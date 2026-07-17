pub use crate::nettable_live::live_players_value;
use crate::{
    config::Config,
    gsi::GsiState,
    dump_commands::{
        dota_has_foreground_focus, send_dump_keys_forcing_dota_focus,
        send_dump_keys_if_dota_focused, DumpKey,
    },
    ipc_events::{
        event_json, NettableCheckActiveMatch, NettableCreepRound, NettableEndBoardSaved,
        NettableGameEnded, NettableIngestComplete, NettableIngestError, NettableMatchLeftPending,
        NettableMatchLeftResolved, NettablePersonalGameEnded, NettableQueenUploadComplete,
        NettableQueenUploadProgress, NettableRankingScanned, NettableResyncComplete,
        NettableRoundChanged, NettableStateEvent, NettableStatus, NettableTimelineExtracted,
    },
    match_builder::{
        build_match_timeline, extract_death_team_from_rows, extract_round_from_rows,
        store_session_dump, SessionDump,
    },
    nettable_parser::{self, NettableRow, ParsedLog},
    nettable_setup::{
        apply_dota_launch_options, find_any_dota_launch_options, find_autoexec_target,
        find_console_log, find_dota_dir, find_dota_launch_options_for_steam_id,
        find_gsi_cfg_target, install_autoexec, install_gsi_cfg, is_steam_running,
        request_steam_shutdown, setup_progress, setup_result_error, tokenize_launch_options,
        wait_for_steam_exit, DEFAULT_GSI_PORT, REQUIRED_LAUNCH_FLAGS,
    },
    outbox::Outbox,
    queen_ladder,
    supabase::{finished_match_id_from_rows, fresh_client_from_disk, parse_valid_steam_id64},
};
use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime},
};

const QUEEN_LADDER_AUTO_SYNC_INTERVAL: Duration = Duration::from_secs(600);
/// How long a left-match snapshot is held before it uploads as-is. DAC allows
/// reconnecting to an ongoing game, so uploading immediately would
/// double-record the match if the player rejoins and finishes it.
const LEFT_MATCH_UPLOAD_GRACE: Duration = Duration::from_secs(30 * 60);
const POST_GAME_END_BOARD_ATTEMPTS: usize = 10;
const POST_GAME_DUMP_WAIT: Duration = Duration::from_millis(1200);
const PREFERRED_CAPTURE_STEAM_IDS: &[&str] = &[
    "76561198022169086", // Jack
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DumpCommandResult {
    transport: &'static str,
}

#[derive(Clone)]
pub struct NettableService {
    state: Arc<Mutex<NettableState>>,
    /// Shared with the GsiServer so all clones see the same GSI state.
    gsi: Arc<Mutex<Option<Arc<Mutex<GsiState>>>>>,
}

/// Snapshot of a match the local player left before it finished, held until
/// the user confirms they're not rejoining, the grace window lapses, or a
/// different lobby starts. Rejoining the same lobby discards it.
#[derive(Debug)]
struct PendingLeftMatch {
    rows: Vec<NettableRow>,
    roster: Vec<String>,
    deadline: Instant,
}

#[derive(Debug, Default)]
struct NettableState {
    paused: bool,
    log_path: Option<PathBuf>,
    last_modified: Option<SystemTime>,
    latest_rows: Vec<NettableRow>,
    latest_parsed: ParsedLog,
    /// The local player's steam_id (from config), used to flag "You" in the
    /// live standings. None until `start()` runs with a logged-in config.
    local_steam_id: Option<String>,
    /// Last Dota UI state seen in console.log (`ChangeGameUIState` target).
    /// Used to detect when a match leaves gameplay.
    last_ui_state: Option<String>,
    /// Console timestamp for the transition into the active match. This is the
    /// stable per-game identity salt; unlike end_board dump time it does not
    /// change if post-game dump commands run repeatedly.
    match_started_at: Option<String>,
    /// Set by `poll_once` when the UI left `DOTA_GAME_UI_DOTA_INGAME`; the
    /// capture loop consumes it to finalize the match (GSI-independent).
    pending_match_end: bool,
    /// Preferred capture owner for multi-observer lobbies. None means the
    /// roster is unknown or no preferred owner is present, so capture fails open.
    capture_owner_steam_id: Option<String>,
    /// Last observed DAC round. Round changes drive frontend notifications and
    /// let us keep parity with the Python capture cascade.
    last_round: Option<i64>,
    /// Current match roster fingerprint, if known. Used to segment buffered
    /// dumps into match sessions for timeline extraction.
    match_roster_fingerprint: Option<Vec<String>>,
    /// In-memory per-dump snapshots for the active/recent match. Each dump is a
    /// stable full parse of console.log at that point in time.
    session_dumps: Vec<SessionDump>,
    /// Local-player elimination detection cache. POST_GAME only fires when the
    /// whole lobby ends; this catches the local player dying earlier.
    prev_personal_death_team: Option<i64>,
    personal_end_recorded: bool,
    own_slot_key: Option<String>,
    own_team_id: Option<i64>,
    last_own_player_payload: Option<serde_json::Value>,
    /// Last automatic Queen ladder sync. Dota's ranking table is dumped on the
    /// metadata cadence; throttle uploads so a visible Queen list stays fresh
    /// without re-writing Supabase on every poll.
    last_ranking_top_sync_at: Option<Instant>,
    /// End-board match ids already uploaded by this daemon process. Dota keeps
    /// the finished end_board in console.log, so without this the poller would
    /// keep re-upserting and mutating played_at every heartbeat after a game.
    uploaded_end_board_match_ids: HashSet<String>,
    /// Held snapshot of a match the local player left early. See
    /// [`PendingLeftMatch`].
    pending_left_match: Option<PendingLeftMatch>,
    /// True once we have seen at least one DAC-specific table in the current
    /// match. Guards against recording or uploading dumps from regular Dota
    /// games that also produce `DOTA_GAME_UI_DOTA_INGAME` transitions.
    is_dac_match: bool,
    /// True when live data shows the game is decided (one player left with
    /// HP). Drives a faster dac_table dump cadence so the end_board is
    /// captured the moment it publishes instead of waiting out the normal
    /// cadence — which misses it if the player tabs out or quits right away.
    endgame_burst: bool,
    /// A held snapshot that a *different* lobby superseded; staged so the
    /// upload happens outside the state lock on the next loop tick.
    pending_left_match_flush: Option<PendingLeftMatch>,
}

impl NettableService {
    pub fn new() -> Self {
        let log_path = find_console_log();
        Self {
            state: Arc::new(Mutex::new(NettableState {
                log_path,
                ..NettableState::default()
            })),
            gsi: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_gsi(&self, gsi_state: Arc<Mutex<GsiState>>) {
        if let Ok(mut g) = self.gsi.lock() {
            *g = Some(gsi_state);
        }
    }

    pub fn start<F>(&self, cfg: Config, emit: F)
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        if !cfg.steam_id.is_empty() {
            if let Ok(mut state) = self.state.lock() {
                state.local_steam_id = Some(cfg.steam_id.clone());
            }
        }
        let _ = install_autoexec();
        let _ = install_gsi_cfg(DEFAULT_GSI_PORT);
        let state = self.state.clone();
        let gsi = self.gsi.clone();
        let emit = Arc::new(emit);
        thread::spawn(move || {
            let mut last_game_info_fire = Instant::now() - Duration::from_secs(10);
            let mut last_player_fire = Instant::now() - Duration::from_secs(30);
            let mut last_metadata_fire = Instant::now() - Duration::from_secs(60);
            let mut last_status_fire = Instant::now() - Duration::from_secs(10);
            let mut last_dota_focused = false;
            loop {
                maybe_fire_dump_commands(
                    &state,
                    &emit,
                    &mut last_game_info_fire,
                    &mut last_player_fire,
                    &mut last_metadata_fire,
                    &mut last_dota_focused,
                );
                // Re-publish status on a heartbeat so the setup card reflects
                // reality (Dota launched, log went stale) without the user
                // reopening the app. The frontend only requests it on mount.
                if last_status_fire.elapsed() >= Duration::from_secs(5) {
                    last_status_fire = Instant::now();
                    emit(nettable_status_json(&state));
                }
                let result = poll_once(&state, &cfg);
                match result {
                    Ok(Some(rows)) => {
                        if !rows.is_empty() {
                            // Latch is_dac_match from GSI workshop ID confirmation.
                            if gsi_state_is_dac_active(&gsi) {
                                if let Ok(mut s) = state.lock() {
                                    s.is_dac_match = true;
                                }
                            }
                            emit(state_json_from(&state));
                            emit(event_json(&NettableIngestComplete::new(
                                rows.len(),
                                table_names(&rows),
                                &now_iso_utc(),
                            )));
                            for event in handle_rows_for_parity(&state, &rows) {
                                emit(event);
                            }
                            if let Some(event) =
                                maybe_auto_upload_queen_ladder(&state, &rows, &cfg.dac_dir)
                            {
                                emit(event);
                            }
                            if local_is_capture_owner(&state) {
                                let needs_upload = finished_match_id_from_rows(&rows)
                                    .map(|match_id| !end_board_already_uploaded(&state, &match_id))
                                    .unwrap_or(false);
                                match fresh_client_from_disk() {
                                    Ok(client) => {
                                    if let Some(match_id) = finished_match_id_from_rows(&rows) {
                                        if end_board_already_uploaded(&state, &match_id) {
                                            continue;
                                        }
                                        if client.finished_match_has_players(&match_id) {
                                            mark_end_board_uploaded(&state, &match_id);
                                            if let Some(timeline) =
                                                build_match_timeline_from_state(&state, &match_id)
                                            {
                                                let _ = client.upsert_match_timeline(&timeline);
                                            }
                                            continue;
                                        }
                                    }
                                    match client.upload_finished_match_from_rows(&rows) {
                                        Ok(Some(match_id)) => {
                                            mark_end_board_uploaded(&state, &match_id);
                                            if let Some(timeline) =
                                                build_match_timeline_from_state(&state, &match_id)
                                            {
                                                let _ = client.upsert_match_timeline(&timeline);
                                                let round_count = timeline
                                                    .get("round_count")
                                                    .and_then(serde_json::Value::as_u64)
                                                    .unwrap_or(0);
                                                emit(event_json(&NettableTimelineExtracted::new(
                                                    &match_id,
                                                    round_count,
                                                    &now_iso_utc(),
                                                )));
                                            }
                                            emit(event_json(&NettableEndBoardSaved::new(
                                                &match_id,
                                                &now_iso_utc(),
                                            )));
                                        }
                                        Ok(None) => {}
                                        Err(err) => {
                                            emit(event_json(
                                                &NettableIngestError::with_backend_at(
                                                    &format!("end_board upload failed: {err}"),
                                                    &now_iso_utc(),
                                                ),
                                            ));
                                            emit_fallback_finalize(&rows, &emit, "End-board upload failed; saved a partial match from the last live snapshot.");
                                        }
                                    }
                                    }
                                    Err(err) if needs_upload => {
                                        emit(event_json(&NettableIngestError::with_backend_at(
                                            &format!("end_board upload failed: {err}"),
                                            &now_iso_utc(),
                                        )));
                                        emit_fallback_finalize(&rows, &emit, "End-board upload failed; saved a partial match from the last live snapshot.");
                                    }
                                    Err(_) => {}
                                }
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(err) => emit(event_json(&NettableIngestError::new(&err.to_string()))),
                }
                // Finalize when Dota leaves the match (UI returned to the menu).
                // This is the GSI-independent path: many setups never deliver a
                // post-game GSI event, so without this a finished match never
                // reacts at all.
                let match_ended = state
                    .lock()
                    .map(|mut s| std::mem::take(&mut s.pending_match_end))
                    .unwrap_or(false);
                if match_ended {
                    finalize_on_match_left(&state, &cfg, &emit);
                }
                for line in tick_pending_left_match(&state, &cfg) {
                    emit(line);
                }
                thread::sleep(Duration::from_millis(750));
            }
        });
    }

    pub fn set_paused(&self, paused: bool) {
        if let Ok(mut state) = self.state.lock() {
            state.paused = paused;
        }
    }

    /// User confirmed the match they left is over and they're not rejoining:
    /// upload the held snapshot now instead of waiting out the grace window.
    pub fn confirm_match_left<F>(&self, _cfg: &Config, emit: F)
    where
        F: Fn(String),
    {
        let pending = self.state.lock().ok().and_then(|mut s| {
            s.pending_left_match
                .take()
                .or_else(|| s.pending_left_match_flush.take())
        });
        match pending {
            Some(pending) => {
                for line in flush_pending_left_match(pending, "left_match_confirmed") {
                    emit(line);
                }
            }
            None => emit(event_json(&NettableMatchLeftResolved::new(
                "nothing_pending",
                None,
                "No left match is waiting for confirmation.",
                &now_iso_utc(),
            ))),
        }
    }

    pub fn status_json(&self) -> String {
        nettable_status_json(&self.state)
    }

    pub fn state_json(&self) -> String {
        state_json_from(&self.state)
    }

    pub fn apply_launch_options<F>(&self, cfg: &Config, emit: F)
    where
        F: Fn(String),
    {
        if is_steam_running() {
            emit(setup_progress(
                "nettable_launch_options_progress",
                "closing_steam",
                "Asking Steam to quit…",
            ));
            if !request_steam_shutdown() {
                emit(setup_result_error(
                    "Couldn't find steam.exe to close Steam automatically. Quit Steam fully, then try again.",
                ));
                return;
            }
            emit(setup_progress(
                "nettable_launch_options_progress",
                "waiting_steam_exit",
                "Waiting for Steam to flush its setup file…",
            ));
            if !wait_for_steam_exit(Duration::from_secs(20)) {
                emit(setup_result_error("Steam didn't quit within 20s."));
                return;
            }
        }

        emit(setup_progress(
            "nettable_launch_options_progress",
            "writing",
            "Writing Dota setup…",
        ));
        let autoexec = match install_autoexec() {
            Ok(path) => path,
            Err(err) => {
                emit(setup_result_error(&format!("autoexec setup failed: {err}")));
                return;
            }
        };
        let gsi_cfg = install_gsi_cfg(DEFAULT_GSI_PORT).ok();
        match apply_dota_launch_options(REQUIRED_LAUNCH_FLAGS, cfg.steam_id.as_str()) {
            Ok(applied) => {
                emit(applied.event_json(&autoexec, gsi_cfg.as_deref()));
                emit(nettable_status_json(&self.state));
            }
            Err(message) => emit(setup_result_error(&message)),
        }
    }

    pub fn resync_from_steam<F>(&self, emit: F)
    where
        F: Fn(String),
    {
        if !is_steam_running() {
            emit(event_json(&NettableResyncComplete::ok(true)));
            emit(nettable_status_json(&self.state));
            return;
        }
        emit(setup_progress(
            "nettable_resync_progress",
            "closing_steam",
            "Asking Steam to quit…",
        ));
        if !request_steam_shutdown() {
            emit(event_json(&NettableResyncComplete::error(
                "Couldn't find steam.exe to close Steam automatically.",
            )));
            return;
        }
        emit(setup_progress(
            "nettable_resync_progress",
            "waiting_steam_exit",
            "Waiting for Steam to flush its state…",
        ));
        if !wait_for_steam_exit(Duration::from_secs(20)) {
            emit(event_json(&NettableResyncComplete::error(
                "Steam didn't quit within 20s.",
            )));
            return;
        }
        emit(event_json(&NettableResyncComplete::ok(false)));
        emit(nettable_status_json(&self.state));
    }

    pub fn capture_once_json(&self) -> String {
        self.set_paused(false);
        match send_dump_commands_forcing_focus(&[DumpKey::F23, DumpKey::F22, DumpKey::F20, DumpKey::F21])
        {
            Ok(result) => event_json(&NettableCheckActiveMatch::new(
                "Requested a manual lobby snapshot.",
                Some(result.transport),
                &now_iso_utc(),
            )),
            Err(err) => event_json(&NettableIngestError::new(&format!(
                "manual capture failed: {err}"
            ))),
        }
    }

    pub fn check_active_match_json(&self) -> String {
        self.set_paused(false);
        match send_dump_commands_forcing_focus(&[
            DumpKey::F23,
            DumpKey::F22,
            DumpKey::F20,
            DumpKey::F24,
            DumpKey::F16,
            DumpKey::F21,
        ]) {
            Ok(result) => event_json(&NettableCheckActiveMatch::new(
                "Requested a full live lobby snapshot. Dota was focused briefly if needed so dump keys could land.",
                Some(result.transport),
                &now_iso_utc(),
            )),
            Err(err) => event_json(&NettableIngestError::new(&format!(
                "active match check failed: {err}"
            ))),
        }
    }

    pub fn handle_post_game<F>(&self, cfg: Config, emit: F)
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        let state = self.state.clone();
        let emit = Arc::new(emit);
        thread::spawn(move || {
            if let Ok(mut state) = state.lock() {
                state.paused = false;
            }
            if !local_is_capture_owner(&state) {
                let owner = capture_owner_steam_id(&state).unwrap_or_else(|| "unknown".to_owned());
                let message = format!(
                    "Dota reported post-game; standing down for preferred capture owner {owner}."
                );
                emit(event_json(&NettableGameEnded::new(
                    &message,
                    None,
                    &now_iso_utc(),
                )));
                return;
            }
            let rows = chase_post_game_end_board(&state, &cfg, &emit, "Dota reported post-game");
            if upload_end_board_if_present(
                &state,
                &rows,
                &emit,
                "post-game end_board upload failed",
            ) {
                return;
            }
            match finalize_without_end_board(&rows) {
                Ok(Some(match_id)) => emit(event_json(&NettableGameEnded::new(
                    "Marked the match finished from the last live snapshot after end_board did not appear.",
                    Some(&match_id),
                    &now_iso_utc(),
                ))),
                Ok(None) => emit(event_json(&NettableGameEnded::new(
                    "Post-game ended, but there was no usable lobby snapshot to finalize.",
                    None,
                    &now_iso_utc(),
                ))),
                Err(err) => emit(event_json(&NettableIngestError::new(&format!(
                    "post-game fallback finalize failed: {err}"
                )))),
            }
        });
    }

    /// Force a fresh Queen-ladder scan and upsert the discovered players.
    ///
    /// Mirrors the Python `manual_upload_queen_ladder`: ask Dota to redump the
    /// ranking_top_table (unless capture is paused/disabled), wait for the log
    /// to land, parse it, and upsert the players to `users`. Progress and the
    /// final result are streamed through `emit`.
    pub fn upload_queens<F>(&self, cfg: &Config, emit: F)
    where
        F: Fn(String),
    {
        emit(queen_progress(
            "Checking the current Queen list…",
            &now_iso_utc(),
        ));

        let outcome = (|| -> Result<(usize, usize, String), String> {
            let (log_path, paused) = {
                let state = self.state.lock().unwrap();
                (
                    state.log_path.clone().or_else(find_console_log),
                    state.paused,
                )
            };
            let log_path = log_path.filter(|path| path.exists()).ok_or_else(|| {
                "Dota log not found. Start Dota, enter a DAC lobby, then try again.".to_owned()
            })?;

            if paused {
                emit(queen_progress(
                    "Capture is paused; uploading the most recent Queen list we can see…",
                    &now_iso_utc(),
                ));
            } else if cfg.local_only {
                emit(queen_progress(
                    "Tracking is disabled; uploading the most recent Queen list we can see…",
                    &now_iso_utc(),
                ));
            } else if is_dota_running() {
                emit(queen_progress(
                    "Asking Dota for the current Queen list…",
                    &now_iso_utc(),
                ));
                // F24 dumps ranking_top_table (+ player_id_table). Only worth
                // sending when Dota is actually running — otherwise the keys go
                // nowhere and we'd just be spamming the foreground app.
                let _ = send_dump_commands_forcing_focus(&[DumpKey::F24]);
                // Dota writes console.log asynchronously; give the stringtable
                // block time to land before parsing the full file.
                thread::sleep(Duration::from_millis(2500));
            } else {
                emit(queen_progress(
                    "Dota isn't running; uploading the most recent Queen list we can see…",
                    &now_iso_utc(),
                ));
            }

            let parsed = nettable_parser::parse_log(&log_path)
                .map_err(|err| format!("Could not read the Dota log: {err}"))?;
            let ranking_raw = parsed
                .iter()
                .find(|(table, _)| table.ends_with("ranking_top_table"))
                .and_then(|(_, entries)| entries.get("ranking_top"))
                .map(|value| value.to_value())
                .ok_or_else(|| queen_list_missing_message(&log_path))?;

            let scanned_at = now_iso_utc();
            let players = queen_ladder::extract_ranking_top_players(&ranking_raw, &scanned_at);
            if players.is_empty() {
                return Err("Found the Queen list, but it did not contain any players.".to_owned());
            }
            let season = players[0].season.clone().unwrap_or_default();
            let outbox_path = persist_queen_ladder_locally(&cfg.dac_dir, &players, &scanned_at)?;
            emit(queen_progress(
                &format!(
                    "Saved {} Queen players locally; uploading…",
                    players.len()
                ),
                &scanned_at,
            ));
            let upserted = upload_persisted_queen_ladder(&cfg.dac_dir, &outbox_path, &players)
                .map_err(|err| {
                    format!(
                        "{err} (saved locally in outbox until the next successful push)"
                    )
                })?;
            Ok((players.len(), upserted, season))
        })();

        let at = now_iso_utc();
        match outcome {
            Ok((player_count, upserted, season)) => {
                let ok = upserted > 0;
                let error = if ok {
                    None
                } else {
                    Some(format!(
                        "Found {player_count} Queen players, but the database wrote 0 rows. Kept locally until the next successful push."
                    ))
                };
                emit(event_json(&NettableQueenUploadComplete::complete(
                    player_count,
                    upserted,
                    &season,
                    error.as_deref(),
                    &at,
                )));
            }
            Err(message) => emit(event_json(&NettableQueenUploadComplete::failed(
                &message, &at,
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nettable_parser::extract_rows;
    use std::collections::BTreeMap;
    use std::path::Path;

    // The live standings board was dead because the migration hardcoded
    // `players: {}`. This guards the revived extraction against a real dump.
    #[test]
    fn live_players_value_extracts_per_player_state() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/nettable_golden/player_info_colon_buffs/console.log");
        let rows = extract_rows(&fixture).expect("fixture parses");
        let (players, local_ids) = live_players_value(&rows, Some("76561198022169086"));

        let players = players.as_object().expect("players is an object");
        assert!(!players.is_empty(), "expected at least one live player");
        let player = players
            .get("76561198022169086")
            .and_then(|p| p.as_object())
            .expect("local player present");
        // Field renames must hold: hero_level→level, curr_rank→placement.
        assert!(player.contains_key("hp"), "hp carried through");
        assert!(player.contains_key("level"), "hero_level mapped to level");
        assert!(
            player.contains_key("placement"),
            "curr_rank mapped to placement"
        );
        assert!(
            player.contains_key("lineup"),
            "raw chess_lineup carried as lineup"
        );
        assert_eq!(local_ids, vec!["76561198022169086".to_owned()]);
    }

    #[test]
    fn latest_ui_state_reads_last_transition_target() {
        let log = "\
06/08 00:15:50 ChangeGameUIState: DOTA_GAME_UI_STATE_LOADING_SCREEN -> DOTA_GAME_UI_DOTA_INGAME
06/08 01:11:17 ChangeGameUIState: DOTA_GAME_UI_DOTA_INGAME -> DOTA_GAME_UI_STATE_LOADING_SCREEN
06/08 01:11:19 ChangeGameUIState: DOTA_GAME_UI_STATE_LOADING_SCREEN -> DOTA_GAME_UI_STATE_DASHBOARD
";
        assert_eq!(
            latest_ui_state(log).map(|(state, _)| state),
            Some("DOTA_GAME_UI_STATE_DASHBOARD".to_owned())
        );
        assert_eq!(latest_ui_state("no transitions here"), None);
    }

    #[test]
    fn match_end_transition_only_fires_leaving_a_game() {
        // Leaving the match → finalize.
        assert!(is_match_end_transition(
            Some("DOTA_GAME_UI_DOTA_INGAME"),
            "DOTA_GAME_UI_STATE_LOADING_SCREEN"
        ));
        assert!(is_match_end_transition(
            Some("DOTA_GAME_UI_DOTA_INGAME"),
            "DOTA_GAME_UI_STATE_DASHBOARD"
        ));
        // Entering a game or sitting in menus → no finalize.
        assert!(!is_match_end_transition(
            Some("DOTA_GAME_UI_STATE_LOADING_SCREEN"),
            "DOTA_GAME_UI_DOTA_INGAME"
        ));
        assert!(!is_match_end_transition(
            None,
            "DOTA_GAME_UI_STATE_DASHBOARD"
        ));
        assert!(!is_match_end_transition(
            Some("DOTA_GAME_UI_STATE_DASHBOARD"),
            "DOTA_GAME_UI_STATE_LOADING_SCREEN"
        ));
    }

    #[test]
    fn live_players_value_falls_back_to_single_player_as_local() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/nettable_golden/player_info_colon_buffs/console.log");
        let rows = extract_rows(&fixture).expect("fixture parses");
        // No configured steam_id: a single-player dump is treated as "you".
        let (_players, local_ids) = live_players_value(&rows, None);
        assert_eq!(
            local_ids.len(),
            1,
            "single-player dump flags the lone seat as local"
        );
    }

    #[test]
    fn preferred_capture_owner_wins_when_in_roster() {
        let mut state = NettableState {
            local_steam_id: Some("76561198022169086".to_owned()),
            ..NettableState::default()
        };
        update_capture_owner_from_rows(
            &mut state,
            &player_id_rows(&["76561198000000001", "76561198022169086"]),
        );

        assert_eq!(
            state.capture_owner_steam_id.as_deref(),
            Some("76561198022169086")
        );
        assert!(state.local_is_capture_owner());
    }

    #[test]
    fn non_preferred_client_stands_down_when_preferred_owner_present() {
        let mut state = NettableState {
            local_steam_id: Some("76561198000000001".to_owned()),
            ..NettableState::default()
        };
        update_capture_owner_from_rows(
            &mut state,
            &player_id_rows(&["76561198000000001", "76561198022169086"]),
        );

        assert_eq!(
            state.capture_owner_steam_id.as_deref(),
            Some("76561198022169086")
        );
        assert!(!state.local_is_capture_owner());
    }

    #[test]
    fn capture_election_fails_open_without_preferred_owner() {
        let mut state = NettableState {
            local_steam_id: Some("76561198000000001".to_owned()),
            ..NettableState::default()
        };
        update_capture_owner_from_rows(
            &mut state,
            &player_id_rows(&["76561198000000001", "76561198000000002"]),
        );

        assert_eq!(state.capture_owner_steam_id, None);
        assert!(state.local_is_capture_owner());
    }

    #[test]
    fn parity_events_emit_round_creep_and_personal_elimination() {
        let state = Arc::new(Mutex::new(NettableState {
            local_steam_id: Some("76561198022169086".to_owned()),
            ..NettableState::default()
        }));
        let rows = rows_from_json(vec![
            (
                "CustomNetTable_game_info",
                "round_info",
                serde_json::json!({"round": 10}),
            ),
            (
                "CustomNetTable_game_info",
                "death_team",
                serde_json::json!({"6": 1}),
            ),
            (
                "CustomNetTable_player_info_table",
                "player_info",
                serde_json::json!({"data": {"76561198022169086": {"steam_id": "76561198022169086", "team_id": 6, "round": 10, "curr_rank": 4}}}),
            ),
            (
                "CustomNetTable_player_id_table",
                "player_0",
                serde_json::json!({"steam_id": "76561198022169086"}),
            ),
        ]);

        let events = handle_rows_for_parity(&state, &rows);

        assert!(events.iter().any(
            |event| event.contains("nettable_round_changed") && event.contains("\"round\":10")
        ));
        assert!(events
            .iter()
            .any(|event| event.contains("nettable_creep_round") && event.contains("\"round\":10")));
        assert!(events
            .iter()
            .any(|event| event.contains("nettable_personal_game_ended")
                && event.contains("\"rank\":4")));
        assert_eq!(state.lock().unwrap().session_dumps.len(), 1);
    }

    #[test]
    fn timeline_ignores_duplicate_snapshots_per_round() {
        let state = Arc::new(Mutex::new(NettableState {
            local_steam_id: Some("76561198022169086".to_owned()),
            match_roster_fingerprint: Some(vec!["76561198022169086".to_owned()]),
            session_dumps: vec![
                SessionDump {
                    captured_at: "2026-06-08T00:00:00Z".to_owned(),
                    rows: rows_from_json(vec![
                        (
                            "CustomNetTable_game_info",
                            "round_info",
                            serde_json::json!({"round": 1}),
                        ),
                        (
                            "CustomNetTable_player_info_table",
                            "player_info",
                            serde_json::json!({"data": {"76561198022169086": {"hp": 99, "hero_level": 4, "curr_rank": 1}}}),
                        ),
                    ]),
                },
                SessionDump {
                    captured_at: "2026-06-08T00:01:00Z".to_owned(),
                    rows: rows_from_json(vec![
                        (
                            "CustomNetTable_game_info",
                            "round_info",
                            serde_json::json!({"round": 1}),
                        ),
                        (
                            "CustomNetTable_player_info_table",
                            "player_info",
                            serde_json::json!({"data": {"76561198022169086": {"hp": 88, "hero_level": 5, "curr_rank": 1, "player_id": 0, "chess_hand": "chess_lion,chess_ck1,"}}}),
                        ),
                        (
                            "CustomNetTable_player_id_table",
                            "vchess_0",
                            serde_json::json!({
                                "2_3": {
                                    "chess": "chess_ck1",
                                    "x": 3,
                                    "y": 2,
                                    "item": {"1": "item_bkb"},
                                    "lastitem": {"2": "item_blink"},
                                    "buy_price": 4,
                                    "index": 123,
                                    "water_id": 9
                                }
                            }),
                        ),
                    ]),
                },
            ],
            ..NettableState::default()
        }));

        let timeline = build_match_timeline_from_state(&state, "match-1").expect("timeline builds");

        assert_eq!(timeline["match_id"], "match-1");
        assert_eq!(timeline["round_count"], 1);
        assert_eq!(timeline["first_round"], 1);
        assert_eq!(timeline["last_round"], 1);
        assert_eq!(timeline["rounds"][0]["captured_at"], "2026-06-08T00:00:00Z");
        assert_eq!(
            timeline["rounds"][0]["players"]["76561198022169086"]["hp"],
            99
        );
    }

    #[test]
    fn timeline_keeps_unique_rounds_when_polling_many_times_per_round() {
        let state = Arc::new(Mutex::new(NettableState {
            local_steam_id: Some("76561198022169086".to_owned()),
            match_roster_fingerprint: Some(vec!["76561198022169086".to_owned()]),
            ..NettableState::default()
        }));

        {
            let mut state = state.lock().unwrap();
            for round in 1..=41 {
                for poll in 0..8 {
                    store_session_dump(
                        &mut state.session_dumps,
                        SessionDump {
                            captured_at: format!("2026-06-08T00:{round:02}:{poll:02}Z"),
                            rows: rows_from_json(vec![
                                (
                                    "CustomNetTable_game_info",
                                    "round_info",
                                    serde_json::json!({"round": round}),
                                ),
                                (
                                    "CustomNetTable_player_info_table",
                                    "player_info",
                                    serde_json::json!({"data": {"76561198022169086": {"hp": 100 - round, "hero_level": 5, "curr_rank": 1}}}),
                                ),
                            ]),
                        },
                    );
                }
            }
        }

        let timeline = build_match_timeline_from_state(&state, "match-1").expect("timeline builds");

        assert_eq!(timeline["round_count"], 41);
        assert_eq!(timeline["first_round"], 1);
        assert_eq!(timeline["last_round"], 41);
        assert_eq!(timeline["rounds"][0]["captured_at"], "2026-06-08T00:01:00Z");
        assert_eq!(
            timeline["rounds"][40]["captured_at"],
            "2026-06-08T00:41:00Z"
        );
    }

    #[test]
    fn timeline_caps_at_eighty_unique_rounds() {
        let state = Arc::new(Mutex::new(NettableState {
            local_steam_id: Some("76561198022169086".to_owned()),
            match_roster_fingerprint: Some(vec!["76561198022169086".to_owned()]),
            ..NettableState::default()
        }));

        {
            let mut state = state.lock().unwrap();
            for round in 1..=90 {
                store_session_dump(
                    &mut state.session_dumps,
                    SessionDump {
                        captured_at: format!("2026-06-08T00:{round:02}:00Z"),
                        rows: rows_from_json(vec![
                            (
                                "CustomNetTable_game_info",
                                "round_info",
                                serde_json::json!({"round": round}),
                            ),
                            (
                                "CustomNetTable_player_info_table",
                                "player_info",
                                serde_json::json!({"data": {"76561198022169086": {"hp": 100 - round, "hero_level": 5, "curr_rank": 1}}}),
                            ),
                        ]),
                    },
                );
            }
        }

        let timeline = build_match_timeline_from_state(&state, "match-1").expect("timeline builds");

        assert_eq!(timeline["round_count"], 80);
        assert_eq!(timeline["first_round"], 11);
        assert_eq!(timeline["last_round"], 90);
    }

    #[test]
    fn timeline_adds_final_round_from_end_board_when_live_round_lags() {
        let state = Arc::new(Mutex::new(NettableState {
            local_steam_id: Some("76561198022169086".to_owned()),
            match_roster_fingerprint: Some(vec![
                "76561198022169086".to_owned(),
                "76561198085219046".to_owned(),
            ]),
            ..NettableState::default()
        }));

        {
            let mut state = state.lock().unwrap();
            store_session_dump(
                &mut state.session_dumps,
                SessionDump {
                    captured_at: "2026-06-13T23:26:31Z".to_owned(),
                    rows: rows_from_json(vec![
                        (
                            "CustomNetTable_game_info",
                            "round_info",
                            serde_json::json!({"round": 49}),
                        ),
                        (
                            "CustomNetTable_player_info_table",
                            "player_info",
                            serde_json::json!({"data": {
                                "76561198022169086": {"hp": 37, "hero_level": 11, "curr_rank": 1},
                                "76561198085219046": {"hp": 11, "hero_level": 11, "curr_rank": 2}
                            }}),
                        ),
                        (
                            "CustomNetTable_dac_table",
                            "end_board",
                            serde_json::json!({"data": {
                                "76561198022169086": {"round": 50, "hp": 37, "hero_level": 11, "curr_rank": 1, "chess_lineup": "chess_lion,"},
                                "76561198085219046": {"round": 50, "hp": 11, "hero_level": 11, "curr_rank": 2, "chess_lineup": "chess_ck1,"}
                            }}),
                        ),
                    ]),
                },
            );
        }

        let timeline = build_match_timeline_from_state(&state, "match-1").expect("timeline builds");

        assert_eq!(timeline["round_count"], 2);
        assert_eq!(timeline["last_round"], 50);
        assert_eq!(timeline["rounds"][0]["round"], 49);
        assert_eq!(timeline["rounds"][1]["round"], 50);
        assert_eq!(timeline["rounds"][1]["source"], "end_board");
        assert_eq!(
            timeline["rounds"][1]["players"]["76561198022169086"]["hp"],
            37
        );
        assert_eq!(
            timeline["rounds"][1]["players"]["76561198085219046"]["hp"],
            0
        );
        assert_eq!(
            timeline["rounds"][1]["players"]["76561198085219046"]["placement"],
            2
        );
    }

    #[test]
    fn automatic_queen_scan_is_throttled_to_sync_interval() {
        let dac_dir = std::env::temp_dir().join(format!(
            "dac-queen-throttle-{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let state = Arc::new(Mutex::new(NettableState::default()));
        let rows = rows_from_json(vec![(
            "CustomNetTable_ranking_top_table",
            "ranking_top",
            serde_json::json!({"season": "s40", "ranking_top": {"1": {"steam_id": "76561198022169086", "name": "Jack", "rank": 1, "mmr": 4200}}}),
        )]);

        let first = maybe_auto_upload_queen_ladder(&state, &rows, &dac_dir).expect("scan event");
        let second = maybe_auto_upload_queen_ladder(&state, &rows, &dac_dir);
        {
            let mut state = state.lock().unwrap();
            state.last_ranking_top_sync_at =
                Some(Instant::now() - QUEEN_LADDER_AUTO_SYNC_INTERVAL - Duration::from_secs(1));
        }
        let third = maybe_auto_upload_queen_ladder(&state, &rows, &dac_dir).expect("resync event");

        assert!(first.contains("nettable_ranking_scanned"));
        assert!(first.contains("\"player_count\":1"));
        assert!(
            second.is_none(),
            "ranking scan should be throttled inside interval"
        );
        assert!(third.contains("nettable_ranking_scanned"));
        assert!(third.contains("\"player_count\":1"));
        assert!(
            dac_dir.join("captures").join("latest_queen_ladder.json").is_file(),
            "queen ladder must be saved locally on every scan"
        );
        // Outbox is cleared only after a successful remote upsert. In CI without
        // credentials it stays queued; with a live session it may already be gone.
        let pending = Outbox::new(dac_dir.join("outbox")).list().unwrap().len();
        assert!(
            pending <= 1,
            "identical ladder scans should dedupe to at most one outbox item"
        );
        let _ = fs::remove_dir_all(dac_dir);
    }

    #[test]
    fn persist_queen_ladder_locally_writes_latest_and_outbox() {
        let dac_dir = std::env::temp_dir().join(format!(
            "dac-queen-persist-{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let players = vec![queen_ladder::QueenPlayer {
            steam_id: "76561198000000001".to_owned(),
            name: Some("alice".to_owned()),
            rank: 1,
            mmr: Some(4200),
            season: Some("s44".to_owned()),
            seen_at: "2026-07-17T01:00:00Z".to_owned(),
        }];
        let path = persist_queen_ladder_locally(&dac_dir, &players, "2026-07-17T01:00:00Z")
            .expect("persist");
        assert!(path.is_file());
        let latest = fs::read_to_string(dac_dir.join("captures").join("latest_queen_ladder.json"))
            .expect("latest");
        let parsed: serde_json::Value = serde_json::from_str(&latest).expect("json");
        assert_eq!(parsed["kind"], queen_ladder::QUEEN_LADDER_OUTBOX_KIND);
        assert_eq!(parsed["players"].as_array().unwrap().len(), 1);
        let _ = fs::remove_dir_all(dac_dir);
    }

    fn player_id_rows(steam_ids: &[&str]) -> Vec<NettableRow> {
        steam_ids
            .iter()
            .enumerate()
            .map(|(idx, steam_id)| {
                let mut raw = BTreeMap::new();
                raw.insert(
                    "steam_id".to_owned(),
                    crate::nettable_parser::Value::String((*steam_id).to_owned()),
                );
                NettableRow {
                    table_name: "CustomNetTable_player_id_table".to_owned(),
                    key: format!("player_{idx}"),
                    raw: crate::nettable_parser::Value::Object(raw),
                    observed_at: None,
                    match_started_at: None,
                }
            })
            .collect()
    }

    fn rows_from_json(rows: Vec<(&str, &str, serde_json::Value)>) -> Vec<NettableRow> {
        rows.into_iter()
            .map(|(table_name, key, raw)| NettableRow {
                table_name: table_name.to_owned(),
                key: key.to_owned(),
                raw: value_from_json(raw),
                observed_at: None,
                match_started_at: None,
            })
            .collect()
    }

    fn value_from_json(value: serde_json::Value) -> crate::nettable_parser::Value {
        match value {
            serde_json::Value::Object(map) => crate::nettable_parser::Value::Object(
                map.into_iter()
                    .map(|(key, value)| (key, value_from_json(value)))
                    .collect(),
            ),
            serde_json::Value::Array(values) => crate::nettable_parser::Value::Array(
                values.into_iter().map(value_from_json).collect(),
            ),
            serde_json::Value::String(value) => crate::nettable_parser::Value::String(value),
            serde_json::Value::Number(value) => {
                if let Some(value) = value.as_u64() {
                    crate::nettable_parser::Value::U64(value)
                } else if let Some(value) = value.as_i64() {
                    crate::nettable_parser::Value::I32(value as i32)
                } else {
                    crate::nettable_parser::Value::F32(value.as_f64().unwrap_or_default() as f32)
                }
            }
            serde_json::Value::Bool(value) => crate::nettable_parser::Value::I32(value as i32),
            serde_json::Value::Null => crate::nettable_parser::Value::String(String::new()),
        }
    }
}

fn queen_list_missing_message(log_path: &PathBuf) -> String {
    let saw_ranking_table = fs::read_to_string(log_path)
        .map(|body| body.contains("CustomNetTable_ranking_top_table"))
        .unwrap_or(false);
    if saw_ranking_table {
        "Dota dumped the Queen table, but only the tiny non-VBKV stub was present. Open/load the DAC Queen leaderboard/menu, wait a few seconds, then press Upload Queens again."
            .to_owned()
    } else {
        "No Queen list found yet. Open/load the DAC Queen leaderboard/menu, wait a few seconds, then press Upload Queens again."
            .to_owned()
    }
}

fn queen_progress(message: &str, at: &str) -> String {
    event_json(&NettableQueenUploadProgress::new(message, at))
}

fn state_json_from(state: &Arc<Mutex<NettableState>>) -> String {
    let state = state.lock().unwrap();
    let (players, local_ids) =
        live_players_value(&state.latest_rows, state.local_steam_id.as_deref());
    let local_ids_json = serde_json::Value::Array(
        local_ids
            .into_iter()
            .map(serde_json::Value::String)
            .collect(),
    );
    event_json(&NettableStateEvent::new(
        serde_json::Value::Array(Vec::new()),
        parsed_value(&state.latest_parsed),
        players,
        local_ids_json,
        now_iso_utc(),
    ))
}

fn handle_rows_for_parity(state: &Arc<Mutex<NettableState>>, rows: &[NettableRow]) -> Vec<String> {
    let now = now_iso_utc();
    let mut events = Vec::new();
    let mut state = state.lock().unwrap();

    let roster = roster_steam_ids(rows);
    if !roster.is_empty() {
        if state
            .match_roster_fingerprint
            .as_ref()
            .map(|known| known != &roster)
            .unwrap_or(true)
        {
            state.match_roster_fingerprint = Some(roster);
            state.prev_personal_death_team = None;
            state.personal_end_recorded = false;
            state.own_slot_key = None;
            state.own_team_id = None;
            state.last_own_player_payload = None;
            state.last_ranking_top_sync_at = None;
            state.endgame_burst = false;
        }
    }

    // When only one player still has HP the game is decided and end_board is
    // imminent; flag the dump loop to burst the dac_table dump so it lands
    // before the player tabs out or leaves.
    let (live_players, _) = live_players_value(rows, state.local_steam_id.as_deref());
    if let Some(players) = live_players.as_object() {
        if players.len() >= 2 {
            let alive = players
                .values()
                .filter(|player| {
                    player
                        .get("hp")
                        .and_then(serde_json::Value::as_f64)
                        .unwrap_or(0.0)
                        > 0.0
                })
                .count();
            state.endgame_burst = alive == 1;
        }
    }

    if let Some(round) = extract_round_from_rows(rows) {
        if state.last_round != Some(round) {
            let prev = state.last_round;
            state.last_round = Some(round);
            events.push(event_json(&NettableRoundChanged::new(round, prev, &now)));
            if round > 0 && round % 5 == 0 {
                events.push(event_json(&NettableCreepRound::new(round, &now)));
            }
            // A fresh round proves we're actively in a lobby again (stale log
            // rows never advance the round). If a left-match snapshot is on
            // hold: the same roster means a rejoin, so discard it and let the
            // game finalize normally; a different roster proves we're not
            // rejoining, so stage the held snapshot for upload as-is.
            if let Some(pending) = state.pending_left_match.take() {
                if state.match_roster_fingerprint.as_deref() == Some(pending.roster.as_slice()) {
                    events.push(event_json(&NettableMatchLeftResolved::new(
                        "cancelled",
                        None,
                        "Rejoined the match — the held snapshot was discarded; the game will finalize normally.",
                        &now,
                    )));
                } else {
                    state.pending_left_match_flush = Some(pending);
                }
            }
        }
    }

    if let Some(event) = detect_personal_elimination(&mut state, rows, &now) {
        events.push(event);
    }

    if state.is_dac_match {
        store_session_dump(
            &mut state.session_dumps,
            SessionDump {
                captured_at: now,
                rows: rows.to_vec(),
            },
        );
    }
    events
}

fn maybe_auto_upload_queen_ladder(
    state: &Arc<Mutex<NettableState>>,
    rows: &[NettableRow],
    dac_dir: &Path,
) -> Option<String> {
    let now = Instant::now();
    let should_sync = {
        let state = state.lock().unwrap();
        state
            .last_ranking_top_sync_at
            .map(|last| now.duration_since(last) >= QUEEN_LADDER_AUTO_SYNC_INTERVAL)
            .unwrap_or(true)
    };
    if !should_sync {
        return None;
    }
    let ranking_raw = rows
        .iter()
        .find(|row| row.table_name.ends_with("ranking_top_table") && row.key == "ranking_top")
        .map(|row| row.raw.to_value())?;
    let scanned_at = now_iso_utc();
    let players = queen_ladder::extract_ranking_top_players(&ranking_raw, &scanned_at);
    let player_count = players.len();
    if player_count == 0 {
        return None;
    }
    // Persist before throttling/upload so a failed push still leaves a durable
    // copy for startup/outbox-flush replay.
    let outbox_path = persist_queen_ladder_locally(dac_dir, &players, &scanned_at).ok()?;
    if let Ok(mut state) = state.lock() {
        state.last_ranking_top_sync_at = Some(now);
    }
    let season = players[0].season.clone().unwrap_or_default();
    let upserted =
        upload_persisted_queen_ladder(dac_dir, &outbox_path, &players).unwrap_or(0);
    Some(event_json(&NettableRankingScanned::new(
        player_count,
        upserted,
        &season,
        &scanned_at,
    )))
}

/// Write the ladder under `captures/latest_queen_ladder.json` and enqueue a
/// typed outbox payload. Deleted from outbox only after a successful upsert.
fn persist_queen_ladder_locally(
    dac_dir: &Path,
    players: &[queen_ladder::QueenPlayer],
    scanned_at: &str,
) -> Result<PathBuf, String> {
    let payload = queen_ladder::queen_ladder_outbox_payload(players, scanned_at);
    let payload_str = payload.to_string();
    let captures = dac_dir.join("captures");
    fs::create_dir_all(&captures).map_err(|err| err.to_string())?;
    fs::write(captures.join("latest_queen_ladder.json"), &payload_str)
        .map_err(|err| format!("Could not save Queen ladder locally: {err}"))?;
    let outbox = Outbox::new(dac_dir.join("outbox"));
    outbox
        .enqueue_str(&payload_str)
        .map_err(|err| format!("Could not queue Queen ladder for upload: {err}"))
}

fn upload_persisted_queen_ladder(
    dac_dir: &Path,
    outbox_path: &Path,
    players: &[queen_ladder::QueenPlayer],
) -> Result<usize, String> {
    let client = fresh_client_from_disk().map_err(|err| {
        format!("Supabase session is not ready; cannot upload the Queen ladder: {err}")
    })?;
    let upserted = client.upsert_queen_ladder_players(players)?;
    if upserted > 0 {
        let outbox = Outbox::new(dac_dir.join("outbox"));
        let _ = outbox.mark_uploaded(outbox_path);
    }
    Ok(upserted)
}

fn build_match_timeline_from_state(
    state: &Arc<Mutex<NettableState>>,
    match_id: &str,
) -> Option<serde_json::Value> {
    let state = state.lock().unwrap();
    build_match_timeline(
        &state.session_dumps,
        state.local_steam_id.as_deref(),
        state.match_roster_fingerprint.as_deref(),
        match_id,
        &now_iso_utc(),
    )
}

fn detect_personal_elimination(
    state: &mut NettableState,
    rows: &[NettableRow],
    now: &str,
) -> Option<String> {
    if state.personal_end_recorded {
        return None;
    }
    let local_steam_id = state.local_steam_id.as_deref()?.to_owned();
    if let Some((slot_key, team_id, payload)) = own_player_payload(rows, &local_steam_id) {
        state.own_slot_key = Some(slot_key);
        state.own_team_id = Some(team_id);
        state.last_own_player_payload = Some(payload);
    }
    let team_id = state.own_team_id?;
    let payload = state.last_own_player_payload.clone()?;
    let death_team = extract_death_team_from_rows(rows);
    let current = death_team
        .get(&team_id.to_string())
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let prev = state.prev_personal_death_team;
    state.prev_personal_death_team = Some(current);
    if current != 1 {
        return None;
    }
    state.personal_end_recorded = true;
    let round = payload
        .get("round")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let rank = payload
        .get("rank")
        .or_else(|| payload.get("curr_rank"))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    Some(event_json(&NettablePersonalGameEnded::new(
        now,
        round,
        rank,
        prev.is_none(),
    )))
}

fn own_player_payload(
    rows: &[NettableRow],
    local_steam_id: &str,
) -> Option<(String, i64, serde_json::Value)> {
    for row in rows {
        if !row.table_name.ends_with("player_info_table") || row.key != "player_info" {
            continue;
        }
        let value = row.raw.to_value();
        let data = value.get("data")?.as_object()?;
        for (slot_key, payload) in data {
            let obj = payload.as_object()?;
            let steam_id = obj
                .get("steam_id")
                .map(|value| match value {
                    serde_json::Value::String(value) => value.clone(),
                    serde_json::Value::Number(value) => value.to_string(),
                    _ => String::new(),
                })
                .unwrap_or_else(|| slot_key.clone());
            if steam_id != local_steam_id && slot_key != local_steam_id {
                continue;
            }
            let team_id = obj.get("team_id")?.as_i64()?;
            return Some((slot_key.clone(), team_id, payload.clone()));
        }
    }
    None
}

/// How recently console.log must have been written for `-condebug` to count
/// as "working right now". Live capture refreshes the file every few seconds,
/// so a stale mtime means Dota is closed or condebug isn't doing its job.
const LOG_ACTIVE_WINDOW: Duration = Duration::from_secs(120);

/// Build the `nettable_status` payload from observable signals.
///
/// The migration shipped this hardcoded (`dota_running:false`, all flags null),
/// which left the setup card stuck on "Might be set up" even mid-capture.
/// We report what we can actually measure: Dota process presence and whether
/// console.log is being written within the active window.
fn nettable_status_json(state: &Arc<Mutex<NettableState>>) -> String {
    let (paused, log_path, local_steam_id) = {
        let state = state.lock().unwrap();
        (
            state.paused,
            state.log_path.clone(),
            state.local_steam_id.clone(),
        )
    };
    let log_path = log_path.or_else(find_console_log);
    let log_writable = log_path.as_ref().map(|path| path.exists()).unwrap_or(false);
    let launch_options = local_steam_id
        .as_deref()
        .filter(|steam_id| !steam_id.is_empty())
        .and_then(find_dota_launch_options_for_steam_id)
        .or_else(find_any_dota_launch_options);
    let launch_tokens = launch_options
        .as_deref()
        .map(tokenize_launch_options)
        .unwrap_or_default();
    let launch_known = launch_options.is_some();
    let log_active = log_path
        .as_ref()
        .and_then(|path| path.metadata().ok())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .map(|age| age <= LOG_ACTIVE_WINDOW)
        .unwrap_or(false);
    let log_path_string = log_path
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let dota_dir_string = find_dota_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    event_json(&NettableStatus {
        event_type: "nettable_status",
        backend: "rust",
        ok: true,
        paused,
        autoexec_installed: find_autoexec_target().map(|p| p.exists()).unwrap_or(false),
        gsi_cfg_installed: find_gsi_cfg_target().map(|p| p.exists()).unwrap_or(false),
        log_path: &log_path_string,
        log_writable,
        dota_dir: &dota_dir_string,
        remote_enabled: true,
        launch_options: launch_options.as_deref(),
        has_console: launch_known.then(|| launch_tokens.iter().any(|token| token == "-console")),
        has_condebug: launch_known.then(|| launch_tokens.iter().any(|token| token == "-condebug")),
        has_conclearlog: launch_known
            .then(|| launch_tokens.iter().any(|token| token == "-conclearlog")),
        has_gamestateintegration: launch_known.then(|| {
            launch_tokens
                .iter()
                .any(|token| token == "-gamestateintegration")
        }),
        dota_focused: dota_has_foreground_focus(),
        steam_running: is_steam_running(),
        dota_running: is_dota_running(),
        log_active,
    })
}

fn table_names(rows: &[NettableRow]) -> Vec<String> {
    let mut tables = rows
        .iter()
        .map(|row| row.table_name.as_str())
        .collect::<Vec<_>>();
    tables.sort_unstable();
    tables.dedup();
    tables.into_iter().map(str::to_owned).collect()
}

fn local_is_capture_owner(state: &Arc<Mutex<NettableState>>) -> bool {
    state
        .lock()
        .map(|state| state.local_is_capture_owner())
        .unwrap_or(true)
}

fn capture_owner_steam_id(state: &Arc<Mutex<NettableState>>) -> Option<String> {
    state
        .lock()
        .ok()
        .and_then(|state| state.capture_owner_steam_id.clone())
}

impl NettableState {
    fn local_is_capture_owner(&self) -> bool {
        match self.capture_owner_steam_id.as_deref() {
            Some(owner) => self.local_steam_id.as_deref() == Some(owner),
            None => true,
        }
    }
}

fn update_capture_owner_from_rows(state: &mut NettableState, rows: &[NettableRow]) {
    let roster = roster_steam_ids(rows);
    if roster.is_empty() {
        return;
    }
    state.capture_owner_steam_id = PREFERRED_CAPTURE_STEAM_IDS
        .iter()
        .find(|steam_id| roster.iter().any(|roster_id| roster_id == **steam_id))
        .map(|steam_id| (*steam_id).to_owned());
}

fn roster_steam_ids(rows: &[NettableRow]) -> Vec<String> {
    let mut ids = rows
        .iter()
        .filter(|row| row.table_name.ends_with("player_id_table"))
        .filter_map(|row| {
            let value = row.raw.to_value();
            match value.get("steam_id")? {
                serde_json::Value::String(value) => Some(value.trim().to_owned()),
                serde_json::Value::Number(value) => Some(value.to_string()),
                _ => None,
            }
        })
        .filter(|steam_id| !steam_id.is_empty())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        // Current mod builds dump player_id_table without steam_ids; recover
        // the roster from the steam-id-keyed player_info maps instead.
        ids = rows
            .iter()
            .filter(|row| row.key == "player_info")
            .filter_map(|row| {
                row.raw
                    .to_value()
                    .get("data")
                    .and_then(serde_json::Value::as_object)
                    .map(|data| data.keys().cloned().collect::<Vec<_>>())
            })
            .flatten()
            .filter(|steam_id| parse_valid_steam_id64(steam_id).is_some())
            .collect();
    }
    ids.sort();
    ids.dedup();
    ids
}

fn maybe_fire_dump_commands<F>(
    state: &Arc<Mutex<NettableState>>,
    emit: &Arc<F>,
    last_game_info_fire: &mut Instant,
    last_player_fire: &mut Instant,
    last_metadata_fire: &mut Instant,
    last_dota_focused: &mut bool,
) where
    F: Fn(String) + Send + Sync + 'static,
{
    let (paused, in_match, endgame_burst, last_round, has_hidden_legendary_pool) = state
        .lock()
        .map(|state| {
            (
                state.paused,
                state.last_ui_state.as_deref() == Some(DOTA_INGAME_STATE),
                state.endgame_burst,
                state.last_round,
                state_has_hidden_legendary_pool(&state),
            )
        })
        .unwrap_or((true, false, false, None, true));
    let dota_focused = dota_has_foreground_focus();
    if paused || !in_match {
        *last_dota_focused = dota_focused;
        return;
    }
    if !dota_focused {
        *last_dota_focused = false;
        return;
    }
    let capture_owner = local_is_capture_owner(state);

    // One player left with HP: end_board publishes any moment now, so dump
    // dac_table every couple of seconds instead of the relaxed cadence.
    let player_cadence = if endgame_burst {
        Duration::from_secs(2)
    } else {
        Duration::from_secs(12)
    };

    let now = Instant::now();
    if !*last_dota_focused {
        *last_dota_focused = true;
        if capture_owner {
            fire_dump_commands(
                emit,
                &[
                    DumpKey::F23,
                    DumpKey::F22,
                    DumpKey::F20,
                    DumpKey::F24,
                    DumpKey::F16,
                    DumpKey::F21,
                ],
                "refocus catch-up snapshot",
            );
        } else {
            fire_dump_commands(
                emit,
                &[DumpKey::F23, DumpKey::F24],
                "refocus roster snapshot",
            );
        }
        *last_game_info_fire = now;
        *last_player_fire = now;
        *last_metadata_fire = now;
        return;
    }
    if now.duration_since(*last_game_info_fire) >= Duration::from_secs(3) {
        *last_game_info_fire = now;
        fire_dump_commands(emit, &[DumpKey::F23], "game_info");
        if capture_owner && last_round.unwrap_or(0) >= 1 && !has_hidden_legendary_pool {
            fire_dump_commands(emit, &[DumpKey::F16], "hidden legendary pool");
        }
    }
    if capture_owner && now.duration_since(*last_player_fire) >= player_cadence {
        *last_player_fire = now;
        // F21 dumps dac_table, which is where `end_board` (the full 8-player
        // final result) appears at game over. Without firing it here, end_board
        // is only ever dumped by the GSI post-game handler — which never fires
        // for many setups — so a finished match has no full-board data to save.
        fire_dump_commands(
            emit,
            &[DumpKey::F22, DumpKey::F20, DumpKey::F21],
            "player snapshot",
        );
    }
    if now.duration_since(*last_metadata_fire) >= Duration::from_secs(30) {
        *last_metadata_fire = now;
        if capture_owner {
            fire_dump_commands(emit, &[DumpKey::F24, DumpKey::F16], "metadata snapshot");
        } else {
            // Keep the lightweight roster dump running so a non-owner can
            // recover if the preferred owner leaves the next lobby.
            fire_dump_commands(emit, &[DumpKey::F24], "metadata roster snapshot");
        }
    }
}

fn fire_dump_commands<F>(emit: &Arc<F>, keys: &[DumpKey], _label: &str)
where
    F: Fn(String) + Send + Sync + 'static,
{
    match send_dump_commands(keys) {
        Ok(_) => {}
        Err(err) => emit(event_json(&NettableIngestError::new(&format!(
            "dump command failed: {err}"
        )))),
    }
}

fn send_dump_commands(keys: &[DumpKey]) -> Result<DumpCommandResult, String> {
    send_dump_keys_if_dota_focused(keys).map(|()| DumpCommandResult {
        transport: "focused_sendinput",
    })
}

fn send_dump_commands_forcing_focus(keys: &[DumpKey]) -> Result<DumpCommandResult, String> {
    send_dump_keys_forcing_dota_focus(keys).map(|()| DumpCommandResult {
        transport: "focus_steal_sendinput",
    })
}

fn end_board_already_uploaded(state: &Arc<Mutex<NettableState>>, match_id: &str) -> bool {
    state
        .lock()
        .map(|state| state.uploaded_end_board_match_ids.contains(match_id))
        .unwrap_or(false)
}

fn mark_end_board_uploaded(state: &Arc<Mutex<NettableState>>, match_id: &str) {
    if let Ok(mut state) = state.lock() {
        state
            .uploaded_end_board_match_ids
            .insert(match_id.to_owned());
    }
}

fn upload_end_board_if_present<F>(
    state: &Arc<Mutex<NettableState>>,
    rows: &[NettableRow],
    emit: &Arc<F>,
    error_context: &str,
) -> bool
where
    F: Fn(String) + Send + Sync + 'static,
{
    let Some(match_id) = finished_match_id_from_rows(rows) else {
        return false;
    };
    let client = match fresh_client_from_disk() {
        Ok(client) => client,
        Err(err) => {
            emit(event_json(&NettableIngestError::with_backend_at(
                &format!("{error_context}: {err}"),
                &now_iso_utc(),
            )));
            return false;
        }
    };
    if end_board_already_uploaded(state, &match_id) || client.finished_match_has_players(&match_id)
    {
        mark_end_board_uploaded(state, &match_id);
        return true;
    }
    match client.upload_finished_match_from_rows(rows) {
        Ok(Some(uploaded_match_id)) => {
            mark_end_board_uploaded(state, &uploaded_match_id);
            if let Some(timeline) = build_match_timeline_from_state(state, &uploaded_match_id) {
                let _ = client.upsert_match_timeline(&timeline);
                let round_count = timeline
                    .get("round_count")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                emit(event_json(&NettableTimelineExtracted::new(
                    &uploaded_match_id,
                    round_count,
                    &now_iso_utc(),
                )));
            }
            emit(event_json(&NettableEndBoardSaved::new(
                &uploaded_match_id,
                &now_iso_utc(),
            )));
            true
        }
        Ok(None) => false,
        Err(err) => {
            emit(event_json(&NettableIngestError::with_backend_at(
                &format!("{error_context}: {err}"),
                &now_iso_utc(),
            )));
            false
        }
    }
}

fn latest_rows(state: &Arc<Mutex<NettableState>>) -> Vec<NettableRow> {
    state
        .lock()
        .map(|state| state.latest_rows.clone())
        .unwrap_or_default()
}

fn chase_post_game_end_board<F>(
    state: &Arc<Mutex<NettableState>>,
    cfg: &Config,
    emit: &Arc<F>,
    reason: &str,
) -> Vec<NettableRow>
where
    F: Fn(String) + Send + Sync + 'static,
{
    let mut rows = latest_rows(state);
    if finished_match_id_from_rows(&rows).is_some() {
        return rows;
    }

    emit(event_json(&NettableGameEnded::new(
        &format!("{reason}; requesting end-board dumps."),
        None,
        &now_iso_utc(),
    )));

    for _ in 0..POST_GAME_END_BOARD_ATTEMPTS {
        if let Err(err) = send_dump_commands_forcing_focus(&[
            DumpKey::F23,
            DumpKey::F22,
            DumpKey::F20,
            DumpKey::F21,
        ]) {
            emit(event_json(&NettableIngestError::with_backend_at(
                &format!("post-game dump command failed: {err}"),
                &now_iso_utc(),
            )));
            break;
        }

        thread::sleep(POST_GAME_DUMP_WAIT);
        match poll_once(state, cfg) {
            Ok(Some(fresh_rows)) if !fresh_rows.is_empty() => rows = fresh_rows,
            Ok(_) => rows = latest_rows(state),
            Err(err) => emit(event_json(&NettableIngestError::with_backend_at(
                &format!("post-game log poll failed: {err}"),
                &now_iso_utc(),
            ))),
        }
        if finished_match_id_from_rows(&rows).is_some() {
            return rows;
        }
    }

    rows
}

fn finalize_without_end_board(rows: &[NettableRow]) -> Result<Option<String>, String> {
    let client = fresh_client_from_disk()?;
    client.upsert_fallback_finished_match(rows, "post_game_no_end_board")
}

fn emit_fallback_finalize<F>(rows: &[NettableRow], emit: &Arc<F>, message: &str)
where
    F: Fn(String) + Send + Sync + 'static,
{
    match finalize_without_end_board(rows) {
        Ok(Some(match_id)) => emit(event_json(&NettableGameEnded::new(
            message,
            Some(&match_id),
            &now_iso_utc(),
        ))),
        Ok(None) => emit(event_json(&NettableGameEnded::new(
            "End-board upload failed, and there was no usable live snapshot to save.",
            None,
            &now_iso_utc(),
        ))),
        Err(err) => emit(event_json(&NettableIngestError::new(&format!(
            "fallback finalize after end-board failure failed: {err}"
        )))),
    }
}

/// The Dota UI state string for "in a match" (note: not `..._STATE_INGAME`).
const DOTA_INGAME_STATE: &str = "DOTA_GAME_UI_DOTA_INGAME";

/// The current UI state = the target of the last `ChangeGameUIState: X -> Y`
/// line in the log. Dota writes these on every menu/match transition.
fn latest_ui_state(text: &str) -> Option<(String, Option<String>)> {
    let (idx, _) = text.rmatch_indices("ChangeGameUIState:").next()?;
    let line_start = text[..idx].rfind('\n').map(|pos| pos + 1).unwrap_or(0);
    let line = text[line_start..].lines().next()?;
    let target = line.rsplit("-> ").next()?.trim();
    if target.is_empty() {
        return None;
    }
    Some((
        target.to_owned(),
        crate::nettable_parser::console_line_observed_at(line),
    ))
}

/// True when the UI just left a match (was in-game, now isn't). This is the
/// moment to finalize — the game is over even if GSI never told us.
fn is_match_end_transition(prev: Option<&str>, next: &str) -> bool {
    prev == Some(DOTA_INGAME_STATE) && next != DOTA_INGAME_STATE
}

/// Finalize a match detected via the UI-state transition (no GSI). Tries the
/// real end board first (in case it landed), then falls back to the last live
/// snapshot so a finished game is always recorded and the UI reacts.
/// Flush a held left-match snapshot when the grace window lapses or a
/// different lobby supersedes it. Returns event lines for the caller to emit.
fn tick_pending_left_match(state: &Arc<Mutex<NettableState>>, _cfg: &Config) -> Vec<String> {
    let (staged, expired) = match state.lock() {
        Ok(mut s) => {
            let staged = s.pending_left_match_flush.take();
            let expired = match &s.pending_left_match {
                Some(pending) if Instant::now() >= pending.deadline => s.pending_left_match.take(),
                _ => None,
            };
            (staged, expired)
        }
        Err(_) => (None, None),
    };
    let mut events = Vec::new();
    if let Some(pending) = staged {
        events.extend(flush_pending_left_match(
            pending,
            "left_match_superseded",
        ));
    }
    if let Some(pending) = expired {
        events.extend(flush_pending_left_match(pending, "left_match_timeout"));
    }
    events
}

fn flush_pending_left_match(pending: PendingLeftMatch, reason: &str) -> Vec<String> {
    let now = now_iso_utc();
    let client = match fresh_client_from_disk() {
        Ok(client) => client,
        Err(err) => {
            return vec![event_json(&NettableIngestError::with_backend_at(
                &format!("left-match upload failed: {err}"),
                &now,
            ))];
        }
    };
    match client.upsert_fallback_finished_match(&pending.rows, reason) {
        Ok(Some(match_id)) => vec![event_json(&NettableMatchLeftResolved::new(
            "uploaded",
            Some(&match_id),
            "Uploaded the match you left with everyone's last-known standings.",
            &now,
        ))],
        Ok(None) => vec![event_json(&NettableMatchLeftResolved::new(
            "nothing_pending",
            None,
            "The match you left had no usable snapshot to upload.",
            &now,
        ))],
        Err(err) => vec![event_json(&NettableIngestError::with_backend_at(
            &format!("left-match upload failed: {err}"),
            &now,
        ))],
    }
}

fn finalize_on_match_left<F>(state: &Arc<Mutex<NettableState>>, cfg: &Config, emit: &Arc<F>)
where
    F: Fn(String) + Send + Sync + 'static,
{
    if !local_is_capture_owner(state) {
        let owner = capture_owner_steam_id(state).unwrap_or_else(|| "unknown".to_owned());
        let message =
            format!("Dota left the match; standing down for preferred capture owner {owner}.");
        emit(event_json(&NettableGameEnded::new(
            &message,
            None,
            &now_iso_utc(),
        )));
        return;
    }
    let rows = chase_post_game_end_board(state, cfg, emit, "Dota left the match");
    // No end board after an explicit post-game chase usually means the local
    // player left before the lobby finished. Don't upload the partial snapshot
    // yet: DAC allows reconnecting, and an immediate upload would double-record
    // the game if they rejoin and finish it. Hold the snapshot for user
    // confirmation or the grace window instead.
    if finished_match_id_from_rows(&rows).is_none() {
        let roster = roster_steam_ids(&rows);
        if roster.is_empty() {
            emit(event_json(&NettableGameEnded::new(
                "Match ended, but there was no usable snapshot to finalize.",
                None,
                &now_iso_utc(),
            )));
            return;
        }
        let expires_at = (chrono::Utc::now()
            + chrono::Duration::from_std(LEFT_MATCH_UPLOAD_GRACE)
                .unwrap_or_else(|_| chrono::Duration::minutes(30)))
        .to_rfc3339();
        if let Ok(mut s) = state.lock() {
            s.pending_left_match = Some(PendingLeftMatch {
                rows,
                roster,
                deadline: Instant::now() + LEFT_MATCH_UPLOAD_GRACE,
            });
        }
        emit(event_json(&NettableMatchLeftPending::new(
            "You left the match before it finished. Confirm the game is over to upload it now; otherwise it uploads as-is when the window lapses. Rejoining the match cancels the upload.",
            &expires_at,
            &now_iso_utc(),
        )));
        return;
    }
    emit(event_json(&NettableGameEnded::new(
        "Dota left the match; finalizing from the captured end board.",
        None,
        &now_iso_utc(),
    )));
    if upload_end_board_if_present(
        state,
        &rows,
        emit,
        "match-left end_board upload failed",
    ) {
        return;
    }
    match finalize_without_end_board(&rows) {
        Ok(Some(match_id)) => emit(event_json(&NettableGameEnded::new(
            "Marked the match finished from the last live snapshot (no end board was emitted).",
            Some(&match_id),
            &now_iso_utc(),
        ))),
        Ok(None) => emit(event_json(&NettableGameEnded::new(
            "Match ended, but there was no usable snapshot to finalize.",
            None,
            &now_iso_utc(),
        ))),
        Err(err) => emit(event_json(&NettableIngestError::new(&format!(
            "match-end finalize failed: {err}"
        )))),
    }
}

fn poll_once(
    state: &Arc<Mutex<NettableState>>,
    cfg: &Config,
) -> io::Result<Option<Vec<NettableRow>>> {
    let path = {
        let mut state = state.lock().unwrap();
        if state.paused {
            return Ok(None);
        }
        if state
            .log_path
            .as_ref()
            .map(|path| !path.exists())
            .unwrap_or(true)
        {
            state.log_path = find_console_log();
        }
        state.log_path.clone()
    };
    let Some(path) = path else {
        return Ok(None);
    };
    let modified = path.metadata()?.modified()?;
    {
        let state = state.lock().unwrap();
        if state.last_modified == Some(modified) {
            return Ok(None);
        }
    }
    // Read the log once: parse the stringtables AND scan the UI-state line.
    let text = fs::read_to_string(&path)?;
    let (_, mut rows) = nettable_parser::parse_log_text_with_rows(&text);
    let ui_state = latest_ui_state(&text);
    let mut state = state.lock().unwrap();
    state.last_modified = Some(modified);
    if let Some((next, observed_at)) = ui_state {
        if state.last_ui_state.as_deref() != Some(DOTA_INGAME_STATE) && next == DOTA_INGAME_STATE {
            state.match_started_at = observed_at.or_else(|| Some(now_iso_utc()));
            state.uploaded_end_board_match_ids.clear();
            state.latest_parsed.clear();
            state.latest_rows.clear();
            state.session_dumps.clear();
            state.last_round = None;
            state.is_dac_match = false;
            state.endgame_burst = false;
            state.pending_match_end = false;
            state.prev_personal_death_team = None;
            state.personal_end_recorded = false;
        }
        if is_match_end_transition(state.last_ui_state.as_deref(), &next) {
            state.pending_match_end = true;
        }
        state.last_ui_state = Some(next);
    }
    let match_started_at = state.match_started_at.clone();
    if let Some(started_at) = match_started_at.as_deref() {
        rows.retain(|row| row_observed_at_or_after_match_start(row, started_at));
    }
    for row in &mut rows {
        row.match_started_at = match_started_at.clone();
    }
    state.latest_parsed = parsed_from_rows(&rows);
    state.latest_rows = rows.clone();
    update_capture_owner_from_rows(&mut state, &rows);
    if cfg.keep_local_nettable_dumps && !rows.is_empty() {
        persist_local_nettable_dump(cfg, &rows);
    }
    Ok(Some(rows))
}

fn persist_local_nettable_dump(cfg: &Config, rows: &[NettableRow]) {
    let captured_at = now_iso_utc();
    let row_values = rows.iter().map(nettable_row_debug_json).collect::<Vec<_>>();
    let mut tables = rows
        .iter()
        .map(|row| row.table_name.as_str())
        .collect::<Vec<_>>();
    tables.sort_unstable();
    tables.dedup();
    let dump = serde_json::json!({
        "captured_at": captured_at,
        "tables": tables,
        "rows": row_values,
    });

    let captures_dir = cfg.dac_dir.join("captures");
    let _ = fs::create_dir_all(&captures_dir);
    if let Ok(body) = serde_json::to_string_pretty(&row_values) {
        let _ = fs::write(captures_dir.join("latest_nettable_rows.json"), body);
    }

    let dumps_dir = cfg.dac_dir.join("nettable_dumps");
    let _ = fs::create_dir_all(&dumps_dir);
    let file_name = format!("{}.json", chrono::Utc::now().format("%Y%m%d_%H%M%S_%6f"));
    if let Ok(body) = serde_json::to_string_pretty(&dump) {
        let _ = fs::write(dumps_dir.join(file_name), body);
    }
}

/// Detect whether dota2.exe is currently a running process.
///
/// Ported from the Python backend's `is_dota_running`: shell out to `tasklist`
/// with the no-window flag so we don't pop a console. Used to avoid trying to
/// request dumps when Dota isn't even open.
#[cfg(target_os = "windows")]
fn is_dota_running() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq dota2.exe", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .to_ascii_lowercase()
                .contains("dota2.exe")
        })
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn is_dota_running() -> bool {
    false
}

pub fn rows_json(rows: &[NettableRow]) -> String {
    rows_value(rows).to_string()
}

pub fn rows_value(rows: &[NettableRow]) -> serde_json::Value {
    serde_json::Value::Array(
        rows.iter()
            .map(|row| {
                serde_json::json!({
                    "table_name": row.table_name,
                    "key": row.key,
                    "raw": row.raw.to_value(),
                })
            })
            .collect(),
    )
}

fn nettable_row_debug_json(row: &NettableRow) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    out.insert("table_name".to_owned(), serde_json::json!(row.table_name));
    out.insert("key".to_owned(), serde_json::json!(row.key));
    out.insert("raw".to_owned(), row.raw.to_value());
    if let Some(observed_at) = &row.observed_at {
        out.insert("observed_at".to_owned(), serde_json::json!(observed_at));
    }
    if let Some(match_started_at) = &row.match_started_at {
        out.insert(
            "match_started_at".to_owned(),
            serde_json::json!(match_started_at),
        );
    }
    serde_json::Value::Object(out)
}

pub fn parsed_json(parsed: &ParsedLog) -> String {
    parsed_value(parsed).to_string()
}

fn parsed_value(parsed: &ParsedLog) -> serde_json::Value {
    serde_json::Value::Object(
        parsed
            .iter()
            .map(|(table, entries)| {
                (
                    table.clone(),
                    serde_json::Value::Object(
                        entries
                            .iter()
                            .map(|(key, raw)| (key.clone(), raw.to_value()))
                            .collect(),
                    ),
                )
            })
            .collect(),
    )
}

fn now_iso_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn parsed_from_rows(rows: &[NettableRow]) -> ParsedLog {
    let mut parsed = ParsedLog::new();
    for row in rows {
        parsed
            .entry(row.table_name.clone())
            .or_default()
            .insert(row.key.clone(), row.raw.clone());
    }
    parsed
}

fn gsi_state_is_dac_active(gsi: &Arc<Mutex<Option<Arc<Mutex<GsiState>>>>>) -> bool {
    gsi.lock()
        .ok()
        .and_then(|g| g.as_ref().map(|gs| gs.lock().ok().map(|s| s.is_dac_active()).unwrap_or(false)))
        .unwrap_or(false)
}

fn state_has_hidden_legendary_pool(state: &NettableState) -> bool {
    state.latest_rows.iter().any(|row| {
        row.table_name.ends_with("chess_pool_table")
            && (row.key == "revealed_legendary_chess_list"
                || row.key == "unrevealed_legendary_chess_list")
    })
}

fn row_observed_at_or_after_match_start(row: &NettableRow, match_started_at: &str) -> bool {
    let Some(observed_at) = row.observed_at.as_deref() else {
        return true;
    };
    let Ok(observed_at) = chrono::DateTime::parse_from_rfc3339(observed_at) else {
        return true;
    };
    let Ok(match_started_at) = chrono::DateTime::parse_from_rfc3339(match_started_at) else {
        return true;
    };
    observed_at >= match_started_at
}
