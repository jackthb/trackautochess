use crate::{
    nettable_live::live_players_value, nettable_parser::NettableRow,
    unit_codes::{normalize_chess_lineup, normalize_chess_unit},
};

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
            if let Some((round, players)) = extract_end_board_snapshot_from_rows(&dump.rows) {
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
        if let Some((end_round, players)) = extract_end_board_snapshot_from_rows(&dump.rows) {
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
