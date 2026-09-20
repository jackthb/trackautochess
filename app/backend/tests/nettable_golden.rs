use serde_json::Value;
use std::{fs, path::Path, process::Command};

#[test]
fn parser_matches_golden_fixtures() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/nettable_golden");
    let mut cases = Vec::new();
    collect_cases(&root, &mut cases);
    assert!(
        !cases.is_empty(),
        "no nettable golden fixtures found under {}",
        root.display()
    );

    for case_dir in cases {
        assert_command_json_eq(&case_dir, "parse-log-full", "expected_decoded.json");
        assert_command_json_eq(&case_dir, "parse-log", "expected_rows.json");
    }

    assert_tracking_coverage(&root.join("all_tables_tracking_30_rounds"));
    assert_loss_coverage(&root.join("tracking_repeat_and_loss"));
    assert_player_info_colon_coverage(&root.join("player_info_colon_buffs"));
}

/// Regression guard for the live HP/lineup table.
///
/// `player_info_table` dumps as a VBKV blob whose ASCII column contains ':'
/// (buff strings like "is_warlock:1"). A parser that tests for a "key :" line
/// before the ">>" data line misreads those data lines as new keys, drops the
/// whole table, and silently loses all live player state. This fixture is a
/// anonymized captured dump; assert the table decodes into per-player data.
fn assert_player_info_colon_coverage(case_dir: &Path) {
    let decoded = read_json(&case_dir.join("expected_decoded.json"));
    let data = decoded
        .get("CustomNetTable_player_info_table")
        .and_then(|t| t.get("player_info"))
        .and_then(|p| p.get("data"))
        .and_then(Value::as_object)
        .unwrap_or_else(|| {
            panic!(
                "{} must decode player_info_table.player_info.data — the colon-in-ASCII bug drops it",
                case_dir.display()
            )
        });
    assert!(
        !data.is_empty(),
        "player_info data should contain at least one player"
    );
    let player = data
        .values()
        .next()
        .and_then(Value::as_object)
        .expect("player entry should be an object");
    assert!(
        player.contains_key("hp"),
        "decoded player should carry live hp"
    );
    let buff = player
        .get("buff")
        .and_then(Value::as_str)
        .expect("decoded player should carry a buff string");
    assert!(
        buff.contains(':'),
        "fixture must exercise the colon path: buff was {buff:?}"
    );

    // The rows projection must surface the table too (not just the decoded map).
    let rows = read_json(&case_dir.join("expected_rows.json"));
    assert!(
        rows.as_array()
            .expect("rows fixture should be array")
            .iter()
            .any(|row| { row["table_name"] == "CustomNetTable_player_info_table" }),
        "rows output should include player_info_table"
    );
}

fn assert_tracking_coverage(case_dir: &Path) {
    let decoded = read_json(&case_dir.join("expected_decoded.json"));
    let rows = read_json(&case_dir.join("expected_rows.json"));

    let decoded_obj = decoded
        .as_object()
        .expect("decoded fixture should be object");
    for table in [
        "CustomNetTable_dac_table",
        "CustomNetTable_game_info",
        "CustomNetTable_player_id_table",
        "CustomNetTable_ranking_top_table",
        "ModifierNames",
    ] {
        assert!(
            decoded_obj.contains_key(table),
            "{} should include decoded table {table}",
            case_dir.display()
        );
    }

    let game_info = decoded["CustomNetTable_game_info"]
        .as_object()
        .expect("game_info should be object");
    assert_eq!(game_info["tracking_start"]["state"], "tracking_started");
    assert_eq!(game_info["tracking_lost"]["state"], "tracking_lost");
    for round in 1..=30 {
        let key = format!("round_{round:02}");
        assert_eq!(game_info[&key]["round"], round, "missing {key}");
    }

    let row_tables = rows
        .as_array()
        .expect("rows fixture should be array")
        .iter()
        .map(|row| {
            row["table_name"]
                .as_str()
                .expect("table_name should be string")
        })
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        row_tables,
        std::collections::BTreeSet::from([
            "CustomNetTable_dac_table",
            "CustomNetTable_game_info",
            "CustomNetTable_player_id_table",
            "CustomNetTable_ranking_top_table",
        ])
    );
    assert!(
        !row_tables.contains("ModifierNames"),
        "row output should filter non-CustomNetTable tables"
    );
}

fn assert_loss_coverage(case_dir: &Path) {
    let decoded = read_json(&case_dir.join("expected_decoded.json"));
    let game_info = decoded["CustomNetTable_game_info"]
        .as_object()
        .expect("game_info should be object");
    assert_eq!(game_info["tracking_start_a"], game_info["tracking_start_b"]);
    assert_eq!(game_info["tracking_lost"]["state"], "tracking_lost");
    assert_eq!(
        game_info["tracking_lost"]["reason"],
        "console_log_missing_then_restored"
    );
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap())
        .unwrap_or_else(|err| panic!("failed to parse {}: {err}", path.display()))
}

fn assert_command_json_eq(case_dir: &Path, command: &str, expected_file: &str) {
    let input = case_dir.join("console.log");
    let expected_path = case_dir.join(expected_file);
    let expected = read_json(&expected_path);

    let output = Command::new(env!("CARGO_BIN_EXE_dac-capture-backend"))
        .arg(command)
        .arg(&input)
        .output()
        .unwrap_or_else(|err| panic!("failed to run {command} for {}: {err}", input.display()));
    assert!(
        output.status.success(),
        "{command} failed for {}\nstdout:\n{}\nstderr:\n{}",
        input.display(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let mut actual: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|err| {
        panic!(
            "{command} emitted invalid JSON for {}: {err}",
            input.display()
        )
    });
    let mut expected = expected;
    if expected_file == "expected_rows.json" {
        sort_rows(&mut actual);
        sort_rows(&mut expected);
    }
    assert_json_eq(
        &actual,
        &expected,
        &format!("{} ({command})", case_dir.display()),
    );
}

fn sort_rows(value: &mut Value) {
    let rows = value
        .as_array_mut()
        .expect("rows output should be an array");
    rows.sort_by(|a, b| {
        let a_key = format!(
            "{}\u{0}{}\u{0}{}",
            a["table_name"].as_str().unwrap_or_default(),
            a["key"].as_str().unwrap_or_default(),
            a["raw"]
        );
        let b_key = format!(
            "{}\u{0}{}\u{0}{}",
            b["table_name"].as_str().unwrap_or_default(),
            b["key"].as_str().unwrap_or_default(),
            b["raw"]
        );
        a_key.cmp(&b_key)
    });
}

fn collect_cases(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            if path.join("console.log").is_file()
                && path.join("expected_decoded.json").is_file()
                && path.join("expected_rows.json").is_file()
            {
                out.push(path);
            } else {
                collect_cases(&path, out);
            }
        }
    }
}

fn assert_json_eq(actual: &Value, expected: &Value, path: &str) {
    if path.ends_with("._decode_error") {
        assert!(
            actual.is_string() && expected.is_string(),
            "decode error mismatch at {path}: actual={actual:?} expected={expected:?}"
        );
        return;
    }
    match (actual, expected) {
        (Value::Number(a), Value::Number(e)) => {
            let a = a.as_f64().expect("actual JSON number should fit f64");
            let e = e.as_f64().expect("expected JSON number should fit f64");
            assert!(
                (a - e).abs() <= 0.000_01,
                "numeric mismatch at {path}: actual={a:?} expected={e:?}"
            );
        }
        (Value::Array(a), Value::Array(e)) => {
            assert_eq!(a.len(), e.len(), "array length mismatch at {path}");
            for (idx, (a, e)) in a.iter().zip(e.iter()).enumerate() {
                assert_json_eq(a, e, &format!("{path}[{idx}]"));
            }
        }
        (Value::Object(a), Value::Object(e)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                e.keys().collect::<Vec<_>>(),
                "object keys mismatch at {path}"
            );
            for (key, e) in e {
                assert_json_eq(&a[key], e, &format!("{path}.{key}"));
            }
        }
        _ => assert_eq!(actual, expected, "JSON mismatch at {path}"),
    }
}
