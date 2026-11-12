use super::SupabaseClient;
use crate::{config::Config, outbox::Outbox, queen_ladder};
use serde_json::{json, Value};
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
    pub(crate) fn persist_fallback_request(cfg: &Config, body: &Value, timeline: Option<Value>) -> Result<PathBuf, String> {
        if cfg.local_only || super::parse_valid_steam_id64(&cfg.steam_id).is_none() {
            return Err("Cloud match sync requires a signed-in account and cloud mode".into());
        }
        let id = body["match"]["match_id"].as_str().ok_or("Missing fallback match ID")?;
        let envelope = json!({"kind":"fallback_ingest_v1", "steam_id":cfg.steam_id,
            "request":body, "timeline":timeline});
        Outbox::new(cfg.dac_dir.join("outbox"))
            .enqueue_with_key(&format!("fallback_ingest_v1:{}:{id}",cfg.steam_id), &envelope.to_string())
            .map_err(|err| format!("Could not save fallback for retry: {err}"))
    }

    pub(crate) fn send_persisted_fallback(&self, cfg: &Config, path: &Path) -> Result<String, String> {
        self.check_match_account(cfg)?;
        let value: Value = serde_json::from_str(&fs::read_to_string(path).map_err(|err| err.to_string())?)
            .map_err(|err| err.to_string())?;
        let id = self.replay_fallback_request(cfg, &value)?;
        Outbox::new(cfg.dac_dir.join("outbox")).mark_uploaded(path).map_err(|err| err.to_string())?;
        Ok(id)
    }

    fn replay_fallback_request(&self, cfg: &Config, envelope: &Value) -> Result<String, String> {
        self.check_match_account(cfg)?;
        let body = match_request_for_account(cfg, envelope)?;
        resolve_fallback_request(body, envelope.get("timeline").filter(|value| !value.is_null()),
            |ids, at| self.find_same_game_match_ids(ids, at, None, None),
            |request| self.invoke_match_ingest(request).map(|_| ()))
    }
    /// Durable, account-bound requests use only the authenticated ingest API.
    /// No bearer/refresh credentials are ever stored in an outbox item.
    pub(crate) fn persist_match_request(cfg: &Config, body: &Value) -> Result<PathBuf, String> {
        if cfg.local_only || super::parse_valid_steam_id64(&cfg.steam_id).is_none() {
            return Err("Cloud match sync requires a signed-in account and cloud mode".into());
        }
        let action = body["action"].as_str().unwrap_or("");
        let id = body["match"]["match_id"].as_str()
            .or_else(|| body["timeline"]["match_id"].as_str())
            .ok_or("Missing match ID")?;
        if !matches!(action, "ingest_match" | "upsert_timeline") {
            return Err("Unsupported match outbox action".into());
        }
        let envelope = json!({"kind":"match_ingest_v1", "steam_id": cfg.steam_id, "request": body});
        // Timeline updates can grow as later rounds arrive; dedupe by content.
        let key = if action == "upsert_timeline" { envelope.to_string() }
            else { format!("match_ingest_v1:{}:{action}:{id}", cfg.steam_id) };
        Outbox::new(cfg.dac_dir.join("outbox")).enqueue_with_key(&key, &envelope.to_string())
            .map_err(|err| format!("Could not save match for retry: {err}"))
    }

    pub(crate) fn send_persisted_match(&self, cfg: &Config, path: &Path) -> Result<(), String> {
        self.check_match_account(cfg)?;
        let payload = fs::read_to_string(path).map_err(|err| err.to_string())?;
        self.post_raw_payload(cfg, &payload)?;
        Outbox::new(cfg.dac_dir.join("outbox")).mark_uploaded(path).map_err(|err| err.to_string())
    }

    pub(super) fn persist_and_send_match(&self, body: &Value) -> Result<(), String> {
        let cfg = Config::load().map_err(|err| err.to_string())?;
        self.check_match_account(&cfg)?;
        let path = Self::persist_match_request(&cfg, body)?;
        self.send_persisted_match(&cfg, &path)
    }

    pub(super) fn check_match_account(&self, cfg: &Config) -> Result<(), String> {
        if cfg.local_only || self.url != cfg.supabase_url.trim_end_matches('/')
            || self.auth_token.as_deref() != Some(cfg.supabase_access_token.as_str())
            || cfg.supabase_access_token.is_empty() {
            return Err("Cloud session changed; retry with the current signed-in account".into());
        }
        Ok(())
    }
    pub fn replay_outbox(&self, cfg: &Config, outbox: &Outbox) -> io::Result<usize> {
        self.replay_outbox_summary(cfg, outbox)
            .map(|summary| summary.uploaded)
    }

    pub fn replay_outbox_summary(
        &self,
        cfg: &Config,
        outbox: &Outbox,
    ) -> io::Result<OutboxReplaySummary> {
        replay_items(outbox, |payload| self.post_raw_payload(cfg, payload))
    }

    fn post_raw_payload(&self, cfg: &Config, payload: &str) -> Result<(), String> {
        let value = serde_json::from_str::<Value>(payload).map_err(|err| err.to_string())?;
        if value.get("kind").and_then(Value::as_str) == Some("fallback_ingest_v1") {
            return self.replay_fallback_request(cfg, &value).map(|_| ());
        }
        if value.get("kind").and_then(Value::as_str) == Some("match_ingest_v1") {
            self.check_match_account(cfg)?;
            let body = match_request_for_account(cfg, &value)?;
            return self.invoke_match_ingest(body).map(|_| ());
        }
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

fn resolve_fallback_request(
    body: &Value,
    timeline: Option<&Value>,
    mut find: impl FnMut(&std::collections::BTreeSet<u64>, &str) -> Result<Vec<String>, String>,
    mut send: impl FnMut(&Value) -> Result<(), String>,
) -> Result<String, String> {
    let at = body["match"]["played_at"].as_str().ok_or("Missing captured timestamp")?;
    let fallback_id = body["match"]["match_id"].as_str().ok_or("Missing fallback match ID")?;
    let players = body["players"].as_array().ok_or("Missing fallback roster")?;
    let ids = players.iter().filter_map(|row| row["steam_id"].as_str())
        .filter_map(super::parse_valid_steam_id64).collect();
    // A failed lookup is not proof of absence. Keep the envelope and retry.
    let existing = find(&ids, at)?;
    let id = if let Some(id) = existing.first() { id.clone() } else {
        send(body)?;
        fallback_id.to_owned()
    };
    if let Some(timeline) = timeline {
        let mut resolved = timeline.clone();
        resolved["match_id"] = json!(id);
        send(&json!({"action":"upsert_timeline", "timeline":resolved}))?;
    }
    Ok(id)
}

fn replay_items(outbox: &Outbox, mut send: impl FnMut(&str) -> Result<(), String>) -> io::Result<OutboxReplaySummary> {
        let mut uploaded = 0;
        let mut failed = 0;
        let mut last_error = None;
        let items = outbox.list()?;
        let pending = items.len();
        for item in items {
            match send(&item.payload) {
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

fn match_request_for_account<'a>(cfg: &Config, envelope: &'a Value) -> Result<&'a Value, String> {
    if cfg.local_only || cfg.steam_id.is_empty()
        || envelope.get("steam_id").and_then(Value::as_str) != Some(cfg.steam_id.as_str()) {
        return Err("Queued match belongs to another account or cloud sync is disabled".into());
    }
    let body = &envelope["request"];
    if !matches!(body["action"].as_str(), Some("ingest_match" | "upsert_timeline")) {
        return Err("Unsupported match outbox action".into());
    }
    Ok(body)
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

    fn config_for_test(dir: PathBuf) -> Config {
        Config {
            dac_dir: dir, steam_id: "76561197960265729".into(), steam_name: String::new(),
            replay_enabled: true, keep_local_nettable_dumps: true, local_game_cache_max_gb: 1,
            local_only: false, supabase_url: "https://example.invalid".into(),
            supabase_key: "public-test-key".into(), supabase_auth_url: String::new(),
            supabase_access_token: "test-token".into(), supabase_refresh_token: String::new(),
            supabase_token_expires_at: String::new(),
        }
    }

    #[test]
    fn typed_match_queue_is_account_bound_and_freezes_identity_time() {
        let dir = std::env::temp_dir().join(format!("dac-match-account-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let mut cfg = config_for_test(dir.clone());
        let body = json!({"action":"ingest_match", "match":{"match_id":"stable", "played_at":"original"}, "players":[]});
        let first = SupabaseClient::persist_match_request(&cfg, &body).unwrap();
        let mut changed = body.clone();
        changed["match"]["played_at"] = json!("later");
        assert_eq!(SupabaseClient::persist_match_request(&cfg, &changed).unwrap(), first);
        let envelope: Value = serde_json::from_str(&fs::read_to_string(&first).unwrap()).unwrap();
        assert_eq!(match_request_for_account(&cfg, &envelope).unwrap(), &body);
        assert!(!fs::read_to_string(&first).unwrap().contains("test-token"));
        cfg.steam_id = "76561197960265730".into();
        assert!(match_request_for_account(&cfg, &envelope).is_err());
        cfg.local_only = true;
        assert!(SupabaseClient::persist_match_request(&cfg, &body).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stale_client_cannot_send_using_a_new_account_config() {
        let mut cfg = config_for_test(PathBuf::new());
        let client = SupabaseClient { url: cfg.supabase_url.clone(), key: cfg.supabase_key.clone(), auth_token: Some("old-token".into()) };
        assert!(client.check_match_account(&cfg).is_err());
        cfg.supabase_access_token = "old-token".into();
        assert!(client.check_match_account(&cfg).is_ok());
        cfg.local_only = true;
        assert!(client.check_match_account(&cfg).is_err());
    }

    #[test]
    fn fallback_restart_resolves_existing_game_and_retries_failed_timeline() {
        let dir = std::env::temp_dir().join(format!("dac-fallback-restart-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let cfg = config_for_test(dir.clone());
        let body = json!({"action":"ingest_match", "match":{"match_id":"fallback-id", "played_at":"2026-09-21T00:00:00Z"}, "players":[{"steam_id":"76561197960265729"},{"steam_id":"76561197960265730"}]});
        let queued = SupabaseClient::persist_fallback_request(&cfg, &body,
            Some(json!({"match_id":"fallback-id", "round_count":12}))).unwrap();
        let restarted = Outbox::new(cfg.dac_dir.join("outbox"));
        let find = |ids: &std::collections::BTreeSet<u64>, at: &str| {
            assert_eq!(ids.len(), 2);
            assert_eq!(at, "2026-09-21T00:00:00Z");
            Ok(vec!["canonical-end-board".to_owned()])
        };
        let attempt = |fail_timeline| replay_items(&restarted, |payload| {
            let envelope: Value = serde_json::from_str(payload).unwrap();
            let request = match_request_for_account(&cfg, &envelope)?;
            resolve_fallback_request(request, envelope.get("timeline"), find, |sent| {
                assert_eq!(sent["action"], "upsert_timeline");
                assert_eq!(sent["timeline"]["match_id"], "canonical-end-board");
                if fail_timeline { Err("transient".into()) } else { Ok(()) }
            }).map(|_| ())
        }).unwrap();
        assert_eq!(attempt(true).failed, 1);
        assert!(queued.exists());
        assert_eq!(attempt(false).uploaded, 1);
        assert!(!queued.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn fallback_lookup_failure_never_creates_a_duplicate() {
        let body = json!({"action":"ingest_match", "match":{"match_id":"fixed", "played_at":"2026-09-21T00:00:00Z"}, "players":[]});
        assert!(resolve_fallback_request(&body, None, |_, _| Err("offline".into()),
            |_| panic!("must not upload without successful dedup lookup")).is_err());
        let mut sent = Vec::new();
        let id = resolve_fallback_request(&body, None, |_, _| Ok(vec![]),
            |value| { sent.push(value.clone()); Ok(()) }).unwrap();
        assert_eq!(id, "fixed");
        assert_eq!(sent, vec![body]);
    }

    #[test]
    fn fallback_transient_match_failure_retries_exact_frozen_payload() {
        let body = json!({"action":"ingest_match", "match":{"match_id":"fixed", "played_at":"2026-09-21T00:00:00Z"}, "players":[]});
        let mut attempts = Vec::new();
        assert!(resolve_fallback_request(&body, None, |_, _| Ok(vec![]), |sent| {
            attempts.push(sent.clone()); Err("connection lost".into())
        }).is_err());
        assert_eq!(resolve_fallback_request(&body, None, |_, _| Ok(vec![]), |sent| {
            attempts.push(sent.clone()); Ok(())
        }).unwrap(), "fixed");
        assert_eq!(attempts, vec![body.clone(), body]);
    }

    #[test]
    fn replay_keeps_failed_timeline_across_restart_without_resending_match() {
        let dir = std::env::temp_dir().join(format!("dac-retry-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let outbox = Outbox::new(dir.clone());
        let match_body = r#"{"kind":"match_ingest_v1","request":{"action":"ingest_match","match":{"match_id":"stable-id","played_at":"2026-09-21T00:00:00Z"}}}"#;
        let timeline = r#"{"kind":"match_ingest_v1","request":{"action":"upsert_timeline","timeline":{"match_id":"stable-id"}}}"#;
        outbox.enqueue_str(match_body).unwrap();
        outbox.enqueue_str(timeline).unwrap();
        let result = replay_items(&outbox, |body| {
            if body == timeline { Err("temporary failure".into()) } else { assert_eq!(body, match_body); Ok(()) }
        }).unwrap();
        assert_eq!((result.uploaded, result.failed), (1, 1));
        let restarted = Outbox::new(dir.clone());
        assert_eq!(restarted.list().unwrap()[0].payload, timeline);
        let result = replay_items(&restarted, |body| { assert_eq!(body, timeline); Ok(()) }).unwrap();
        assert_eq!(result.uploaded, 1);
        assert!(restarted.list().unwrap().is_empty());
        assert_eq!(replay_items(&restarted, |_| panic!("already acknowledged")).unwrap().uploaded, 0);
        fs::remove_dir_all(dir).unwrap();
    }

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
