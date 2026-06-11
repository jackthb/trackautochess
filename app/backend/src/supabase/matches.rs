use super::{now_iso_utc, parse_valid_steam_id64, SupabaseClient};
use crate::{nettable_parser::NettableRow, unit_codes::normalize_chess_lineup};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

/// Solo lobbies (practice/bot games with no other humans) are not real
/// matches; require at least one opponent before recording anything.
pub(super) const MIN_TRACKED_PLAYERS: usize = 2;

impl SupabaseClient {
    pub fn upload_finished_match_from_rows(
        &self,
        rows: &[NettableRow],
    ) -> Result<Option<String>, String> {
        let row_values = rows.iter().map(nettable_row_json).collect::<Vec<_>>();
        if !row_values.iter().any(is_end_board_row) {
            return Ok(None);
        }
        self.upload_end_board_rows(&row_values)
    }

    pub fn finished_match_has_players(&self, match_id: &str) -> bool {
        self.get_json(&format!(
            "/rest/v1/match_players?select=steam_id&match_id=eq.{match_id}&limit=1"
        ))
        .ok()
        .and_then(|value| value.as_array().map(|rows| !rows.is_empty()))
        .unwrap_or(false)
    }

    pub fn upsert_match_timeline(&self, timeline: &Value) -> Result<(), String> {
        let match_id = timeline
            .get("match_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "timeline missing match_id".to_owned())?;
        let round_count = timeline
            .get("round_count")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if let Ok(existing) = self.get_json(&format!(
            "/rest/v1/match_timelines?select=round_count&match_id=eq.{match_id}&limit=1"
        )) {
            let existing_round_count = existing
                .as_array()
                .and_then(|rows| rows.first())
                .and_then(|row| row.get("round_count"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            if existing_round_count >= round_count && existing_round_count > 0 {
                return Ok(());
            }
        }
        let row = json!({
            "match_id": match_id,
            "round_count": round_count,
            "first_round": timeline.get("first_round").cloned().unwrap_or(Value::Null),
            "last_round": timeline.get("last_round").cloned().unwrap_or(Value::Null),
            "timeline": timeline,
        });
        self.post_json(
            "/rest/v1/match_timelines?on_conflict=match_id",
            &row,
            "resolution=merge-duplicates,return=minimal",
        )
    }

    pub fn upsert_fallback_finished_match(
        &self,
        rows: &[NettableRow],
        reason: &str,
    ) -> Result<Option<String>, String> {
        let Some(match_row) = build_fallback_match_row(rows, reason, &now_iso_utc()) else {
            return Ok(None);
        };
        let match_id = match_row
            .get("match_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        self.post_json(
            "/rest/v1/matches",
            &match_row,
            "resolution=ignore-duplicates,return=minimal",
        )?;
        let players = unify_row_keys(build_fallback_match_players(rows, &match_id, reason));
        if !players.is_empty() {
            self.ensure_match_player_users(&players)?;
            self.post_json(
                "/rest/v1/match_players?on_conflict=match_id,steam_id",
                &Value::Array(players),
                "resolution=merge-duplicates,return=minimal",
            )?;
        }
        Ok(Some(match_id))
    }

    /// Upsert player identities discovered from the in-game Queen ladder.
    ///
    /// Mirrors the Python `upsert_queen_ladder_players`: merge fresh rows into
    /// `users`, then clear stale ladder fields for users absent from the new

    pub(super) fn upload_end_board_rows(&self, rows: &[Value]) -> Result<Option<String>, String> {
        if !rows.iter().any(is_end_board_row) {
            return Ok(None);
        }
        let Some(upload) = build_end_board_upload(rows, &now_iso_utc()) else {
            return Ok(None);
        };
        let match_id = upload
            .match_row
            .get("match_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        self.post_json(
            "/rest/v1/matches",
            &upload.match_row,
            "resolution=merge-duplicates,return=minimal",
        )?;
        let players = unify_row_keys(dedupe_match_players(upload.players));
        if !players.is_empty() {
            self.ensure_match_player_users(&players)?;
            self.post_json(
                "/rest/v1/match_players?on_conflict=match_id,steam_id",
                &Value::Array(players),
                "resolution=merge-duplicates,return=minimal",
            )?;
        }
        Ok(Some(match_id))
    }

    pub(super) fn ensure_match_player_users(&self, players: &[Value]) -> Result<(), String> {
        let mut seen = HashSet::new();
        let rows = players
            .iter()
            .filter_map(|player| player.get("steam_id").and_then(Value::as_u64))
            .filter(|steam_id| seen.insert(*steam_id))
            .map(|steam_id| json!({ "steam_id": steam_id }))
            .collect::<Vec<_>>();
        if rows.is_empty() {
            return Ok(());
        }
        self.post_json(
            "/rest/v1/users",
            &Value::Array(rows),
            "resolution=ignore-duplicates,return=minimal",
        )
    }
}

pub(super) fn dedupe_match_players(players: Vec<Value>) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for player in players {
        let key = player
            .get("steam_id")
            .and_then(Value::as_u64)
            .map(|steam_id| {
                let match_id = player
                    .get("match_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                (match_id, steam_id)
            });
        if let Some(key) = key {
            if seen.insert(key) {
                out.push(player);
            }
        }
    }
    out
}

/// PostgREST bulk inserts reject arrays whose objects have differing key sets
/// (PGRST102 "All object keys must match"). Player rows only carry the fields
/// each player happened to have, so pad every row to the union of keys with
/// explicit nulls before posting.
pub(super) fn unify_row_keys(rows: Vec<Value>) -> Vec<Value> {
    let mut keys = std::collections::BTreeSet::new();
    for row in &rows {
        if let Some(object) = row.as_object() {
            keys.extend(object.keys().cloned());
        }
    }
    rows.into_iter()
        .map(|mut row| {
            if let Some(object) = row.as_object_mut() {
                for key in &keys {
                    object.entry(key.clone()).or_insert(Value::Null);
                }
            }
            row
        })
        .collect()
}

const MATCH_PLAYER_COLUMNS: &[&str] = &[
    "match_id",
    "steam_id",
    "placement",
    "mmr_level",
    "hero_level",
    "chess_lineup",
    "chess_hand",
    "synergies",
    "relic",
    "relic_history",
    "talents",
    "win_round",
    "lose_round",
    "draw_round",
    "kills",
    "deaths",
    "hero_damage",
    "hero_damaged",
    "mvp_chess_name",
    "mvp_chess_items",
    "max_lineup_value",
    "max_lineup_value_lineup",
    "duration",
    "final_round",
    "zhugong",
    "total_money",
    "candy",
    "played_at",
    "replay",
    "created_at",
];

pub(super) fn nettable_row_json(row: &NettableRow) -> Value {
    let mut out = serde_json::Map::new();
    out.insert("table_name".to_owned(), json!(row.table_name));
    out.insert("key".to_owned(), json!(row.key));
    out.insert("raw".to_owned(), row.raw.to_value());
    if let Some(observed_at) = &row.observed_at {
        out.insert("observed_at".to_owned(), json!(observed_at));
    }
    if let Some(match_started_at) = &row.match_started_at {
        out.insert("match_started_at".to_owned(), json!(match_started_at));
    }
    Value::Object(out)
}

fn is_end_board_row(row: &Value) -> bool {
    row.get("table_name").and_then(Value::as_str) == Some("CustomNetTable_dac_table")
        && row.get("key").and_then(Value::as_str) == Some("end_board")
}

#[derive(Debug, PartialEq)]
pub(super) struct EndBoardUpload {
    pub(super) match_row: Value,
    pub(super) players: Vec<Value>,
}

pub(super) fn build_end_board_upload(
    rows: &[Value],
    fallback_played_at: &str,
) -> Option<EndBoardUpload> {
    let end_board = rows.iter().find(|row| {
        row.get("table_name").and_then(Value::as_str) == Some("CustomNetTable_dac_table")
            && row.get("key").and_then(Value::as_str) == Some("end_board")
    })?;
    let observed_at = end_board
        .get("observed_at")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let match_started_at = end_board
        .get("match_started_at")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let played_at = observed_at.unwrap_or(fallback_played_at);
    let data = end_board
        .get("raw")
        .and_then(|raw| raw.get("data"))
        .and_then(Value::as_object)?;
    if data.len() < MIN_TRACKED_PLAYERS {
        return None;
    }
    let mut pairs = data
        .iter()
        .map(|(steam_id, player)| {
            let rank = player
                .get("curr_rank")
                .or_else(|| player.get("rank"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            (steam_id.clone(), rank)
        })
        .collect::<Vec<_>>();
    pairs.sort();
    let final_round = data
        .values()
        .filter_map(|player| value_i64(player.get("round")))
        .max();
    let duration = data
        .values()
        .filter_map(|player| value_f64(player.get("duration")))
        .fold(None, |acc: Option<f64>, value| {
            Some(acc.map_or(value, |current| current.max(value)))
        });
    let match_started_hour = match_started_at
        .or(observed_at)
        .and_then(match_identity_hour_bucket);
    let match_id =
        generate_live_match_id(&pairs, final_round, duration, match_started_hour.as_deref());
    let match_row = json!({
        "match_id": match_id,
        "played_at": played_at,
        "duration": duration,
        "final_round": final_round,
        "player_count": data.len(),
        "capture_status": "complete",
        "is_finished": true,
        "verification_source": "end_board",
        "verified_at": played_at,
        "capture_ended_at": played_at,
    });
    let players = data
        .iter()
        .filter_map(|(steam_id, player)| {
            let steam_id_num = parse_valid_steam_id64(steam_id)?;
            let placement = player
                .get("curr_rank")
                .or_else(|| player.get("rank"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let mut row = serde_json::Map::new();
            if let Some(player_obj) = player.as_object() {
                for column in MATCH_PLAYER_COLUMNS {
                    if let Some(value) = player_obj.get(*column) {
                        row.insert((*column).to_owned(), value.clone());
                    }
                }
            }
            if let Some(lineup) = player
                .get("chess_lineup")
                .and_then(Value::as_str)
                .and_then(normalize_chess_lineup)
            {
                row.insert("chess_lineup".to_owned(), json!(lineup));
            }
            if let Some(hand) = player
                .get("chess_hand")
                .and_then(Value::as_str)
                .and_then(normalize_chess_lineup)
            {
                row.insert("chess_hand".to_owned(), json!(hand));
            }
            if let Some(lineup) = player
                .get("max_lineup_value_lineup")
                .and_then(Value::as_str)
                .and_then(normalize_chess_lineup)
            {
                row.insert("max_lineup_value_lineup".to_owned(), json!(lineup));
            }
            row.insert("match_id".to_owned(), json!(match_id));
            row.insert("steam_id".to_owned(), json!(steam_id_num));
            row.insert("placement".to_owned(), json!(placement));
            if !row.contains_key("final_round") {
                if let Some(round) = player.get("round") {
                    row.insert("final_round".to_owned(), round.clone());
                }
            }
            if !row.contains_key("synergies") {
                if let Some(synergies) =
                    normalize_synergy_string(player.get("buff").and_then(Value::as_str))
                {
                    row.insert("synergies".to_owned(), json!(synergies));
                }
            }
            if !row.contains_key("talents") {
                if let Some(talents) = normalize_talents(player.get("talent_tree")) {
                    row.insert("talents".to_owned(), json!(talents));
                }
            }
            row.entry("played_at".to_owned())
                .or_insert_with(|| json!(played_at));
            Some(Value::Object(row))
        })
        .collect::<Vec<_>>();
    Some(EndBoardUpload { match_row, players })
}

fn value_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| match value {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().map(|v| v as i64)),
        Value::String(value) => value.parse::<i64>().ok(),
        _ => None,
    })
}

fn value_f64(value: Option<&Value>) -> Option<f64> {
    value.and_then(|value| match value {
        Value::Number(number) => number.as_f64(),
        Value::String(value) => value.parse::<f64>().ok(),
        _ => None,
    })
}

fn match_identity_hour_bucket(value: &str) -> Option<String> {
    let value = value.trim();
    let t = value.find('T')?;
    let hour_end = t + 3;
    (value.len() >= hour_end).then(|| value[..hour_end].to_owned())
}

fn normalize_synergy_string(value: Option<&str>) -> Option<String> {
    let out = value?
        .split(',')
        .filter_map(|entry| {
            let entry = entry.trim();
            if entry.is_empty() {
                return None;
            }
            let (name, count) = entry.split_once(':')?;
            let name = name.trim().strip_prefix("is_").unwrap_or(name.trim());
            let count = count.trim();
            (!name.is_empty() && !count.is_empty()).then(|| format!("{name}:{count}"))
        })
        .collect::<Vec<_>>()
        .join("|");
    (!out.is_empty()).then_some(out)
}

fn normalize_talents(value: Option<&Value>) -> Option<String> {
    let object = value?.as_object()?;
    let mut entries = object
        .iter()
        .filter_map(|(slot, talent)| Some((slot.parse::<i64>().ok()?, talent.as_str()?)))
        .collect::<Vec<_>>();
    entries.sort_by_key(|(slot, _)| *slot);
    let out = entries
        .into_iter()
        .map(|(_, talent)| talent)
        .collect::<Vec<_>>()
        .join("|");
    (!out.is_empty()).then_some(out)
}

pub(super) fn build_fallback_match_row(
    rows: &[NettableRow],
    reason: &str,
    played_at: &str,
) -> Option<Value> {
    let mut pairs = player_id_pairs(rows);
    if pairs.len() < MIN_TRACKED_PLAYERS {
        return None;
    }
    pairs.sort();
    let match_id = generate_fallback_match_id(&pairs, reason, played_at);
    Some(json!({
        "match_id": match_id,
        "played_at": played_at,
        "player_count": pairs.len(),
        "capture_status": "partial",
        "is_finished": true,
        "verification_source": reason,
        "verified_at": played_at,
        "capture_ended_at": played_at,
    }))
}

pub(super) fn build_fallback_match_players(
    rows: &[NettableRow],
    match_id: &str,
    reason: &str,
) -> Vec<Value> {
    let played_at = now_iso_utc();
    let final_round = rows
        .iter()
        .filter(|row| row.table_name == "CustomNetTable_game_info" && row.key == "round_info")
        .filter_map(|row| value_i64(row.raw.to_value().get("round")))
        .max();
    player_id_pairs(rows)
        .into_iter()
        .filter_map(|(steam_id, slot)| {
            let steam_id_num = parse_valid_steam_id64(&steam_id)?;
            let live_player = live_player_by_steam_id(rows, &steam_id);
            let placement = live_player
                .as_ref()
                .and_then(|player| {
                    value_i64(player.get("curr_rank").or_else(|| player.get("rank")))
                })
                .unwrap_or(0);
            let mut row = serde_json::Map::new();
            row.insert("match_id".to_owned(), json!(match_id));
            row.insert("steam_id".to_owned(), json!(steam_id_num));
            row.insert("placement".to_owned(), json!(placement));
            row.insert("played_at".to_owned(), json!(played_at));
            row.insert("created_at".to_owned(), json!(played_at));
            if let Some(final_round) = final_round {
                row.insert("final_round".to_owned(), json!(final_round));
            }
            if let Some(player) = live_player {
                copy_fallback_player_field(&mut row, &player, "mmr_level");
                copy_fallback_player_field(&mut row, &player, "hero_level");
                copy_fallback_player_field(&mut row, &player, "duration");
                copy_fallback_player_field(&mut row, &player, "total_money");
                copy_fallback_player_field(&mut row, &player, "candy");
                if let Some(lineup) = player
                    .get("chess_lineup")
                    .and_then(Value::as_str)
                    .and_then(normalize_chess_lineup)
                {
                    row.insert("chess_lineup".to_owned(), json!(lineup));
                }
                if let Some(hand) = player
                    .get("chess_hand")
                    .and_then(Value::as_str)
                    .and_then(normalize_chess_lineup)
                {
                    row.insert("chess_hand".to_owned(), json!(hand));
                }
                if let Some(synergies) =
                    normalize_synergy_string(player.get("buff").and_then(Value::as_str))
                {
                    row.insert("synergies".to_owned(), json!(synergies));
                }
                if let Some(relic) = player.get("relic").filter(|value| !value.is_null()) {
                    row.insert("relic".to_owned(), relic.clone());
                }
            }
            if row.get("placement").and_then(Value::as_i64).unwrap_or(0) == 0 {
                row.insert("placement".to_owned(), json!(slot));
            }
            row.insert("zhugong".to_owned(), json!(reason));
            Some(Value::Object(row))
        })
        .collect()
}

fn live_player_by_steam_id(rows: &[NettableRow], steam_id: &str) -> Option<Value> {
    rows.iter()
        .find(|row| {
            row.table_name == "CustomNetTable_player_info_table" && row.key == "player_info"
        })
        .and_then(|row| row.raw.to_value().get("data")?.get(steam_id).cloned())
}

fn copy_fallback_player_field(
    row: &mut serde_json::Map<String, Value>,
    player: &Value,
    field: &str,
) {
    if let Some(value) = player.get(field).filter(|value| !value.is_null()) {
        row.insert(field.to_owned(), value.clone());
    }
}

fn player_id_pairs(rows: &[NettableRow]) -> Vec<(String, i64)> {
    rows.iter()
        .filter(|row| row.table_name == "CustomNetTable_player_id_table")
        .filter_map(|row| {
            let slot = row.key.strip_prefix("player_")?.parse::<i64>().ok()?;
            let steam_id = row
                .raw
                .to_value()
                .get("steam_id")
                .and_then(|value| match value {
                    Value::String(value) => Some(value.clone()),
                    Value::Number(value) => Some(value.to_string()),
                    _ => None,
                })?;
            if parse_valid_steam_id64(&steam_id).is_none() {
                return None;
            }
            Some((steam_id, slot))
        })
        .collect()
}

pub(super) fn generate_live_match_id(
    pairs: &[(String, i64)],
    final_round: Option<i64>,
    duration: Option<f64>,
    match_started_hour: Option<&str>,
) -> String {
    let seed = json!({
        "kind": "end_board",
        "players": pairs,
        "match_started_hour": match_started_hour,
        "final_round": final_round,
        "duration_seconds": duration.map(|value| (value * 1000.0).round() as i64),
    });
    let canonical = serde_json::to_string(&seed).unwrap_or_else(|_| "{}".to_owned());
    let digest = Sha256::digest(canonical.as_bytes());
    format!("{digest:x}")[..16].to_owned()
}

fn generate_fallback_match_id(pairs: &[(String, i64)], reason: &str, played_at: &str) -> String {
    let seed = json!({
        "kind": "fallback_no_end_board",
        "reason": reason,
        "played_at": played_at,
        "players": pairs,
    });
    let digest = Sha256::digest(seed.to_string().as_bytes());
    format!("{digest:x}")[..16].to_owned()
}

pub fn finished_match_id_from_rows(rows: &[NettableRow]) -> Option<String> {
    let row_values = rows.iter().map(nettable_row_json).collect::<Vec<_>>();
    build_end_board_upload(&row_values, &now_iso_utc()).and_then(|upload| {
        upload
            .match_row
            .get("match_id")
            .and_then(Value::as_str)
            .map(str::to_owned)
    })
}
