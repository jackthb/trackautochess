use super::SupabaseClient;
use crate::{config::Config, outbox::Outbox};
use serde_json::Value;
use std::io;

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
                    last_error = Some(err);
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
        self.post_json(&format!("/rest/v1/{table}"), body, "return=minimal")
    }
}

fn is_end_board_row(row: &Value) -> bool {
    row.get("table_name").and_then(Value::as_str) == Some("CustomNetTable_dac_table")
        && row.get("key").and_then(Value::as_str) == Some("end_board")
}

