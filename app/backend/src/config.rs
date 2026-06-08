use serde_json::{json, Value};
use std::{env, fs, io, path::PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub dac_dir: PathBuf,
    pub steam_id: String,
    pub steam_name: String,
    pub replay_enabled: bool,
    pub keep_local_nettable_dumps: bool,
    pub upload_raw_nettable_dumps: bool,
    pub local_only: bool,
    pub supabase_url: String,
    pub supabase_key: String,
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
        let value = parse_config_json(&body);
        Ok(Self {
            dac_dir,
            steam_id: value_string(&value, "steam_id"),
            // Sanitize on load: legacy configs (old backend) stored the raw
            // Steam XML `<![CDATA[name]]>`, which otherwise renders as
            // "C. Data <name>". normalize_steam_name strips that wrapper.
            steam_name: crate::steam_auth::normalize_steam_name(&value_string(
                &value,
                "steam_name",
            )),
            replay_enabled: value_bool(&value, "replay_enabled", true),
            keep_local_nettable_dumps: value_bool(&value, "keep_local_nettable_dumps", true),
            upload_raw_nettable_dumps: value_bool(&value, "upload_raw_nettable_dumps", false),
            local_only: local_only_mode_from(&value),
            supabase_url: value_string(&value, "supabase_url"),
            supabase_key: value_string(&value, "supabase_key"),
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
}

pub fn dac_dir() -> PathBuf {
    if let Some(value) = env::var_os("DAC_DIR") {
        return PathBuf::from(value);
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
  "local_only": false,
  "steam_id": "",
  "steam_name": "",
  "replay_enabled": true,
  "replay_max_gb": 15,
  "keep_local_nettable_dumps": true,
  "upload_raw_nettable_dumps": false,
  "local_nettable_retention_days": 14,
  "local_nettable_max_mb": 500
}
"#
}

fn parse_config_json(body: &str) -> Value {
    serde_json::from_str(body)
        .unwrap_or_else(|_| serde_json::from_str(default_config_json()).unwrap())
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
}
