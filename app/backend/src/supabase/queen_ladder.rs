use super::{
    current_drodo_season, next_drodo_poll_at, now_iso_utc, number_from_object,
    parse_valid_steam_id64, queens_revalidate_url, drodo_courier_api_url, SupabaseClient,
    DRODO_COURIER_BATCH_SIZE, HTTP_TIMEOUT,
};
use crate::{queen_ladder, queen_ladder::QueenPlayer};
use serde_json::{json, Value};
use std::{collections::HashSet, thread};

impl SupabaseClient {
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
            row.insert(
                "queen_ladder_last_seen_at".to_owned(),
                json!(seen_at.clone()),
            );
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
        self.spawn_queen_ladder_followups(players.to_vec(), seen_ids);
        Ok(count)
    }

    fn spawn_queen_ladder_followups(&self, players: Vec<QueenPlayer>, seen_ids: Vec<u64>) {
        let client = self.clone();
        thread::spawn(move || {
            let unpulled_ids = client
                .unpulled_queen_profile_ids(&seen_ids)
                .unwrap_or_default();
            let _ = client.hydrate_queen_profiles(&unpulled_ids);
            // The web poll now owns queen_ladder_rank and clears players who drop
            // off the ladder on their next profile poll (queen_rank comes back
            // null). Blanket-nulling everyone absent from this single capture
            // would fight those web writes and flap the leaderboard, so it is
            // parked rather than run. Kept (not deleted) in case capture-driven
            // clearing is wanted again.
            // let _ = client.clear_stale_queen_ladder_snapshot(&seen_ids);
            let _ = client.upsert_queen_ladder_snapshots(&players);
            let _ = revalidate_queens_page();
        });
    }

    /// Ladder Steam IDs whose Drodo profile has never been fetched — either
    /// brand-new `users` rows or existing rows with a null
    /// `drodo_last_fetched_at`.
    fn unpulled_queen_profile_ids(&self, current_steam_ids: &[u64]) -> Result<Vec<u64>, String> {
        if current_steam_ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids = current_steam_ids
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let pulled = self.get_json(&format!(
            "/rest/v1/users?select=steam_id&drodo_last_fetched_at=not.is.null&steam_id=in.({ids})"
        ))?;
        let pulled = pulled
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| row.get("steam_id").and_then(Value::as_u64))
            .collect::<HashSet<u64>>();
        Ok(current_steam_ids
            .iter()
            .copied()
            .filter(|id| !pulled.contains(id))
            .collect())
    }

    fn upsert_queen_ladder_snapshots(&self, players: &[QueenPlayer]) -> Result<usize, String> {
        let mut rows = Vec::new();
        let mut seen = HashSet::new();
        for player in players {
            let Some(steam_id) = parse_valid_steam_id64(&player.steam_id) else {
                continue;
            };
            if !seen.insert(steam_id) || player.rank < 1 {
                continue;
            }
            let season = queen_ladder::normalize_season_key(player.season.as_deref().unwrap_or(""));
            rows.push(json!({
                "steam_id": steam_id,
                "season": if season.is_empty() { Value::Null } else { json!(season) },
                "mmr": player.mmr,
                "chicken_count": Value::Null,
                "queen_rank": player.rank,
                "snapshotted_at": if player.seen_at.is_empty() { now_iso_utc() } else { player.seen_at.clone() },
            }));
        }
        if rows.is_empty() {
            return Ok(0);
        }
        let count = rows.len();
        self.post_json(
            "/rest/v1/mmr_snapshots?on_conflict=steam_id,season,snapshot_date,mmr,chicken_count,queen_rank",
            &Value::Array(rows.clone()),
            "resolution=merge-duplicates,return=minimal",
        )?;
        let steam_ids = rows
            .iter()
            .filter_map(|row| row.get("steam_id").and_then(Value::as_u64))
            .collect::<Vec<_>>();
        let _ = self.sync_player_season_queen_ranks(&steam_ids);
        Ok(count)
    }

    fn sync_player_season_queen_ranks(&self, steam_ids: &[u64]) -> Result<(), String> {
        for steam_id in steam_ids {
            let _ = self.post_json(
                "/rest/v1/rpc/sync_player_season_queen_ranks",
                &json!({ "p_steam_id": steam_id }),
                "return=minimal",
            );
        }
        Ok(())
    }

    fn hydrate_queen_profiles(&self, ids: &[u64]) -> Result<usize, String> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut user_rows = Vec::new();
        let mut snapshot_rows = Vec::new();
        for batch in ids.chunks(DRODO_COURIER_BATCH_SIZE) {
            let fetched_at = now_iso_utc();
            let joined = batch
                .iter()
                .map(u64::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let api_url = drodo_courier_api_url(&format!("courier/get/@{joined}"));
            let response = ureq::get(&api_url)
                .timeout(HTTP_TIMEOUT)
                .call()
                .map_err(|err| err.to_string())?;
            if !(200..300).contains(&response.status()) {
                return Err(format!("Drodo returned HTTP {}", response.status()));
            }
            let body = response.into_string().map_err(|err| err.to_string())?;
            let payload = serde_json::from_str::<Value>(&body).map_err(|err| err.to_string())?;
            let user_info = payload
                .get("user_info")
                .and_then(Value::as_object)
                .ok_or_else(|| "Drodo response missing user_info".to_owned())?;
            for steam_id in batch {
                let key = steam_id.to_string();
                let Some(info) = user_info.get(&key).and_then(Value::as_object) else {
                    user_rows.push(json!({
                        "steam_id": steam_id,
                        "drodo_last_fetched_at": fetched_at,
                        "drodo_profile_missing": true,
                        "next_poll_at": next_drodo_poll_at(600),
                        "poll_interval_seconds": 600,
                    }));
                    continue;
                };
                let season = current_drodo_season(info);
                let mmr = season
                    .as_deref()
                    .and_then(|season| number_from_object(info, &format!("mmr_{season}")));
                let max_mmr = season
                    .as_deref()
                    .and_then(|season| number_from_object(info, &format!("max_mmr_{season}")));
                let season_games = season
                    .as_deref()
                    .and_then(|season| number_from_object(info, &format!("match_{season}")));
                let chicken_count = number_from_object(info, "chicken_count").unwrap_or(0);
                user_rows.push(json!({
                    "steam_id": steam_id,
                    "drodo_mmr": mmr,
                    "drodo_max_mmr": max_mmr,
                    "drodo_mmr_level": number_from_object(info, "mmr_level"),
                    "drodo_season": season,
                    "drodo_season_games": season_games,
                    "drodo_candy": number_from_object(info, "candy"),
                    "drodo_chicken_count": chicken_count,
                    "drodo_raw_data": Value::Object(info.clone()),
                    "drodo_last_fetched_at": fetched_at,
                    "drodo_profile_missing": false,
                    "next_poll_at": next_drodo_poll_at(600),
                    "poll_interval_seconds": 600,
                }));
                snapshot_rows.push(json!({
                    "steam_id": steam_id,
                    "season": season,
                    "mmr": mmr,
                    "chicken_count": chicken_count,
                    "queen_rank": Value::Null,
                    "snapshotted_at": fetched_at,
                }));
            }
        }
        if !user_rows.is_empty() {
            self.post_json(
                "/rest/v1/users",
                &Value::Array(user_rows),
                "resolution=merge-duplicates,return=minimal",
            )?;
        }
        if !snapshot_rows.is_empty() {
            let snapshot_count = snapshot_rows.len();
            let _ = self.post_json(
                "/rest/v1/mmr_snapshots?on_conflict=steam_id,season,snapshot_date,mmr,chicken_count,queen_rank",
                &Value::Array(snapshot_rows),
                "resolution=merge-duplicates,return=minimal",
            );
            return Ok(snapshot_count);
        }
        Ok(0)
    }

    #[allow(dead_code)] // Parked: web poll now owns queen_ladder_rank (see spawn_queen_ladder_followups).
    fn clear_stale_queen_ladder_snapshot(&self, current_steam_ids: &[u64]) -> Result<(), String> {
        if current_steam_ids.is_empty() {
            return Ok(());
        }
        let body = json!({
            "queen_ladder_rank": Value::Null,
            "queen_ladder_season": Value::Null,
            "queen_ladder_last_seen_at": Value::Null,
        });
        self.patch_json(
            &queen_ladder_stale_clear_path(current_steam_ids),
            &body,
            "return=minimal",
        )
    }
}

/// Ask the public site to rebuild /queens now that the fresh ladder rows and
/// any newly hydrated profiles are in the database. Best effort: the page
/// still revalidates on its own ISR schedule if this fails.
fn revalidate_queens_page() -> Result<(), String> {
    let Some(url) = queens_revalidate_url() else {
        return Ok(());
    };
    ureq::post(&url)
        .timeout(HTTP_TIMEOUT)
        .call()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[allow(dead_code)] // Parked alongside clear_stale_queen_ladder_snapshot.
pub(super) fn queen_ladder_stale_clear_path(current_steam_ids: &[u64]) -> String {
    let ids = current_steam_ids
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    format!("/rest/v1/users?queen_ladder_last_seen_at=not.is.null&steam_id=not.in.({ids})")
}
