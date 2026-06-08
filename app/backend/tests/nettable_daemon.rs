use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn daemon_covers_status_parse_tail_and_error_paths() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/nettable_golden/all_tables_tracking_30_rounds/console.log");
    let temp_dir = temp_dir("daemon-paths");

    let mut child = Command::new(env!("CARGO_BIN_EXE_dac-capture-backend"))
        .arg("daemon")
        .env("DAC_DIR", &temp_dir)
        .env("DAC_TEST_NO_STEAM_SHUTDOWN", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn backend daemon");

    let mut stdin = child.stdin.take().expect("daemon stdin should be piped");
    let stdout = child.stdout.take().expect("daemon stdout should be piped");
    let mut stdout = BufReader::new(stdout);

    let startup = read_json_line_of_type(&mut stdout, "status");
    assert_eq!(startup["type"], "status");
    assert_eq!(startup["backend"], "rust");

    send(&mut stdin, json!({"cmd":"status"}));
    let status = read_json_line_of_type(&mut stdout, "status");
    assert_eq!(status["type"], "status");
    assert_eq!(status["backend"], "rust");

    send(&mut stdin, json!({"cmd":"nettable_status"}));
    let nettable_status = read_json_line_of_type(&mut stdout, "nettable_status");
    assert_eq!(nettable_status["type"], "nettable_status");
    assert_eq!(nettable_status["ok"], true);
    assert_nettable_status_contract(&nettable_status);

    send(&mut stdin, json!({"cmd":"nettable_get_state"}));
    let state = read_json_line_of_type(&mut stdout, "nettable_state");
    assert_eq!(state["type"], "nettable_state");
    assert_eq!(state["rows"].as_array().unwrap().len(), 0);
    assert_nettable_state_contract(&state);

    send(&mut stdin, json!({"cmd":"parse_log", "path": fixture}));
    let parsed = read_json_line_of_type(&mut stdout, "nettable_rows");
    assert_eq!(parsed["type"], "nettable_rows");
    assert_eq!(parsed["rows"].as_array().unwrap().len(), 40);
    assert_round_rows(&parsed["rows"]);

    send(&mut stdin, json!({"cmd":"tail_log_once", "path": fixture}));
    let tailed = read_json_line_of_type(&mut stdout, "nettable_rows");
    assert_eq!(tailed["type"], "nettable_rows");
    assert_eq!(tailed["rows"].as_array().unwrap().len(), 40);

    send(&mut stdin, json!({"cmd":"tail_log_once"}));
    let missing_path = read_json_line_of_type(&mut stdout, "error");
    assert_eq!(missing_path["type"], "error");
    assert!(missing_path["message"]
        .as_str()
        .unwrap()
        .contains("missing path"));

    send(&mut stdin, json!({"cmd":"nettable_apply_launch_options"}));
    let setup = read_json_line_until(&mut stdout, |value| {
        value["type"] == "nettable_launch_options_applied"
            || value["type"] == "nettable_ingest_error"
    });
    assert!(
        setup["type"] == "nettable_launch_options_applied"
            || setup["type"] == "nettable_ingest_error",
        "unexpected launch setup response: {setup:?}"
    );
    if setup["type"] == "nettable_ingest_error" {
        assert!(
            setup.get("error").and_then(Value::as_str).is_some(),
            "ingest error should use the frontend-compatible error field: {setup:?}"
        );
    }

    send(&mut stdin, json!({"cmd":"definitely_unknown"}));
    let unknown = read_json_line_of_type(&mut stdout, "error");
    assert_eq!(unknown["type"], "error");
    assert!(unknown["message"]
        .as_str()
        .unwrap()
        .contains("unknown command"));

    send(&mut stdin, json!({"cmd":"quit"}));
    wait_for_exit(&mut child);
    let _ = fs::remove_dir_all(temp_dir);
}

fn assert_round_rows(rows: &Value) {
    let rows = rows.as_array().expect("rows should be array");
    for round in 1..=30 {
        let key = format!("round_{round:02}");
        let row = rows
            .iter()
            .find(|row| row["table_name"] == "CustomNetTable_game_info" && row["key"] == key)
            .unwrap_or_else(|| panic!("missing {key}"));
        assert_eq!(row["raw"]["round"], round);
    }
    assert!(rows
        .iter()
        .any(|row| row["key"] == "tracking_start" && row["raw"]["state"] == "tracking_started"));
    assert!(rows
        .iter()
        .any(|row| row["key"] == "tracking_lost" && row["raw"]["state"] == "tracking_lost"));
    assert!(!rows.iter().any(|row| row["table_name"] == "ModifierNames"));
}

fn assert_nettable_status_contract(status: &Value) {
    for key in [
        "autoexec_installed",
        "log_path",
        "log_writable",
        "remote_enabled",
        "launch_options",
        "has_condebug",
        "has_conclearlog",
        "has_gamestateintegration",
        "steam_running",
        "dota_running",
        "log_active",
        "paused",
    ] {
        assert!(
            status.get(key).is_some(),
            "nettable_status missing frontend field {key}: {status:?}"
        );
    }
    for key in [
        "autoexec_installed",
        "log_writable",
        "remote_enabled",
        "steam_running",
        "dota_running",
        "log_active",
        "paused",
    ] {
        assert!(
            status[key].is_boolean(),
            "nettable_status field {key} should be boolean: {status:?}"
        );
    }
    assert!(
        status["log_path"].is_string(),
        "nettable_status log_path should be string: {status:?}"
    );
}

fn assert_nettable_state_contract(state: &Value) {
    assert!(
        state["state"].is_object(),
        "nettable_state state should be object: {state:?}"
    );
    assert!(
        state["players"].is_object(),
        "nettable_state players should be object: {state:?}"
    );
    assert!(
        state["local_steam_ids"].is_array(),
        "nettable_state local_steam_ids should be array: {state:?}"
    );
    assert!(
        state["at"].is_string(),
        "nettable_state at should be string: {state:?}"
    );
}

fn send(stdin: &mut ChildStdin, payload: Value) {
    writeln!(stdin, "{payload}").expect("failed to write daemon command");
    stdin.flush().expect("failed to flush daemon command");
}

fn read_json_line(stdout: &mut BufReader<ChildStdout>) -> Value {
    let mut line = String::new();
    stdout
        .read_line(&mut line)
        .expect("failed to read daemon stdout");
    assert!(!line.is_empty(), "daemon stdout closed unexpectedly");
    serde_json::from_str(&line).unwrap_or_else(|err| panic!("invalid daemon JSON {line:?}: {err}"))
}

fn read_json_line_of_type(stdout: &mut BufReader<ChildStdout>, expected_type: &str) -> Value {
    read_json_line_until(stdout, |value| value["type"] == expected_type)
}

fn read_json_line_until(
    stdout: &mut BufReader<ChildStdout>,
    mut accept: impl FnMut(&Value) -> bool,
) -> Value {
    for _ in 0..20 {
        let value = read_json_line(stdout);
        if accept(&value) {
            return value;
        }
    }
    panic!("daemon did not emit expected event");
}

fn wait_for_exit(child: &mut Child) {
    let status = child.wait().expect("failed to wait for daemon");
    assert!(status.success(), "daemon exited with {status}");
}

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("dac-{name}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&path).expect("failed to create temp dir");
    path
}
