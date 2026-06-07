use std::{env, fs, io, path::PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub dac_dir: PathBuf,
    pub steam_id: String,
    pub steam_name: String,
    pub replay_enabled: bool,
    pub keep_local_nettable_dumps: bool,
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
        Ok(Self {
            dac_dir,
            steam_id: json_string(&body, "steam_id").unwrap_or_default(),
            steam_name: json_string(&body, "steam_name").unwrap_or_default(),
            replay_enabled: json_bool(&body, "replay_enabled").unwrap_or(true),
            keep_local_nettable_dumps: json_bool(&body, "keep_local_nettable_dumps")
                .unwrap_or(true),
        })
    }

    pub fn save_value(&self, key: &str, value_json: &str) -> io::Result<()> {
        let path = self.dac_dir.join("config.json");
        let mut body =
            fs::read_to_string(&path).unwrap_or_else(|_| default_config_json().to_owned());
        set_json_value(&mut body, key, value_json);
        fs::write(path, body)
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

fn json_string(body: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let start = rest.find('"')? + 1;
    let mut escaped = false;
    let mut out = String::new();
    for ch in rest[start..].chars() {
        if escaped {
            out.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            });
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

fn json_bool(body: &str, key: &str) -> Option<bool> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let value = rest.trim_start();
    if value.starts_with("true") {
        Some(true)
    } else if value.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

fn set_json_value(body: &mut String, key: &str, value_json: &str) {
    let marker = format!("\"{key}\"");
    if let Some(start_key) = body.find(&marker) {
        if let Some(colon_rel) = body[start_key..].find(':') {
            let value_start = start_key + colon_rel + 1;
            let value_end = find_json_value_end(body, value_start);
            body.replace_range(value_start..value_end, &format!(" {value_json}"));
            return;
        }
    }
    let insertion = format!(",\n  \"{key}\": {value_json}");
    if let Some(pos) = body.rfind('\n').and_then(|_| body.rfind('}')) {
        body.insert_str(pos, &insertion);
    }
}

fn find_json_value_end(body: &str, start: usize) -> usize {
    let bytes = body.as_bytes();
    let mut i = start;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i < bytes.len() && bytes[i] == b'\"' {
        i += 1;
        let mut escaped = false;
        while i < bytes.len() {
            if escaped {
                escaped = false;
            } else if bytes[i] == b'\\' {
                escaped = true;
            } else if bytes[i] == b'\"' {
                i += 1;
                break;
            }
            i += 1;
        }
        return i;
    }
    while i < bytes.len() && bytes[i] != b',' && bytes[i] != b'}' && bytes[i] != b'\n' {
        i += 1;
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_config_fields() {
        let body = r#"{"steam_id":"123","steam_name":"abc","replay_enabled":false}"#;
        assert_eq!(json_string(body, "steam_id").as_deref(), Some("123"));
        assert_eq!(json_string(body, "steam_name").as_deref(), Some("abc"));
        assert_eq!(json_bool(body, "replay_enabled"), Some(false));
    }
}
