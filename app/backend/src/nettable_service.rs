use crate::{
    config::Config,
    hotkeys::{send_dump_keys, DumpKey},
    nettable_parser::{self, NettableRow, ParsedLog},
    queen_ladder,
    supabase::{finished_match_id_from_rows, queue_rows, SupabaseClient},
    unit_codes::{normalize_chess_lineup, normalize_chess_unit},
};
use std::{
    collections::{HashMap, HashSet},
    env, fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime},
};

const POST_GAME_FINALIZE_ATTEMPTS: usize = 12;
const POST_GAME_FINALIZE_INTERVAL: Duration = Duration::from_secs(4);
const DEFAULT_GSI_PORT: u16 = 4001;
const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;
const DOTA_APP_ID: &str = "570";
const REQUIRED_LAUNCH_FLAGS: &[&str] = &["-condebug", "-conclearlog", "-gamestateintegration"];
const PREFERRED_CAPTURE_STEAM_IDS: &[&str] = &[
    "76561198022169086", // Jack
];

const AUTOEXEC_BLOCK: &str = r#"// >>> DAC Tracker nettable capture >>>
bind "F20" "dumpstringtable CustomNetTable_player_id_table cl verbose"
bind "F21" "dumpstringtable CustomNetTable_dac_table cl verbose"
bind "F22" "dumpstringtable CustomNetTable_player_info_table cl verbose"
bind "F23" "dumpstringtable CustomNetTable_game_info cl verbose"
bind "F24" "dumpstringtable CustomNetTable_ranking_top_table cl verbose;dumpstringtable CustomNetTable_player_id_table cl verbose"
bind "F16" "dumpstringtable CustomNetTable_chess_pool_table cl verbose"
bind "F25" "dumpstringtable CustomNetTable_unit_table cl verbose"
// <<< DAC Tracker nettable capture <<<
"#;

#[derive(Clone)]
pub struct NettableService {
    state: Arc<Mutex<NettableState>>,
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
    /// Python scanned ranking_top_table once per lobby/session. Keep the same
    /// latch so automatic Queen ladder upserts don't spam Supabase.
    ranking_top_scanned: bool,
    /// End-board match ids already uploaded by this daemon process. Dota keeps
    /// the finished end_board in console.log, so without this the poller would
    /// keep re-upserting and mutating played_at every heartbeat after a game.
    uploaded_end_board_match_ids: HashSet<String>,
}

#[derive(Debug, Clone)]
struct SessionDump {
    captured_at: String,
    rows: Vec<NettableRow>,
}

impl NettableService {
    pub fn new() -> Self {
        let log_path = find_console_log();
        Self {
            state: Arc::new(Mutex::new(NettableState {
                log_path,
                ..NettableState::default()
            })),
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
        let emit = Arc::new(emit);
        thread::spawn(move || {
            let mut last_game_info_fire = Instant::now() - Duration::from_secs(10);
            let mut last_player_fire = Instant::now() - Duration::from_secs(30);
            let mut last_metadata_fire = Instant::now() - Duration::from_secs(60);
            let mut last_status_fire = Instant::now() - Duration::from_secs(10);
            loop {
                maybe_fire_dump_hotkeys(
                    &state,
                    &emit,
                    &mut last_game_info_fire,
                    &mut last_player_fire,
                    &mut last_metadata_fire,
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
                            emit(format!(
                                r#"{{"type":"nettable_rows","rows":{}}}"#,
                                rows_json(&rows)
                            ));
                            emit(state_json_from(&state));
                            emit(format!(
                                r#"{{"type":"nettable_ingest_complete","backend":"rust","rows_written":{},"tables":{},"at":{}}}"#,
                                rows.len(),
                                tables_json(&rows),
                                json_string(&now_iso_utc())
                            ));
                            for event in handle_rows_for_parity(&state, &rows) {
                                emit(event);
                            }
                            if let Some(event) = maybe_auto_upload_queen_ladder(&state, &cfg, &rows)
                            {
                                emit(event);
                            }
                            if local_is_capture_owner(&state) {
                                if let Some(client) = SupabaseClient::from_config(&cfg) {
                                    if let Some(match_id) = finished_match_id_from_rows(&rows) {
                                        if end_board_already_uploaded(&state, &match_id)
                                            || client.finished_match_exists(&match_id)
                                        {
                                            mark_end_board_uploaded(&state, &match_id);
                                            continue;
                                        }
                                    }
                                    match client.upload_finished_match_from_rows(&rows) {
                                        Ok(Some(match_id)) => {
                                            mark_end_board_uploaded(&state, &match_id);
                                            if let Some(timeline) =
                                                build_match_timeline(&state, &match_id)
                                            {
                                                let _ = client.upsert_match_timeline(&timeline);
                                                emit(format!(
                                                    r#"{{"type":"nettable_timeline_extracted","backend":"rust","match_id":{},"round_count":{},"at":{}}}"#,
                                                    json_string(&match_id),
                                                    timeline
                                                        .get("round_count")
                                                        .and_then(serde_json::Value::as_u64)
                                                        .unwrap_or(0),
                                                    json_string(&now_iso_utc())
                                                ));
                                            }
                                            emit(format!(
                                                r#"{{"type":"nettable_end_board_saved","backend":"rust","match_id":{},"at":{}}}"#,
                                                json_string(&match_id),
                                                json_string(&now_iso_utc())
                                            ));
                                        }
                                        Ok(None) => {}
                                        Err(err) => emit(format!(
                                            r#"{{"type":"nettable_ingest_error","backend":"rust","error":{},"at":{}}}"#,
                                            json_string(&format!("end_board upload failed: {err}")),
                                            json_string(&now_iso_utc())
                                        )),
                                    }
                                }
                            }
                            if cfg.upload_raw_nettable_dumps && local_is_capture_owner(&state) {
                                let raw_end_board_already_uploaded =
                                    finished_match_id_from_rows(&rows)
                                        .as_deref()
                                        .map(|match_id| {
                                            end_board_already_uploaded(&state, match_id)
                                        })
                                        .unwrap_or(false);
                                if !raw_end_board_already_uploaded {
                                    if let Some(client) = SupabaseClient::from_config(&cfg) {
                                        if client.insert_nettable_rows(&rows).is_err() {
                                            let _ = queue_rows(cfg.dac_dir.join("outbox"), &rows);
                                        }
                                    } else {
                                        let _ = queue_rows(cfg.dac_dir.join("outbox"), &rows);
                                    }
                                }
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(err) => emit(format!(
                        r#"{{"type":"nettable_ingest_error","error":{}}}"#,
                        json_string(&err.to_string())
                    )),
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
                thread::sleep(Duration::from_millis(750));
            }
        });
    }

    pub fn set_paused(&self, paused: bool) {
        if let Ok(mut state) = self.state.lock() {
            state.paused = paused;
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
            emit(r#"{"type":"nettable_resync_complete","ok":true,"noop":true}"#.to_owned());
            emit(nettable_status_json(&self.state));
            return;
        }
        emit(setup_progress(
            "nettable_resync_progress",
            "closing_steam",
            "Asking Steam to quit…",
        ));
        if !request_steam_shutdown() {
            emit(format!(
                r#"{{"type":"nettable_resync_complete","ok":false,"error":{}}}"#,
                json_string("Couldn't find steam.exe to close Steam automatically.")
            ));
            return;
        }
        emit(setup_progress(
            "nettable_resync_progress",
            "waiting_steam_exit",
            "Waiting for Steam to flush its state…",
        ));
        if !wait_for_steam_exit(Duration::from_secs(20)) {
            emit(format!(
                r#"{{"type":"nettable_resync_complete","ok":false,"error":{}}}"#,
                json_string("Steam didn't quit within 20s.")
            ));
            return;
        }
        emit(r#"{"type":"nettable_resync_complete","ok":true,"noop":false}"#.to_owned());
        emit(nettable_status_json(&self.state));
    }

    pub fn capture_once_json(&self) -> String {
        self.set_paused(false);
        match send_dump_keys(&[DumpKey::F23, DumpKey::F22, DumpKey::F20, DumpKey::F21]) {
            Ok(()) => format!(
                r#"{{"type":"nettable_check_active_match","backend":"rust","ok":true,"paused":false,"message":{},"at":{}}}"#,
                json_string("Requested a manual lobby snapshot."),
                json_string(&now_iso_utc())
            ),
            Err(err) => format!(
                r#"{{"type":"nettable_ingest_error","error":{}}}"#,
                json_string(&format!("manual capture failed: {err}"))
            ),
        }
    }

    pub fn check_active_match_json(&self) -> String {
        self.set_paused(false);
        match send_dump_keys(&[
            DumpKey::F23,
            DumpKey::F22,
            DumpKey::F20,
            DumpKey::F24,
            DumpKey::F16,
            DumpKey::F21,
        ]) {
            Ok(()) => format!(
                r#"{{"type":"nettable_check_active_match","backend":"rust","ok":true,"paused":false,"message":{},"at":{}}}"#,
                json_string("Requested a full live lobby snapshot. If Dota is focused, new rows should appear within a few seconds."),
                json_string(&now_iso_utc())
            ),
            Err(err) => format!(
                r#"{{"type":"nettable_ingest_error","error":{}}}"#,
                json_string(&format!("active match check failed: {err}"))
            ),
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
                emit(format!(
                    r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"at":{}}}"#,
                    json_string(&format!("Dota reported post-game; standing down for preferred capture owner {owner}.")),
                    json_string(&now_iso_utc())
                ));
                return;
            }
            emit(format!(
                r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"at":{}}}"#,
                json_string("Dota reported post-game. Requesting the final board."),
                json_string(&now_iso_utc())
            ));

            for _ in 0..POST_GAME_FINALIZE_ATTEMPTS {
                let _ = send_dump_keys(&[
                    DumpKey::F21,
                    DumpKey::F22,
                    DumpKey::F20,
                    DumpKey::F23,
                    DumpKey::F24,
                    DumpKey::F16,
                ]);
                thread::sleep(POST_GAME_FINALIZE_INTERVAL);

                let rows = state
                    .lock()
                    .map(|state| state.latest_rows.clone())
                    .unwrap_or_default();
                if rows_have_end_board(&rows) {
                    if let Some(client) = SupabaseClient::from_config(&cfg) {
                        if let Some(match_id) = finished_match_id_from_rows(&rows) {
                            if end_board_already_uploaded(&state, &match_id)
                                || client.finished_match_exists(&match_id)
                            {
                                mark_end_board_uploaded(&state, &match_id);
                                return;
                            }
                        }
                        match client.upload_finished_match_from_rows(&rows) {
                            Ok(Some(match_id)) => {
                                mark_end_board_uploaded(&state, &match_id);
                                emit(format!(
                                    r#"{{"type":"nettable_end_board_saved","backend":"rust","match_id":{},"at":{}}}"#,
                                    json_string(&match_id),
                                    json_string(&now_iso_utc())
                                ));
                            }
                            Ok(None) => emit(format!(
                                r#"{{"type":"nettable_end_board_saved","backend":"rust","at":{}}}"#,
                                json_string(&now_iso_utc())
                            )),
                            Err(err) => emit(format!(
                                r#"{{"type":"nettable_ingest_error","backend":"rust","error":{},"at":{}}}"#,
                                json_string(&format!("post-game end_board upload failed: {err}")),
                                json_string(&now_iso_utc())
                            )),
                        }
                    } else {
                        emit(format!(
                            r#"{{"type":"nettable_ingest_error","backend":"rust","error":{},"at":{}}}"#,
                            json_string(
                                "post-game end_board upload failed: Supabase is not configured"
                            ),
                            json_string(&now_iso_utc())
                        ));
                    }
                    return;
                }
            }

            let rows = state
                .lock()
                .map(|state| state.latest_rows.clone())
                .unwrap_or_default();
            match finalize_without_end_board(&cfg, &rows) {
                Ok(Some(match_id)) => emit(format!(
                    r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"match_id":{},"at":{}}}"#,
                    json_string("Marked the match finished from the last live snapshot; end_board never appeared."),
                    json_string(&match_id),
                    json_string(&now_iso_utc())
                )),
                Ok(None) => emit(format!(
                    r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"at":{}}}"#,
                    json_string("Post-game ended, but there was no usable lobby snapshot to finalize."),
                    json_string(&now_iso_utc())
                )),
                Err(err) => emit(format!(
                    r#"{{"type":"nettable_ingest_error","error":{}}}"#,
                    json_string(&format!("post-game fallback finalize failed: {err}"))
                )),
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
                let _ = send_dump_keys(&[DumpKey::F24]);
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

            let players = queen_ladder::extract_ranking_top_players(&ranking_raw, &now_iso_utc());
            if players.is_empty() {
                return Err("Found the Queen list, but it did not contain any players.".to_owned());
            }
            let season = players[0].season.clone().unwrap_or_default();

            let client = SupabaseClient::from_config(cfg).ok_or_else(|| {
                "Supabase is not configured; cannot upload the Queen ladder.".to_owned()
            })?;
            let upserted = client.upsert_queen_ladder_players(&players)?;
            Ok((players.len(), upserted, season))
        })();

        let at = now_iso_utc();
        match outcome {
            Ok((player_count, upserted, season)) => {
                let ok = upserted > 0;
                let error = if ok {
                    "null".to_owned()
                } else {
                    json_string(&format!(
                        "Found {player_count} Queen players, but the database wrote 0 rows."
                    ))
                };
                emit(format!(
                    r#"{{"type":"nettable_queen_upload_complete","ok":{},"player_count":{},"upserted_count":{},"season":{},"error":{},"at":{}}}"#,
                    if ok { "true" } else { "false" },
                    player_count,
                    upserted,
                    json_string(&season),
                    error,
                    json_string(&at),
                ));
            }
            Err(message) => emit(format!(
                r#"{{"type":"nettable_queen_upload_complete","ok":false,"player_count":0,"upserted_count":0,"error":{},"at":{}}}"#,
                json_string(&message),
                json_string(&at),
            )),
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
            latest_ui_state(log).as_deref(),
            Some("DOTA_GAME_UI_STATE_DASHBOARD")
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
    fn timeline_builds_latest_snapshot_per_round() {
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

        let timeline = build_match_timeline(&state, "match-1").expect("timeline builds");

        assert_eq!(timeline["match_id"], "match-1");
        assert_eq!(timeline["round_count"], 1);
        assert_eq!(timeline["first_round"], 1);
        assert_eq!(timeline["last_round"], 1);
        assert_eq!(timeline["rounds"][0]["captured_at"], "2026-06-08T00:01:00Z");
        assert_eq!(
            timeline["rounds"][0]["players"]["76561198022169086"]["hp"],
            88
        );
        assert_eq!(
            timeline["rounds"][0]["players"]["76561198022169086"]["hand"],
            "Lion|Chaos Knight(2)"
        );
        let board = &timeline["rounds"][0]["players"]["76561198022169086"]["board"][0];
        assert_eq!(board["name"], "Chaos Knight");
        assert_eq!(board["stars"], 2);
        assert_eq!(board["x"], 3);
        assert_eq!(board["y"], 2);
        assert_eq!(board["items"][0], "item_bkb");
        assert_eq!(board["last_items"][0], "item_blink");
    }

    #[test]
    fn automatic_queen_scan_is_latched_per_session() {
        let state = Arc::new(Mutex::new(NettableState::default()));
        let cfg = Config {
            dac_dir: std::env::temp_dir(),
            steam_id: String::new(),
            steam_name: String::new(),
            replay_enabled: true,
            keep_local_nettable_dumps: false,
            upload_raw_nettable_dumps: false,
            local_only: true,
            supabase_url: String::new(),
            supabase_key: String::new(),
        };
        let rows = rows_from_json(vec![(
            "CustomNetTable_ranking_top_table",
            "ranking_top",
            serde_json::json!({"season": "s40", "ranking_top": {"1": {"steam_id": "76561198022169086", "name": "Jack", "rank": 1, "mmr": 4200}}}),
        )]);

        let first = maybe_auto_upload_queen_ladder(&state, &cfg, &rows).expect("scan event");
        let second = maybe_auto_upload_queen_ladder(&state, &cfg, &rows);

        assert!(first.contains("nettable_ranking_scanned"));
        assert!(first.contains("\"player_count\":1"));
        assert!(second.is_none(), "ranking scan should be once per session");
    }

    #[test]
    fn launch_options_are_added_without_duplicates() {
        let path = std::env::temp_dir().join(format!(
            "dac-localconfig-{}-{}.vdf",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::write(
            &path,
            r#""UserLocalConfigStore"
{
    "apps"
    {
        "570"
        {
            "LaunchOptions"        "-console -condebug"
        }
    }
}
"#,
        )
        .expect("write localconfig fixture");

        let result = apply_dota_launch_options_to_file(&path, REQUIRED_LAUNCH_FLAGS)
            .expect("launch options apply");
        let updated = fs::read_to_string(&path).expect("read updated localconfig");
        let _ = fs::remove_file(&path);
        if let Some(backup) = result.backup_path.as_ref() {
            let _ = fs::remove_file(backup);
        }

        assert_eq!(result.added, vec!["-conclearlog", "-gamestateintegration"]);
        assert!(updated.contains("-console -condebug -conclearlog -gamestateintegration"));
        assert_eq!(updated.matches("-condebug").count(), 1);
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
    format!(
        r#"{{"type":"nettable_queen_upload_progress","message":{},"at":{}}}"#,
        json_string(message),
        json_string(at)
    )
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
    format!(
        r#"{{"type":"nettable_state","backend":"rust","rows":{},"state":{},"players":{},"local_steam_ids":{},"at":{}}}"#,
        rows_json(&state.latest_rows),
        parsed_json(&state.latest_parsed),
        players,
        local_ids_json,
        json_string(&now_iso_utc())
    )
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
            state.ranking_top_scanned = false;
        }
    }

    if let Some(round) = extract_round_from_rows(rows) {
        if state.last_round != Some(round) {
            let prev = state.last_round;
            state.last_round = Some(round);
            events.push(format!(
                r#"{{"type":"nettable_round_changed","backend":"rust","round":{},"prev_round":{},"at":{}}}"#,
                round,
                prev.map(|round| round.to_string()).unwrap_or_else(|| "null".to_owned()),
                json_string(&now)
            ));
            if round > 0 && round % 5 == 0 {
                events.push(format!(
                    r#"{{"type":"nettable_creep_round","backend":"rust","round":{},"at":{}}}"#,
                    round,
                    json_string(&now)
                ));
            }
        }
    }

    if let Some(event) = detect_personal_elimination(&mut state, rows, &now) {
        events.push(event);
    }

    state.session_dumps.push(SessionDump {
        captured_at: now,
        rows: rows.to_vec(),
    });
    if state.session_dumps.len() > 256 {
        let excess = state.session_dumps.len() - 256;
        state.session_dumps.drain(0..excess);
    }
    events
}

fn maybe_auto_upload_queen_ladder(
    state: &Arc<Mutex<NettableState>>,
    cfg: &Config,
    rows: &[NettableRow],
) -> Option<String> {
    {
        let state = state.lock().unwrap();
        if state.ranking_top_scanned {
            return None;
        }
    }
    let ranking_raw = rows
        .iter()
        .find(|row| row.table_name.ends_with("ranking_top_table") && row.key == "ranking_top")
        .map(|row| row.raw.to_value())?;
    let scanned_at = now_iso_utc();
    let players = queen_ladder::extract_ranking_top_players(&ranking_raw, &scanned_at);
    let player_count = players.len();
    if let Ok(mut state) = state.lock() {
        state.ranking_top_scanned = true;
    }
    if player_count == 0 {
        return None;
    }
    let season = players[0].season.clone().unwrap_or_default();
    let upserted = SupabaseClient::from_config(cfg)
        .map(|client| client.upsert_queen_ladder_players(&players).unwrap_or(0))
        .unwrap_or(0);
    Some(format!(
        r#"{{"type":"nettable_ranking_scanned","backend":"rust","player_count":{},"upserted_count":{},"season":{},"at":{}}}"#,
        player_count,
        upserted,
        json_string(&season),
        json_string(&scanned_at)
    ))
}

fn build_match_timeline(
    state: &Arc<Mutex<NettableState>>,
    match_id: &str,
) -> Option<serde_json::Value> {
    let state = state.lock().unwrap();
    let mut by_round = std::collections::BTreeMap::<i64, serde_json::Value>::new();
    for dump in &state.session_dumps {
        let Some(round) = extract_round_from_rows(&dump.rows) else {
            continue;
        };
        let (players, _local_ids) = live_players_value(&dump.rows, state.local_steam_id.as_deref());
        let snapshot = serde_json::json!({
            "round": round,
            "captured_at": dump.captured_at,
            "players": players,
            "draft": extract_draft_state_from_rows(&dump.rows),
            "death_team": extract_death_team_from_rows(&dump.rows),
        });
        let replace = by_round
            .get(&round)
            .and_then(|existing| existing.get("captured_at"))
            .and_then(serde_json::Value::as_str)
            .map(|existing_at| dump.captured_at.as_str() >= existing_at)
            .unwrap_or(true);
        if replace {
            by_round.insert(round, snapshot);
        }
    }
    if by_round.is_empty() {
        return None;
    }
    let first_round = *by_round.keys().next()?;
    let last_round = *by_round.keys().last()?;
    let rounds = by_round.into_values().collect::<Vec<_>>();
    Some(serde_json::json!({
        "match_id": match_id,
        "played_at": now_iso_utc(),
        "roster_fingerprint": state.match_roster_fingerprint.clone().unwrap_or_default(),
        "observer_steam_id": state.local_steam_id.clone().unwrap_or_default(),
        "is_finished": true,
        "verification_source": "end_board",
        "round_count": rounds.len(),
        "first_round": first_round,
        "last_round": last_round,
        "rounds": rounds,
    }))
}

fn extract_round_from_rows(rows: &[NettableRow]) -> Option<i64> {
    let mut best = None;
    for row in rows {
        if !row.table_name.ends_with("game_info") {
            continue;
        }
        let value = row.raw.to_value();
        if row.key == "round_info" {
            return value.get("round").and_then(serde_json::Value::as_i64);
        }
        if let Some(round) = value.get("round").and_then(serde_json::Value::as_i64) {
            best = Some(best.map_or(round, |current: i64| current.max(round)));
        }
    }
    best
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
    Some(format!(
        r#"{{"type":"nettable_personal_game_ended","backend":"rust","at":{},"round":{},"rank":{},"late_capture":{}}}"#,
        json_string(now),
        round,
        rank,
        if prev.is_none() { "true" } else { "false" }
    ))
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

fn extract_draft_state_from_rows(rows: &[NettableRow]) -> serde_json::Value {
    let mut bans = serde_json::Map::new();
    let mut legendaries = Vec::new();
    for row in rows {
        if !row.table_name.ends_with("chess_pool_table") {
            continue;
        }
        let raw = row.raw.to_value();
        if let Some(pid) = row.key.strip_prefix("ban_info_") {
            if let Some(ban) = raw
                .get("ban")
                .or_else(|| raw.get("synergy"))
                .and_then(serde_json::Value::as_str)
            {
                bans.insert(pid.to_owned(), serde_json::Value::String(ban.to_owned()));
            }
        } else if row.key == "revealed_legendary_chess_list" {
            if let Some(values) = raw.as_object() {
                legendaries.extend(values.values().cloned());
            } else if let Some(values) = raw.as_array() {
                legendaries.extend(values.iter().cloned());
            }
        }
    }
    serde_json::json!({"bans": bans, "legendaries_revealed": legendaries})
}

fn extract_death_team_from_rows(
    rows: &[NettableRow],
) -> serde_json::Map<String, serde_json::Value> {
    for row in rows {
        if row.table_name.ends_with("game_info") && row.key == "death_team" {
            if let Some(obj) = row.raw.to_value().as_object() {
                return obj.clone();
            }
        }
    }
    serde_json::Map::new()
}

/// Source → output field mapping for live per-player state, mirroring the
/// Python `_extract_players_state_from_rows`. `lineup` stays as the raw
/// `chess_*` code list — the frontend resolves codes to names (it owns
/// units_full.json) so we don't duplicate that data in the backend.
const LIVE_PLAYER_FIELDS: &[(&str, &str)] = &[
    ("hp", "hp"),
    ("hero_level", "level"),
    ("curr_rank", "placement"),
    ("duration", "duration"),
    ("chess_lineup", "lineup"),
    ("chess_hand", "hand"),
    ("lineup_value", "lineup_value"),
    ("total_money", "total_money"),
    ("win_round", "win_round"),
    ("lose_round", "lose_round"),
    ("buff", "buff"),
    ("relic", "relic"),
    ("mmr_level", "mmr_level"),
    ("candy", "candy"),
];

/// Extract live per-player state for the standings board, keyed by steam_id.
///
/// `player_info_table.player_info.data` is the live source (updates round to
/// round); `dac_table.player_info.info` only fills gaps for players the live
/// table hasn't covered yet. Returns the players object plus the local
/// steam_ids to highlight ("You").
pub fn live_players_value(
    rows: &[NettableRow],
    local_steam_id: Option<&str>,
) -> (serde_json::Value, Vec<String>) {
    use serde_json::{Map, Value};

    let boards_by_player_id = live_boards_by_player_id(rows);

    fn harvest(
        players: &mut Map<String, Value>,
        container: &Value,
        boards_by_player_id: &HashMap<i64, Value>,
    ) {
        let Some(obj) = container.as_object() else {
            return;
        };
        for (sid, player) in obj {
            let Some(player) = player.as_object() else {
                continue;
            };
            let row = players
                .entry(sid.clone())
                .or_insert_with(|| Value::Object(Map::new()))
                .as_object_mut()
                .expect("player row is an object");
            for (src, dst) in LIVE_PLAYER_FIELDS {
                if let Some(value) = player.get(*src) {
                    if !value.is_null() {
                        // The live table is harvested first; or_insert keeps
                        // its value over the dac_table gap-fill pass.
                        let normalized = if *dst == "lineup" || *dst == "hand" {
                            value
                                .as_str()
                                .and_then(normalize_chess_lineup)
                                .map(Value::String)
                                .unwrap_or_else(|| value.clone())
                        } else {
                            value.clone()
                        };
                        row.entry((*dst).to_owned()).or_insert(normalized);
                    }
                }
            }
            if !row.contains_key("board") {
                if let Some(board) = player
                    .get("player_id")
                    .and_then(Value::as_i64)
                    .and_then(|player_id| boards_by_player_id.get(&player_id))
                {
                    row.insert("board".to_owned(), board.clone());
                }
            }
            // Full relic pick order from `relic_history`
            // ({ "1": {relic, round}, ... }) — the single `relic` field is
            // only the latest pick. Emit every relic the player has taken,
            // ordered by the round it was acquired.
            if !row.contains_key("relics") {
                if let Some(history) = player.get("relic_history").and_then(Value::as_object) {
                    let mut picks: Vec<(i64, String)> = history
                        .values()
                        .filter_map(|entry| {
                            let entry = entry.as_object()?;
                            let relic = entry.get("relic")?.as_str()?.to_owned();
                            let round = entry.get("round").and_then(Value::as_i64).unwrap_or(0);
                            Some((round, relic))
                        })
                        .collect();
                    picks.sort_by_key(|(round, _)| *round);
                    if !picks.is_empty() {
                        let relics = picks
                            .into_iter()
                            .map(|(_, relic)| Value::String(relic))
                            .collect();
                        row.insert("relics".to_owned(), Value::Array(relics));
                    }
                }
            }
        }
    }

    let mut players: Map<String, Value> = Map::new();
    for row in rows {
        if row.table_name.ends_with("player_info_table") && row.key == "player_info" {
            if let Some(data) = row.raw.to_value().get("data") {
                harvest(&mut players, data, &boards_by_player_id);
            }
        }
    }
    for row in rows {
        if row.table_name.ends_with("dac_table") && row.key == "player_info" {
            if let Some(info) = row.raw.to_value().get("info") {
                harvest(&mut players, info, &boards_by_player_id);
            }
        }
    }

    let local_ids = match local_steam_id {
        Some(id) if !id.is_empty() => vec![id.to_owned()],
        // Local-only dumps carry a single player — treat that as "you".
        _ if players.len() == 1 => players.keys().next().cloned().into_iter().collect(),
        _ => Vec::new(),
    };

    (Value::Object(players), local_ids)
}

fn live_boards_by_player_id(rows: &[NettableRow]) -> HashMap<i64, serde_json::Value> {
    rows.iter()
        .filter(|row| row.table_name == "CustomNetTable_player_id_table")
        .filter_map(|row| {
            let player_id = row.key.strip_prefix("vchess_")?.parse::<i64>().ok()?;
            let board = normalize_live_board(row.raw.to_value())?;
            Some((player_id, board))
        })
        .collect()
}

fn normalize_live_board(value: serde_json::Value) -> Option<serde_json::Value> {
    let mut pieces = value
        .as_object()?
        .iter()
        .filter_map(|(slot_key, piece)| normalize_live_board_piece(slot_key, piece))
        .collect::<Vec<_>>();
    pieces.sort_by_key(|piece| {
        let y = piece
            .get("y")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(99);
        let x = piece
            .get("x")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(99);
        (y, x)
    });
    (!pieces.is_empty()).then(|| serde_json::Value::Array(pieces))
}

fn normalize_live_board_piece(
    slot_key: &str,
    piece: &serde_json::Value,
) -> Option<serde_json::Value> {
    let chess = piece.get("chess")?.as_str()?.to_owned();
    let name = normalize_chess_unit(&chess).unwrap_or_else(|| chess.clone());
    let stars = name
        .rsplit_once('(')
        .and_then(|(_, suffix)| suffix.strip_suffix(')'))
        .and_then(|suffix| suffix.parse::<i64>().ok())
        .unwrap_or(1);
    let mut out = serde_json::Map::new();
    out.insert("slot_key".to_owned(), serde_json::json!(slot_key));
    out.insert("chess".to_owned(), serde_json::json!(chess));
    out.insert(
        "name".to_owned(),
        serde_json::json!(name.trim_end_matches(&format!("({stars})")).trim()),
    );
    out.insert("stars".to_owned(), serde_json::json!(stars));
    for key in ["x", "y", "index", "buy_price", "water_id"] {
        if let Some(value) = piece.get(key) {
            out.insert(key.to_owned(), value.clone());
        }
    }
    let items = sorted_string_values(piece.get("item"));
    if !items.is_empty() {
        out.insert("items".to_owned(), serde_json::Value::Array(items));
    }
    let last_items = sorted_string_values(piece.get("lastitem"));
    if !last_items.is_empty() {
        out.insert(
            "last_items".to_owned(),
            serde_json::Value::Array(last_items),
        );
    }
    Some(serde_json::Value::Object(out))
}

fn sorted_string_values(value: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    let mut values = value
        .and_then(serde_json::Value::as_object)
        .map(|object| {
            let mut entries = object
                .iter()
                .filter_map(|(key, value)| Some((key.parse::<i64>().ok()?, value.as_str()?)))
                .collect::<Vec<_>>();
            entries.sort_by_key(|(key, _)| *key);
            entries
                .into_iter()
                .map(|(_, value)| serde_json::Value::String(value.to_owned()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    values.dedup();
    values
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
    let (paused, log_path) = {
        let state = state.lock().unwrap();
        (state.paused, state.log_path.clone())
    };
    let log_path = log_path.or_else(find_console_log);
    let log_writable = log_path.as_ref().map(|path| path.exists()).unwrap_or(false);
    let launch_options = find_dota_launch_options(None);
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
    format!(
        r#"{{"type":"nettable_status","backend":"rust","ok":true,"paused":{},"autoexec_installed":{},"gsi_cfg_installed":{},"log_path":{},"log_writable":{},"dota_dir":{},"remote_enabled":true,"launch_options":{},"has_condebug":{},"has_conclearlog":{},"has_gamestateintegration":{},"steam_running":{},"dota_running":{},"log_active":{}}}"#,
        if paused { "true" } else { "false" },
        if find_autoexec_target().map(|p| p.exists()).unwrap_or(false) {
            "true"
        } else {
            "false"
        },
        if find_gsi_cfg_target().map(|p| p.exists()).unwrap_or(false) {
            "true"
        } else {
            "false"
        },
        json_string(
            &log_path
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_default()
        ),
        if log_writable { "true" } else { "false" },
        json_string(
            &find_dota_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default()
        ),
        launch_options
            .as_deref()
            .map(json_string)
            .unwrap_or_else(|| "null".to_owned()),
        bool_or_null(
            launch_known,
            launch_tokens.iter().any(|token| token == "-condebug"),
        ),
        bool_or_null(
            launch_known,
            launch_tokens.iter().any(|token| token == "-conclearlog"),
        ),
        bool_or_null(
            launch_known,
            launch_tokens
                .iter()
                .any(|token| token == "-gamestateintegration"),
        ),
        if is_steam_running() { "true" } else { "false" },
        if is_dota_running() { "true" } else { "false" },
        if log_active { "true" } else { "false" },
    )
}

fn bool_or_null(known: bool, value: bool) -> &'static str {
    if !known {
        "null"
    } else if value {
        "true"
    } else {
        "false"
    }
}

fn tables_json(rows: &[NettableRow]) -> String {
    let mut tables = rows
        .iter()
        .map(|row| row.table_name.as_str())
        .collect::<Vec<_>>();
    tables.sort_unstable();
    tables.dedup();
    serde_json::Value::Array(
        tables
            .into_iter()
            .map(|table| serde_json::Value::String(table.to_owned()))
            .collect(),
    )
    .to_string()
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
    ids.sort();
    ids.dedup();
    ids
}

fn maybe_fire_dump_hotkeys<F>(
    state: &Arc<Mutex<NettableState>>,
    emit: &Arc<F>,
    last_game_info_fire: &mut Instant,
    last_player_fire: &mut Instant,
    last_metadata_fire: &mut Instant,
) where
    F: Fn(String) + Send + Sync + 'static,
{
    let capture_owner = local_is_capture_owner(state);
    if state.lock().map(|state| state.paused).unwrap_or(true) {
        return;
    }

    let now = Instant::now();
    if now.duration_since(*last_game_info_fire) >= Duration::from_secs(3) {
        *last_game_info_fire = now;
        fire_keys(emit, &[DumpKey::F23], "game_info");
    }
    if capture_owner && now.duration_since(*last_player_fire) >= Duration::from_secs(12) {
        *last_player_fire = now;
        // F21 dumps dac_table, which is where `end_board` (the full 8-player
        // final result) appears at game over. Without firing it here, end_board
        // is only ever dumped by the GSI post-game handler — which never fires
        // for many setups — so a finished match has no full-board data to save.
        fire_keys(
            emit,
            &[DumpKey::F22, DumpKey::F20, DumpKey::F21],
            "player snapshot",
        );
    }
    if now.duration_since(*last_metadata_fire) >= Duration::from_secs(30) {
        *last_metadata_fire = now;
        if capture_owner {
            fire_keys(emit, &[DumpKey::F24, DumpKey::F16], "metadata snapshot");
        } else {
            // Keep the lightweight roster dump running so a non-owner can
            // recover if the preferred owner leaves the next lobby.
            fire_keys(emit, &[DumpKey::F24], "metadata roster snapshot");
        }
    }
}

fn fire_keys<F>(emit: &Arc<F>, keys: &[DumpKey], _label: &str)
where
    F: Fn(String) + Send + Sync + 'static,
{
    match send_dump_keys(keys) {
        Ok(()) => {}
        Err(err) => emit(format!(
            r#"{{"type":"nettable_ingest_error","error":{}}}"#,
            json_string(&format!("dump hotkey failed: {err}"))
        )),
    }
}

fn rows_have_end_board(rows: &[NettableRow]) -> bool {
    rows.iter()
        .any(|row| row.table_name == "CustomNetTable_dac_table" && row.key == "end_board")
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

fn finalize_without_end_board(
    cfg: &Config,
    rows: &[NettableRow],
) -> Result<Option<String>, String> {
    let Some(client) = SupabaseClient::from_config(cfg) else {
        return Ok(None);
    };
    client.upsert_fallback_finished_match(rows, "post_game_no_end_board")
}

/// The Dota UI state string for "in a match" (note: not `..._STATE_INGAME`).
const DOTA_INGAME_STATE: &str = "DOTA_GAME_UI_DOTA_INGAME";

/// The current UI state = the target of the last `ChangeGameUIState: X -> Y`
/// line in the log. Dota writes these on every menu/match transition.
fn latest_ui_state(text: &str) -> Option<String> {
    let (idx, _) = text.rmatch_indices("ChangeGameUIState:").next()?;
    let line = text[idx..].lines().next()?;
    let target = line.rsplit("-> ").next()?.trim();
    if target.is_empty() {
        return None;
    }
    Some(target.to_owned())
}

/// True when the UI just left a match (was in-game, now isn't). This is the
/// moment to finalize — the game is over even if GSI never told us.
fn is_match_end_transition(prev: Option<&str>, next: &str) -> bool {
    prev == Some(DOTA_INGAME_STATE) && next != DOTA_INGAME_STATE
}

/// Finalize a match detected via the UI-state transition (no GSI). Tries the
/// real end board first (in case it landed), then falls back to the last live
/// snapshot so a finished game is always recorded and the UI reacts.
fn finalize_on_match_left<F>(state: &Arc<Mutex<NettableState>>, cfg: &Config, emit: &Arc<F>)
where
    F: Fn(String) + Send + Sync + 'static,
{
    if !local_is_capture_owner(state) {
        let owner = capture_owner_steam_id(state).unwrap_or_else(|| "unknown".to_owned());
        emit(format!(
            r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"at":{}}}"#,
            json_string(&format!(
                "Dota left the match; standing down for preferred capture owner {owner}."
            )),
            json_string(&now_iso_utc())
        ));
        return;
    }
    let rows = state
        .lock()
        .map(|s| s.latest_rows.clone())
        .unwrap_or_default();
    emit(format!(
        r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"at":{}}}"#,
        json_string("Dota left the match — finalizing from the last live snapshot."),
        json_string(&now_iso_utc())
    ));
    if let Some(client) = SupabaseClient::from_config(cfg) {
        if let Some(match_id) = finished_match_id_from_rows(&rows) {
            if end_board_already_uploaded(state, &match_id)
                || client.finished_match_exists(&match_id)
            {
                mark_end_board_uploaded(state, &match_id);
                return;
            }
        }
        match client.upload_finished_match_from_rows(&rows) {
            Ok(Some(match_id)) => {
                mark_end_board_uploaded(state, &match_id);
                emit(format!(
                    r#"{{"type":"nettable_end_board_saved","backend":"rust","match_id":{},"at":{}}}"#,
                    json_string(&match_id),
                    json_string(&now_iso_utc())
                ));
                return;
            }
            Ok(None) => {}
            Err(err) => emit(format!(
                r#"{{"type":"nettable_ingest_error","backend":"rust","error":{},"at":{}}}"#,
                json_string(&format!("match-left end_board upload failed: {err}")),
                json_string(&now_iso_utc())
            )),
        }
    }
    match finalize_without_end_board(cfg, &rows) {
        Ok(Some(match_id)) => emit(format!(
            r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"match_id":{},"at":{}}}"#,
            json_string(
                "Marked the match finished from the last live snapshot (no end board was emitted)."
            ),
            json_string(&match_id),
            json_string(&now_iso_utc())
        )),
        Ok(None) => emit(format!(
            r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"at":{}}}"#,
            json_string("Match ended, but there was no usable snapshot to finalize."),
            json_string(&now_iso_utc())
        )),
        Err(err) => emit(format!(
            r#"{{"type":"nettable_ingest_error","error":{}}}"#,
            json_string(&format!("match-end finalize failed: {err}"))
        )),
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
    let parsed = nettable_parser::parse_log_text(&text);
    let rows = nettable_parser::rows_from_parsed(parsed.clone());
    let ui_state = latest_ui_state(&text);
    let mut state = state.lock().unwrap();
    state.last_modified = Some(modified);
    state.latest_parsed = parsed;
    state.latest_rows = rows.clone();
    update_capture_owner_from_rows(&mut state, &rows);
    if let Some(next) = ui_state {
        if is_match_end_transition(state.last_ui_state.as_deref(), &next) {
            state.pending_match_end = true;
        }
        state.last_ui_state = Some(next);
    }
    if cfg.keep_local_nettable_dumps && !rows.is_empty() {
        persist_local_nettable_dump(cfg, &rows);
    }
    Ok(Some(rows))
}

fn persist_local_nettable_dump(cfg: &Config, rows: &[NettableRow]) {
    let captured_at = now_iso_utc();
    let row_values = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "table_name": row.table_name,
                "key": row.key,
                "raw": row.raw.to_value(),
            })
        })
        .collect::<Vec<_>>();
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

pub fn find_dota_dir() -> Option<PathBuf> {
    if let Some(path) = env::var_os("DAC_DOTA_DIR").map(PathBuf::from) {
        if path.exists() {
            return Some(path);
        }
    }
    [
        r"C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta",
        r"C:\Program Files\Steam\steamapps\common\dota 2 beta",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|path| path.exists())
}

pub fn find_console_log() -> Option<PathBuf> {
    find_dota_dir()
        .map(|dir| dir.join("game/dota/console.log"))
        .filter(|path| path.exists())
}

/// Detect whether dota2.exe is currently a running process.
///
/// Ported from the Python backend's `is_dota_running`: shell out to `tasklist`
/// with the no-window flag so we don't pop a console. Used to avoid sending
/// dump hotkeys into the foreground app when Dota isn't even open.
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

fn setup_progress(event_type: &str, stage: &str, message: &str) -> String {
    format!(
        r#"{{"type":{},"stage":{},"message":{}}}"#,
        json_string(event_type),
        json_string(stage),
        json_string(message)
    )
}

fn setup_result_error(message: &str) -> String {
    format!(
        r#"{{"type":"nettable_launch_options_applied","backend":"rust","ok":false,"error":{}}}"#,
        json_string(message)
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LaunchOptionsApplied {
    ok: bool,
    noop: bool,
    before: String,
    after: String,
    added: Vec<String>,
    config_path: PathBuf,
    backup_path: Option<PathBuf>,
}

impl LaunchOptionsApplied {
    fn event_json(&self, autoexec: &Path, gsi_cfg: Option<&Path>) -> String {
        let added = serde_json::Value::Array(
            self.added
                .iter()
                .cloned()
                .map(serde_json::Value::String)
                .collect(),
        );
        format!(
            r#"{{"type":"nettable_launch_options_applied","backend":"rust","ok":{},"noop":{},"before":{},"after":{},"added":{},"config_path":{},"backup_path":{},"autoexec_path":{},"gsi_cfg_path":{}}}"#,
            if self.ok { "true" } else { "false" },
            if self.noop { "true" } else { "false" },
            json_string(&self.before),
            json_string(&self.after),
            added,
            json_string(&self.config_path.display().to_string()),
            self.backup_path
                .as_ref()
                .map(|path| json_string(&path.display().to_string()))
                .unwrap_or_else(|| "null".to_owned()),
            json_string(&autoexec.display().to_string()),
            gsi_cfg
                .map(|path| json_string(&path.display().to_string()))
                .unwrap_or_else(|| "null".to_owned())
        )
    }
}

fn tokenize_launch_options(opts: &str) -> Vec<String> {
    opts.split_whitespace()
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

fn apply_dota_launch_options(
    flags: &[&str],
    steam_id64: &str,
) -> Result<LaunchOptionsApplied, String> {
    if flags.is_empty() {
        return Err("No launch-option flags requested.".to_owned());
    }
    let account_id = steam_id64_to_account_id(steam_id64);
    let config_path = find_localconfig_vdf(account_id.as_deref()).ok_or_else(|| {
        "Couldn't find Steam's localconfig.vdf with a Dota 2 entry. Open Steam → Dota 2 Properties once, then try again.".to_owned()
    })?;
    apply_dota_launch_options_to_file(&config_path, flags)
}

fn apply_dota_launch_options_to_file(
    config_path: &Path,
    flags: &[&str],
) -> Result<LaunchOptionsApplied, String> {
    let text = fs::read_to_string(config_path)
        .map_err(|err| format!("Couldn't read {}: {err}", config_path.display()))?;
    let (body_start, body_end) = find_app_block_bounds(&text, DOTA_APP_ID)
        .ok_or_else(|| "No Dota 2 (app 570) block found in localconfig.vdf.".to_owned())?;
    let body = &text[body_start..body_end];
    let field = find_launch_options_value(body);
    let before = field
        .as_ref()
        .map(|field| field.value.clone())
        .unwrap_or_default();
    let mut tokens = before
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut lower = tokenize_launch_options(&before);
    let mut added = Vec::new();
    for flag in flags {
        if !lower
            .iter()
            .any(|token| token == &flag.to_ascii_lowercase())
        {
            tokens.push((*flag).to_owned());
            lower.push(flag.to_ascii_lowercase());
            added.push((*flag).to_owned());
        }
    }
    let after = tokens.join(" ");
    if added.is_empty() {
        return Ok(LaunchOptionsApplied {
            ok: true,
            noop: true,
            before,
            after,
            added,
            config_path: config_path.to_owned(),
            backup_path: None,
        });
    }
    let new_body = if let Some(field) = field {
        format!("{}{}{}", &body[..field.start], after, &body[field.end..])
    } else {
        let indent = body
            .lines()
            .find_map(|line| line.find('"').map(|idx| &line[..idx]))
            .unwrap_or("\t\t\t\t\t");
        format!(
            "{}\n{indent}\"LaunchOptions\"\t\t\"{}\"\n",
            body.trim_end(),
            after
        )
    };
    let new_text = format!("{}{}{}", &text[..body_start], new_body, &text[body_end..]);
    let backup_path = config_path.with_extension(
        config_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{ext}.bak"))
            .unwrap_or_else(|| "bak".to_owned()),
    );
    fs::write(&backup_path, text)
        .map_err(|err| format!("Couldn't write {}: {err}", backup_path.display()))?;
    fs::write(config_path, new_text)
        .map_err(|err| format!("Couldn't write {}: {err}", config_path.display()))?;
    Ok(LaunchOptionsApplied {
        ok: true,
        noop: false,
        before,
        after,
        added,
        config_path: config_path.to_owned(),
        backup_path: Some(backup_path),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LaunchOptionsValue {
    start: usize,
    end: usize,
    value: String,
}

fn find_launch_options_value(body: &str) -> Option<LaunchOptionsValue> {
    let key = body.find("\"LaunchOptions\"")?;
    let after_key = &body[key + "\"LaunchOptions\"".len()..];
    let first_quote = after_key.find('"')?;
    let value_start = key + "\"LaunchOptions\"".len() + first_quote + 1;
    let rest = &body[value_start..];
    let value_end = value_start + rest.find('"')?;
    Some(LaunchOptionsValue {
        start: value_start,
        end: value_end,
        value: body[value_start..value_end].to_owned(),
    })
}

fn find_app_block_bounds(text: &str, app_id: &str) -> Option<(usize, usize)> {
    let apps_idx = text.find("\"apps\"")?;
    let needle = format!("\"{app_id}\"");
    let mut cursor = apps_idx;
    while let Some(idx) = text[cursor..].find(&needle).map(|idx| cursor + idx) {
        let mut brace = idx + needle.len();
        while brace < text.len() && text.as_bytes()[brace].is_ascii_whitespace() {
            brace += 1;
        }
        if text.as_bytes().get(brace) != Some(&b'{') {
            cursor = idx + 1;
            continue;
        }
        let body_start = brace + 1;
        let mut depth = 1_i32;
        for (offset, ch) in text[body_start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some((body_start, body_start + offset));
                    }
                }
                _ => {}
            }
        }
        return None;
    }
    None
}

fn find_dota_launch_options(account_id: Option<&str>) -> Option<String> {
    let config_path = find_localconfig_vdf(account_id)?;
    let text = fs::read_to_string(config_path).ok()?;
    let (body_start, body_end) = find_app_block_bounds(&text, DOTA_APP_ID)?;
    let body = &text[body_start..body_end];
    Some(
        find_launch_options_value(body)
            .map(|field| field.value)
            .unwrap_or_default(),
    )
}

fn steam_id64_to_account_id(steam_id64: &str) -> Option<String> {
    let steam_id = steam_id64.trim().parse::<u64>().ok()?;
    steam_id
        .checked_sub(STEAM_ID64_BASE)
        .map(|account| account.to_string())
}

fn find_localconfig_vdf(account_id: Option<&str>) -> Option<PathBuf> {
    for steam_dir in candidate_steam_dirs() {
        let userdata = steam_dir.join("userdata");
        if let Some(account_id) = account_id {
            let path = userdata.join(account_id).join("config/localconfig.vdf");
            if localconfig_has_dota(&path) {
                return Some(path);
            }
        }
        for entry in fs::read_dir(&userdata).ok()?.flatten() {
            if account_id.is_some_and(|id| entry.file_name().to_string_lossy() == id) {
                continue;
            }
            let path = entry.path().join("config/localconfig.vdf");
            if localconfig_has_dota(&path) {
                return Some(path);
            }
        }
    }
    None
}

fn localconfig_has_dota(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| find_app_block_bounds(&text, DOTA_APP_ID))
        .is_some()
}

fn candidate_steam_dirs() -> Vec<PathBuf> {
    if let Some(path) = env::var_os("DAC_STEAM_DIR").map(PathBuf::from) {
        return vec![path];
    }
    vec![
        PathBuf::from(r"C:\Program Files (x86)\Steam"),
        PathBuf::from(r"C:\Program Files\Steam"),
    ]
}

fn find_gsi_cfg_target() -> Option<PathBuf> {
    find_dota_dir().map(|dir| {
        dir.join("game/dota/cfg/gamestate_integration/gamestate_integration_dac_tracker.cfg")
    })
}

fn install_gsi_cfg(port: u16) -> io::Result<PathBuf> {
    let path = find_gsi_cfg_target()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Dota directory not found"))?;
    fs::create_dir_all(path.parent().unwrap())?;
    let desired = crate::gsi::install_cfg_text(port);
    if fs::read_to_string(&path).ok().as_deref() != Some(desired.as_str()) {
        fs::write(&path, desired)?;
    }
    Ok(path)
}

#[cfg(target_os = "windows")]
fn is_steam_running() -> bool {
    if env::var_os("DAC_TEST_NO_STEAM_SHUTDOWN").is_some() {
        return false;
    }
    process_running("steam.exe")
}

#[cfg(not(target_os = "windows"))]
fn is_steam_running() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn process_running(image_name: &str) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {image_name}"), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .to_ascii_lowercase()
                .contains(&image_name.to_ascii_lowercase())
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn request_steam_shutdown() -> bool {
    if env::var_os("DAC_TEST_NO_STEAM_SHUTDOWN").is_some() {
        return false;
    }
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    candidate_steam_dirs()
        .into_iter()
        .map(|dir| dir.join("steam.exe"))
        .find(|path| path.exists())
        .and_then(|path| {
            std::process::Command::new(path)
                .arg("-shutdown")
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .ok()
        })
        .is_some()
}

#[cfg(not(target_os = "windows"))]
fn request_steam_shutdown() -> bool {
    false
}

fn wait_for_steam_exit(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !is_steam_running() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    !is_steam_running()
}

fn find_autoexec_target() -> Option<PathBuf> {
    find_dota_dir().map(|dir| dir.join("game/dota/cfg/autoexec.cfg"))
}

fn install_autoexec() -> io::Result<PathBuf> {
    let path = find_autoexec_target()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Dota directory not found"))?;
    fs::create_dir_all(path.parent().unwrap())?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let next = if let (Some(start), Some(end)) = (
        existing.find("// >>> DAC Tracker nettable capture >>>"),
        existing.find("// <<< DAC Tracker nettable capture <<<"),
    ) {
        let end = end + "// <<< DAC Tracker nettable capture <<<".len();
        format!(
            "{}{}{}",
            &existing[..start],
            AUTOEXEC_BLOCK,
            &existing[end..]
        )
    } else {
        format!("{}\n{}", existing.trim_end(), AUTOEXEC_BLOCK)
    };
    fs::write(&path, next)?;
    Ok(path)
}

pub fn rows_json(rows: &[NettableRow]) -> String {
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
    .to_string()
}

pub fn parsed_json(parsed: &ParsedLog) -> String {
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
    .to_string()
}

fn json_string(value: &str) -> String {
    serde_json::Value::String(value.to_owned()).to_string()
}

fn now_iso_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}
