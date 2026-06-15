use serde_json::Value;
use std::{collections::HashMap, fs, path::PathBuf, sync::OnceLock};

static UNIT_BY_CODE: OnceLock<HashMap<String, String>> = OnceLock::new();

pub fn normalize_chess_lineup(value: &str) -> Option<String> {
    let units = value
        .split([',', '|'])
        .filter_map(|entry| normalize_chess_unit(entry.trim()))
        .collect::<Vec<_>>();
    (!units.is_empty()).then(|| units.join("|"))
}

pub fn normalize_chess_unit(value: &str) -> Option<String> {
    if value.is_empty() {
        return None;
    }
    if !value.starts_with("chess_") {
        return Some(value.to_owned());
    }
    let (base, stars) = chess_unit_base_and_stars(value);
    let name = unit_by_code()
        .get(base)
        .cloned()
        .unwrap_or_else(|| base.to_owned());
    Some(if stars > 1 {
        format!("{name}({stars})")
    } else {
        name
    })
}

fn chess_unit_base_and_stars(code: &str) -> (&str, u8) {
    let by_code = unit_by_code();
    if let Some(base) = code.strip_suffix("11") {
        if by_code.contains_key(base) {
            return (base, 3);
        }
    }
    if let Some(base) = code.strip_suffix('1') {
        if by_code.contains_key(base) {
            return (base, 2);
        }
    }
    (code, 1)
}

fn unit_by_code() -> &'static HashMap<String, String> {
    UNIT_BY_CODE.get_or_init(load_unit_codes)
}

fn load_unit_codes() -> HashMap<String, String> {
    let mut out = HashMap::new();
    for dir in candidate_unit_dirs() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let Ok(body) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<Value>(&body) else {
                continue;
            };
            let Some(name) = value.get("name").and_then(Value::as_str) else {
                continue;
            };
            let code = value
                .get("gameId")
                .or_else(|| value.get("source").and_then(|source| source.get("id")))
                .and_then(Value::as_str);
            if let Some(code) = code.filter(|code| code.starts_with("chess_")) {
                out.insert(code.to_owned(), name.to_owned());
            }
        }
        if !out.is_empty() {
            break;
        }
    }
    out
}

fn candidate_unit_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../content/game/units"));
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("content/game/units"));
        dirs.push(cwd.join("../content/game/units"));
        dirs.push(cwd.join("../../content/game/units"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.join("content/game/units"));
            dirs.push(dir.join("../content/game/units"));
            dirs.push(dir.join("../../content/game/units"));
            dirs.push(dir.join("../../../content/game/units"));
        }
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_raw_chess_lineup_codes_for_display() {
        let lineup = normalize_chess_lineup("chess_axe,chess_ck1,chess_br11,").unwrap();

        assert_eq!(lineup, "Axe|Chaos Knight(2)|Broodmother(3)");
    }
}
