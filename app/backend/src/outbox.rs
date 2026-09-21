use std::{
    fs, io::{self, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct Outbox {
    dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct OutboxItem {
    pub path: PathBuf,
    pub payload: String,
}

impl Outbox {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn enqueue_str(&self, payload: &str) -> io::Result<PathBuf> {
        self.enqueue_with_key(payload, payload)
    }

    /// Like `enqueue_str`, but dedupes on `key` instead of the payload body.
    /// Use this when the payload embeds volatile fields (e.g. a scan
    /// timestamp) that would otherwise defeat content-hash dedup even though
    /// the underlying data is unchanged.
    pub fn enqueue_with_key(&self, key: &str, payload: &str) -> io::Result<PathBuf> {
        fs::create_dir_all(&self.dir)?;
        let name = format!("{:016x}.json", stable_hash(key));
        let path = self.dir.join(name);
        if !path.exists() {
            // A partial write must never become a replayable JSON item. Publish
            // a fully synced file with a no-clobber hard link on the same disk.
            let temp = self.dir.join(format!(".{}-{}-{}.tmp", stable_hash(key), std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
            let result = (|| {
                let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
                file.write_all(payload.as_bytes())?;
                file.sync_all()?;
                match fs::hard_link(&temp, &path) {
                    Ok(()) => Ok(()),
                    Err(err) if err.kind() == io::ErrorKind::AlreadyExists => Ok(()),
                    Err(err) => Err(err),
                }
            })();
            let _ = fs::remove_file(temp);
            result?;
        }
        Ok(path)
    }

    pub fn list(&self) -> io::Result<Vec<OutboxItem>> {
        if !self.dir.exists() {
            return Ok(Vec::new());
        }
        let mut paths = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let path = entry?.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                paths.push(path);
            }
        }
        paths.sort();
        paths
            .into_iter()
            .map(|path| {
                let payload = fs::read_to_string(&path)?;
                Ok(OutboxItem { path, payload })
            })
            .collect()
    }

    pub fn mark_uploaded(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }
}

fn stable_hash(value: &str) -> u64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn enqueue_dedupes_identical_payloads() {
        let dir = std::env::temp_dir().join(format!(
            "dac-outbox-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let outbox = Outbox::new(dir.clone());
        let payload = r#"{"match":{"match_id":"abc"},"players":[]}"#;

        let first = outbox.enqueue_str(payload).unwrap();
        let second = outbox.enqueue_str(payload).unwrap();

        assert_eq!(first, second);
        assert_eq!(outbox.list().unwrap().len(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn restart_preserves_first_payload_and_ignores_incomplete_writes() {
        let dir = std::env::temp_dir().join(format!("dac-outbox-atomic-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let outbox = Outbox::new(dir.clone());
        let path = outbox.enqueue_with_key("same-match", r#"{"played_at":"original"}"#).unwrap();
        fs::write(dir.join("interrupted.tmp"), "{").unwrap();
        let restarted = Outbox::new(dir.clone());
        assert_eq!(restarted.enqueue_with_key("same-match", r#"{"played_at":"later"}"#).unwrap(), path);
        let items = restarted.list().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].payload, r#"{"played_at":"original"}"#);
        fs::remove_dir_all(dir).unwrap();
    }
}
