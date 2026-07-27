use crate::{
    nettable_parser::NettableRow,
    unit_codes::{normalize_chess_lineup, normalize_chess_unit},
};
use std::collections::HashMap;

/// Source -> output field mapping for live per-player state, mirroring the
/// Python `_extract_players_state_from_rows`. `lineup` stays as the raw
/// `chess_*` code list; the frontend resolves codes to names from content.
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
/// table has not covered yet. Returns the players object plus local steam IDs
/// to highlight as "You".
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
            // Full relic pick order from `relic_history`; the single `relic`
            // field is only the latest pick.
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
            if !row.contains_key("pandaren_drops") {
                if let Some(drops) = parse_pandaren_drops(player.get("pandaman_getlist")) {
                    row.insert("pandaren_drops".to_owned(), drops);
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
        // Local-only dumps carry a single player; treat that as "you".
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

/// Item slots off a board piece (`item` / `lastitem`).
///
/// The nettable normally sends a slot-keyed table (`{"1": "item_x"}`), but the
/// same field has shipped as a plain list and as a single delimited string
/// depending on the build. Only the table shape used to be read, so any other
/// shape silently dropped every item off the board. Accept all three.
fn sorted_string_values(value: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    let Some(value) = value else {
        return Vec::new();
    };
    let mut values = match value {
        serde_json::Value::Object(object) => {
            let mut entries = object
                .iter()
                .filter_map(|(key, value)| Some((key.parse::<i64>().ok()?, value.as_str()?)))
                .collect::<Vec<_>>();
            entries.sort_by_key(|(key, _)| *key);
            entries
                .into_iter()
                .map(|(_, value)| value.to_owned())
                .collect::<Vec<_>>()
        }
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_owned))
            .collect(),
        serde_json::Value::String(raw) => raw
            .split([',', '|', ';'])
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    };
    values.retain(|entry| !entry.is_empty());
    values.dedup();
    values
        .into_iter()
        .map(serde_json::Value::String)
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn strings(value: serde_json::Value) -> Vec<String> {
        sorted_string_values(Some(&value))
            .into_iter()
            .map(|entry| entry.as_str().unwrap_or_default().to_owned())
            .collect()
    }

    #[test]
    fn reads_items_from_every_shape_the_nettable_uses() {
        // Slot-keyed table: ordered by slot, not by hash order.
        assert_eq!(
            strings(json!({ "2": "item_b", "1": "item_a" })),
            vec!["item_a", "item_b"]
        );
        // Plain list.
        assert_eq!(
            strings(json!(["item_a", "item_b"])),
            vec!["item_a", "item_b"]
        );
        // Single delimited string.
        assert_eq!(
            strings(json!("item_a|item_b")),
            vec!["item_a", "item_b"]
        );
        assert_eq!(strings(json!("item_a")), vec!["item_a"]);
        // Empty entries never become items.
        assert!(strings(json!("")).is_empty());
        assert!(strings(json!({})).is_empty());
        assert!(strings(json!(0)).is_empty());
    }

    #[test]
    fn board_piece_keeps_its_items() {
        let piece = json!({
            "chess": "chess_dk",
            "x": 4,
            "y": 3,
            "item": "item_gulonghaojiao",
        });
        let normalized = normalize_live_board_piece("3_4", &piece).expect("piece");
        assert_eq!(
            normalized["items"],
            json!(["item_gulonghaojiao"]),
            "a Minotaur Horn carrier must keep the item that makes it a Dragon"
        );
    }
}
