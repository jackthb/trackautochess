mod config;
mod gsi;
mod hotkeys;
mod nettable_parser;
mod nettable_service;
mod nettable_tail;
mod outbox;
mod queen_ladder;
mod steam_auth;
mod supabase;
mod unit_codes;

use config::Config;
use nettable_service::{parsed_json, rows_json, NettableService};
use nettable_tail::NettableTailer;
use outbox::Outbox;
use std::sync::{Arc, Mutex};
use std::{
    env, fs,
    io::{self, BufRead, Write},
    path::PathBuf,
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
        "gsi-cfg" => {
            println!("{}", gsi::install_cfg_text(gsi::DEFAULT_PORT));
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
        let nettable = nettable.clone();
        let cfg = cfg.clone();
        gsi::GsiServer::spawn_with_callback(gsi::DEFAULT_PORT, move |event| {
            if event == gsi::GsiEvent::DacPostGame {
                let stdout_lock = stdout_lock.clone();
                nettable.handle_post_game(cfg.clone(), move |line| {
                    let _guard = stdout_lock.lock().ok();
                    let _ = emit(&line);
                });
            }
        })
        .ok()
    };
    {
        let stdout_lock = stdout_lock.clone();
        nettable.start(cfg.clone(), move |line| {
            let _guard = stdout_lock.lock().ok();
            let _ = emit(&line);
        });
    }
    if let Some(client) = supabase::SupabaseClient::from_config(&cfg) {
        let _ = client.replay_outbox(&outbox);
    }
    emit(&status_json(&cfg))?;

    for line in io::stdin().lock().lines() {
        let line = line?;
        let cmd = json_string_field(&line, "cmd").unwrap_or_default();
        match cmd.as_str() {
            "quit" => break,
            "status" => emit(&status_json(&cfg))?,
            "queue_ingest" | "queue_payload" => {
                let payload =
                    json_object_field(&line, "payload").unwrap_or_else(|| "{}".to_owned());
                let path = outbox.enqueue_str(&payload)?;
                emit(&format!(
                    r#"{{"type":"payload_queued","path":{}}}"#,
                    json_string(&path.display().to_string())
                ))?;
            }
            "set_config" => {
                if let Some(key) = json_string_field(&line, "key") {
                    let value = json_field_raw(&line, "value").unwrap_or_else(|| "null".to_owned());
                    cfg.save_value(&key, &value)?;
                    emit(&format!(
                        r#"{{"type":"config_updated","key":{}}}"#,
                        json_string(&key)
                    ))?;
                } else {
                    emit_error("set_config missing key")?;
                }
            }
            "steam_logout" => {
                cfg.save_value("steam_id", "\"\"")?;
                cfg.save_value("steam_name", "\"\"")?;
                cfg.steam_id.clear();
                cfg.steam_name.clear();
                emit(r#"{"type":"steam_logout"}"#)?;
            }
            "steam_login" => {
                match steam_auth::steam_login_with_opener(Duration::from_secs(120), |url| {
                    emit(&format!(
                        r#"{{"type":"steam_login_url","url":{}}}"#,
                        json_string(url)
                    ))
                    .map_err(|err| err.to_string())
                }) {
                    Ok((steam_id, steam_name)) => {
                        cfg.save_steam_user(&steam_id, &steam_name)?;
                        cfg.steam_id = steam_id.clone();
                        cfg.steam_name = steam_name.clone();
                        if let Some(client) = supabase::SupabaseClient::from_config(&cfg) {
                            let _ = client.upsert_user(&steam_id, &steam_name);
                        }
                        emit(&format!(
                            r#"{{"type":"steam_login","steam_id":{},"steam_name":{}}}"#,
                            json_string(&steam_id),
                            json_string(&steam_name)
                        ))?;
                    }
                    Err(err) => emit_error(&format!("steam_login failed: {err}"))?,
                }
            }
            "toggle_recording" => {
                emit_error("Replay recording is not available in the Rust-only nettable build")?
            }
            "nettable_status" => emit(&nettable.status_json())?,
            "nettable_get_state" => emit(&nettable.state_json())?,
            "capture" => emit(&nettable.capture_once_json())?,
            "nettable_apply_launch_options" => nettable.apply_launch_options(&cfg, |line| {
                let _ = emit(&line);
            }),
            "nettable_check_active_match" => emit(&nettable.check_active_match_json())?,
            "nettable_resync_from_steam" => nettable.resync_from_steam(|line| {
                let _ = emit(&line);
            }),
            "nettable_set_paused" => {
                let paused = json_bool_field(&line, "paused").unwrap_or(false);
                nettable.set_paused(paused);
                emit(&format!(
                    r#"{{"type":"nettable_paused","backend":"rust","paused":{}}}"#,
                    if paused { "true" } else { "false" }
                ))?;
            }
            "nettable_upload_queens" => nettable.upload_queens(&cfg, |line| {
                let _ = emit(&line);
            }),
            "upload_logs" => {
                let reason =
                    json_string_field(&line, "reason").unwrap_or_else(|| "manual".to_owned());
                match supabase::SupabaseClient::from_config(&cfg) {
                    Some(client) => match client.upload_diagnostic_logs(
                        &cfg,
                        &reason,
                        nettable_service::find_console_log(),
                    ) {
                        Ok(summary) => emit(&summary.event_json())?,
                        Err(err) => emit(&format!(
                            r#"{{"type":"diagnostics_uploaded","backend":"rust","storage_ok":false,"reason":{},"paths":{{}},"message":{}}}"#,
                            json_string(&reason),
                            json_string(&err)
                        ))?,
                    },
                    None => emit(&format!(
                        r#"{{"type":"diagnostics_uploaded","backend":"rust","storage_ok":false,"reason":{},"paths":{{}},"message":"Supabase is not configured."}}"#,
                        json_string(&reason)
                    ))?,
                }
            }
            "do_update" => emit(r#"{"type":"update_apply_requested","backend":"rust","ok":true}"#)?,
            "parse_log" => {
                if let Some(path) = json_string_field(&line, "path") {
                    match nettable_parser::extract_rows(PathBuf::from(path).as_path()) {
                        Ok(rows) => emit(&format!(
                            r#"{{"type":"nettable_rows","rows":{}}}"#,
                            rows_json(&rows)
                        ))?,
                        Err(err) => emit_error(&format!("parse_log failed: {err}"))?,
                    }
                } else {
                    emit_error("parse_log missing path")?;
                }
            }
            "tail_log_once" => {
                if let Some(path) = json_string_field(&line, "path") {
                    let mut tailer = NettableTailer::new(PathBuf::from(path));
                    match tailer.poll() {
                        Ok(Some(rows)) => emit(&format!(
                            r#"{{"type":"nettable_rows","rows":{}}}"#,
                            rows_json(&rows)
                        ))?,
                        Ok(None) => emit(r#"{"type":"nettable_rows","rows":[]}"#)?,
                        Err(err) => emit_error(&format!("tail_log_once failed: {err}"))?,
                    }
                } else {
                    emit_error("tail_log_once missing path")?;
                }
            }
            "" => emit_error("missing cmd")?,
            other => emit_error(&format!("unknown command: {other}"))?,
        }
    }

    Ok(())
}

fn status_json(cfg: &Config) -> String {
    format!(
        r#"{{"type":"status","backend":"rust","recording":false,"focused":false,"logged_in":{},"steam_id":{},"steam_name":{},"replay_enabled":{}}}"#,
        if cfg.steam_id.is_empty() {
            "false"
        } else {
            "true"
        },
        json_string(&cfg.steam_id),
        json_string(&cfg.steam_name),
        if cfg.replay_enabled { "true" } else { "false" }
    )
}

fn json_string(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

fn json_string_field(body: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let start = rest.find('"')? + 1;
    let mut out = String::new();
    let mut escaped = false;
    for ch in rest[start..].chars() {
        if escaped {
            out.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

fn json_field_raw(body: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let value = rest.trim_start();
    if value.starts_with('{') {
        return json_object_field(body, key);
    }
    if value.starts_with('"') {
        return json_string_field(body, key).map(|v| json_string(&v));
    }
    let end = value
        .find(|ch: char| ch == ',' || ch == '}')
        .unwrap_or(value.len());
    Some(value[..end].trim().to_owned())
}

fn json_bool_field(body: &str, key: &str) -> Option<bool> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let value = rest.trim_start();
    if value.starts_with("true") {
        Some(true)
    } else if value.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

fn json_object_field(body: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let start = rest.find('{')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (idx, ch) in rest[start..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if in_string {
            if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(rest[start..start + idx + 1].to_owned());
                }
            }
            _ => {}
        }
    }
    None
}

fn emit(line: &str) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    stdout.write_all(line.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

fn emit_error(message: &str) -> io::Result<()> {
    emit(&format!(
        r#"{{"type":"error","message":{}}}"#,
        json_string(message)
    ))
}

#[allow(dead_code)]
fn sleep_interval() -> Duration {
    Duration::from_millis(250)
}
