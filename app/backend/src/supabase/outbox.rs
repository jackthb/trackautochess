use super::SupabaseClient;
use crate::{config::Config, outbox::Outbox, queen_ladder};
use serde_json::Value;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

const LEGACY_MATCH_OUTBOX: &str = "legacy_match_outbox:";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboxReplaySummary {
    pub pending: usize,
    pub uploaded: usize,
    pub failed: usize,
    pub last_error: Option<String>,
}

impl SupabaseClient {
    pub fn replay_outbox(&self, cfg: &Config, outbox: &Outbox) -> io::Result<usize> {
        self.replay_outbox_summary(cfg, outbox)
            .map(|summary| summary.uploaded)
    }

    pub fn replay_outbox_summary(
        &self,
        cfg: &Config,
        outbox: &Outbox,
    ) -> io::Result<OutboxReplaySummary> {
        let mut uploaded = 0;
        let mut failed = 0;
        let mut last_error = None;
        let items = outbox.list()?;
        let pending = items.len();
        for item in items {
            match self.post_raw_payload(cfg, &item.payload) {
                Ok(()) => {
                    outbox.mark_uploaded(&item.path)?;
                    uploaded += 1;
                }
                Err(err) => {
                    failed += 1;
                    if err.starts_with(LEGACY_MATCH_OUTBOX) {
                        let quarantined = quarantine_legacy_outbox(&item.path, &err)?;
                        last_error = Some(format!(
                            "legacy match payload moved to {} for manual recovery",
                            quarantined.display()
                        ));
                    } else {
                        last_error = Some(err);
                    }
                }
            }
        }
        Ok(OutboxReplaySummary {
            pending,
            uploaded,
            failed,
            last_error,
        })
    }

    fn post_raw_payload(&self, _cfg: &Config, payload: &str) -> Result<(), String> {
        let value = serde_json::from_str::<Value>(payload).map_err(|err| err.to_string())?;
        if let Some(players) = queen_ladder::parse_queen_ladder_outbox(&value) {
            if players.is_empty() {
                return Ok(());
            }
            let upserted = self.upsert_queen_ladder_players(&players)?;
            if upserted == 0 {
                return Err("Queen ladder outbox replay wrote 0 rows".to_owned());
            }
            return Ok(());
        }
        let table = value.get("table").and_then(Value::as_str).unwrap_or("");
        let body = value
            .get("rows")
            .or_else(|| value.get("payload"))
            .unwrap_or(&value);
        if table.is_empty() {
            // Only the end-board rows carry product data; legacy queued raw
            // captures are acked without uploading so stale outboxes drain.
            if let Some(rows) = body.as_array() {
                if rows.iter().any(is_end_board_row) {
                    self.upload_end_board_rows(rows)?;
                }
            }
            return Ok(());
        }
        if matches!(table, "matches" | "match_players" | "match_timelines") {
            return Err(format!("{LEGACY_MATCH_OUTBOX} direct {table} writes are disabled"));
        }
        self.post_json(&format!("/rest/v1/{table}"), body, "return=minimal")
    }
}

fn quarantine_legacy_outbox(path: &Path, reason: &str) -> io::Result<PathBuf> {
    let outbox_dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing outbox directory"))?;
    let quarantine_dir = outbox_dir.join("quarantine");
    fs::create_dir_all(&quarantine_dir)?;
    let file_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing outbox filename"))?;
    let destination = quarantine_dir.join(file_name);
    if destination.exists() {
        fs::remove_file(path)?;
    } else {
        fs::rename(path, &destination)?;
    }
    fs::write(destination.with_extension("error.txt"), reason)?;
    Ok(destination)
}

fn is_end_board_row(row: &Value) -> bool {
    row.get("table_name").and_then(Value::as_str) == Some("CustomNetTable_dac_table")
        && row.get("key").and_then(Value::as_str) == Some("end_board")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn legacy_match_payload_is_quarantined_outside_replay_directory() {
        let dir = std::env::temp_dir().join(format!(
            "dac-legacy-outbox-quarantine-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("legacy.json");
        fs::write(&path, r#"{"table":"matches"}"#).unwrap();

        let quarantined =
            quarantine_legacy_outbox(&path, "legacy_match_outbox: disabled").unwrap();

        assert_eq!(quarantined, dir.join("quarantine/legacy.json"));
        assert!(!path.exists());
        assert!(quarantined.exists());
        assert_eq!(
            fs::read_to_string(quarantined.with_extension("error.txt")).unwrap(),
            "legacy_match_outbox: disabled"
        );
        let _ = fs::remove_dir_all(dir);
    }
}

