use super::{
    courier_player, describe_ureq_error, drodo_courier_error, drodo_profile_to_user_payload,
    drodo_user_row_to_profile, fetch_drodo_courier_payload, mmr_level_to_app_rank, now_iso_utc,
    parse_valid_steam_id64, preserve_omitted_drodo_fields, queen_rank_from_object, value_number,
    SupabaseClient, HTTP_TIMEOUT, MATCH_INGEST_HTTP_TIMEOUT,
};
use crate::config::Config;
use serde_json::{json, Value};
use std::sync::Mutex;

const TOKEN_REFRESH_SKEW_SECONDS: i64 = 60;

/// Serializes refresh-token use and the config.json write that follows it.
/// Several independent threads (outbox replay, nettable auto-upload, manual
/// CLI commands) each load their own `Config` and call `ensure_fresh_session`
/// around the same time. Without this lock they can race Supabase's
/// rotate-on-use refresh endpoint with the same refresh token, so one of them
/// gets "Already Used" and both writers can clobber each other's config.json
/// update.
static SESSION_REFRESH_LOCK: Mutex<()> = Mutex::new(());

fn positive_value_number(value: &Value, key: &str) -> Option<i64> {
    value_number(value, key).filter(|number| *number > 0)
}

impl SupabaseClient {
    pub fn from_config(cfg: &Config) -> Option<Self> {
        let supabase_url = cfg.supabase_url.trim_end_matches('/').to_owned();
        if cfg.local_only || supabase_url.is_empty() || cfg.supabase_key.is_empty() {
            return None;
        }
        Some(Self {
            url: supabase_url,
            key: cfg.supabase_key.clone(),
            auth_token: (!cfg.supabase_access_token.trim().is_empty())
                .then(|| cfg.supabase_access_token.clone()),
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

    pub fn fetch_games_for_steam_id(&self, steam_id: &str) -> Result<Value, String> {
        let steam_id = parse_valid_steam_id64(steam_id)
            .ok_or_else(|| "Steam login is required before fetching games.".to_owned())?;
        let rows = self.get_json(&format!(
            "/rest/v1/match_players?select=*&steam_id=eq.{steam_id}&order=played_at.desc&limit=50"
        ))?;
        let games = rows
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|row| {
                json!({
                    "id": row.get("id").cloned().unwrap_or(Value::Null),
                    "user_id": row.get("steam_id").map(|value| value.to_string().trim_matches('"').to_owned()).unwrap_or_default(),
                    "placement": row.get("placement").map(|value| value.to_string().trim_matches('"').to_owned()).unwrap_or_default(),
                    "lineup": row.get("chess_lineup").cloned().unwrap_or(Value::Null),
                    "synergies": row.get("synergies").cloned().unwrap_or(Value::Null),
                    "talents": row.get("talents").cloned().unwrap_or(Value::Null),
                    "relic": row.get("relic").cloned().unwrap_or(Value::Null),
                    "relic_history": row.get("relic_history").cloned().unwrap_or(Value::Null),
                    "level": row.get("hero_level").map(|value| value.to_string().trim_matches('"').to_owned()).unwrap_or_default(),
                    "wins": row.get("win_round").cloned().unwrap_or(Value::Null),
                    "losses": row.get("lose_round").cloned().unwrap_or(Value::Null),
                    "match_id": row.get("match_id").cloned().unwrap_or(Value::Null),
                    "played_at": row.get("played_at").cloned().unwrap_or_else(|| json!("")),
                    "created_at": row.get("created_at").cloned().unwrap_or_else(|| json!("")),
                    "rank": mmr_level_to_app_rank(row.get("mmr_level")).map(Value::String).unwrap_or(Value::Null),
                    "rank_change": Value::Null,
                    "wl": Value::Null,
                    "screenshot": Value::Null,
                    "replay": Value::Null,
                    "notes": Value::Null,
                })
            })
            .collect::<Vec<_>>();
        Ok(Value::Array(games))
    }

    pub fn fetch_match_timeline(&self, match_id: &str) -> Result<Value, String> {
        let rows = self.get_json(&format!(
            "/rest/v1/match_timelines?match_id=eq.{match_id}&select=timeline"
        ))?;
        Ok(rows
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row.get("timeline"))
            .cloned()
            .unwrap_or(Value::Null))
    }

    pub fn update_game_fields(&self, game_id: i64, fields: &Value) -> Result<(), String> {
        self.invoke_match_ingest(&json!({
            "action": "update_match_player",
            "id": game_id,
            "fields": fields,
        }))
        .map(|_| ())
    }

    pub fn fetch_drodo_profile(&self, steam_id: &str) -> Result<Value, String> {
        let steam_id = parse_valid_steam_id64(steam_id)
            .ok_or_else(|| "Steam login is required before fetching Drodo profile.".to_owned())?;
        let profile_rows = self.get_json(&format!(
            "/rest/v1/users?select=steam_id,drodo_mmr,drodo_max_mmr,drodo_mmr_level,drodo_season,drodo_season_games,drodo_chicken_count,drodo_last_fetched_at&steam_id=eq.{steam_id}"
        ))?;
        let seasons = self.get_json(&format!(
            "/rest/v1/player_seasons?select=season,mmr,max_mmr,games_played,queen_rank,peak_queen_rank&steam_id=eq.{steam_id}&order=season.asc"
        ))?;
        let Some(row) = profile_rows.as_array().and_then(|rows| rows.first()) else {
            return Ok(Value::Null);
        };
        Ok(drodo_user_row_to_profile(row, seasons))
    }

    pub fn refresh_drodo_profile(&self, steam_id: &str) -> Result<Value, String> {
        let body = fetch_drodo_courier_payload(steam_id)?;
        if let Some(message) = drodo_courier_error(&body) {
            return Err(message);
        }
        let drodo_data = courier_player(&body, steam_id)
            .map(|info| Value::Object(info.clone()))
            .ok_or_else(|| "Drodo profile was not found for this Steam account.".to_owned())?;

        let mut max_season = 0;
        let mut season = String::new();
        if let Some(map) = drodo_data.as_object() {
            for key in map.keys() {
                if let Some(n) = key
                    .strip_prefix("mmr_s")
                    .and_then(|value| value.parse::<i64>().ok())
                {
                    if n > max_season {
                        max_season = n;
                        season = format!("s{n}");
                    }
                }
            }
        }

        let now = now_iso_utc();
        let mmr_key = (!season.is_empty()).then(|| format!("mmr_{season}"));
        let max_mmr_key = (!season.is_empty()).then(|| format!("max_mmr_{season}"));
        let match_key = (!season.is_empty()).then(|| format!("match_{season}"));
        let mut profile = json!({
            "steam_id": steam_id,
            "mmr": mmr_key.as_deref().and_then(|key| positive_value_number(&drodo_data, key)),
            "max_mmr": max_mmr_key.as_deref().and_then(|key| positive_value_number(&drodo_data, key)),
            "mmr_level": value_number(&drodo_data, "mmr_level"),
            "queen_rank": drodo_data
                .as_object()
                .and_then(queen_rank_from_object)
                .map(|rank| json!(rank))
                .unwrap_or(Value::Null),
            "season": if season.is_empty() { Value::Null } else { json!(season) },
            "season_games": match_key.as_deref().and_then(|key| positive_value_number(&drodo_data, key)),
            "candy": value_number(&drodo_data, "candy"),
            "chicken_count": value_number(&drodo_data, "chicken_count").unwrap_or(0),
            "raw_data": drodo_data,
            "fetched_at": now,
        });

        let existing_rows = self.get_json(&format!(
            "/rest/v1/users?select=drodo_mmr,drodo_max_mmr,drodo_season,drodo_season_games&steam_id=eq.{steam_id}"
        ))?;
        if let Some(existing) = existing_rows.as_array().and_then(|rows| rows.first()) {
            preserve_omitted_drodo_fields(existing, &mut profile);
        }

        let user_payload = drodo_profile_to_user_payload(&profile);
        self.post_json(
            "/rest/v1/users",
            &user_payload,
            "resolution=merge-duplicates,return=minimal",
        )?;

        let mut season_rows = Vec::new();
        if let Some(map) = profile.get("raw_data").and_then(Value::as_object) {
            for key in map.keys() {
                let Some(n) = key.strip_prefix("mmr_s") else {
                    continue;
                };
                let season_key = format!("s{n}");
                season_rows.push(json!({
                    "steam_id": steam_id,
                    "season": season_key,
                    "mmr": positive_value_number(profile.get("raw_data").unwrap_or(&Value::Null), &format!("mmr_s{n}")),
                    "max_mmr": positive_value_number(profile.get("raw_data").unwrap_or(&Value::Null), &format!("max_mmr_s{n}")),
                    "games_played": positive_value_number(profile.get("raw_data").unwrap_or(&Value::Null), &format!("match_s{n}")),
                    "fetched_at": now,
                }));
            }
        }
        if !season_rows.is_empty() {
            self.post_json(
                "/rest/v1/player_seasons?on_conflict=steam_id,season",
                &Value::Array(season_rows.clone()),
                "resolution=merge-duplicates,return=minimal",
            )?;
        }

        let mut output = profile;
        if let Some(obj) = output.as_object_mut() {
            obj.insert("seasons".to_owned(), Value::Array(season_rows));
        }
        Ok(output)
    }

    pub(super) fn post_json(&self, path: &str, body: &Value, prefer: &str) -> Result<(), String> {
        let bearer_token = self.authenticated_bearer_token()?;
        let response = ureq::post(&format!("{}{}", self.url, path))
            .timeout(HTTP_TIMEOUT)
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {bearer_token}"))
            .set("Content-Type", "application/json")
            .set("Prefer", prefer)
            .send_string(&body.to_string());
        match response {
            Ok(resp) if (200..300).contains(&resp.status()) => Ok(()),
            Ok(resp) => {
                let status = resp.status();
                let detail = resp.into_string().unwrap_or_default();
                Err(format!("Supabase returned HTTP {status}: {detail}"))
            }
            Err(err) => Err(describe_ureq_error(err)),
        }
    }

    pub(super) fn patch_json(&self, path: &str, body: &Value, prefer: &str) -> Result<(), String> {
        let bearer_token = self.authenticated_bearer_token()?;
        let response = ureq::request("PATCH", &format!("{}{}", self.url, path))
            .timeout(HTTP_TIMEOUT)
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {bearer_token}"))
            .set("Content-Type", "application/json")
            .set("Prefer", prefer)
            .send_string(&body.to_string());
        match response {
            Ok(resp) if (200..300).contains(&resp.status()) => Ok(()),
            Ok(resp) => Err(format!("Supabase returned HTTP {}", resp.status())),
            Err(err) => Err(describe_ureq_error(err)),
        }
    }

    pub(super) fn invoke_match_ingest(&self, body: &Value) -> Result<Value, String> {
        let bearer_token = self.authenticated_bearer_token()?;
        let response = ureq::post(&format!("{}/functions/v1/match-ingest", self.url))
            .timeout(MATCH_INGEST_HTTP_TIMEOUT)
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {bearer_token}"))
            .set("Content-Type", "application/json")
            .send_string(&body.to_string());
        match response {
            Ok(resp) if (200..300).contains(&resp.status()) => {
                let response_body = resp.into_string().map_err(|err| err.to_string())?;
                serde_json::from_str(&response_body).map_err(|err| err.to_string())
            }
            Ok(resp) => {
                let status = resp.status();
                let detail = resp.into_string().unwrap_or_default();
                Err(format!("match ingest returned HTTP {status}: {detail}"))
            }
            Err(err) => Err(describe_ureq_error(err)),
        }
    }

    pub(super) fn get_json(&self, path: &str) -> Result<Value, String> {
        let response = ureq::get(&format!("{}{}", self.url, path))
            .timeout(HTTP_TIMEOUT)
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {}", self.bearer_token()))
            .call();
        match response {
            Ok(resp) if (200..300).contains(&resp.status()) => {
                let body = resp.into_string().map_err(|err| err.to_string())?;
                serde_json::from_str::<Value>(&body).map_err(|err| err.to_string())
            }
            Ok(resp) => Err(format!("Supabase returned HTTP {}", resp.status())),
            Err(err) => Err(describe_ureq_error(err)),
        }
    }

    pub(super) fn bearer_token(&self) -> &str {
        self.auth_token.as_deref().unwrap_or(&self.key)
    }

    fn authenticated_bearer_token(&self) -> Result<&str, String> {
        self.auth_token
            .as_deref()
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| "Steam login is required before uploading to Supabase.".to_owned())
    }
}

pub fn client_with_fresh_session(cfg: &mut Config) -> Result<SupabaseClient, String> {
    ensure_fresh_session(cfg)?;
    SupabaseClient::from_config(cfg)
        .ok_or_else(|| "Supabase is not configured.".to_owned())
}

/// Reload config from disk, refresh the Supabase session when needed, and
/// return a client. Refreshed tokens are persisted to config.json.
pub fn fresh_client_from_disk() -> Result<SupabaseClient, String> {
    let mut cfg = Config::load().map_err(|err| err.to_string())?;
    client_with_fresh_session(&mut cfg)
}

pub fn ensure_fresh_session(cfg: &mut Config) -> Result<(), String> {
    if cfg.local_only
        || cfg.supabase_url.trim().is_empty()
        || cfg.supabase_key.trim().is_empty()
        || cfg.supabase_refresh_token.trim().is_empty()
    {
        return Ok(());
    }

    if !needs_refresh(cfg) {
        return Ok(());
    }

    let _guard = SESSION_REFRESH_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    // Another thread may have refreshed (or invalidated) the session while
    // we were waiting for the lock, so re-check against the latest state on
    // disk instead of the possibly-stale copy the caller loaded earlier.
    let on_disk = Config::load().map_err(|err| err.to_string())?;
    cfg.supabase_access_token = on_disk.supabase_access_token;
    cfg.supabase_refresh_token = on_disk.supabase_refresh_token;
    cfg.supabase_token_expires_at = on_disk.supabase_token_expires_at;

    if cfg.supabase_refresh_token.trim().is_empty() {
        return Err("Supabase session was cleared; Steam login is required.".to_owned());
    }
    if !needs_refresh(cfg) {
        return Ok(());
    }

    let session = match refresh_session(cfg) {
        Ok(session) => session,
        Err(err) => {
            if is_invalid_refresh_token_error(&err) {
                let _ = cfg.clear_supabase_session();
                cfg.supabase_access_token.clear();
                cfg.supabase_refresh_token.clear();
                cfg.supabase_token_expires_at.clear();
            }
            return Err(err);
        }
    };
    cfg.save_supabase_session(
        &session.access_token,
        &session.refresh_token,
        session.expires_at,
    )
    .map_err(|err| err.to_string())?;
    cfg.supabase_access_token = session.access_token;
    cfg.supabase_refresh_token = session.refresh_token;
    cfg.supabase_token_expires_at = session
        .expires_at
        .map(|value| value.to_string())
        .unwrap_or_default();
    Ok(())
}

fn needs_refresh(cfg: &Config) -> bool {
    cfg.supabase_access_token.trim().is_empty()
        || cfg
            .supabase_token_expires_at
            .trim()
            .parse::<i64>()
            .map(|expires_at| {
                expires_at <= chrono::Utc::now().timestamp() + TOKEN_REFRESH_SKEW_SECONDS
            })
            .unwrap_or(true)
}

/// Supabase's GoTrue rejects a refresh token that has already been rotated
/// away by a concurrent refresh with an `invalid_grant` / "Already Used"
/// error. Treat that as a dead session rather than a retryable failure —
/// otherwise every later upload attempt keeps retrying the same poisoned
/// token and failing forever.
fn is_invalid_refresh_token_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("invalid_grant")
        || lower.contains("invalid refresh token")
        || lower.contains("already used")
        || lower.contains("refresh_token_not_found")
}

struct RefreshedSession {
    access_token: String,
    refresh_token: String,
    expires_at: Option<i64>,
}

fn refresh_session(cfg: &Config) -> Result<RefreshedSession, String> {
    let supabase_url = cfg.supabase_url.trim_end_matches('/');
    let response = ureq::post(&format!(
        "{supabase_url}/auth/v1/token?grant_type=refresh_token"
    ))
    .timeout(HTTP_TIMEOUT)
    .set("apikey", &cfg.supabase_key)
    .set("Content-Type", "application/json")
    .send_string(&json!({ "refresh_token": cfg.supabase_refresh_token }).to_string())
    .map_err(describe_ureq_error)?;
    let body = response.into_string().map_err(|err| err.to_string())?;
    let value = serde_json::from_str::<Value>(&body).map_err(|err| err.to_string())?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(format!("Supabase token refresh failed: {error}"));
    }
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Supabase token refresh did not return an access token".to_owned())?
        .to_owned();
    let refresh_token = value
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&cfg.supabase_refresh_token)
        .to_owned();
    let expires_at = value
        .get("expires_at")
        .and_then(Value::as_i64)
        .or_else(|| {
            value
                .get("expires_at")
                .and_then(Value::as_str)
                .and_then(|value| value.parse::<i64>().ok())
        })
        .or_else(|| {
            value
                .get("expires_in")
                .and_then(Value::as_i64)
                .map(|seconds| chrono::Utc::now().timestamp() + seconds)
        });

    Ok(RefreshedSession {
        access_token,
        refresh_token,
        expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_invalid_refresh_token_errors_case_insensitively() {
        assert!(is_invalid_refresh_token_error(
            "status code 400: {\"error\":\"invalid_grant\",\"error_description\":\"Invalid Refresh Token: Already Used\"}"
        ));
        assert!(is_invalid_refresh_token_error(
            "Supabase token refresh failed: refresh_token_not_found"
        ));
    }

    #[test]
    fn does_not_treat_network_errors_as_invalid_refresh_token() {
        assert!(!is_invalid_refresh_token_error("status code 503: upstream timeout"));
        assert!(!is_invalid_refresh_token_error("network unreachable"));
    }

    fn base_config() -> Config {
        Config {
            dac_dir: std::env::temp_dir(),
            steam_id: String::new(),
            steam_name: String::new(),
            replay_enabled: true,
            keep_local_nettable_dumps: true,
            local_game_cache_max_gb: 5,
            local_only: false,
            supabase_url: "https://example.supabase.co".to_owned(),
            supabase_key: "key".to_owned(),
            supabase_auth_url: String::new(),
            supabase_access_token: String::new(),
            supabase_refresh_token: String::new(),
            supabase_token_expires_at: String::new(),
        }
    }

    #[test]
    fn needs_refresh_when_access_token_is_empty() {
        let cfg = base_config();
        assert!(needs_refresh(&cfg));
    }

    #[test]
    fn needs_refresh_when_expiry_is_within_skew_window() {
        let mut cfg = base_config();
        cfg.supabase_access_token = "token".to_owned();
        cfg.supabase_token_expires_at = (chrono::Utc::now().timestamp() + 10).to_string();
        assert!(needs_refresh(&cfg));
    }

    #[test]
    fn does_not_need_refresh_when_token_is_comfortably_valid() {
        let mut cfg = base_config();
        cfg.supabase_access_token = "token".to_owned();
        cfg.supabase_token_expires_at = (chrono::Utc::now().timestamp() + 3600).to_string();
        assert!(!needs_refresh(&cfg));
    }
}
