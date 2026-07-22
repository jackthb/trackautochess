//! Bounded local game/dump cache under the DAC data dir.
//!
//! Keeps finished-match archives (`game_cache/`) and raw dump files
//! (`nettable_dumps/`) until total size hits `local_game_cache_max_gb`, then
//! deletes the oldest entries first.

use std::{
    fs,
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

pub const GAME_CACHE_DIR: &str = "game_cache";
pub const NETTABLE_DUMPS_DIR: &str = "nettable_dumps";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvictionResult {
    pub bytes_before: u64,
    pub bytes_after: u64,
    pub deleted: usize,
}

#[derive(Debug)]
struct CacheEntry {
    path: PathBuf,
    modified: SystemTime,
    size: u64,
    is_dir: bool,
}

/// Enforce a size budget across `game_cache/` and `nettable_dumps/`.
/// Deletes oldest entries first. Never touches outbox or live `captures/`.
pub fn enforce_budget(dac_dir: &Path, max_bytes: u64) -> io::Result<EvictionResult> {
    let mut entries = collect_entries(dac_dir)?;
    let bytes_before: u64 = entries.iter().map(|e| e.size).sum();
    if max_bytes == 0 || bytes_before <= max_bytes {
        return Ok(EvictionResult {
            bytes_before,
            bytes_after: bytes_before,
            deleted: 0,
        });
    }

    entries.sort_by(|a, b| a.modified.cmp(&b.modified).then(a.path.cmp(&b.path)));

    let mut bytes_after = bytes_before;
    let mut deleted = 0;
    for entry in entries {
        if bytes_after <= max_bytes {
            break;
        }
        let removed = if entry.is_dir {
            remove_dir_sized(&entry.path)?
        } else {
            match fs::remove_file(&entry.path) {
                Ok(()) => entry.size,
                Err(err) if err.kind() == io::ErrorKind::NotFound => 0,
                Err(err) => return Err(err),
            }
        };
        bytes_after = bytes_after.saturating_sub(removed);
        deleted += 1;
    }

    Ok(EvictionResult {
        bytes_before,
        bytes_after,
        deleted,
    })
}

pub fn max_bytes_from_gb(max_gb: u64) -> u64 {
    max_gb.saturating_mul(1024 * 1024 * 1024)
}

/// Persist a finished match's session dumps + optional timeline for later rebuild.
pub fn persist_match_archive(
    dac_dir: &Path,
    match_id: &str,
    dumps_json: serde_json::Value,
    timeline: Option<&serde_json::Value>,
    source: &str,
) -> io::Result<PathBuf> {
    let safe_id = sanitize_match_id(match_id);
    if safe_id.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "empty match id",
        ));
    }
    let dir = dac_dir.join(GAME_CACHE_DIR).join(&safe_id);
    fs::create_dir_all(&dir)?;

    let meta = serde_json::json!({
        "match_id": match_id,
        "saved_at": chrono::Utc::now().to_rfc3339(),
        "source": source,
        "has_timeline": timeline.is_some(),
    });
    fs::write(dir.join("meta.json"), serde_json::to_vec_pretty(&meta)?)?;
    fs::write(dir.join("dumps.json"), serde_json::to_vec(&dumps_json)?)?;
    if let Some(timeline) = timeline {
        fs::write(dir.join("timeline.json"), serde_json::to_vec(timeline)?)?;
    }
    Ok(dir)
}

fn sanitize_match_id(match_id: &str) -> String {
    match_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn collect_entries(dac_dir: &Path) -> io::Result<Vec<CacheEntry>> {
    let mut entries = Vec::new();

    let dumps_dir = dac_dir.join(NETTABLE_DUMPS_DIR);
    if dumps_dir.is_dir() {
        for entry in fs::read_dir(&dumps_dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let meta = entry.metadata()?;
            entries.push(CacheEntry {
                path,
                modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                size: meta.len(),
                is_dir: false,
            });
        }
    }

    let games_dir = dac_dir.join(GAME_CACHE_DIR);
    if games_dir.is_dir() {
        for entry in fs::read_dir(&games_dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let size = dir_size(&path)?;
            let modified = game_archive_mtime(&path).unwrap_or(SystemTime::UNIX_EPOCH);
            entries.push(CacheEntry {
                path,
                modified,
                size,
                is_dir: true,
            });
        }
    }

    Ok(entries)
}

fn game_archive_mtime(path: &Path) -> io::Result<SystemTime> {
    let meta_path = path.join("meta.json");
    if meta_path.is_file() {
        if let Ok(body) = fs::read_to_string(&meta_path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(saved_at) = value.get("saved_at").and_then(|v| v.as_str()) {
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(saved_at) {
                        return Ok(SystemTime::UNIX_EPOCH
                            + Duration::from_secs(dt.timestamp().max(0) as u64)
                            + Duration::from_nanos(dt.timestamp_subsec_nanos() as u64));
                    }
                }
            }
        }
    }
    newest_mtime(path)
}

fn dir_size(path: &Path) -> io::Result<u64> {
    let mut total = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    Ok(total)
}

fn newest_mtime(path: &Path) -> io::Result<SystemTime> {
    let mut newest = fs::metadata(path)?.modified()?;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if meta.is_dir() {
                stack.push(entry.path());
            }
            if let Ok(modified) = meta.modified() {
                if modified > newest {
                    newest = modified;
                }
            }
        }
    }
    Ok(newest)
}

fn remove_dir_sized(path: &Path) -> io::Result<u64> {
    let size = dir_size(path).unwrap_or(0);
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(size),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(0),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    fn temp_dac(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "dac-local-cache-{}-{}-{}",
            label,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn evicts_oldest_files_when_over_budget() {
        let dac = temp_dac("evict");
        let dumps = dac.join(NETTABLE_DUMPS_DIR);
        fs::create_dir_all(&dumps).unwrap();

        fs::write(dumps.join("old.json"), vec![b'a'; 100]).unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(dumps.join("mid.json"), vec![b'b'; 100]).unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(dumps.join("new.json"), vec![b'c'; 100]).unwrap();

        let result = enforce_budget(&dac, 150).unwrap();
        assert!(result.deleted >= 1);
        assert!(result.bytes_after <= 150);
        assert!(!dumps.join("old.json").exists());
        assert!(dumps.join("new.json").exists());

        let _ = fs::remove_dir_all(dac);
    }

    #[test]
    fn persists_match_archive_and_evicts_old_game_dirs() {
        let dac = temp_dac("archive");
        let first = persist_match_archive(
            &dac,
            "match-old",
            serde_json::json!([{"captured_at":"t0","rows":[]}]),
            Some(&serde_json::json!({"round_count": 2})),
            "end_board",
        )
        .unwrap();
        fs::write(first.join("pad.bin"), vec![0u8; 200]).unwrap();
        fs::write(
            first.join("meta.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "match_id": "match-old",
                "saved_at": "2020-01-01T00:00:00Z",
                "source": "end_board",
                "has_timeline": true,
            }))
            .unwrap(),
        )
        .unwrap();

        let second = persist_match_archive(
            &dac,
            "match-new",
            serde_json::json!([{"captured_at":"t1","rows":[]}]),
            None,
            "left_match",
        )
        .unwrap();
        fs::write(second.join("pad.bin"), vec![0u8; 200]).unwrap();
        fs::write(
            second.join("meta.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "match_id": "match-new",
                "saved_at": "2024-01-01T00:00:00Z",
                "source": "left_match",
                "has_timeline": false,
            }))
            .unwrap(),
        )
        .unwrap();

        let result = enforce_budget(&dac, 400).unwrap();
        assert_eq!(result.deleted, 1);
        assert!(!first.exists());
        assert!(second.exists());
        assert!(second.join("dumps.json").is_file());
        assert!(result.bytes_after <= 400);

        let _ = fs::remove_dir_all(dac);
    }
}
