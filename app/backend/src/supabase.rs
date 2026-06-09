use crate::{
    config::Config, nettable_parser::NettableRow, outbox::Outbox, queen_ladder,
    queen_ladder::QueenPlayer, unit_codes::normalize_chess_lineup,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env, fs, io,
    path::{Path, PathBuf},
};

const STEAM_ID64_MIN: u64 = 76_561_197_960_265_728;
const STEAM_ID64_MAX: u64 = 76_561_202_255_233_023;

#[derive(Debug, Clone)]
pub struct SupabaseClient {
    url: String,
    key: String,
}

impl SupabaseClient {
    pub fn from_config(cfg: &Config) -> Option<Self> {
        if cfg.local_only || cfg.supabase_url.is_empty() || cfg.supabase_key.is_empty() {
            return None;
        }
        Some(Self {
            url: cfg.supabase_url.trim_end_matches('/').to_owned(),
            key: cfg.supabase_key.clone(),
        })
    }

    pub fn upsert_user(&self, steam_id: &str, steam_name: &str) -> Result<(), String> {
        let steam_id_num =
            parse_valid_steam_id64(steam_id).ok_or_else(|| "invalid steam_id".to_owned())?;
        let row = json!({"steam_id": steam_id_num, "name": steam_name});
        self.post_json(
            "/rest/v1/users",
            &row,
            "resolution=merge-duplicates,return=minimal",
        )
    }

    pub fn upload_nettable_dump_log(
        &self,
        cfg: &Config,
        rows: &[NettableRow],
    ) -> Result<usize, String> {
        if rows.is_empty() {
            return Ok(0);
        }
        let row_values = rows.iter().map(nettable_row_json).collect::<Vec<_>>();
        self.upload_end_board_rows(&row_values)?;
        self.upload_nettable_rows_blob(cfg, &row_values)?;
        Ok(rows.len())
    }

    fn upload_nettable_rows_blob(&self, cfg: &Config, rows: &[Value]) -> Result<String, String> {
        let user_id = cfg.steam_id.trim();
        if user_id.is_empty() {
            return Err("nettable dump logging needs steam_id for storage path".to_owned());
        }
        let captured_at = chrono::Utc::now();
        let mut tables = rows
            .iter()
            .filter_map(|row| row.get("table_name").and_then(Value::as_str))
            .collect::<Vec<_>>();
        tables.sort_unstable();
        tables.dedup();
        let body = json!({
            "kind": "nettable_dump_log",
            "captured_at": captured_at.to_rfc3339(),
            "tables": tables,
            "rows": rows,
        });
        let bytes = serde_json::to_vec_pretty(&body).map_err(|err| err.to_string())?;
        self.upload_storage_object(
            &format!(
                "{user_id}/nettable-dumps/{}.json",
                captured_at.format("%Y%m%d_%H%M%S_%6f")
            ),
            &bytes,
            "application/json",
            true,
        )?;
        Ok(format!("{} rows", rows.len()))
    }

    pub fn upload_diagnostic_logs(
        &self,
        cfg: &Config,
        reason: &str,
        console_path: Option<PathBuf>,
    ) -> Result<DiagnosticUploadSummary, String> {
        let user_id = cfg.steam_id.trim();
        if user_id.is_empty() {
            return Err("diagnostic upload needs steam_id for storage path".to_owned());
        }
        let session = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
        let tracker_path = env::var_os("TRACK_AUTO_CHESS_LOG_PATH")
            .or_else(|| env::var_os(concat!("DAC", "_TRACKER_LOG_PATH")))
            .map(PathBuf::from)
            .unwrap_or_else(|| cfg.dac_dir.join("tracker.log"));
        let tracker_data = read_file_bytes(&tracker_path).unwrap_or_default();
        let console_data = console_path
            .as_deref()
            .and_then(read_file_bytes)
            .unwrap_or_default();

        let mut paths = serde_json::Map::new();
        let mut storage_ok = true;
        if !tracker_data.is_empty() {
            match self.upload_storage_object(
                &format!("{user_id}/{session}/tracker.log"),
                &tracker_data,
                "text/plain; charset=utf-8",
                true,
            ) {
                Ok(path) => {
                    paths.insert("tracker_log".to_owned(), json!(path));
                }
                Err(_) => storage_ok = false,
            }
        }
        if !console_data.is_empty() {
            match self.upload_storage_object(
                &format!("{user_id}/{session}/console.log"),
                &console_data,
                "text/plain; charset=utf-8",
                true,
            ) {
                Ok(path) => {
                    paths.insert("console_log".to_owned(), json!(path));
                }
                Err(_) => storage_ok = false,
            }
        }

        Ok(DiagnosticUploadSummary {
            reason: reason.to_owned(),
            storage_ok,
            paths: Value::Object(paths),
            tracker_bytes: tracker_data.len(),
            console_bytes: console_data.len(),
            console_found: console_path.is_some(),
        })
    }

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

    pub fn finished_match_exists(&self, match_id: &str) -> bool {
        self.get_json(&format!(
            "/rest/v1/matches?select=match_id&match_id=eq.{match_id}&limit=1"
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
        Ok(Some(match_id))
    }

    /// Upsert player identities discovered from the in-game Queen ladder.
    ///
    /// Mirrors the Python `upsert_queen_ladder_players`: merge fresh rows into
    /// `users`, then clear stale ladder fields for users absent from the new
    /// snapshot. Returns the number of rows posted (0 if nothing usable).
    pub fn upsert_queen_ladder_players(&self, players: &[QueenPlayer]) -> Result<usize, String> {
        if players.is_empty() {
            return Ok(0);
        }
        let now = now_iso_utc();
        let mut seen: HashSet<u64> = HashSet::new();
        let mut seen_ids: Vec<u64> = Vec::new();
        let mut rows: Vec<Value> = Vec::new();
        for player in players {
            let Some(steam_id) = parse_valid_steam_id64(&player.steam_id) else {
                continue;
            };
            if !seen.insert(steam_id) {
                continue;
            }
            let mut row = serde_json::Map::new();
            row.insert("steam_id".to_owned(), json!(steam_id));
            let seen_at = if player.seen_at.is_empty() {
                now.clone()
            } else {
                player.seen_at.clone()
            };
            row.insert("queen_ladder_last_seen_at".to_owned(), json!(seen_at));
            if let Some(name) = player
                .name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
            {
                row.insert("name".to_owned(), json!(name));
            }
            let season = queen_ladder::normalize_season_key(player.season.as_deref().unwrap_or(""));
            if !season.is_empty() {
                row.insert("queen_ladder_season".to_owned(), json!(season));
            }
            if player.rank >= 1 {
                row.insert("queen_ladder_rank".to_owned(), json!(player.rank));
            }
            if let Some(mmr) = player.mmr.filter(|mmr| *mmr >= 0) {
                row.insert("queen_ladder_mmr".to_owned(), json!(mmr));
                // The Queen ladder consists of Queen players; setting these lets
                // public leaderboards show them before a Drodo profile refresh.
                row.insert("drodo_mmr".to_owned(), json!(mmr));
                row.insert("drodo_mmr_level".to_owned(), json!(38));
            }
            rows.push(Value::Object(row));
            seen_ids.push(steam_id);
        }
        if rows.is_empty() {
            return Ok(0);
        }
        let count = rows.len();
        self.post_json(
            "/rest/v1/users",
            &Value::Array(rows),
            "resolution=merge-duplicates,return=minimal",
        )?;
        let _ = self.clear_stale_queen_ladder_snapshot(&seen_ids);
        Ok(count)
    }

    fn clear_stale_queen_ladder_snapshot(&self, current_steam_ids: &[u64]) -> Result<(), String> {
        if current_steam_ids.is_empty() {
            return Ok(());
        }
        let body = json!({
            "queen_ladder_rank": Value::Null,
            "queen_ladder_mmr": Value::Null,
            "queen_ladder_season": Value::Null,
            "queen_ladder_last_seen_at": Value::Null,
        });
        self.patch_json(
            &queen_ladder_stale_clear_path(current_steam_ids),
            &body,
            "return=minimal",
        )
    }

    fn upload_end_board_rows(&self, rows: &[Value]) -> Result<Option<String>, String> {
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
        let players = dedupe_match_players(upload.players);
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

    fn ensure_match_player_users(&self, players: &[Value]) -> Result<(), String> {
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

    pub fn replay_outbox(&self, cfg: &Config, outbox: &Outbox) -> io::Result<usize> {
        let mut uploaded = 0;
        for item in outbox.list()? {
            match self.post_raw_payload(cfg, &item.payload) {
                Ok(()) => {
                    outbox.mark_uploaded(&item.path)?;
                    uploaded += 1;
                }
                Err(_) => {}
            }
        }
        Ok(uploaded)
    }

    fn post_raw_payload(&self, cfg: &Config, payload: &str) -> Result<(), String> {
        let value = serde_json::from_str::<Value>(payload).map_err(|err| err.to_string())?;
        let table = value.get("table").and_then(Value::as_str).unwrap_or("");
        let body = value
            .get("rows")
            .or_else(|| value.get("payload"))
            .unwrap_or(&value);
        if table.is_empty() || table == "dac_nettable_dumps" {
            if let Some(rows) = body.as_array() {
                let _ = self.upload_end_board_rows(rows);
                self.upload_nettable_rows_blob(cfg, rows)?;
            }
            return Ok(());
        }
        self.post_json(&format!("/rest/v1/{table}"), body, "return=minimal")
    }

    fn upload_storage_object(
        &self,
        object_path: &str,
        body: &[u8],
        content_type: &str,
        upsert: bool,
    ) -> Result<String, String> {
        let mut request = ureq::post(&format!(
            "{}/storage/v1/object/diagnostic-logs/{}",
            self.url, object_path
        ))
        .set("apikey", &self.key)
        .set("Authorization", &format!("Bearer {}", self.key))
        .set("Content-Type", content_type);
        if upsert {
            request = request.set("x-upsert", "true");
        }
        match request.send_bytes(body) {
            Ok(resp) if (200..300).contains(&resp.status()) => {
                Ok(format!("diagnostic-logs/{object_path}"))
            }
            Ok(resp) => Err(format!("Supabase Storage returned HTTP {}", resp.status())),
            Err(err) => Err(err.to_string()),
        }
    }

    fn post_json(&self, path: &str, body: &Value, prefer: &str) -> Result<(), String> {
        let response = ureq::post(&format!("{}{}", self.url, path))
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {}", self.key))
            .set("Content-Type", "application/json")
            .set("Prefer", prefer)
            .send_string(&body.to_string());
        match response {
            Ok(resp) if (200..300).contains(&resp.status()) => Ok(()),
            Ok(resp) => Err(format!("Supabase returned HTTP {}", resp.status())),
            Err(err) => Err(err.to_string()),
        }
    }

    fn patch_json(&self, path: &str, body: &Value, prefer: &str) -> Result<(), String> {
        let response = ureq::request("PATCH", &format!("{}{}", self.url, path))
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {}", self.key))
            .set("Content-Type", "application/json")
            .set("Prefer", prefer)
            .send_string(&body.to_string());
        match response {
            Ok(resp) if (200..300).contains(&resp.status()) => Ok(()),
            Ok(resp) => Err(format!("Supabase returned HTTP {}", resp.status())),
            Err(err) => Err(err.to_string()),
        }
    }

    fn get_json(&self, path: &str) -> Result<Value, String> {
        let response = ureq::get(&format!("{}{}", self.url, path))
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {}", self.key))
            .call();
        match response {
            Ok(resp) if (200..300).contains(&resp.status()) => {
                let body = resp.into_string().map_err(|err| err.to_string())?;
                serde_json::from_str::<Value>(&body).map_err(|err| err.to_string())
            }
            Ok(resp) => Err(format!("Supabase returned HTTP {}", resp.status())),
            Err(err) => Err(err.to_string()),
        }
    }
}

fn queen_ladder_stale_clear_path(current_steam_ids: &[u64]) -> String {
    let ids = current_steam_ids
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    format!("/rest/v1/users?queen_ladder_last_seen_at=not.is.null&steam_id=not.in.({ids})")
}

fn dedupe_match_players(players: Vec<Value>) -> Vec<Value> {
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

fn nettable_row_json(row: &NettableRow) -> Value {
    json!({
        "table_name": row.table_name,
        "key": row.key,
        "raw": row.raw.to_value(),
    })
}

fn is_end_board_row(row: &Value) -> bool {
    row.get("table_name").and_then(Value::as_str) == Some("CustomNetTable_dac_table")
        && row.get("key").and_then(Value::as_str) == Some("end_board")
}

#[derive(Debug, PartialEq)]
struct EndBoardUpload {
    match_row: Value,
    players: Vec<Value>,
}

fn build_end_board_upload(rows: &[Value], played_at: &str) -> Option<EndBoardUpload> {
    let end_board = rows.iter().find(|row| {
        row.get("table_name").and_then(Value::as_str) == Some("CustomNetTable_dac_table")
            && row.get("key").and_then(Value::as_str) == Some("end_board")
    })?;
    let data = end_board
        .get("raw")
        .and_then(|raw| raw.get("data"))
        .and_then(Value::as_object)?;
    if data.is_empty() {
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
    let match_id = generate_live_match_id(&pairs);
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

fn build_fallback_match_row(rows: &[NettableRow], reason: &str, played_at: &str) -> Option<Value> {
    let mut pairs = player_id_pairs(rows);
    if pairs.is_empty() {
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

fn generate_live_match_id(pairs: &[(String, i64)]) -> String {
    let canonical = serde_json::to_string(pairs).unwrap_or_else(|_| "[]".to_owned());
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

fn parse_valid_steam_id64(value: &str) -> Option<u64> {
    let steam_id = value.trim().parse::<u64>().ok()?;
    (STEAM_ID64_MIN..=STEAM_ID64_MAX)
        .contains(&steam_id)
        .then_some(steam_id)
}

fn now_iso_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_match_id_hashes_like_legacy_algorithm() {
        let pairs = vec![
            ("76561198000000001".to_owned(), 1),
            ("76561198000000002".to_owned(), 2),
        ];
        assert_eq!(generate_live_match_id(&pairs), "0197bf92d36d4c32");
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
        };
        assert_eq!(
            nettable_row_json(&row),
            json!({"table_name":"CustomNetTable_dac_table","key":"end_board","raw":{"data":{}}})
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

        assert_eq!(upload.match_row["match_id"], "d5246b0d2fcc093d");
        assert_eq!(upload.match_row["player_count"], 3);
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
        assert_eq!(second["synergies"], "demon:5|demonhunter:2|warlock:2");
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
            },
        ];

        let row = build_fallback_match_row(&rows, "post_game_no_end_board", "2026-06-07T12:00:00Z")
            .expect("player_id_table should be enough to build fallback match row");

        assert_eq!(row["match_id"], "070e139568e352a7");
        assert_eq!(row["player_count"], 2);
        assert_eq!(row["capture_status"], "partial");
        assert_eq!(row["is_finished"], true);
        assert_eq!(row["verification_source"], "post_game_no_end_board");

        let later =
            build_fallback_match_row(&rows, "post_game_no_end_board", "2026-06-07T12:01:00Z")
                .expect("later fallback should also build");
        assert_ne!(
            later["match_id"], row["match_id"],
            "fallback IDs must not collide across sessions"
        );
    }
}

pub fn queue_rows(outbox_dir: PathBuf, rows: &[NettableRow]) -> io::Result<Option<PathBuf>> {
    if rows.is_empty() {
        return Ok(None);
    }
    let outbox = Outbox::new(outbox_dir);
    let payload = json!({
        "kind": "nettable_rows",
        "rows": rows.iter().map(nettable_row_json).collect::<Vec<_>>()
    });
    outbox.enqueue_str(&payload.to_string()).map(Some)
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

#[derive(Debug, Clone, PartialEq)]
pub struct DiagnosticUploadSummary {
    pub reason: String,
    pub storage_ok: bool,
    pub paths: Value,
    pub tracker_bytes: usize,
    pub console_bytes: usize,
    pub console_found: bool,
}

impl DiagnosticUploadSummary {
    pub fn event_json(&self) -> String {
        json!({
            "type": "diagnostics_uploaded",
            "backend": "rust",
            "reason": self.reason,
            "storage_ok": self.storage_ok,
            "paths": self.paths,
            "tracker_bytes": self.tracker_bytes,
            "console_bytes": self.console_bytes,
            "console_found": self.console_found,
        })
        .to_string()
    }
}

fn read_file_bytes(path: &Path) -> Option<Vec<u8>> {
    fs::read(path).ok().filter(|data| !data.is_empty())
}
