mod client;
mod diagnostics;
mod matches;
mod outbox;
mod queen_ladder;
mod storage;

pub use client::{client_with_fresh_session, fresh_client_from_disk};
pub use matches::finished_match_id_from_rows;

use serde_json::{json, Value};
use std::{env, time::Duration};

const STEAM_ID64_MIN: u64 = 76_561_197_960_265_728;
const STEAM_ID64_MAX: u64 = 76_561_202_255_233_023;
const DRODO_COURIER_BATCH_SIZE: usize = 100;
const HTTP_TIMEOUT: Duration = Duration::from_secs(4);
const MATCH_INGEST_HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const DRODO_COURIER_API_BASE_URL: &str = "http://autochess.ppbizon.com";
const QUEENS_REVALIDATE_URL_ENV: &str = "DAC_QUEENS_REVALIDATE_URL";

#[derive(Debug, Clone)]
pub struct SupabaseClient {
    url: String,
    key: String,
    auth_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DiagnosticUploadSummary {
    pub reason: String,
    pub storage_ok: bool,
    pub paths: Value,
    pub tracker_bytes: usize,
    pub console_bytes: usize,
    pub console_found: bool,
}

/// Renders a `ureq` failure as a message that keeps the response body when the
/// server sent one — HTTP status alone rarely says why Supabase or Steam
/// rejected a request.
pub(crate) fn describe_ureq_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, response) => {
            let body = response.into_string().unwrap_or_default();
            if body.trim().is_empty() {
                format!("status code {code}")
            } else {
                format!("status code {code}: {body}")
            }
        }
        err => err.to_string(),
    }
}

pub(crate) fn parse_valid_steam_id64(value: &str) -> Option<u64> {
    let steam_id = value.trim().parse::<u64>().ok()?;
    (STEAM_ID64_MIN..=STEAM_ID64_MAX)
        .contains(&steam_id)
        .then_some(steam_id)
}

pub(crate) fn steam_id64_to_account_id(value: &str) -> Option<String> {
    parse_valid_steam_id64(value)?
        .checked_sub(STEAM_ID64_MIN)
        .map(|account| account.to_string())
}

fn number_from_object(object: &serde_json::Map<String, Value>, key: &str) -> Option<i64> {
    let value = object.get(key)?;
    match value {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().and_then(|n| i64::try_from(n).ok())),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn current_drodo_season(object: &serde_json::Map<String, Value>) -> Option<String> {
    object
        .keys()
        .filter_map(|key| key.strip_prefix("mmr_s"))
        .filter_map(|suffix| suffix.parse::<u32>().ok())
        .max()
        .map(|season| format!("s{season}"))
}

fn next_drodo_poll_at(interval_seconds: i64) -> String {
    let seconds = interval_seconds.max(0);
    (chrono::Utc::now() + chrono::Duration::seconds(seconds)).to_rfc3339()
}

fn now_iso_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(crate) fn drodo_courier_api_url(path: &str) -> String {
    format!(
        "{}/{}",
        DRODO_COURIER_API_BASE_URL,
        path.trim_start_matches('/')
    )
}

pub(crate) fn queens_revalidate_url() -> Option<String> {
    env::var(QUEENS_REVALIDATE_URL_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn mmr_level_to_app_rank(value: Option<&Value>) -> Option<String> {
    const RANKS: &[&str] = &[
        "Pawn-1", "Pawn-2", "Pawn-3", "Pawn-4", "Pawn-5", "Pawn-6", "Pawn-7", "Pawn-8", "Pawn-9",
        "Knight-1", "Knight-2", "Knight-3", "Knight-4", "Knight-5", "Knight-6", "Knight-7",
        "Knight-8", "Knight-9", "Bishop-1", "Bishop-2", "Bishop-3", "Bishop-4", "Bishop-5",
        "Bishop-6", "Bishop-7", "Bishop-8", "Bishop-9", "Rook-1", "Rook-2", "Rook-3", "Rook-4",
        "Rook-5", "Rook-6", "Rook-7", "Rook-8", "Rook-9", "King", "Queen",
    ];
    let n = value.and_then(Value::as_i64)?;
    if n < 1 || n as usize > RANKS.len() {
        return None;
    }
    Some(RANKS[n as usize - 1].to_owned())
}

fn drodo_user_row_to_profile(row: &Value, seasons: Value) -> Value {
    json!({
        "mmr": row.get("drodo_mmr").cloned().unwrap_or(Value::Null),
        "max_mmr": row.get("drodo_max_mmr").cloned().unwrap_or(Value::Null),
        "mmr_level": row.get("drodo_mmr_level").cloned().unwrap_or(Value::Null),
        "season": row.get("drodo_season").cloned().unwrap_or(Value::Null),
        "season_games": row.get("drodo_season_games").cloned().unwrap_or(Value::Null),
        "chicken_count": row.get("drodo_chicken_count").cloned().unwrap_or_else(|| json!(0)),
        "fetched_at": row.get("drodo_last_fetched_at").cloned().unwrap_or(Value::Null),
        "seasons": seasons,
    })
}

fn drodo_profile_to_user_payload(profile: &Value) -> Value {
    let mut payload = json!({
        "steam_id": profile.get("steam_id").cloned().unwrap_or(Value::Null),
        "drodo_mmr_level": profile.get("mmr_level").cloned().unwrap_or(Value::Null),
        "drodo_candy": profile.get("candy").cloned().unwrap_or(Value::Null),
        "drodo_chicken_count": profile.get("chicken_count").cloned().unwrap_or_else(|| json!(0)),
        "drodo_raw_data": profile.get("raw_data").cloned().unwrap_or(Value::Null),
        "drodo_last_fetched_at": profile.get("fetched_at").cloned().unwrap_or(Value::Null),
        "drodo_profile_missing": false,
    });
    // Drodo's public courier payload currently omits season MMR / queen_rank for
    // many accounts. Never write null over a previously cached value.
    if let Some(obj) = payload.as_object_mut() {
        for (payload_key, profile_key) in [
            ("drodo_mmr", "mmr"),
            ("drodo_max_mmr", "max_mmr"),
            ("drodo_season", "season"),
            ("drodo_season_games", "season_games"),
        ] {
            if let Some(value) = profile.get(profile_key).filter(|value| !value.is_null()) {
                obj.insert(payload_key.to_owned(), value.clone());
            }
        }
    }
    payload
}

fn preserve_omitted_drodo_fields(existing: &Value, profile: &mut Value) {
    let Some(obj) = profile.as_object_mut() else {
        return;
    };
    for (profile_key, existing_key) in [
        ("mmr", "drodo_mmr"),
        ("max_mmr", "drodo_max_mmr"),
        ("season", "drodo_season"),
        ("season_games", "drodo_season_games"),
    ] {
        let missing = obj.get(profile_key).map_or(true, Value::is_null);
        if !missing {
            continue;
        }
        if let Some(value) = existing.get(existing_key).filter(|value| !value.is_null()) {
            obj.insert(profile_key.to_owned(), value.clone());
        }
    }
}

fn value_number(value: &Value, key: &str) -> Option<i64> {
    match value.get(key)? {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|n| n as i64)),
        Value::String(text) => text.parse::<i64>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::matches::*;
    use super::queen_ladder::queen_ladder_stale_clear_path;
    use super::*;
    use crate::nettable_parser::NettableRow;

    #[test]
    fn live_match_id_distinguishes_repeat_solo_games() {
        let pairs = vec![("76561198000000001".to_owned(), 1)];
        let first =
            generate_live_match_id(&pairs, Some(46), Some(2084.0), Some("2026-06-09T10:59:52Z"));
        let retry =
            generate_live_match_id(&pairs, Some(46), Some(2084.0), Some("2026-06-09T10:59:52Z"));
        let next_solo_win =
            generate_live_match_id(&pairs, Some(49), Some(2210.0), Some("2026-06-09T11:12:16Z"));

        assert_eq!(first, retry, "same final board should remain idempotent");
        assert_ne!(
            first, next_solo_win,
            "solo games with the same player and placement must not collide"
        );
    }

    #[test]
    fn same_game_window_emits_postgrest_safe_utc_bounds() {
        // now_iso_utc() emits a +00:00 offset; the window must come back
        // Z-suffixed or PostgREST reads the '+' as a space and the filter 400s.
        let (start, end) = same_game_window("2026-06-11T14:42:16+00:00").expect("window");
        assert_eq!(start, "2026-06-11T14:12:16Z");
        assert_eq!(end, "2026-06-11T15:12:16Z");
        assert!(same_game_window("not-a-timestamp").is_none());
    }

    #[test]
    fn steam_id_sets_match_between_fallback_rows_and_end_board_players() {
        // The supersede check compares the fallback roster against the
        // end-board roster; both must reduce to the same steam_id set.
        let players = vec![
            json!({"steam_id": 76561198000000002u64, "placement": 1}),
            json!({"steam_id": 76561198000000001u64, "placement": 2}),
            json!({"placement": 3}),
        ];
        let id_row = |slot: u32, steam_id: u64| NettableRow {
            table_name: "CustomNetTable_player_id_table".to_owned(),
            key: format!("player_{slot}"),
            raw: crate::nettable_parser::Value::Object(
                [(
                    "steam_id".to_owned(),
                    crate::nettable_parser::Value::U64(steam_id),
                )]
                .into_iter()
                .collect(),
            ),
            observed_at: None,
            match_started_at: None,
        };
        let rows = vec![id_row(1, 76561198000000002), id_row(2, 76561198000000001)];
        let expected: std::collections::BTreeSet<u64> =
            [76561198000000001u64, 76561198000000002u64]
                .into_iter()
                .collect();
        let player_ids = players
            .iter()
            .filter_map(|player| player.get("steam_id").and_then(Value::as_u64))
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(player_ids, expected);
        assert_eq!(rows_steam_id_set(&rows), expected);
    }

    #[test]
    fn unify_row_keys_pads_ragged_rows_with_nulls() {
        let rows = vec![
            serde_json::json!({"steam_id": 1, "placement": 1, "relic": "doubloon"}),
            serde_json::json!({"steam_id": 2, "placement": 2}),
        ];
        let unified = unify_row_keys(rows);
        // PostgREST bulk inserts 400 (PGRST102) unless every object has the
        // same key set, so the second row must gain an explicit null relic.
        assert_eq!(unified[1]["relic"], serde_json::Value::Null);
        for row in &unified {
            let keys: Vec<_> = row.as_object().unwrap().keys().collect();
            assert_eq!(keys, vec!["placement", "relic", "steam_id"]);
        }
    }

    #[test]
    fn match_ingest_serializes_steam_ids_without_javascript_precision_loss() {
        let rows = match_ingest_player_rows(vec![json!({
            "match_id": "0123456789abcdef",
            "steam_id": 76561198000000001u64,
            "placement": 1,
        })]);

        assert_eq!(rows[0]["steam_id"], "76561198000000001");
    }

    #[test]
    fn nettable_row_json_preserves_upload_shape() {
        let row = NettableRow {
            table_name: "CustomNetTable_dac_table".to_owned(),
            key: "end_board".to_owned(),
            raw: crate::nettable_parser::Value::Object(
                [(
                    "data".to_owned(),
                    crate::nettable_parser::Value::Object(Default::default()),
                )]
                .into_iter()
                .collect(),
            ),
            observed_at: Some("2026-06-09T10:59:52Z".to_owned()),
            match_started_at: Some("2026-06-09T10:01:10Z".to_owned()),
        };
        assert_eq!(
            nettable_row_json(&row),
            json!({"table_name":"CustomNetTable_dac_table","key":"end_board","raw":{"data":{}},"observed_at":"2026-06-09T10:59:52Z","match_started_at":"2026-06-09T10:01:10Z"})
        );
    }

    #[test]
    fn queen_ladder_cleanup_excludes_current_scan_ids() {
        assert_eq!(
            queen_ladder_stale_clear_path(&[76561198000000001, 76561198000000002]),
            "/rest/v1/users?queen_ladder_last_seen_at=not.is.null&steam_id=not.in.(76561198000000001,76561198000000002)"
        );
    }

    #[test]
    fn match_player_dedupe_keeps_one_row_per_match_and_steam_id() {
        let players = dedupe_match_players(vec![
            json!({"match_id":"m1","steam_id":76561198000000001u64,"placement":1}),
            json!({"match_id":"m1","steam_id":76561198000000001u64,"placement":1}),
            json!({"match_id":"m1","steam_id":76561198000000002u64,"placement":2}),
        ]);

        assert_eq!(players.len(), 2);
        assert_eq!(players[0]["steam_id"], 76561198000000001u64);
        assert_eq!(players[1]["steam_id"], 76561198000000002u64);
    }

    #[test]
    fn fallback_upload_builds_minimal_match_player_rows() {
        use crate::nettable_parser::Value as RawValue;
        use std::collections::BTreeMap;

        fn object(entries: Vec<(&str, RawValue)>) -> RawValue {
            RawValue::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key.to_owned(), value))
                    .collect::<BTreeMap<_, _>>(),
            )
        }

        let rows = vec![
            NettableRow {
                table_name: "CustomNetTable_player_id_table".to_owned(),
                key: "player_1".to_owned(),
                raw: object(vec![(
                    "steam_id",
                    RawValue::String("76561198000000001".to_owned()),
                )]),
                observed_at: None,
                match_started_at: None,
            },
            NettableRow {
                table_name: "CustomNetTable_player_info_table".to_owned(),
                key: "player_info".to_owned(),
                raw: object(vec![(
                    "data",
                    object(vec![(
                        "76561198000000001",
                        object(vec![
                            ("curr_rank", RawValue::I32(3)),
                            ("hero_level", RawValue::I32(10)),
                            ("chess_lineup", RawValue::String("chess_ck1,".to_owned())),
                            ("buff", RawValue::String("is_demon:2,".to_owned())),
                        ]),
                    )]),
                )]),
                observed_at: None,
                match_started_at: None,
            },
            NettableRow {
                table_name: "CustomNetTable_game_info".to_owned(),
                key: "round_info".to_owned(),
                raw: object(vec![("round", RawValue::I32(42))]),
                observed_at: None,
                match_started_at: None,
            },
        ];

        let players =
            build_fallback_match_players(&rows, "fallback-match", "post_game_no_end_board");
        assert_eq!(players.len(), 1);
        assert_eq!(players[0]["match_id"], "fallback-match");
        assert_eq!(players[0]["steam_id"], 76561198000000001u64);
        assert_eq!(players[0]["placement"], 3);
        assert_eq!(players[0]["hero_level"], 10);
        assert_eq!(players[0]["final_round"], 42);
        assert_eq!(players[0]["chess_lineup"], "Chaos Knight(2)");
        assert_eq!(players[0]["synergies"], "demon:1");
    }

    #[test]
    fn steam_id64_validation_rejects_out_of_range_values() {
        assert_eq!(
            parse_valid_steam_id64("76561197960265728"),
            Some(76561197960265728)
        );
        assert_eq!(
            parse_valid_steam_id64("76561202255233023"),
            Some(76561202255233023)
        );
        assert_eq!(parse_valid_steam_id64("76561197960265727"), None);
        assert_eq!(parse_valid_steam_id64("76561202255233024"), None);
        assert_eq!(parse_valid_steam_id64("not-a-steam-id"), None);
    }

    #[test]
    fn steam_id64_to_account_id_uses_standard_valve_offset() {
        assert_eq!(
            steam_id64_to_account_id("76561198022169086"),
            Some("61903358".to_owned())
        );
        assert_eq!(steam_id64_to_account_id("not-a-steam-id"), None);
    }

    #[test]
    fn end_board_upload_builds_match_and_schema_safe_player_rows() {
        let rows = vec![json!({
            "table_name": "CustomNetTable_dac_table",
            "key": "end_board",
            "raw": {
                "data": {
                    "76561198000000002": {
                        "rank": 8,
                        "curr_rank": 2,
                        "mmr_level": 4200,
                        "round": 34,
                        "duration": 2084.5,
                        "buff": "is_demon:5,is_demonhunter:2,is_warlock:2,",
                        "talent_tree": {
                            "2": "talent_2b_promotion",
                            "1": "talent_1b_losebonus"
                        },
                        "chess_lineup": "Axe(2)",
                        "chess_hand": "chess_ck1,chess_lion,",
                        "screenshot": "legacy screenshot should not upload",
                        "notes": "legacy notes should not upload",
                        "unknown_future_field": "drop me"
                    },
                    "76561198000000001": {
                        "rank": 1,
                        "round": 42,
                        "duration": 2400.0,
                        "played_at": "from-payload",
                        "relic": "relic_example"
                    },
                    "not-a-steam-id": { "rank": 3 }
                }
            }
        })];

        let upload = build_end_board_upload(&rows, "2026-06-07T12:00:00Z")
            .expect("end_board should build upload");

        assert_eq!(
            upload.match_row["match_id"],
            build_end_board_upload(&rows, "2026-06-07T12:00:05Z")
                .expect("same end board should rebuild")
                .match_row["match_id"],
            "same end_board content should be stable across upload retries"
        );
        assert_eq!(
            upload.match_row["player_count"], 2,
            "invalid Steam IDs must not inflate the validated roster size"
        );
        assert_eq!(upload.match_row["final_round"], 42);
        assert_eq!(upload.match_row["duration"], 2400.0);
        assert_eq!(upload.match_row["capture_status"], "complete");
        assert_eq!(upload.match_row["verification_source"], "end_board");
        assert_eq!(
            upload.players.len(),
            2,
            "invalid Steam IDs should be skipped for match_players"
        );

        let second = upload
            .players
            .iter()
            .find(|player| player["steam_id"] == 76561198000000002u64)
            .expect("second player row should exist");
        assert_eq!(second["placement"], 2, "curr_rank should win over rank");
        assert_eq!(second["mmr_level"], 4200);
        assert_eq!(second["final_round"], 34);
        assert_eq!(second["duration"], 2084.5);
        assert_eq!(second["synergies"], "demon:1|demonhunter:2|warlock:2");
        assert_eq!(second["talents"], "talent_1b_losebonus|talent_2b_promotion");
        assert_eq!(second["chess_lineup"], "Axe(2)");
        assert_eq!(second["chess_hand"], "Chaos Knight(2)|Lion");
        assert!(
            second.get("screenshot").is_none(),
            "legacy screenshot column should not be posted"
        );
        assert!(
            second.get("notes").is_none(),
            "legacy notes column should not be posted"
        );
        assert!(
            second.get("unknown_future_field").is_none(),
            "unknown columns should not be posted to PostgREST"
        );

        let first = upload
            .players
            .iter()
            .find(|player| player["steam_id"] == 76561198000000001u64)
            .expect("first player row should exist");
        assert_eq!(
            first["played_at"], "from-payload",
            "payload played_at should be preserved when present"
        );
        assert_eq!(first["relic"], "relic_example");
    }

    #[test]
    fn end_board_upload_ignores_missing_or_empty_end_board() {
        assert!(build_end_board_upload(&[], "2026-06-07T12:00:00Z").is_none());
        assert!(build_end_board_upload(
            &[json!({
                "table_name": "CustomNetTable_dac_table",
                "key": "end_board",
                "raw": {"data": {}}
            })],
            "2026-06-07T12:00:00Z"
        )
        .is_none());
    }

    #[test]
    fn fallback_match_uses_player_id_table_without_end_board() {
        let rows = vec![
            NettableRow {
                table_name: "CustomNetTable_player_id_table".to_owned(),
                key: "player_1".to_owned(),
                raw: crate::nettable_parser::Value::Object(
                    [(
                        "steam_id".to_owned(),
                        crate::nettable_parser::Value::U64(76561198000000002),
                    )]
                    .into_iter()
                    .collect(),
                ),
                observed_at: None,
                match_started_at: None,
            },
            NettableRow {
                table_name: "CustomNetTable_player_id_table".to_owned(),
                key: "player_0".to_owned(),
                raw: crate::nettable_parser::Value::Object(
                    [(
                        "steam_id".to_owned(),
                        crate::nettable_parser::Value::U64(76561198000000001),
                    )]
                    .into_iter()
                    .collect(),
                ),
                observed_at: None,
                match_started_at: None,
            },
        ];

        let row = build_fallback_match_row(&rows, "post_game_no_end_board", "2026-06-07T12:00:00Z")
            .expect("player_id_table should be enough to build fallback match row");

        assert_eq!(row["match_id"], "05ca0c23f3fab115");
        assert_eq!(row["player_count"], 2);
        assert_eq!(row["capture_status"], "partial");
        assert_eq!(row["is_finished"], true);
        assert_eq!(row["verification_source"], "post_game_no_end_board");

        let later =
            build_fallback_match_row(&rows, "post_game_no_end_board", "2026-06-07T12:01:00Z")
                .expect("later fallback should also build");
        assert_ne!(
            later["match_id"], row["match_id"],
            "fallback IDs without captured timing still use upload time as a last-resort salt"
        );

        let mut timed_rows = rows.clone();
        for row in &mut timed_rows {
            row.match_started_at = Some("2026-06-07T11:45:00Z".to_owned());
        }
        let timed = build_fallback_match_row(
            &timed_rows,
            "post_game_no_end_board",
            "2026-06-07T12:00:00Z",
        )
        .expect("timed fallback should build");
        let timed_retry = build_fallback_match_row(
            &timed_rows,
            "post_game_no_end_board",
            "2026-06-07T12:01:00Z",
        )
        .expect("timed retry fallback should build");
        assert_eq!(
            timed_retry["match_id"], timed["match_id"],
            "fallback retries with captured match timing should be idempotent"
        );
    }
}
