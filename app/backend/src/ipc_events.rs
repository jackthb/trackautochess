use serde::Serialize;

pub fn event_json<T: Serialize>(event: &T) -> String {
    serde_json::to_string(event).expect("IPC event serialization should not fail")
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub struct NettableRankingScanned<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub player_count: usize,
    pub upserted_count: usize,
    pub season: &'a str,
    pub at: &'a str,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub struct NettableCheckActiveMatch<'a> {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub backend: &'static str,
    pub ok: bool,
    pub paused: bool,
    pub message: &'a str,
    pub at: &'a str,
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
