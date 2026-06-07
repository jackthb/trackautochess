mod config;
mod gsi;
mod nettable_parser;
mod nettable_tail;
mod outbox;

use config::Config;
use nettable_tail::NettableTailer;
use outbox::Outbox;
use std::{
    env, fs,
    io::{self, BufRead, Write},
    path::PathBuf,
    time::Duration,
};

fn main() -> io::Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let command = args.first().map(String::as_str).unwrap_or("daemon");
    match command {
        "daemon" => run_daemon(),
        "parse-log" => {
            let path = args.get(1).map(PathBuf::from).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "parse-log needs a path")
            })?;
            let rows = nettable_parser::extract_rows(&path)?;
            println!("{}", rows_json(&rows));
            Ok(())
        }
        "queue" => {
            let path = args.get(1).map(PathBuf::from).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "queue needs a payload path")
            })?;
            let cfg = Config::load()?;
            let outbox = Outbox::new(cfg.dac_dir.join("outbox"));
            let body = fs::read_to_string(path)?;
            println!("{}", outbox.enqueue_str(&body)?.display());
            Ok(())
        }
        "outbox-list" => {
            let cfg = Config::load()?;
            let outbox = Outbox::new(cfg.dac_dir.join("outbox"));
            for item in outbox.list()? {
                println!("{}	{} bytes", item.path.display(), item.payload.len());
            }
            Ok(())
        }
        "gsi-cfg" => {
            println!("{}", gsi::install_cfg_text(gsi::DEFAULT_PORT));
            Ok(())
        }
        other => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown command: {other}"),
        )),
    }
}

fn run_daemon() -> io::Result<()> {
    let cfg = Config::load()?;
    let outbox = Outbox::new(cfg.dac_dir.join("outbox"));
    let _gsi = gsi::GsiServer::spawn(gsi::DEFAULT_PORT).ok();
    emit(&format!(
        r#"{{"type":"status","backend":"rust","recording":false,"focused":false,"logged_in":{},"steam_id":{},"steam_name":{},"replay_enabled":{}}}"#,
        if cfg.steam_id.is_empty() {
            "false"
        } else {
            "true"
        },
        json_string(&cfg.steam_id),
        json_string(&cfg.steam_name),
        if cfg.replay_enabled { "true" } else { "false" }
    ))?;

    for line in io::stdin().lock().lines() {
        let line = line?;
        let cmd = json_string_field(&line, "cmd").unwrap_or_default();
        match cmd.as_str() {
            "quit" => break,
            "status" => {
                emit(r#"{"type":"status","backend":"rust","recording":false,"focused":false}"#)?
            }
            "queue_ingest" | "queue_payload" => {
                let payload =
                    json_object_field(&line, "payload").unwrap_or_else(|| "{}".to_owned());
                let path = outbox.enqueue_str(&payload)?;
                emit(&format!(
                    r#"{{"type":"payload_queued","path":{}}}"#,
                    json_string(&path.display().to_string())
                ))?;
            }
            "set_config" => {
                if let Some(key) = json_string_field(&line, "key") {
                    let value = json_field_raw(&line, "value").unwrap_or_else(|| "null".to_owned());
                    cfg.save_value(&key, &value)?;
                    emit(&format!(r#"{{"type":"config_updated","key":{}}}"#, json_string(&key)))?;
                } else {
                    emit_error("set_config missing key")?;
                }
            }
            "steam_logout" => {
                cfg.save_value("steam_id", "\"\"")?;
                cfg.save_value("steam_name", "\"\"")?;
                emit(r#"{"type":"steam_logout"}"#)?;
            }
            "steam_login" => emit_error("steam_login is not migrated to Rust yet; use DAC_BACKEND=python for Steam OAuth")?,
            "toggle_recording" => emit_error("Replay recording is not migrated to Rust yet; use DAC_BACKEND=python for recording")?,
            "nettable_status" => emit(r#"{"type":"nettable_status","backend":"rust","ok":true}"#)?,
            "nettable_get_state" => emit(r#"{"type":"nettable_state","backend":"rust","rows":[]}"#)?,
            "nettable_apply_launch_options" => emit_error("Launch-option mutation is not migrated to Rust yet")?,
            "nettable_set_paused" => emit(r#"{"type":"nettable_paused","backend":"rust"}"#)?,
            "nettable_upload_queens" => emit(r#"{"type":"nettable_queen_upload_complete","ok":false,"player_count":0,"upserted_count":0,"error":"Queen upload is not migrated to Rust yet."}"#)?,
            "upload_logs" => emit_error("Log upload is not migrated to Rust yet")?,
            "do_update" => emit_error("Auto-update apply is not migrated to Rust yet")?,
            "parse_log" => {
                if let Some(path) = json_string_field(&line, "path") {
                    match nettable_parser::extract_rows(PathBuf::from(path).as_path()) {
                        Ok(rows) => emit(&format!(
                            r#"{{"type":"nettable_rows","rows":{}}}"#,
                            rows_json(&rows)
                        ))?,
                        Err(err) => emit_error(&format!("parse_log failed: {err}"))?,
                    }
                } else {
                    emit_error("parse_log missing path")?;
                }
            }
            "tail_log_once" => {
                if let Some(path) = json_string_field(&line, "path") {
                    let mut tailer = NettableTailer::new(PathBuf::from(path));
                    match tailer.poll() {
                        Ok(Some(rows)) => emit(&format!(
                            r#"{{"type":"nettable_rows","rows":{}}}"#,
                            rows_json(&rows)
                        ))?,
                        Ok(None) => emit(r#"{"type":"nettable_rows","rows":[]}"#)?,
                        Err(err) => emit_error(&format!("tail_log_once failed: {err}"))?,
                    }
                } else {
                    emit_error("tail_log_once missing path")?;
                }
            }
            "" => emit_error("missing cmd")?,
            other => emit_error(&format!("unknown command: {other}"))?,
        }
    }
    Ok(())
}

fn rows_json(rows: &[nettable_parser::NettableRow]) -> String {
    format!(
        "[{}]",
        rows.iter()
            .map(|row| format!(
                r#"{{"table_name":{},"key":{},"raw":{}}}"#,
                json_string(&row.table_name),
                json_string(&row.key),
                row.raw.to_json()
            ))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn json_string(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

fn json_string_field(body: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let start = rest.find('"')? + 1;
    let mut out = String::new();
    let mut escaped = false;
    for ch in rest[start..].chars() {
        if escaped {
            out.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

fn json_field_raw(body: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let value = rest.trim_start();
    if value.starts_with('{') {
        return json_object_field(body, key);
    }
    if value.starts_with('"') {
        return json_string_field(body, key).map(|v| json_string(&v));
    }
    let end = value
        .find(|ch: char| ch == ',' || ch == '}')
        .unwrap_or(value.len());
    Some(value[..end].trim().to_owned())
}

fn json_object_field(body: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let start = rest.find('{')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (idx, ch) in rest[start..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if in_string {
            if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(rest[start..start + idx + 1].to_owned());
                }
            }
            _ => {}
        }
    }
    None
}

fn emit(line: &str) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    stdout.write_all(line.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

fn emit_error(message: &str) -> io::Result<()> {
    emit(&format!(
        r#"{{"type":"error","message":{}}}"#,
        json_string(message)
    ))
}

#[allow(dead_code)]
fn sleep_interval() -> Duration {
    Duration::from_millis(250)
}
