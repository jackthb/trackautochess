//! Queen-ladder extraction from the `ranking_top_table` CustomNetTable.
//!
//! Ported from the Python backend's `_extract_ranking_top_players`
//! (`app/backend/nettable_capture.py`). Drodo has changed the exact field
//! names in this net-table over time, so this accepts a small set of
//! observed/likely aliases instead of depending on one brittle shape.

use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct QueenPlayer {
    pub steam_id: String,
    pub name: Option<String>,
    pub rank: i64,
    pub mmr: Option<i64>,
    pub season: Option<String>,
    pub seen_at: String,
}

/// Return normalized Queen-ladder rows from a decoded `ranking_top` payload.
///
/// `raw` is the VBKV object stored under the `ranking_top` stringtable key,
/// which itself contains a nested `ranking_top` object keyed by ladder index.
pub fn extract_ranking_top_players(raw: &Value, scanned_at: &str) -> Vec<QueenPlayer> {
    let Some(raw_obj) = raw.as_object() else {
        return Vec::new();
    };
    let Some(top) = raw_obj.get("ranking_top").and_then(Value::as_object) else {
        return Vec::new();
    };
    let season = first_present_str(raw_obj, &["season", "current_season", "season_id"]);
    let mut players = Vec::new();
    for (idx, entry) in top.values().enumerate() {
        let Some(entry) = entry.as_object() else {
            continue;
        };
        let Some(steam_id) = first_present_str(
            entry,
            &["steam_id", "steamid", "player", "player_id", "uid", "id"],
        ) else {
            continue;
        };
        if !steam_id.starts_with("7656") {
            continue;
        }
        let rank = first_present_int(
            entry,
            &["rank", "ranking", "queen_rank", "ladder_rank", "index", "place"],
            Some(1),
        )
        .unwrap_or((idx as i64) + 1);
        players.push(QueenPlayer {
            steam_id,
            name: first_present_str(
                entry,
                &["name", "player_name", "nick_name", "nickname", "user_name"],
            ),
            rank,
            mmr: first_present_int(
                entry,
                &["mmr", "score", "rank_score", "season_mmr", "points"],
                Some(0),
            ),
            season: season.clone(),
            seen_at: scanned_at.to_owned(),
        });
    }
    players
}

/// Collapse a free-form season label into a canonical `s<N>` key.
/// Ported from `_normalize_season_key` in the Python `db` module.
pub fn normalize_season_key(value: &str) -> String {
    let raw = value.trim().to_lowercase();
    if raw.is_empty() {
        return String::new();
    }
    let digits: String = raw
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if let Ok(n) = digits.parse::<u64>() {
        return format!("s{n}");
    }
    raw
}

fn first_present_str(obj: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = obj.get(*key) else {
            continue;
        };
        let text = match value {
            Value::String(s) => s.trim().to_owned(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            _ => continue,
        };
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

fn first_present_int(obj: &Map<String, Value>, keys: &[&str], lo: Option<i64>) -> Option<i64> {
    for key in keys {
        let Some(value) = obj.get(*key) else {
            continue;
        };
        let n = match value {
            Value::Number(num) => num.as_i64().or_else(|| num.as_u64().map(|u| u as i64)),
            Value::String(s) => s.trim().parse::<i64>().ok(),
            _ => None,
        };
        let Some(n) = n else {
            continue;
        };
        if let Some(lo) = lo {
            if n < lo {
                continue;
            }
        }
        return Some(n);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_players_with_explicit_rank_and_mmr() {
        let raw = json!({
            "season": "Season 7",
            "ranking_top": {
                "0": {"steam_id": "76561198000000001", "name": "alice", "rank": 1, "mmr": 4200},
                "1": {"steamid": "76561198000000002", "nickname": "bob", "ranking": 2, "score": 4100}
            }
        });
        let players = extract_ranking_top_players(&raw, "2026-06-07T12:00:00Z");
        assert_eq!(players.len(), 2);
        assert_eq!(players[0].steam_id, "76561198000000001");
        assert_eq!(players[0].name.as_deref(), Some("alice"));
        assert_eq!(players[0].rank, 1);
        assert_eq!(players[0].mmr, Some(4200));
        assert_eq!(players[0].season.as_deref(), Some("Season 7"));
        assert_eq!(players[1].steam_id, "76561198000000002");
        assert_eq!(players[1].name.as_deref(), Some("bob"));
        assert_eq!(players[1].mmr, Some(4100));
    }

    #[test]
    fn skips_non_steam_ids_and_uses_fallback_rank() {
        let raw = json!({
            "ranking_top": {
                "0": {"steam_id": "not-a-steam-id", "name": "skip me"},
                "1": {"steam_id": "76561198000000009", "name": "keep"}
            }
        });
        let players = extract_ranking_top_players(&raw, "2026-06-07T12:00:00Z");
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].steam_id, "76561198000000009");
        // First valid entry is the 2nd map slot, so fallback rank is its index + 1.
        assert_eq!(players[0].rank, 2);
    }

    #[test]
    fn numeric_steam_ids_are_stringified() {
        let raw = json!({
            "ranking_top": {
                "0": {"steam_id": 76561198000000001u64, "rank": 1}
            }
        });
        let players = extract_ranking_top_players(&raw, "now");
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].steam_id, "76561198000000001");
        assert_eq!(players[0].name, None);
        assert_eq!(players[0].mmr, None);
    }

    #[test]
    fn missing_ranking_top_yields_no_players() {
        assert!(extract_ranking_top_players(&json!({"season": "s7"}), "now").is_empty());
        assert!(extract_ranking_top_players(&json!("nope"), "now").is_empty());
    }

    #[test]
    fn normalizes_season_keys() {
        assert_eq!(normalize_season_key("Season 7"), "s7");
        assert_eq!(normalize_season_key("s12"), "s12");
        assert_eq!(normalize_season_key("  S03 "), "s3");
        assert_eq!(normalize_season_key("preseason"), "preseason");
        assert_eq!(normalize_season_key(""), "");
    }
}
