use super::{matches::nettable_row_json, DiagnosticUploadSummary, SupabaseClient};
use crate::{config::Config, nettable_parser::NettableRow};
use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

impl SupabaseClient {
    pub fn upload_nettable_dump_log(
        &self,
        cfg: &Config,
        rows: &[NettableRow],
    ) -> Result<usize, String> {
        if rows.is_empty() {
            return Ok(0);
        }
        let row_values = rows.iter().map(nettable_row_json).collect::<Vec<_>>();
        self.upload_end_board_rows(&row_values)?;
        self.upload_nettable_rows_blob(cfg, &row_values)?;
        Ok(rows.len())
    }

    pub(super) fn upload_nettable_rows_blob(
        &self,
        cfg: &Config,
        rows: &[Value],
    ) -> Result<String, String> {
        let user_id = cfg.steam_id.trim();
        if user_id.is_empty() {
            return Err("nettable dump logging needs steam_id for storage path".to_owned());
        }
        let captured_at = chrono::Utc::now();
        let mut tables = rows
            .iter()
            .filter_map(|row| row.get("table_name").and_then(Value::as_str))
            .collect::<Vec<_>>();
        tables.sort_unstable();
        tables.dedup();
        let body = json!({
            "kind": "nettable_dump_log",
            "captured_at": captured_at.to_rfc3339(),
            "tables": tables,
            "rows": rows,
        });
        let bytes = serde_json::to_vec_pretty(&body).map_err(|err| err.to_string())?;
        self.upload_storage_object(
            &format!(
                "{user_id}/nettable-dumps/{}.json",
                captured_at.format("%Y%m%d_%H%M%S_%6f")
            ),
            &bytes,
            "application/json",
            true,
        )?;
        Ok(format!("{} rows", rows.len()))
    }

    pub fn upload_diagnostic_logs(
        &self,
        cfg: &Config,
        reason: &str,
        console_path: Option<PathBuf>,
    ) -> Result<DiagnosticUploadSummary, String> {
        let user_id = cfg.steam_id.trim();
        if user_id.is_empty() {
            return Err("diagnostic upload needs steam_id for storage path".to_owned());
        }
        let session = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
        let tracker_data = env::var_os("TRACK_AUTO_CHESS_LOG_PATH")
            .map(PathBuf::from)
            .and_then(|path| read_file_bytes(&path))
            .unwrap_or_default();
        let console_data = console_path
            .as_deref()
            .and_then(read_file_bytes)
            .unwrap_or_default();

        let mut paths = serde_json::Map::new();
        let mut storage_ok = true;
        if !tracker_data.is_empty() {
            match self.upload_storage_object(
                &format!("{user_id}/{session}/tracker.log"),
                &tracker_data,
                "text/plain; charset=utf-8",
                true,
            ) {
                Ok(path) => {
                    paths.insert("tracker_log".to_owned(), json!(path));
                }
                Err(_) => storage_ok = false,
            }
        }
        if !console_data.is_empty() {
            match self.upload_storage_object(
                &format!("{user_id}/{session}/console.log"),
                &console_data,
                "text/plain; charset=utf-8",
                true,
            ) {
                Ok(path) => {
                    paths.insert("console_log".to_owned(), json!(path));
                }
                Err(_) => storage_ok = false,
            }
        }

        Ok(DiagnosticUploadSummary {
            reason: reason.to_owned(),
            storage_ok,
            paths: Value::Object(paths),
            tracker_bytes: tracker_data.len(),
            console_bytes: console_data.len(),
            console_found: console_path.is_some(),
        })
    }
}

fn read_file_bytes(path: &Path) -> Option<Vec<u8>> {
    fs::read(path).ok().filter(|data| !data.is_empty())
}
