mod config;
mod dump_commands;
mod gsi;
mod ipc_events;
mod match_builder;
mod nettable_live;
mod nettable_parser;
mod nettable_service;
mod nettable_setup;
mod nettable_tail;
mod outbox;
mod queen_ladder;
mod steam_auth;
mod supabase;
mod unit_codes;

use config::Config;
use ipc_events::{
    event_json, BackendCommand, BackendStatus, ConfigUpdated, DiagnosticsUploaded, DrodoProfile,
    ErrorEvent, GameUpdated, GamesList, MatchTimeline, NettablePaused, NettableRows, OutboxFlushed,
    PayloadQueued, SteamLogin, SteamLoginUrl, SteamLogout, UpdateApplyRequested,
};
use nettable_service::{parsed_json, rows_json, NettableService};
use nettable_tail::NettableTailer;
use outbox::Outbox;
use std::sync::{Arc, Mutex};
use std::{
    env, fs,
    io::{self, BufRead, Write},
    path::PathBuf,
    thread,
    time::Duration,
};

fn main() -> io::Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let command = args.first().map(String::as_str).unwrap_or("daemon");
    match command {
        "daemon" => run_daemon(),
        "parse-log" => {
            let path = args.get(1).map(PathBuf::from).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "parse-log needs a path")
            })?;
            let rows = nettable_parser::extract_rows(&path)?;
            println!("{}", rows_json(&rows));
            Ok(())
        }
        "parse-log-full" => {
            let path = args.get(1).map(PathBuf::from).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "parse-log-full needs a path")
            })?;
            let parsed = nettable_parser::parse_log(&path)?;
            println!("{}", parsed_json(&parsed));
            Ok(())
        }
        // Same extraction the live standings board consumes — handy for
        // confirming a console.log yields per-player state without a daemon.
        "parse-live" => {
            let path = args.get(1).map(PathBuf::from).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "parse-live needs a path")
            })?;
            let rows = nettable_parser::extract_rows(&path)?;
            let (players, local_ids) =
                nettable_service::live_players_value(&rows, args.get(2).map(String::as_str));
            println!(
                "{}",
                serde_json::json!({ "players": players, "local_steam_ids": local_ids })
            );
            Ok(())
        }
        "queue" => {
            let path = args.get(1).map(PathBuf::from).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "queue needs a payload path")
            })?;
            let cfg = Config::load()?;
            let outbox = Outbox::new(cfg.dac_dir.join("outbox"));
            let body = fs::read_to_string(path)?;
            println!("{}", outbox.enqueue_str(&body)?.display());
            Ok(())
        }
        "outbox-list" => {
            let cfg = Config::load()?;
            let outbox = Outbox::new(cfg.dac_dir.join("outbox"));
            for item in outbox.list()? {
                println!("{}	{} bytes", item.path.display(), item.payload.len());
            }
            Ok(())
        }
        // One-shot replay of queued payloads. The daemon only replays the
        // outbox at startup, so this is the recovery path when an upload
        // failed and the daemon has been running ever since.
        "outbox-flush" => {
            let mut cfg = Config::load()?;
            let outbox = Outbox::new(cfg.dac_dir.join("outbox"));
            let client = supabase::client_with_fresh_session(&mut cfg).map_err(|err| {
                io::Error::new(io::ErrorKind::InvalidInput, err)
            })?;
            let pending = outbox.list()?.len();
            let summary = client.replay_outbox_summary(&cfg, &outbox)?;
            println!(
                "uploaded {} of {pending} pending payloads ({} failed)",
                summary.uploaded, summary.failed
            );
            Ok(())
        }
        "gsi-cfg" => {
            println!("{}", gsi::install_cfg_text(gsi::DEFAULT_PORT));
            Ok(())
        }
        // Recover a match from a console.log that holds its rows but whose
        // upload never happened (capture stopped, daemon restarted, etc.).
        // Tries the end-board path first, then the same fallback writer the
        // daemon uses for left-early matches.
        "finalize-log" => {
            let path = args
                .get(1)
                .map(PathBuf::from)
                .or_else(nettable_setup::find_console_log)
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "finalize-log needs a console.log path (none auto-detected)",
                    )
                })?;
            let rows = nettable_parser::extract_rows(&path)?;
            let mut cfg = Config::load()?;
            let client = supabase::client_with_fresh_session(&mut cfg).map_err(|err| {
                io::Error::new(io::ErrorKind::InvalidInput, err)
            })?;
            match client.upload_finished_match_from_rows(&rows) {
                Ok(Some(match_id)) => {
                    println!("uploaded end-board match {match_id}");
                    return Ok(());
                }
                Ok(None) => {}
                Err(err) => eprintln!("end-board upload failed: {err}"),
            }
            match client.upsert_fallback_finished_match(&rows, "manual_finalize") {
                Ok(Some(match_id)) => println!("uploaded fallback match {match_id}"),
                Ok(None) => println!("no usable match data found in the log"),
                Err(err) => return Err(io::Error::new(io::ErrorKind::Other, err)),
            }
            Ok(())
        }
        "finalize-dump" => {
            let path = args.get(1).map(PathBuf::from).ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "finalize-dump needs a dump path",
                )
            })?;
            let rows = nettable_parser::extract_dump_rows(&path)?;
            let mut cfg = Config::load()?;
            let client = supabase::client_with_fresh_session(&mut cfg).map_err(|err| {
                io::Error::new(io::ErrorKind::InvalidInput, err)
            })?;
            match client.upload_finished_match_from_rows(&rows) {
                Ok(Some(match_id)) => {
                    println!("uploaded end-board match {match_id}");
                    return Ok(());
                }
                Ok(None) => {}
                Err(err) => eprintln!("end-board upload failed: {err}"),
            }
            match client.upsert_fallback_finished_match(&rows, "manual_finalize_dump") {
                Ok(Some(match_id)) => println!("uploaded fallback match {match_id}"),
                Ok(None) => println!("no usable match data found in the dump"),
                Err(err) => return Err(io::Error::new(io::ErrorKind::Other, err)),
            }
            Ok(())
        }
        other => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown command: {other}"),
        )),
    }
}

fn run_daemon() -> io::Result<()> {
    let mut cfg = Config::load()?;
    let outbox = Outbox::new(cfg.dac_dir.join("outbox"));
    let stdout_lock = Arc::new(Mutex::new(()));
    let nettable = NettableService::new();
    let _gsi = {
        let stdout_lock = stdout_lock.clone();
        let nettable_for_gsi = nettable.clone();
        let nettable_for_set = nettable.clone();
        let cfg = cfg.clone();
        let gsi = gsi::GsiServer::spawn_with_callback(gsi::DEFAULT_PORT, move |event| {
            if event == gsi::GsiEvent::DacPostGame {
                let stdout_lock = stdout_lock.clone();
                nettable_for_gsi.handle_post_game(cfg.clone(), move |line| {
                    let _guard = stdout_lock.lock().ok();
                    let _ = emit(&line);
                });
            }
        })
        .ok();
        if let Some(ref g) = gsi {
            nettable_for_set.set_gsi(g.state_arc());
        }
        gsi
    };
    {
        let stdout_lock = stdout_lock.clone();
        nettable.start(cfg.clone(), move |line| {
            let _guard = stdout_lock.lock().ok();
            let _ = emit(&line);
        });
    }
    let outbox_for_replay = outbox.clone();
    thread::spawn(move || {
        let _ = supabase::fresh_client_from_disk().and_then(|client| {
            Config::load()
                .map_err(|err| err.to_string())
                .and_then(|cfg| client.replay_outbox(&cfg, &outbox_for_replay).map_err(|err| err.to_string()))
        });
    });
    emit(&status_json(&cfg))?;

    for line in io::stdin().lock().lines() {
        let line = line?;
        let command = match serde_json::from_str::<BackendCommand>(&line) {
            Ok(command) => command,
            Err(err) => {
                if err.to_string().contains("unknown variant") {
                    emit_error(&format!("unknown command: {err}"))?;
                } else {
                    emit_error(&format!("invalid command: {err}"))?;
                }
                continue;
            }
        };
        match command {
            BackendCommand::Quit => break,
            BackendCommand::Status => emit(&status_json(&cfg))?,
            BackendCommand::QueueIngest { payload } | BackendCommand::QueuePayload { payload } => {
                let path = outbox.enqueue_str(&payload.to_string())?;
                emit(&event_json(&PayloadQueued::new(
                    &path.display().to_string(),
                )))?;
            }
            BackendCommand::SetConfig { key, value } => {
                cfg.save_value(&key, &value.to_string())?;
                emit(&event_json(&ConfigUpdated::new(&key)))?;
            }
            BackendCommand::SteamLogout => {
                cfg.save_value("steam_id", "\"\"")?;
                cfg.save_value("steam_name", "\"\"")?;
                cfg.clear_supabase_session()?;
                cfg.steam_id.clear();
                cfg.steam_name.clear();
                cfg.supabase_access_token.clear();
                cfg.supabase_refresh_token.clear();
                cfg.supabase_token_expires_at.clear();
                emit(&event_json(&SteamLogout::new()))?;
            }
            BackendCommand::SteamLogin => {
                match steam_auth::steam_login_with_opener(
                    Duration::from_secs(120),
                    Some(&cfg.supabase_auth_url),
                    |url| {
                        emit(&event_json(&SteamLoginUrl::new(url))).map_err(|err| err.to_string())
                    },
                ) {
                    Ok(login) => {
                        cfg.save_steam_user(&login.steam_id, &login.steam_name)?;
                        cfg.steam_id = login.steam_id.clone();
                        cfg.steam_name = login.steam_name.clone();
                        if let Some(session) = login.supabase_session {
                            cfg.save_supabase_session(
                                &session.access_token,
                                &session.refresh_token,
                                session.expires_at,
                            )?;
                            cfg.supabase_access_token = session.access_token;
                            cfg.supabase_refresh_token = session.refresh_token;
                            cfg.supabase_token_expires_at = session
                                .expires_at
                                .map(|value| value.to_string())
                                .unwrap_or_default();
                        } else {
                            cfg.clear_supabase_session()?;
                            cfg.supabase_access_token.clear();
                            cfg.supabase_refresh_token.clear();
                            cfg.supabase_token_expires_at.clear();
                        }
                        if let Some(client) = supabase::SupabaseClient::from_config(&cfg) {
                            let _ = client.upsert_user(&login.steam_id, &login.steam_name);
                        }
                        emit(&event_json(&SteamLogin::new(
                            &login.steam_id,
                            &login.steam_name,
                        )))?;
                    }
                    Err(err) => emit_error(&format!("steam_login failed: {err}"))?,
                }
            }
            BackendCommand::ToggleRecording => {
                emit_error("Replay recording is not available in the Rust-only nettable build")?
            }
            BackendCommand::NettableStatus => emit(&nettable.status_json())?,
            BackendCommand::NettableGetState => emit(&nettable.state_json())?,
            BackendCommand::Capture => emit(&nettable.capture_once_json())?,
            BackendCommand::NettableApplyLaunchOptions { flags: _flags } => nettable
                .apply_launch_options(&cfg, |line| {
                    let _ = emit(&line);
                }),
            BackendCommand::NettableCheckActiveMatch => emit(&nettable.check_active_match_json())?,
            BackendCommand::NettableResyncFromSteam => nettable.resync_from_steam(|line| {
                let _ = emit(&line);
            }),
            BackendCommand::NettableSetPaused { paused } => {
                nettable.set_paused(paused);
                emit(&event_json(&NettablePaused::new(paused)))?;
            }
            BackendCommand::NettableUploadQueens => nettable.upload_queens(&cfg, |line| {
                let _ = emit(&line);
            }),
            BackendCommand::NettableConfirmMatchEnd => nettable.confirm_match_left(&cfg, |line| {
                let _ = emit(&line);
            }),
            BackendCommand::FetchGames { request_id } => {
                let steam_id = cfg.steam_id.clone();
                spawn_supabase_request(
                    stdout_lock.clone(),
                    cfg.clone(),
                    move |client, emit_lock| {
                        let event = match client
                            .and_then(|client| client.fetch_games_for_steam_id(&steam_id))
                        {
                            Ok(games) => event_json(&GamesList::ok(request_id, games)),
                            Err(err) => event_json(&GamesList::error(request_id, err)),
                        };
                        emit_threaded(&emit_lock, &event);
                    },
                );
            }
            BackendCommand::FetchTimeline {
                request_id,
                match_id,
            } => {
                spawn_supabase_request(
                    stdout_lock.clone(),
                    cfg.clone(),
                    move |client, emit_lock| {
                        let event = if match_id.is_empty() {
                            event_json(&MatchTimeline::error(
                                request_id,
                                "fetch_timeline missing match_id".to_owned(),
                            ))
                        } else {
                            match client.and_then(|client| client.fetch_match_timeline(&match_id)) {
                                Ok(timeline) => {
                                    event_json(&MatchTimeline::ok(request_id, timeline))
                                }
                                Err(err) => event_json(&MatchTimeline::error(request_id, err)),
                            }
                        };
                        emit_threaded(&emit_lock, &event);
                    },
                );
            }
            BackendCommand::UpdateGame {
                request_id,
                id,
                fields,
            } => {
                spawn_supabase_request(
                    stdout_lock.clone(),
                    cfg.clone(),
                    move |client, emit_lock| {
                        let event = if id == 0 {
                            event_json(&GameUpdated::error(
                                request_id,
                                "update_game missing id".to_owned(),
                            ))
                        } else {
                            match client.and_then(|client| client.update_game_fields(id, &fields)) {
                                Ok(()) => event_json(&GameUpdated::ok(request_id)),
                                Err(err) => event_json(&GameUpdated::error(request_id, err)),
                            }
                        };
                        emit_threaded(&emit_lock, &event);
                    },
                );
            }
            BackendCommand::FetchDrodo { request_id } => {
                let steam_id = cfg.steam_id.clone();
                spawn_supabase_request(
                    stdout_lock.clone(),
                    cfg.clone(),
                    move |client, emit_lock| {
                        let event =
                            match client.and_then(|client| client.fetch_drodo_profile(&steam_id)) {
                                Ok(profile) => event_json(&DrodoProfile::ok(request_id, profile)),
                                Err(err) => event_json(&DrodoProfile::error(request_id, err)),
                            };
                        emit_threaded(&emit_lock, &event);
                    },
                );
            }
            BackendCommand::RefreshDrodo { request_id } => {
                let steam_id = cfg.steam_id.clone();
                spawn_supabase_request(
                    stdout_lock.clone(),
                    cfg.clone(),
                    move |client, emit_lock| {
                        let event = match client
                            .and_then(|client| client.refresh_drodo_profile(&steam_id))
                        {
                            Ok(profile) => event_json(&DrodoProfile::ok(request_id, profile)),
                            Err(err) => event_json(&DrodoProfile::error(request_id, err)),
                        };
                        emit_threaded(&emit_lock, &event);
                    },
                );
            }
            BackendCommand::FlushOutbox { request_id } => {
                let cfg_for_outbox = cfg.clone();
                spawn_supabase_request(
                    stdout_lock.clone(),
                    cfg.clone(),
                    move |client, emit_lock| {
                        let event = match client {
                            Ok(client) => {
                                let outbox = Outbox::new(cfg_for_outbox.dac_dir.join("outbox"));
                                match client.replay_outbox_summary(&cfg_for_outbox, &outbox) {
                                    Ok(summary) => event_json(&OutboxFlushed::complete(
                                        request_id,
                                        summary.pending,
                                        summary.uploaded,
                                        summary.failed,
                                        summary.last_error,
                                    )),
                                    Err(err) => event_json(&OutboxFlushed::error(
                                        request_id,
                                        err.to_string(),
                                    )),
                                }
                            }
                            Err(err) => event_json(&OutboxFlushed::error(request_id, err)),
                        };
                        emit_threaded(&emit_lock, &event);
                    },
                );
            }
            BackendCommand::UploadLogs { reason } => {
                let reason = reason.unwrap_or_else(|| "manual".to_owned());
                match supabase::fresh_client_from_disk() {
                    Ok(client) => match Config::load().and_then(|cfg| {
                        client
                            .upload_diagnostic_logs(
                                &cfg,
                                &reason,
                                nettable_setup::find_console_log(),
                            )
                            .map_err(|err| io::Error::new(io::ErrorKind::Other, err))
                    }) {
                        Ok(summary) => emit(&event_json(&DiagnosticsUploaded::complete(
                            &summary.reason,
                            summary.storage_ok,
                            summary.paths,
                            summary.tracker_bytes,
                            summary.console_bytes,
                            summary.console_found,
                        )))?,
                        Err(err) => emit(&event_json(&DiagnosticsUploaded::failed(
                            &reason,
                            &err.to_string(),
                        )))?,
                    },
                    Err(err) => emit(&event_json(&DiagnosticsUploaded::failed(&reason, &err)))?,
                }
            }
            BackendCommand::DoUpdate => emit(&event_json(&UpdateApplyRequested::new()))?,
            BackendCommand::ParseLog { path } => {
                if let Some(path) = path {
                    match nettable_parser::extract_rows(PathBuf::from(path).as_path()) {
                        Ok(rows) => emit(&event_json(&NettableRows::new(
                            nettable_service::rows_value(&rows),
                        )))?,
                        Err(err) => emit_error(&format!("parse_log failed: {err}"))?,
                    }
                } else {
                    emit_error("parse_log missing path")?;
                }
            }
            BackendCommand::TailLogOnce { path } => {
                if let Some(path) = path {
                    let mut tailer = NettableTailer::new(PathBuf::from(path));
                    match tailer.poll() {
                        Ok(Some(rows)) => emit(&event_json(&NettableRows::new(
                            nettable_service::rows_value(&rows),
                        )))?,
                        Ok(None) => emit(&event_json(&NettableRows::new(serde_json::json!([]))))?,
                        Err(err) => emit_error(&format!("tail_log_once failed: {err}"))?,
                    }
                } else {
                    emit_error("tail_log_once missing path")?;
                }
            }
        }
    }

    Ok(())
}

fn status_json(cfg: &Config) -> String {
    event_json(&BackendStatus::new(
        &cfg.steam_id,
        &cfg.steam_name,
        cfg.replay_enabled,
        has_upload_auth_session(cfg),
    ))
}

fn has_upload_auth_session(cfg: &Config) -> bool {
    if cfg.steam_id.trim().is_empty() {
        return false;
    }
    if cfg.local_only || cfg.supabase_url.trim().is_empty() || cfg.supabase_key.trim().is_empty() {
        return true;
    }
    !cfg.supabase_access_token.trim().is_empty() || !cfg.supabase_refresh_token.trim().is_empty()
}

fn spawn_supabase_request<F>(stdout_lock: Arc<Mutex<()>>, cfg: Config, f: F)
where
    F: FnOnce(Result<supabase::SupabaseClient, String>, Arc<Mutex<()>>) + Send + 'static,
{
    thread::spawn(move || {
        let mut cfg = cfg;
        let client = supabase::client_with_fresh_session(&mut cfg);
        f(client, stdout_lock);
    });
}

fn emit_threaded(stdout_lock: &Arc<Mutex<()>>, line: &str) {
    let _guard = stdout_lock.lock().ok();
    let _ = emit(line);
}

fn emit(line: &str) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    stdout.write_all(line.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

fn emit_error(message: &str) -> io::Result<()> {
    emit(&event_json(&ErrorEvent::new(message)))
}

#[allow(dead_code)]
fn sleep_interval() -> Duration {
    Duration::from_millis(250)
}
