use crate::{
    nettable_live::live_players_value,
    nettable_parser::{self, NettableRow},
    unit_codes::{normalize_chess_lineup, normalize_chess_unit},
};
use serde_json::Value;

const MAX_SESSION_ROUND_SNAPSHOTS: usize = 80;

#[derive(Debug, Clone)]
pub(crate) struct SessionDump {
    pub(crate) captured_at: String,
    pub(crate) rows: Vec<NettableRow>,
}

pub(crate) fn store_session_dump(dumps: &mut Vec<SessionDump>, dump: SessionDump) {
    if let Some(round) = extract_round_from_rows(&dump.rows) {
        if dumps
            .iter()
            .rev()
            .any(|existing| extract_round_from_rows(&existing.rows) == Some(round))
        {
            return;
        }
    }
    dumps.push(dump);
    if dumps.len() > MAX_SESSION_ROUND_SNAPSHOTS {
        let excess = dumps.len() - MAX_SESSION_ROUND_SNAPSHOTS;
        dumps.drain(0..excess);
    }
}

pub(crate) fn build_match_timeline(
    session_dumps: &[SessionDump],
    local_steam_id: Option<&str>,
    roster_fingerprint: Option<&[String]>,
    match_id: &str,
    played_at: &str,
) -> Option<serde_json::Value> {
    let mut by_round = std::collections::BTreeMap::<i64, serde_json::Value>::new();
    for dump in session_dumps {
        let Some(round) = extract_round_from_rows(&dump.rows) else {
            if let Some((round, players)) =
                end_board_snapshot_with_live_boards(&dump.rows, local_steam_id)
            {
                let snapshot = serde_json::json!({
                    "round": round,
                    "captured_at": dump.captured_at,
                    "players": players,
                    "draft": extract_draft_state_from_rows(&dump.rows),
                    "death_team": extract_death_team_from_rows(&dump.rows),
                    "source": "end_board",
                });
                by_round.entry(round).or_insert(snapshot);
            }
            continue;
        };
        let (players, _local_ids) = live_players_value(&dump.rows, local_steam_id);
        let snapshot = serde_json::json!({
            "round": round,
            "captured_at": dump.captured_at,
            "players": players,
            "draft": extract_draft_state_from_rows(&dump.rows),
            "death_team": extract_death_team_from_rows(&dump.rows),
        });
        by_round.entry(round).or_insert(snapshot);
        if let Some((end_round, players)) =
            end_board_snapshot_with_live_boards(&dump.rows, local_steam_id)
        {
            if end_round > round {
                let snapshot = serde_json::json!({
                    "round": end_round,
                    "captured_at": dump.captured_at,
                    "players": players,
                    "draft": extract_draft_state_from_rows(&dump.rows),
                    "death_team": extract_death_team_from_rows(&dump.rows),
                    "source": "end_board",
                });
                by_round.entry(end_round).or_insert(snapshot);
            }
        }
    }
    collapse_adjacent_duplicate_board_rounds(&mut by_round);
    if by_round.is_empty() {
        return None;
    }
    let first_round = *by_round.keys().next()?;
    let last_round = *by_round.keys().last()?;
    let rounds = by_round.into_values().collect::<Vec<_>>();
    Some(serde_json::json!({
        "match_id": match_id,
        "played_at": played_at,
        "roster_fingerprint": roster_fingerprint.map(<[String]>::to_vec).unwrap_or_default(),
        "observer_steam_id": local_steam_id.unwrap_or_default(),
        "is_finished": true,
        "verification_source": "end_board",
        "round_count": rounds.len(),
        "first_round": first_round,
        "last_round": last_round,
        "rounds": rounds,
    }))
}

pub(crate) fn replay_session_dumps_from_log(body: &str) -> Vec<SessionDump> {
    let mut matches: Vec<Vec<SessionDump>> = Vec::new();
    let mut current: Vec<SessionDump> = Vec::new();
    let mut last_round: Option<i64> = None;

    let mut finish_match = |current: &mut Vec<SessionDump>| {
        if !current.is_empty() {
            matches.push(std::mem::take(current));
        }
    };

    nettable_parser::replay_round_snapshots_from_log(body, |captured_at, rows| {
        if rows.is_empty() {
            return;
        }
        let has_end_board = rows
            .iter()
            .any(|row| row.table_name.ends_with("dac_table") && row.key == "end_board");
        if has_end_board {
            store_session_dump(
                &mut current,
                SessionDump {
                    captured_at: captured_at.clone(),
                    rows,
                },
            );
            finish_match(&mut current);
            last_round = None;
            return;
        }
        let Some(round) = extract_round_from_rows(&rows) else {
            return;
        };
        if round == 1 && last_round.is_some_and(|prev| prev > 5) {
            finish_match(&mut current);
            last_round = None;
        }
        if last_round == Some(round) {
            return;
        }
        store_session_dump(
            &mut current,
            SessionDump {
                captured_at,
                rows,
            },
        );
        last_round = Some(round);
    });
    finish_match(&mut current);
    matches.into_iter().last().unwrap_or_default()
}

pub(crate) fn build_timeline_from_log(
    body: &str,
    local_steam_id: Option<&str>,
    match_id: &str,
    played_at: &str,
) -> Option<serde_json::Value> {
    let session_dumps = replay_session_dumps_from_log(body);
    if session_dumps.is_empty() {
        return None;
    }
    build_match_timeline(
        &session_dumps,
        local_steam_id,
        None,
        match_id,
        played_at,
    )
}

pub(crate) fn build_timeline_from_rows(
    rows: &[NettableRow],
    local_steam_id: Option<&str>,
    match_id: &str,
    played_at: &str,
) -> Option<serde_json::Value> {
    let captured_at = rows
        .iter()
        .find(|row| row.key == "end_board")
        .and_then(|row| row.observed_at.as_deref())
        .unwrap_or(played_at);
    build_match_timeline(
        &[SessionDump {
            captured_at: captured_at.to_owned(),
            rows: rows.to_vec(),
        }],
        local_steam_id,
        None,
        match_id,
        played_at,
    )
}

fn collapse_adjacent_duplicate_board_rounds(by_round: &mut std::collections::BTreeMap<i64, Value>) {
    let keys: Vec<i64> = by_round.keys().copied().collect();
    for window in keys.windows(2) {
        let [prev, next] = window else {
            continue;
        };
        let (Some(prev_round), Some(next_round)) = (by_round.get(prev), by_round.get(next)) else {
            continue;
        };
        if round_boards_equivalent(prev_round, next_round) {
            by_round.remove(prev);
        }
    }
}

fn round_boards_equivalent(left: &Value, right: &Value) -> bool {
    let (Some(left_players), Some(right_players)) = (
        left.get("players").and_then(Value::as_object),
        right.get("players").and_then(Value::as_object),
    ) else {
        return false;
    };
    let mut compared_boards = false;
    for (steam_id, left_player) in left_players {
        let Some(right_player) = right_players.get(steam_id) else {
            return false;
        };
        let (Some(left_board), Some(right_board)) = (
            left_player.get("board").and_then(Value::as_array),
            right_player.get("board").and_then(Value::as_array),
        ) else {
            continue;
        };
        if left_board.is_empty() || right_board.is_empty() {
            continue;
        }
        compared_boards = true;
        if left_board != right_board {
            return false;
        }
    }
    compared_boards
}

fn end_board_snapshot_with_live_boards(
    rows: &[NettableRow],
    local_steam_id: Option<&str>,
) -> Option<(i64, serde_json::Value)> {
    let (round, mut players) = extract_end_board_snapshot_from_rows(rows)?;
    let (live_players, _) = live_players_value(rows, local_steam_id);
    merge_live_board_fields_into_players(&mut players, &live_players);
    Some((round, players))
}

fn merge_live_board_fields_into_players(
    end_board_players: &mut Value,
    live_players: &Value,
) {
    let (Some(end_obj), Some(live_obj)) = (end_board_players.as_object_mut(), live_players.as_object())
    else {
        return;
    };
    for (steam_id, end_player) in end_obj.iter_mut() {
        let Some(live_player) = live_obj.get(steam_id).and_then(Value::as_object) else {
            continue;
        };
        let Some(end_row) = end_player.as_object_mut() else {
            continue;
        };
        for key in ["board", "hand"] {
            let missing = end_row
                .get(key)
                .map(|value| value.is_null() || value.as_array().is_some_and(|items| items.is_empty()))
                .unwrap_or(true);
            if missing {
                if let Some(value) = live_player.get(key).filter(|value| !value.is_null()) {
                    end_row.insert(key.to_owned(), value.clone());
                }
            }
        }
    }
}

fn extract_end_board_snapshot_from_rows(rows: &[NettableRow]) -> Option<(i64, serde_json::Value)> {
    let data = rows
        .iter()
        .find(|row| row.table_name.ends_with("dac_table") && row.key == "end_board")?
        .raw
        .to_value()
        .get("data")?
        .as_object()?
        .clone();
    let round = data
        .values()
        .filter_map(|player| value_i64(player.get("round")))
        .max()?;
    let mut players = serde_json::Map::new();
    for (steam_id, player) in data {
        let Some(player) = player.as_object() else {
            continue;
        };
        let placement = player
            .get("curr_rank")
            .or_else(|| player.get("rank"))
            .and_then(|value| value_i64(Some(value)))
            .unwrap_or(0);
        let mut row = serde_json::Map::new();
        insert_if_present(&mut row, "hp", player.get("hp"));
        if placement > 1 {
            row.insert("hp".to_owned(), serde_json::json!(0));
        }
        insert_if_present_as(&mut row, "level", player.get("hero_level"));
        if placement > 0 {
            row.insert("placement".to_owned(), serde_json::json!(placement));
        }
        insert_normalized_lineup(&mut row, "lineup", player.get("chess_lineup"));
        insert_normalized_lineup(&mut row, "hand", player.get("chess_hand"));
        for (src, dst) in [
            ("duration", "duration"),
            ("lineup_value", "lineup_value"),
            ("total_money", "total_money"),
            ("win_round", "win_round"),
            ("lose_round", "lose_round"),
            ("buff", "buff"),
            ("relic", "relic"),
            ("mmr_level", "mmr_level"),
            ("candy", "candy"),
        ] {
            insert_if_present_as(&mut row, dst, player.get(src));
        }
        if let Some(drops) = parse_pandaren_drops(player.get("pandaman_getlist")) {
            row.insert("pandaren_drops".to_owned(), drops);
        }
        players.insert(steam_id, serde_json::Value::Object(row));
    }
    Some((round, serde_json::Value::Object(players)))
}

fn value_i64(value: Option<&serde_json::Value>) -> Option<i64> {
    value.and_then(|value| match value {
        serde_json::Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().map(|v| v as i64)),
        serde_json::Value::String(value) => value.parse::<i64>().ok(),
        _ => None,
    })
}

fn insert_if_present(
    row: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<&serde_json::Value>,
) {
    insert_if_present_as(row, key, value);
}

fn insert_if_present_as(
    row: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<&serde_json::Value>,
) {
    if let Some(value) = value.filter(|value| !value.is_null()) {
        row.insert(key.to_owned(), value.clone());
    }
}

fn insert_normalized_lineup(
    row: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<&serde_json::Value>,
) {
    if let Some(value) = value.filter(|value| !value.is_null()) {
        let normalized = value
            .as_str()
            .and_then(normalize_chess_lineup)
            .map(serde_json::Value::String)
            .unwrap_or_else(|| value.clone());
        row.insert(key.to_owned(), normalized);
    }
}

fn parse_pandaren_drops(value: Option<&serde_json::Value>) -> Option<serde_json::Value> {
    let object = value?.as_object()?;
    let mut drops = object
        .iter()
        .filter_map(|(slot, value)| {
            let raw = value.as_str()?.trim();
            if raw.is_empty() {
                return None;
            }
            let (unit_code, round) = raw
                .rsplit_once('_')
                .and_then(|(unit, round)| Some((unit, round.parse::<i64>().ok()?)))
                .unwrap_or((raw, 0));
            let name = normalize_chess_unit(unit_code).unwrap_or_else(|| unit_code.to_owned());
            Some(serde_json::json!({
                "slot": slot,
                "raw": raw,
                "unit": unit_code,
                "name": name,
                "round": round,
            }))
        })
        .collect::<Vec<_>>();
    drops.sort_by_key(|drop| {
        drop.get("round")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0)
    });
    (!drops.is_empty()).then(|| serde_json::Value::Array(drops))
}

pub(crate) fn extract_round_from_rows(rows: &[NettableRow]) -> Option<i64> {
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

pub(crate) fn extract_draft_state_from_rows(rows: &[NettableRow]) -> serde_json::Value {
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

pub(crate) fn extract_death_team_from_rows(
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
