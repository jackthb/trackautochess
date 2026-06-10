use super::{matches::nettable_row_json, SupabaseClient};
use crate::{config::Config, nettable_parser::NettableRow, outbox::Outbox};
use serde_json::{json, Value};
use std::{io, path::PathBuf};

impl SupabaseClient {
    pub fn replay_outbox(&self, cfg: &Config, outbox: &Outbox) -> io::Result<usize> {
        let mut uploaded = 0;
        for item in outbox.list()? {
            match self.post_raw_payload(cfg, &item.payload) {
                Ok(()) => {
                    outbox.mark_uploaded(&item.path)?;
                    uploaded += 1;
                }
                Err(_) => {}
            }
        }
        Ok(uploaded)
    }

    fn post_raw_payload(&self, cfg: &Config, payload: &str) -> Result<(), String> {
        let value = serde_json::from_str::<Value>(payload).map_err(|err| err.to_string())?;
        let table = value.get("table").and_then(Value::as_str).unwrap_or("");
        let body = value
            .get("rows")
            .or_else(|| value.get("payload"))
            .unwrap_or(&value);
        if table.is_empty() || table == "dac_nettable_dumps" {
            if let Some(rows) = body.as_array() {
                let _ = self.upload_end_board_rows(rows);
                self.upload_nettable_rows_blob(cfg, rows)?;
            }
            return Ok(());
        }
        self.post_json(&format!("/rest/v1/{table}"), body, "return=minimal")
    }
}

pub fn queue_rows(outbox_dir: PathBuf, rows: &[NettableRow]) -> io::Result<Option<PathBuf>> {
    if rows.is_empty() {
        return Ok(None);
    }
    let outbox = Outbox::new(outbox_dir);
    let payload = json!({
        "kind": "nettable_rows",
        "rows": rows.iter().map(nettable_row_json).collect::<Vec<_>>()
    });
    outbox.enqueue_str(&payload.to_string()).map(Some)
}
