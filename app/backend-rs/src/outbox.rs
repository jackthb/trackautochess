use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct Outbox {
    dir: PathBuf,
}

#[allow(dead_code)]
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
        fs::create_dir_all(&self.dir)?;
        let name = format!("{:016x}.json", stable_hash(payload));
        let path = self.dir.join(name);
        if !path.exists() {
            fs::write(&path, payload)?;
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

    #[allow(dead_code)]
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
}
