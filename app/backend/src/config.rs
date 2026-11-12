use serde::Serialize;
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use ts_rs::TS;

const DEFAULT_SUPABASE_URL: &str = "https://ismxtcfkuwpvfyuojnaa.supabase.co";
const LEGACY_SUPABASE_URL: &str = "https://xkfxykorskdltcmvgihh.supabase.co";
const LEGACY_SUPABASE_KEY: &str = "sb_publishable_Tk7hBHGJImbtzxxZzEIgKQ_kwnKuCaK";
const DEFAULT_SUPABASE_AUTH_URL: &str = "https://www.trackautochess.com/api/auth/steam/callback";
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn disk_lock(path: &Path) -> io::Result<fs::File> {
    // Lock a stable sidecar: config.json itself is replaced on every commit.
    let file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path.with_extension("lock"))?;
    fs2::FileExt::lock_exclusive(&file)?;
    Ok(file) // Closing the handle releases the OS lock, including on process exit.
}

fn read_config(path: &Path) -> io::Result<Value> {
    let body = fs::read_to_string(path)?;
    let value: Value = serde_json::from_str(body.trim_start_matches('\u{feff}')).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid config.json; original file preserved for recovery",
        )
    })?;
    if !value.is_object() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "config.json must be an object; original preserved",
        ));
    }
    Ok(value)
}

fn atomic_write_config(path: &Path, value: &Value) -> io::Result<()> {
    let mut random = [0u8; 16];
    getrandom::getrandom(&mut random).map_err(|err| io::Error::other(err.to_string()))?;
    let temp = path.with_extension(format!("{:x}.tmp", u128::from_le_bytes(random)));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        file.write_all(serde_json::to_string_pretty(value)?.as_bytes())?;
        file.sync_all()?;
        drop(file);
        // std::fs::rename replaces files atomically on Windows as well as Unix.
        fs::rename(&temp, path)
    })();
    let _ = fs::remove_file(temp);
    result
}

fn update_config(path: &Path, update: impl FnOnce(&mut Value) -> io::Result<()>) -> io::Result<()> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    let _disk_guard = disk_lock(path)?;
    let mut value = read_config(path)?;
    update(&mut value)?;
    atomic_write_config(path, &value)
}

fn set_session(value: &mut Value, access: &str, refresh: &str, expires: Option<i64>) {
    value["supabase_access_token"] = json!(access);
    value["supabase_refresh_token"] = json!(refresh);
    value["supabase_token_expires_at"] = json!(expires.map(|v| v.to_string()).unwrap_or_default());
}

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
    /// Soft cap for `game_cache/` + `nettable_dumps/`. Oldest entries are
    /// deleted once total size exceeds this many gigabytes.
    pub local_game_cache_max_gb: u64,
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
        let _guard = CONFIG_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let dac_dir = dac_dir();
        fs::create_dir_all(&dac_dir)?;
        let path = dac_dir.join("config.json");
        let _disk_guard = disk_lock(&path)?;
        if !path.exists() {
            atomic_write_config(&path, &parse_config_json(default_config_json()))?;
        }
        let mut value = read_config(&path)?;
        if apply_config_migrations(&mut value) {
            atomic_write_config(&path, &value)?;
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
            local_game_cache_max_gb: value_u64(&value, "local_game_cache_max_gb", 5),
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
        let parsed: Value = serde_json::from_str(value_json)?;
        update_config(&self.dac_dir.join("config.json"), |value| {
            value[key] = parsed;
            Ok(())
        })
    }

    pub fn save_login(&self, login: &crate::steam_auth::SteamLoginResult) -> io::Result<()> {
        update_config(&self.dac_dir.join("config.json"), |value| {
            value["steam_id"] = json!(login.steam_id);
            value["steam_name"] = json!(login.steam_name);
            if let Some(session) = &login.supabase_session {
                set_session(
                    value,
                    &session.access_token,
                    &session.refresh_token,
                    session.expires_at,
                );
            } else {
                set_session(value, "", "", None);
            }
            Ok(())
        })
    }

    pub fn save_refreshed_session(
        &self,
        access_token: &str,
        refresh_token: &str,
        expires_at: Option<i64>,
    ) -> io::Result<()> {
        update_config(&self.dac_dir.join("config.json"), |value| {
            if value_string(value, "steam_id") != self.steam_id
                || value_string(value, "supabase_refresh_token") != self.supabase_refresh_token
                || value_string(value, "supabase_url") != self.supabase_url
                || value_bool(value, "local_only", false)
            {
                return Err(io::Error::other(
                    "Session changed during refresh; response discarded",
                ));
            }
            set_session(value, access_token, refresh_token, expires_at);
            Ok(())
        })
    }

    pub fn logout(&self) -> io::Result<()> {
        update_config(&self.dac_dir.join("config.json"), |value| {
            value["steam_id"] = json!("");
            value["steam_name"] = json!("");
            set_session(value, "", "", None);
            Ok(())
        })
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
  "supabase_url": "https://ismxtcfkuwpvfyuojnaa.supabase.co",
  "supabase_key": "sb_publishable_C7GbRNcYQPPrCyqAbl0dcA_IAW0wnY-",
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
  "local_game_cache_max_gb": 5
}
"#
}

fn parse_config_json(body: &str) -> Value {
    serde_json::from_str(body.trim_start_matches('\u{feff}'))
        .unwrap_or_else(|_| serde_json::from_str(default_config_json()).unwrap())
}

fn apply_config_migrations(value: &mut Value) -> bool {
    let current_url = value_string(value, "supabase_url");
    let current_key = value_string(value, "supabase_key");
    let should_replace_supabase =
        current_url.trim().is_empty() || current_url.trim_end_matches('/') == LEGACY_SUPABASE_URL;
    let should_replace_supabase_key = current_key.trim().is_empty()
        || current_key == LEGACY_SUPABASE_KEY
        || should_replace_supabase;
    let should_set_auth_url = value_string(value, "supabase_auth_url").trim().is_empty();

    let defaults = parse_config_json(default_config_json());
    let Some(map) = value.as_object_mut() else {
        return false;
    };

    let mut changed = false;
    if should_replace_supabase || should_replace_supabase_key {
        for key in ["supabase_url", "supabase_key"] {
            if key == "supabase_url" && !should_replace_supabase {
                continue;
            }
            if key == "supabase_key" && !should_replace_supabase_key {
                continue;
            }
            if let Some(default_value) = defaults.get(key) {
                let value = if key == "supabase_url" {
                    json!(DEFAULT_SUPABASE_URL)
                } else {
                    default_value.clone()
                };
                map.insert(key.to_owned(), value);
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
    if !map.contains_key("local_game_cache_max_gb") {
        map.insert("local_game_cache_max_gb".to_owned(), json!(5));
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

fn value_u64(value: &Value, key: &str, fallback: u64) -> u64 {
    value
        .get(key)
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_i64().and_then(|n| u64::try_from(n).ok()))
                .or_else(|| {
                    v.as_f64().and_then(|n| {
                        if n.is_finite() && n >= 0.0 {
                            Some(n as u64)
                        } else {
                            None
                        }
                    })
                })
        })
        .unwrap_or(fallback)
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

    fn fixture() -> (PathBuf, Config) {
        let dir = std::env::temp_dir().join(format!(
            "dac-config-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let cfg = Config {
            dac_dir: dir.clone(),
            steam_id: "76561198000000001".into(),
            steam_name: "Player".into(),
            replay_enabled: false,
            keep_local_nettable_dumps: true,
            local_game_cache_max_gb: 5,
            local_only: false,
            supabase_url: DEFAULT_SUPABASE_URL.into(),
            supabase_key: "public".into(),
            supabase_auth_url: DEFAULT_SUPABASE_AUTH_URL.into(),
            supabase_access_token: "old-access".into(),
            supabase_refresh_token: "old-refresh".into(),
            supabase_token_expires_at: "0".into(),
        };
        atomic_write_config(
            &dir.join("config.json"),
            &serde_json::to_value(&cfg).unwrap(),
        )
        .unwrap();
        (dir, cfg)
    }

    #[test]
    fn stale_refresh_cannot_undo_logout_or_replace_new_login() {
        let (dir, cfg) = fixture();
        cfg.logout().unwrap();
        assert!(cfg.save_refreshed_session("stale", "stale", None).is_err());
        let value = read_config(&dir.join("config.json")).unwrap();
        assert_eq!(value["steam_id"], "");
        assert_eq!(value["supabase_refresh_token"], "");
        cfg.save_login(&crate::steam_auth::SteamLoginResult {
            steam_id: "76561198000000002".into(),
            steam_name: "Other".into(),
            supabase_session: Some(crate::steam_auth::SupabaseSession {
                access_token: "new-access".into(),
                refresh_token: "new-refresh".into(),
                expires_at: None,
            }),
        })
        .unwrap();
        assert!(cfg.save_refreshed_session("stale", "stale", None).is_err());
        assert_eq!(
            read_config(&dir.join("config.json")).unwrap()["supabase_refresh_token"],
            "new-refresh"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refresh_preserves_settings_and_corrupt_config_is_never_overwritten() {
        let (dir, cfg) = fixture();
        cfg.save_value("local_game_cache_max_gb", "12").unwrap();
        cfg.save_refreshed_session("next-access", "next-refresh", Some(10))
            .unwrap();
        let path = dir.join("config.json");
        assert_eq!(read_config(&path).unwrap()["local_game_cache_max_gb"], 12);
        fs::write(&path, "{broken").unwrap();
        assert!(read_config(&path).is_err());
        assert!(cfg.save_value("local_only", "false").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{broken");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn config_process_writer() {
        let Some(path) = env::var_os("DAC_TEST_CONFIG_WRITER_PATH") else {
            return;
        };
        for _ in 0..30 {
            update_config(Path::new(&path), |value| {
                let before = value["counter"].as_u64().unwrap_or(0);
                std::thread::sleep(std::time::Duration::from_millis(1));
                value["counter"] = json!(before + 1);
                Ok(())
            })
            .unwrap();
        }
    }

    #[test]
    fn separate_process_writers_preserve_each_others_updates() {
        let (dir, _) = fixture();
        let path = dir.join("config.json");
        let mut children = Vec::new();
        for _ in 0..2 {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command
                .args(["--exact", "config::tests::config_process_writer"])
                .env("DAC_TEST_CONFIG_WRITER_PATH", &path)
                .stdout(std::process::Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            children.push(command.spawn().unwrap());
        }
        for mut child in children {
            assert!(child.wait().unwrap().success());
        }
        assert_eq!(read_config(&path).unwrap()["counter"], 60);
        fs::remove_dir_all(dir).unwrap();
    }

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
            "supabase_key": LEGACY_SUPABASE_KEY,
            "steam_id": "123"
        });

        assert!(apply_config_migrations(&mut value));
        assert_eq!(value_string(&value, "supabase_url"), DEFAULT_SUPABASE_URL);
        assert_ne!(value_string(&value, "supabase_key"), LEGACY_SUPABASE_KEY);
        assert_eq!(value_string(&value, "steam_id"), "123");
    }

    #[test]
    fn migrates_legacy_supabase_key_when_url_is_current() {
        let mut value = json!({
            "supabase_url": DEFAULT_SUPABASE_URL,
            "supabase_key": LEGACY_SUPABASE_KEY,
            "steam_id": "123"
        });

        assert!(apply_config_migrations(&mut value));
        assert_eq!(value_string(&value, "supabase_url"), DEFAULT_SUPABASE_URL);
        assert_ne!(value_string(&value, "supabase_key"), LEGACY_SUPABASE_KEY);
        assert_eq!(value_string(&value, "steam_id"), "123");
    }
}
