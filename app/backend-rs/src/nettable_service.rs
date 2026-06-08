use crate::{
    config::Config,
    hotkeys::{send_dump_keys, DumpKey},
    nettable_parser::{self, NettableRow, ParsedLog},
    queen_ladder,
    supabase::{queue_rows, SupabaseClient},
};
use std::{
    fs, io,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime},
};

const POST_GAME_FINALIZE_ATTEMPTS: usize = 12;
const POST_GAME_FINALIZE_INTERVAL: Duration = Duration::from_secs(4);

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
                            if let Some(client) = SupabaseClient::from_config(&cfg) {
                                if client.upload_finished_match_from_rows(&rows).unwrap_or(false) {
                                    emit(format!(
                                        r#"{{"type":"nettable_end_board_saved","backend":"rust","at":{}}}"#,
                                        json_string(&now_iso_utc())
                                    ));
                                }
                            }
                            if cfg.upload_raw_nettable_dumps {
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

    pub fn apply_launch_options_json(&self) -> String {
        match install_autoexec() {
            Ok(path) => format!(
                r#"{{"type":"nettable_launch_options_applied","backend":"rust","ok":true,"path":{},"message":"Installed DAC dump bindings. Ensure Dota launch options include -condebug -conclearlog -gamestateintegration."}}"#,
                json_string(&path.display().to_string())
            ),
            Err(err) => format!(
                r#"{{"type":"nettable_ingest_error","error":{}}}"#,
                json_string(&format!("launch option setup failed: {err}"))
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

                let rows = state.lock().map(|state| state.latest_rows.clone()).unwrap_or_default();
                if rows_have_end_board(&rows) {
                    if let Some(client) = SupabaseClient::from_config(&cfg) {
                        let _ = client.upload_finished_match_from_rows(&rows);
                    }
                    emit(format!(
                        r#"{{"type":"nettable_end_board_saved","backend":"rust","at":{}}}"#,
                        json_string(&now_iso_utc())
                    ));
                    return;
                }
            }

            let rows = state.lock().map(|state| state.latest_rows.clone()).unwrap_or_default();
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
        emit(queen_progress("Checking the current Queen list…", &now_iso_utc()));

        let outcome = (|| -> Result<(usize, usize, String), String> {
            let (log_path, paused) = {
                let state = self.state.lock().unwrap();
                (state.log_path.clone().or_else(find_console_log), state.paused)
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
        assert!(player.contains_key("placement"), "curr_rank mapped to placement");
        assert!(player.contains_key("lineup"), "raw chess_lineup carried as lineup");
        assert_eq!(local_ids, vec!["76561198022169086".to_owned()]);
    }

    #[test]
    fn latest_ui_state_reads_last_transition_target() {
        let log = "\
06/08 00:15:50 ChangeGameUIState: DOTA_GAME_UI_STATE_LOADING_SCREEN -> DOTA_GAME_UI_DOTA_INGAME
06/08 01:11:17 ChangeGameUIState: DOTA_GAME_UI_DOTA_INGAME -> DOTA_GAME_UI_STATE_LOADING_SCREEN
06/08 01:11:19 ChangeGameUIState: DOTA_GAME_UI_STATE_LOADING_SCREEN -> DOTA_GAME_UI_STATE_DASHBOARD
";
        assert_eq!(latest_ui_state(log).as_deref(), Some("DOTA_GAME_UI_STATE_DASHBOARD"));
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
        assert!(!is_match_end_transition(None, "DOTA_GAME_UI_STATE_DASHBOARD"));
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
        assert_eq!(local_ids.len(), 1, "single-player dump flags the lone seat as local");
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
        local_ids.into_iter().map(serde_json::Value::String).collect(),
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

    fn harvest(players: &mut Map<String, Value>, container: &Value) {
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
                        row.entry((*dst).to_owned()).or_insert_with(|| value.clone());
                    }
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
                        let relics =
                            picks.into_iter().map(|(_, relic)| Value::String(relic)).collect();
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
                harvest(&mut players, data);
            }
        }
    }
    for row in rows {
        if row.table_name.ends_with("dac_table") && row.key == "player_info" {
            if let Some(info) = row.raw.to_value().get("info") {
                harvest(&mut players, info);
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
    let log_active = log_path
        .as_ref()
        .and_then(|path| path.metadata().ok())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .map(|age| age <= LOG_ACTIVE_WINDOW)
        .unwrap_or(false);
    format!(
        r#"{{"type":"nettable_status","backend":"rust","ok":true,"paused":{},"autoexec_installed":{},"log_path":{},"log_writable":{},"dota_dir":{},"remote_enabled":true,"launch_options":null,"has_condebug":null,"has_conclearlog":null,"has_gamestateintegration":null,"steam_running":false,"dota_running":{},"log_active":{}}}"#,
        if paused { "true" } else { "false" },
        if find_autoexec_target().map(|p| p.exists()).unwrap_or(false) { "true" } else { "false" },
        json_string(&log_path.as_ref().map(|p| p.display().to_string()).unwrap_or_default()),
        if log_writable { "true" } else { "false" },
        json_string(&find_dota_dir().map(|p| p.display().to_string()).unwrap_or_default()),
        if is_dota_running() { "true" } else { "false" },
        if log_active { "true" } else { "false" },
    )
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

fn maybe_fire_dump_hotkeys<F>(
    state: &Arc<Mutex<NettableState>>,
    emit: &Arc<F>,
    last_game_info_fire: &mut Instant,
    last_player_fire: &mut Instant,
    last_metadata_fire: &mut Instant,
) where
    F: Fn(String) + Send + Sync + 'static,
{
    if state.lock().map(|state| state.paused).unwrap_or(true) {
        return;
    }

    let now = Instant::now();
    if now.duration_since(*last_game_info_fire) >= Duration::from_secs(3) {
        *last_game_info_fire = now;
        fire_keys(emit, &[DumpKey::F23], "game_info");
    }
    if now.duration_since(*last_player_fire) >= Duration::from_secs(12) {
        *last_player_fire = now;
        // F21 dumps dac_table, which is where `end_board` (the full 8-player
        // final result) appears at game over. Without firing it here, end_board
        // is only ever dumped by the GSI post-game handler — which never fires
        // for many setups — so a finished match has no full-board data to save.
        fire_keys(emit, &[DumpKey::F22, DumpKey::F20, DumpKey::F21], "player snapshot");
    }
    if now.duration_since(*last_metadata_fire) >= Duration::from_secs(30) {
        *last_metadata_fire = now;
        fire_keys(emit, &[DumpKey::F24, DumpKey::F16], "metadata snapshot");
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
    rows.iter().any(|row| row.table_name == "CustomNetTable_dac_table" && row.key == "end_board")
}

fn finalize_without_end_board(cfg: &Config, rows: &[NettableRow]) -> Result<Option<String>, String> {
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
    let rows = state.lock().map(|s| s.latest_rows.clone()).unwrap_or_default();
    emit(format!(
        r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"at":{}}}"#,
        json_string("Dota left the match — finalizing from the last live snapshot."),
        json_string(&now_iso_utc())
    ));
    if let Some(client) = SupabaseClient::from_config(cfg) {
        if client.upload_finished_match_from_rows(&rows).unwrap_or(false) {
            emit(format!(
                r#"{{"type":"nettable_end_board_saved","backend":"rust","at":{}}}"#,
                json_string(&now_iso_utc())
            ));
            return;
        }
    }
    match finalize_without_end_board(cfg, &rows) {
        Ok(Some(match_id)) => emit(format!(
            r#"{{"type":"nettable_game_ended","backend":"rust","message":{},"match_id":{},"at":{}}}"#,
            json_string("Marked the match finished from the last live snapshot (no end board was emitted)."),
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

fn poll_once(state: &Arc<Mutex<NettableState>>, cfg: &Config) -> io::Result<Option<Vec<NettableRow>>> {
    let path = {
        let mut state = state.lock().unwrap();
        if state.paused {
            return Ok(None);
        }
        if state.log_path.as_ref().map(|path| !path.exists()).unwrap_or(true) {
            state.log_path = find_console_log();
        }
        state.log_path.clone()
    };
    let Some(path) = path else { return Ok(None); };
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
    if let Some(next) = ui_state {
        if is_match_end_transition(state.last_ui_state.as_deref(), &next) {
            state.pending_match_end = true;
        }
        state.last_ui_state = Some(next);
    }
    if cfg.keep_local_nettable_dumps && !rows.is_empty() {
        let _ = fs::create_dir_all(cfg.dac_dir.join("captures"));
        let _ = fs::write(cfg.dac_dir.join("captures/latest_nettable_rows.json"), rows_json(&rows));
    }
    Ok(Some(rows))
}

pub fn find_dota_dir() -> Option<PathBuf> {
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

fn find_autoexec_target() -> Option<PathBuf> {
    find_dota_dir().map(|dir| dir.join("game/dota/cfg/autoexec.cfg"))
}

fn install_autoexec() -> io::Result<PathBuf> {
    let path = find_autoexec_target().ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Dota directory not found"))?;
    fs::create_dir_all(path.parent().unwrap())?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let next = if let (Some(start), Some(end)) = (
        existing.find("// >>> DAC Tracker nettable capture >>>"),
        existing.find("// <<< DAC Tracker nettable capture <<<"),
    ) {
        let end = end + "// <<< DAC Tracker nettable capture <<<".len();
        format!("{}{}{}", &existing[..start], AUTOEXEC_BLOCK, &existing[end..])
    } else {
        format!("{}\n{}", existing.trim_end(), AUTOEXEC_BLOCK)
    };
    fs::write(&path, next)?;
    Ok(path)
}

pub fn rows_json(rows: &[NettableRow]) -> String {
    serde_json::Value::Array(
        rows.iter()
            .map(|row| serde_json::json!({
                "table_name": row.table_name,
                "key": row.key,
                "raw": row.raw.to_value(),
            }))
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
