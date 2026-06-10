use serde::Serialize;
use ts_rs::TS;

pub fn event_json<T: Serialize>(event: &T) -> String {
    serde_json::to_string(event).expect("IPC event serialization should not fail")
}

#[derive(Debug, Serialize, TS)]
pub struct BackendStatus<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub recording: bool,
    pub focused: bool,
    pub logged_in: bool,
    pub steam_id: &'a str,
    pub steam_name: &'a str,
    pub replay_enabled: bool,
}

impl<'a> BackendStatus<'a> {
    pub fn new(steam_id: &'a str, steam_name: &'a str, replay_enabled: bool) -> Self {
        Self {
            event_type: "status",
            backend: "rust",
            recording: false,
            focused: false,
            logged_in: !steam_id.is_empty(),
            steam_id,
            steam_name,
            replay_enabled,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct ErrorEvent<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub message: &'a str,
}

impl<'a> ErrorEvent<'a> {
    pub fn new(message: &'a str) -> Self {
        Self {
            event_type: "error",
            message,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct PayloadQueued<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub path: &'a str,
}

impl<'a> PayloadQueued<'a> {
    pub fn new(path: &'a str) -> Self {
        Self {
            event_type: "payload_queued",
            path,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct ConfigUpdated<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub key: &'a str,
}

impl<'a> ConfigUpdated<'a> {
    pub fn new(key: &'a str) -> Self {
        Self {
            event_type: "config_updated",
            key,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct SteamLogout {
    #[serde(rename = "type")]
    pub event_type: &'static str,
}

impl SteamLogout {
    pub fn new() -> Self {
        Self {
            event_type: "steam_logout",
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct SteamLoginUrl<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub url: &'a str,
}

impl<'a> SteamLoginUrl<'a> {
    pub fn new(url: &'a str) -> Self {
        Self {
            event_type: "steam_login_url",
            url,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct SteamLogin<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub steam_id: &'a str,
    pub steam_name: &'a str,
}

impl<'a> SteamLogin<'a> {
    pub fn new(steam_id: &'a str, steam_name: &'a str) -> Self {
        Self {
            event_type: "steam_login",
            steam_id,
            steam_name,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettablePaused {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub paused: bool,
}

impl NettablePaused {
    pub fn new(paused: bool) -> Self {
        Self {
            event_type: "nettable_paused",
            backend: "rust",
            paused,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct UpdateApplyRequested {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub ok: bool,
}

impl UpdateApplyRequested {
    pub fn new() -> Self {
        Self {
            event_type: "update_apply_requested",
            backend: "rust",
            ok: true,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct DiagnosticsUploaded<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub storage_ok: bool,
    pub reason: &'a str,
    pub paths: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracker_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub console_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub console_found: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<&'a str>,
}

impl<'a> DiagnosticsUploaded<'a> {
    pub fn complete(
        reason: &'a str,
        storage_ok: bool,
        paths: serde_json::Value,
        tracker_bytes: usize,
        console_bytes: usize,
        console_found: bool,
    ) -> Self {
        Self {
            event_type: "diagnostics_uploaded",
            backend: "rust",
            storage_ok,
            reason,
            paths,
            tracker_bytes: Some(tracker_bytes),
            console_bytes: Some(console_bytes),
            console_found: Some(console_found),
            message: None,
        }
    }

    pub fn failed(reason: &'a str, message: &'a str) -> Self {
        Self {
            event_type: "diagnostics_uploaded",
            backend: "rust",
            storage_ok: false,
            reason,
            paths: serde_json::json!({}),
            tracker_bytes: None,
            console_bytes: None,
            console_found: None,
            message: Some(message),
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableRoundChanged<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub round: i64,
    pub prev_round: Option<i64>,
    pub at: &'a str,
}

impl<'a> NettableRoundChanged<'a> {
    pub fn new(round: i64, prev_round: Option<i64>, at: &'a str) -> Self {
        Self {
            event_type: "nettable_round_changed",
            backend: "rust",
            round,
            prev_round,
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableCreepRound<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub round: i64,
    pub at: &'a str,
}

impl<'a> NettableCreepRound<'a> {
    pub fn new(round: i64, at: &'a str) -> Self {
        Self {
            event_type: "nettable_creep_round",
            backend: "rust",
            round,
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettablePersonalGameEnded<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub at: &'a str,
    pub round: i64,
    pub rank: i64,
    pub late_capture: bool,
}

impl<'a> NettablePersonalGameEnded<'a> {
    pub fn new(at: &'a str, round: i64, rank: i64, late_capture: bool) -> Self {
        Self {
            event_type: "nettable_personal_game_ended",
            backend: "rust",
            at,
            round,
            rank,
            late_capture,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableRankingScanned<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub player_count: usize,
    pub upserted_count: usize,
    pub season: &'a str,
    pub at: &'a str,
}

#[derive(Debug, Serialize, TS)]
pub struct NettableIngestComplete<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub rows_written: usize,
    pub tables: Vec<String>,
    pub at: &'a str,
}

impl<'a> NettableIngestComplete<'a> {
    pub fn new(rows_written: usize, tables: Vec<String>, at: &'a str) -> Self {
        Self {
            event_type: "nettable_ingest_complete",
            backend: "rust",
            rows_written,
            tables,
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableRows {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub rows: serde_json::Value,
}

impl NettableRows {
    pub fn new(rows: serde_json::Value) -> Self {
        Self {
            event_type: "nettable_rows",
            rows,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableTimelineExtracted<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub match_id: &'a str,
    pub round_count: u64,
    pub at: &'a str,
}

impl<'a> NettableTimelineExtracted<'a> {
    pub fn new(match_id: &'a str, round_count: u64, at: &'a str) -> Self {
        Self {
            event_type: "nettable_timeline_extracted",
            backend: "rust",
            match_id,
            round_count,
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableEndBoardSaved<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub match_id: &'a str,
    pub at: &'a str,
}

impl<'a> NettableEndBoardSaved<'a> {
    pub fn new(match_id: &'a str, at: &'a str) -> Self {
        Self {
            event_type: "nettable_end_board_saved",
            backend: "rust",
            match_id,
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableIngestError<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<&'static str>,
    pub error: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<&'a str>,
}

impl<'a> NettableIngestError<'a> {
    pub fn new(error: &'a str) -> Self {
        Self {
            event_type: "nettable_ingest_error",
            backend: None,
            error,
            at: None,
        }
    }

    pub fn with_backend_at(error: &'a str, at: &'a str) -> Self {
        Self {
            event_type: "nettable_ingest_error",
            backend: Some("rust"),
            error,
            at: Some(at),
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableGameEnded<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_id: Option<&'a str>,
    pub at: &'a str,
}

impl<'a> NettableGameEnded<'a> {
    pub fn new(message: &'a str, match_id: Option<&'a str>, at: &'a str) -> Self {
        Self {
            event_type: "nettable_game_ended",
            backend: "rust",
            message,
            match_id,
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableCheckActiveMatch<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub ok: bool,
    pub paused: bool,
    pub message: &'a str,
    pub at: &'a str,
}

#[derive(Debug, Serialize, TS)]
pub struct NettableResyncComplete<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub ok: bool,
    pub noop: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'a str>,
}

impl<'a> NettableResyncComplete<'a> {
    pub fn ok(noop: bool) -> Self {
        Self {
            event_type: "nettable_resync_complete",
            ok: true,
            noop,
            error: None,
        }
    }

    pub fn error(error: &'a str) -> Self {
        Self {
            event_type: "nettable_resync_complete",
            ok: false,
            noop: false,
            error: Some(error),
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableQueenUploadProgress<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub message: &'a str,
    pub at: &'a str,
}

impl<'a> NettableQueenUploadProgress<'a> {
    pub fn new(message: &'a str, at: &'a str) -> Self {
        Self {
            event_type: "nettable_queen_upload_progress",
            message,
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableQueenUploadComplete<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub ok: bool,
    pub player_count: usize,
    pub upserted_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season: Option<&'a str>,
    pub error: Option<&'a str>,
    pub at: &'a str,
}

impl<'a> NettableQueenUploadComplete<'a> {
    pub fn complete(
        player_count: usize,
        upserted_count: usize,
        season: &'a str,
        error: Option<&'a str>,
        at: &'a str,
    ) -> Self {
        let ok = upserted_count > 0;
        Self {
            event_type: "nettable_queen_upload_complete",
            ok,
            player_count,
            upserted_count,
            season: Some(season),
            error,
            at,
        }
    }

    pub fn failed(message: &'a str, at: &'a str) -> Self {
        Self {
            event_type: "nettable_queen_upload_complete",
            ok: false,
            player_count: 0,
            upserted_count: 0,
            season: None,
            error: Some(message),
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableStateEvent {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub rows: serde_json::Value,
    pub state: serde_json::Value,
    pub players: serde_json::Value,
    pub local_steam_ids: serde_json::Value,
    pub at: String,
}

impl NettableStateEvent {
    pub fn new(
        rows: serde_json::Value,
        state: serde_json::Value,
        players: serde_json::Value,
        local_steam_ids: serde_json::Value,
        at: String,
    ) -> Self {
        Self {
            event_type: "nettable_state",
            backend: "rust",
            rows,
            state,
            players,
            local_steam_ids,
            at,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableStatus<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub ok: bool,
    pub paused: bool,
    pub autoexec_installed: bool,
    pub gsi_cfg_installed: bool,
    pub log_path: &'a str,
    pub log_writable: bool,
    pub dota_dir: &'a str,
    pub remote_enabled: bool,
    pub launch_options: Option<&'a str>,
    pub has_condebug: Option<bool>,
    pub has_conclearlog: Option<bool>,
    pub has_gamestateintegration: Option<bool>,
    pub steam_running: bool,
    pub dota_running: bool,
    pub log_active: bool,
}

#[derive(Debug, Serialize, TS)]
pub struct NettableSetupProgress<'a> {
    #[serde(rename = "type")]
    pub event_type: &'a str,
    pub stage: &'a str,
    pub message: &'a str,
}

impl<'a> NettableSetupProgress<'a> {
    pub fn new(event_type: &'a str, stage: &'a str, message: &'a str) -> Self {
        Self {
            event_type,
            stage,
            message,
        }
    }
}

#[derive(Debug, Serialize, TS)]
pub struct NettableLaunchOptionsApplied<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub ok: bool,
    pub noop: bool,
    pub before: &'a str,
    pub after: &'a str,
    pub added: &'a [String],
    pub config_path: &'a str,
    pub backup_path: Option<&'a str>,
    pub autoexec_path: &'a str,
    pub gsi_cfg_path: Option<&'a str>,
}

#[derive(Debug, Serialize, TS)]
pub struct NettableLaunchOptionsError<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub ok: bool,
    pub error: &'a str,
}

impl<'a> NettableLaunchOptionsError<'a> {
    pub fn new(error: &'a str) -> Self {
        Self {
            event_type: "nettable_launch_options_applied",
            backend: "rust",
            ok: false,
            error,
        }
    }
}

impl<'a> NettableCheckActiveMatch<'a> {
    pub fn new(message: &'a str, at: &'a str) -> Self {
        Self {
            event_type: "nettable_check_active_match",
            backend: "rust",
            ok: true,
            paused: false,
            message,
            at,
        }
    }
}

impl<'a> NettableRankingScanned<'a> {
    pub fn new(player_count: usize, upserted_count: usize, season: &'a str, at: &'a str) -> Self {
        Self {
            event_type: "nettable_ranking_scanned",
            backend: "rust",
            player_count,
            upserted_count,
            season,
            at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};
    use ts_rs::{Config as TsConfig, TS};

    fn generated_bindings() -> String {
        std::env::set_var("TS_RS_LARGE_INT", "number");
        let cfg = TsConfig::default();
        let mut out = String::from(
            "// This file is generated from app/backend/src/ipc_events.rs. Do not edit.\n\n",
        );
        out.push_str(
            "export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue | undefined } | JsonValue[];\n\n",
        );
        macro_rules! push_decl {
            ($ty:ty) => {{
                let decl = <$ty as TS>::decl(&cfg);
                out.push_str(
                    &decl
                        .replacen("type ", "export type ", 1)
                        .replace("bigint", "number"),
                );
                out.push_str("\n\n");
            }};
        }
        push_decl!(BackendStatus<'static>);
        push_decl!(ErrorEvent<'static>);
        push_decl!(PayloadQueued<'static>);
        push_decl!(ConfigUpdated<'static>);
        push_decl!(SteamLogout);
        push_decl!(SteamLoginUrl<'static>);
        push_decl!(SteamLogin<'static>);
        push_decl!(NettablePaused);
        push_decl!(UpdateApplyRequested);
        push_decl!(DiagnosticsUploaded<'static>);
        push_decl!(NettableRoundChanged<'static>);
        push_decl!(NettableCreepRound<'static>);
        push_decl!(NettablePersonalGameEnded<'static>);
        push_decl!(NettableRankingScanned<'static>);
        push_decl!(NettableIngestComplete<'static>);
        push_decl!(NettableRows);
        push_decl!(NettableTimelineExtracted<'static>);
        push_decl!(NettableEndBoardSaved<'static>);
        push_decl!(NettableIngestError<'static>);
        push_decl!(NettableGameEnded<'static>);
        push_decl!(NettableCheckActiveMatch<'static>);
        push_decl!(NettableResyncComplete<'static>);
        push_decl!(NettableQueenUploadProgress<'static>);
        push_decl!(NettableQueenUploadComplete<'static>);
        push_decl!(NettableStateEvent);
        push_decl!(NettableStatus<'static>);
        push_decl!(NettableSetupProgress<'static>);
        push_decl!(NettableLaunchOptionsApplied<'static>);
        push_decl!(NettableLaunchOptionsError<'static>);
        out
    }

    #[test]
    #[ignore = "generates app/src/backend-events.generated.ts"]
    fn export_backend_event_bindings() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src/backend-events.generated.ts");
        fs::write(path, generated_bindings()).expect("write backend event bindings");
    }

    #[test]
    fn serializes_round_changed_with_null_previous_round() {
        let json = event_json(&NettableRoundChanged::new(10, None, "2026-06-10T00:00:00Z"));
        assert_eq!(
            json,
            r#"{"type":"nettable_round_changed","backend":"rust","round":10,"prev_round":null,"at":"2026-06-10T00:00:00Z"}"#
        );
    }

    #[test]
    fn serializes_personal_game_ended_with_boolean_late_capture() {
        let json = event_json(&NettablePersonalGameEnded::new(
            "2026-06-10T00:00:00Z",
            25,
            4,
            true,
        ));
        assert_eq!(
            json,
            r#"{"type":"nettable_personal_game_ended","backend":"rust","at":"2026-06-10T00:00:00Z","round":25,"rank":4,"late_capture":true}"#
        );
    }

    #[test]
    fn serializes_ingest_complete_with_table_array() {
        let json = event_json(&NettableIngestComplete::new(
            2,
            vec!["CustomNetTable_game_info".to_owned()],
            "2026-06-10T00:00:00Z",
        ));
        assert_eq!(
            json,
            r#"{"type":"nettable_ingest_complete","backend":"rust","rows_written":2,"tables":["CustomNetTable_game_info"],"at":"2026-06-10T00:00:00Z"}"#
        );
    }

    #[test]
    fn serializes_game_ended_without_match_id() {
        let json = event_json(&NettableGameEnded::new(
            "Finished from live snapshot.",
            None,
            "2026-06-10T00:00:00Z",
        ));
        assert_eq!(
            json,
            r#"{"type":"nettable_game_ended","backend":"rust","message":"Finished from live snapshot.","at":"2026-06-10T00:00:00Z"}"#
        );
    }

    #[test]
    fn serializes_rows_event_with_row_array() {
        let json = event_json(&NettableRows::new(serde_json::json!([
            { "table_name": "CustomNetTable_game_info", "key": "round_info", "raw": { "round": 10 } }
        ])));
        assert_eq!(
            json,
            r#"{"type":"nettable_rows","rows":[{"key":"round_info","raw":{"round":10},"table_name":"CustomNetTable_game_info"}]}"#
        );
    }
}
