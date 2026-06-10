use crate::{nettable_live::live_players_value, nettable_parser::NettableRow};

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
