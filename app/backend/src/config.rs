use serde::Serialize;
use serde_json::{json, Value};
use std::{env, fs, io, path::PathBuf};
use ts_rs::TS;

const LEGACY_SUPABASE_URL: &str = "https://ismxtcfkuwpvfyuojnaa.supabase.co";
const DEFAULT_SUPABASE_AUTH_URL: &str = "https://www.trackautochess.com/api/auth/steam/callback";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Config {
    #[ts(type = "string")]
    pub dac_dir: PathBuf,
    pub steam_id: String,
    pub steam_name: String,
    pub replay_enabled: bool,
    /// Persist raw CustomNetTable captures locally for logging/debugging and
    /// post-hoc reprocessing. Product views should use processed matches,
    /// players, and timelines instead of depending on these raw dumps.
    pub keep_local_nettable_dumps: bool,
    /// Upload the same raw captures as private Supabase Storage blobs. This is
    /// a logging/reprocessing safety net, not a Postgres table dependency and
    /// not the user-facing match data model.
    pub upload_raw_nettable_dumps: bool,
    pub local_only: bool,
    pub supabase_url: String,
    pub supabase_key: String,
    pub supabase_auth_url: String,
    pub supabase_access_token: String,
    pub supabase_refresh_token: String,
    pub supabase_token_expires_at: String,
}

impl Config {
    pub fn load() -> io::Result<Self> {
        let dac_dir = dac_dir();
        fs::create_dir_all(&dac_dir)?;
        let path = dac_dir.join("config.json");
        if !path.exists() {
            fs::write(&path, default_config_json())?;
        }
        let body = fs::read_to_string(&path)?;
        let mut value = parse_config_json(&body);
        if apply_config_migrations(&mut value) {
            fs::write(
                &path,
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| body.clone()),
            )?;
        }
        Ok(Self {
            dac_dir,
            steam_id: value_string(&value, "steam_id"),
            steam_name: crate::steam_auth::normalize_steam_name(&value_string(
                &value,
                "steam_name",
            )),
            replay_enabled: value_bool(&value, "replay_enabled", true),
            keep_local_nettable_dumps: value_bool(&value, "keep_local_nettable_dumps", true),
            upload_raw_nettable_dumps: value_bool(&value, "upload_raw_nettable_dumps", true),
            local_only: local_only_mode_from(&value),
            supabase_url: value_string(&value, "supabase_url"),
            supabase_key: value_string(&value, "supabase_key"),
            supabase_auth_url: value_string(&value, "supabase_auth_url"),
            supabase_access_token: value_string(&value, "supabase_access_token"),
            supabase_refresh_token: value_string(&value, "supabase_refresh_token"),
            supabase_token_expires_at: value_string(&value, "supabase_token_expires_at"),
        })
    }

    pub fn save_value(&self, key: &str, value_json: &str) -> io::Result<()> {
        let path = self.dac_dir.join("config.json");
        let body = fs::read_to_string(&path).unwrap_or_else(|_| default_config_json().to_owned());
        let mut value = parse_config_json(&body);
        let parsed = serde_json::from_str(value_json).unwrap_or(Value::Null);
        if let Value::Object(map) = &mut value {
            map.insert(key.to_owned(), parsed);
        }
        fs::write(path, serde_json::to_string_pretty(&value).unwrap_or(body))
    }

    pub fn save_steam_user(&self, steam_id: &str, steam_name: &str) -> io::Result<()> {
        let path = self.dac_dir.join("config.json");
        let body = fs::read_to_string(&path).unwrap_or_else(|_| default_config_json().to_owned());
        let mut value = parse_config_json(&body);
        if let Value::Object(map) = &mut value {
            map.insert("steam_id".to_owned(), json!(steam_id));
            map.insert("steam_name".to_owned(), json!(steam_name));
        }
        fs::write(path, serde_json::to_string_pretty(&value).unwrap_or(body))
    }

    pub fn save_supabase_session(
        &self,
        access_token: &str,
        refresh_token: &str,
        expires_at: Option<i64>,
    ) -> io::Result<()> {
        let path = self.dac_dir.join("config.json");
        let body = fs::read_to_string(&path).unwrap_or_else(|_| default_config_json().to_owned());
        let mut value = parse_config_json(&body);
        if let Value::Object(map) = &mut value {
            map.insert("supabase_access_token".to_owned(), json!(access_token));
            map.insert("supabase_refresh_token".to_owned(), json!(refresh_token));
            map.insert(
                "supabase_token_expires_at".to_owned(),
                json!(expires_at.map(|value| value.to_string()).unwrap_or_default()),
            );
        }
        fs::write(path, serde_json::to_string_pretty(&value).unwrap_or(body))
    }
}

pub fn dac_dir() -> PathBuf {
    if let Some(value) = env::var_os("DAC_DIR") {
        return PathBuf::from(value);
    }
    if let Some(value) = env::var_os("APPDATA") {
        return PathBuf::from(value).join("@dac").join("desktop");
    }
    if let Some(value) = env::var_os("HOME") {
        return PathBuf::from(value).join(".dac");
    }
    if let Some(value) = env::var_os("USERPROFILE") {
        return PathBuf::from(value).join(".dac");
    }
    PathBuf::from(".dac")
}

fn default_config_json() -> &'static str {
    r#"{
  "player_name": "jack",
  "hotkey": "F6",
  "supabase_url": "https://xkfxykorskdltcmvgihh.supabase.co",
  "supabase_key": "sb_publishable_Tk7hBHGJImbtzxxZzEIgKQ_kwnKuCaK",
  "supabase_auth_url": "https://www.trackautochess.com/api/auth/steam/callback",
  "supabase_access_token": "",
  "supabase_refresh_token": "",
  "supabase_token_expires_at": "",
  "local_only": false,
  "steam_id": "",
  "steam_name": "",
  "replay_enabled": true,
  "replay_max_gb": 15,
  "keep_local_nettable_dumps": true,
  "upload_raw_nettable_dumps": true,
  "local_nettable_retention_days": 14,
  "local_nettable_max_mb": 500
}
"#
}

fn parse_config_json(body: &str) -> Value {
    serde_json::from_str(body)
        .unwrap_or_else(|_| serde_json::from_str(default_config_json()).unwrap())
}

fn apply_config_migrations(value: &mut Value) -> bool {
    let current_url = value_string(value, "supabase_url");
    let should_replace_supabase = current_url.trim().is_empty()
        || current_url.trim_end_matches('/') == LEGACY_SUPABASE_URL;
    let should_set_auth_url = value_string(value, "supabase_auth_url").trim().is_empty();

    let defaults = parse_config_json(default_config_json());
    let Some(map) = value.as_object_mut() else {
        return false;
    };

    let mut changed = false;
    if should_replace_supabase {
        for key in ["supabase_url", "supabase_key"] {
            if let Some(default_value) = defaults.get(key) {
                map.insert(key.to_owned(), default_value.clone());
                changed = true;
            }
        }
    }
    if should_set_auth_url {
        map.insert(
            "supabase_auth_url".to_owned(),
            json!(DEFAULT_SUPABASE_AUTH_URL),
        );
        changed = true;
    }
    changed
}

fn value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn value_bool(value: &Value, key: &str, fallback: bool) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn local_only_mode_from(value: &Value) -> bool {
    match env::var("DAC_LOCAL_ONLY")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "1" | "true" | "yes" | "on" => return true,
        "0" | "false" | "no" | "off" => return false,
        _ => {}
    }
    value_bool(value, "local_only", false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_config_fields() {
        let body = r#"{"steam_id":"123","steam_name":"abc","replay_enabled":false}"#;
        let value = parse_config_json(body);
        assert_eq!(value_string(&value, "steam_id"), "123");
        assert_eq!(value_string(&value, "steam_name"), "abc");
        assert!(!value_bool(&value, "replay_enabled", true));
    }

    #[test]
    fn migrates_legacy_supabase_project() {
        let mut value = json!({
            "supabase_url": LEGACY_SUPABASE_URL,
            "supabase_key": "old",
            "steam_id": "123"
        });

        assert!(apply_config_migrations(&mut value));
        assert_eq!(
            value_string(&value, "supabase_url"),
            "https://xkfxykorskdltcmvgihh.supabase.co"
        );
        assert_ne!(value_string(&value, "supabase_key"), "old");
        assert_eq!(value_string(&value, "steam_id"), "123");
    }
}
