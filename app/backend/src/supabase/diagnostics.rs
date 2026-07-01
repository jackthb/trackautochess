use super::{DiagnosticUploadSummary, SupabaseClient};
use crate::config::Config;
use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

impl SupabaseClient {
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
