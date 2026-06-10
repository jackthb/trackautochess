use crate::{
    gsi,
    ipc_events::{
        event_json, NettableLaunchOptionsApplied as NettableLaunchOptionsAppliedEvent,
        NettableLaunchOptionsError, NettableSetupProgress,
    },
};
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

pub(crate) const DEFAULT_GSI_PORT: u16 = 4001;
pub(crate) const REQUIRED_LAUNCH_FLAGS: &[&str] =
    &["-condebug", "-conclearlog", "-gamestateintegration"];

const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;
const DOTA_APP_ID: &str = "570";
const AUTOEXEC_BLOCK: &str = r#"// >>> Track Auto Chess nettable capture >>>
bind "F20" "dumpstringtable CustomNetTable_player_id_table cl verbose"
bind "F21" "dumpstringtable CustomNetTable_dac_table cl verbose"
bind "F22" "dumpstringtable CustomNetTable_player_info_table cl verbose"
bind "F23" "dumpstringtable CustomNetTable_game_info cl verbose"
bind "F24" "dumpstringtable CustomNetTable_ranking_top_table cl verbose;dumpstringtable CustomNetTable_player_id_table cl verbose"
bind "F16" "dumpstringtable CustomNetTable_chess_pool_table cl verbose"
bind "F25" "dumpstringtable CustomNetTable_unit_table cl verbose"
// <<< Track Auto Chess nettable capture <<<
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LaunchOptionsApplied {
    pub(crate) ok: bool,
    pub(crate) noop: bool,
    pub(crate) before: String,
    pub(crate) after: String,
    pub(crate) added: Vec<String>,
    pub(crate) config_path: PathBuf,
    pub(crate) backup_path: Option<PathBuf>,
}

impl LaunchOptionsApplied {
    pub(crate) fn event_json(&self, autoexec: &Path, gsi_cfg: Option<&Path>) -> String {
        let config_path = self.config_path.display().to_string();
        let backup_path = self
            .backup_path
            .as_ref()
            .map(|path| path.display().to_string());
        let autoexec_path = autoexec.display().to_string();
        let gsi_cfg_path = gsi_cfg.map(|path| path.display().to_string());
        event_json(&NettableLaunchOptionsAppliedEvent {
            event_type: "nettable_launch_options_applied",
            backend: "rust",
            ok: self.ok,
            noop: self.noop,
            before: &self.before,
            after: &self.after,
            added: &self.added,
            config_path: &config_path,
            backup_path: backup_path.as_deref(),
            autoexec_path: &autoexec_path,
            gsi_cfg_path: gsi_cfg_path.as_deref(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LaunchOptionsValue {
    start: usize,
    end: usize,
    value: String,
}

pub(crate) fn find_dota_dir() -> Option<PathBuf> {
    if let Some(path) = env::var_os("DAC_DOTA_DIR").map(PathBuf::from) {
        if path.exists() {
            return Some(path);
        }
    }
    [
        r"C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta",
        r"C:\Program Files\Steam\steamapps\common\dota 2 beta",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|path| path.exists())
}

pub(crate) fn find_console_log() -> Option<PathBuf> {
    find_dota_dir()
        .map(|dir| dir.join("game/dota/console.log"))
        .filter(|path| path.exists())
}

pub(crate) fn setup_progress(event_type: &str, stage: &str, message: &str) -> String {
    event_json(&NettableSetupProgress::new(event_type, stage, message))
}

pub(crate) fn setup_result_error(message: &str) -> String {
    event_json(&NettableLaunchOptionsError::new(message))
}

pub(crate) fn tokenize_launch_options(opts: &str) -> Vec<String> {
    opts.split_whitespace()
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

pub(crate) fn apply_dota_launch_options(
    flags: &[&str],
    steam_id64: &str,
) -> Result<LaunchOptionsApplied, String> {
    if flags.is_empty() {
        return Err("No launch-option flags requested.".to_owned());
    }
    let account_id = steam_id64_to_account_id(steam_id64);
    let config_path = find_localconfig_vdf(account_id.as_deref()).ok_or_else(|| {
        "Couldn't find Steam's localconfig.vdf with a Dota 2 entry. Open Steam -> Dota 2 Properties once, then try again.".to_owned()
    })?;
    apply_dota_launch_options_to_file(&config_path, flags)
}

fn apply_dota_launch_options_to_file(
    config_path: &Path,
    flags: &[&str],
) -> Result<LaunchOptionsApplied, String> {
    let text = fs::read_to_string(config_path)
        .map_err(|err| format!("Couldn't read {}: {err}", config_path.display()))?;
    let (body_start, body_end) = find_app_block_bounds(&text, DOTA_APP_ID)
        .ok_or_else(|| "No Dota 2 (app 570) block found in localconfig.vdf.".to_owned())?;
    let body = &text[body_start..body_end];
    let field = find_launch_options_value(body);
    let before = field
        .as_ref()
        .map(|field| field.value.clone())
        .unwrap_or_default();
    let mut tokens = before
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut lower = tokenize_launch_options(&before);
    let mut added = Vec::new();
    for flag in flags {
        if !lower
            .iter()
            .any(|token| token == &flag.to_ascii_lowercase())
        {
            tokens.push((*flag).to_owned());
            lower.push(flag.to_ascii_lowercase());
            added.push((*flag).to_owned());
        }
    }
    let after = tokens.join(" ");
    if added.is_empty() {
        return Ok(LaunchOptionsApplied {
            ok: true,
            noop: true,
            before,
            after,
            added,
            config_path: config_path.to_owned(),
            backup_path: None,
        });
    }
    let new_body = if let Some(field) = field {
        format!("{}{}{}", &body[..field.start], after, &body[field.end..])
    } else {
        let indent = body
            .lines()
            .find_map(|line| line.find('"').map(|idx| &line[..idx]))
            .unwrap_or("\t\t\t\t\t");
        format!(
            "{}\n{indent}\"LaunchOptions\"\t\t\"{}\"\n",
            body.trim_end(),
            after
        )
    };
    let new_text = format!("{}{}{}", &text[..body_start], new_body, &text[body_end..]);
    let backup_path = config_path.with_extension(
        config_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{ext}.bak"))
            .unwrap_or_else(|| "bak".to_owned()),
    );
    fs::write(&backup_path, text)
        .map_err(|err| format!("Couldn't write {}: {err}", backup_path.display()))?;
    fs::write(config_path, new_text)
        .map_err(|err| format!("Couldn't write {}: {err}", config_path.display()))?;
    Ok(LaunchOptionsApplied {
        ok: true,
        noop: false,
        before,
        after,
        added,
        config_path: config_path.to_owned(),
        backup_path: Some(backup_path),
    })
}

fn find_launch_options_value(body: &str) -> Option<LaunchOptionsValue> {
    let key = body.find("\"LaunchOptions\"")?;
    let after_key = &body[key + "\"LaunchOptions\"".len()..];
    let first_quote = after_key.find('"')?;
    let value_start = key + "\"LaunchOptions\"".len() + first_quote + 1;
    let rest = &body[value_start..];
    let value_end = value_start + rest.find('"')?;
    Some(LaunchOptionsValue {
        start: value_start,
        end: value_end,
        value: body[value_start..value_end].to_owned(),
    })
}

fn find_app_block_bounds(text: &str, app_id: &str) -> Option<(usize, usize)> {
    let apps_idx = text.find("\"apps\"")?;
    let needle = format!("\"{app_id}\"");
    let mut cursor = apps_idx;
    while let Some(idx) = text[cursor..].find(&needle).map(|idx| cursor + idx) {
        let mut brace = idx + needle.len();
        while brace < text.len() && text.as_bytes()[brace].is_ascii_whitespace() {
            brace += 1;
        }
        if text.as_bytes().get(brace) != Some(&b'{') {
            cursor = idx + 1;
            continue;
        }
        let body_start = brace + 1;
        let mut depth = 1_i32;
        for (offset, ch) in text[body_start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some((body_start, body_start + offset));
                    }
                }
                _ => {}
            }
        }
        return None;
    }
    None
}

pub(crate) fn find_dota_launch_options(account_id: Option<&str>) -> Option<String> {
    let config_path = find_localconfig_vdf(account_id)?;
    let text = fs::read_to_string(config_path).ok()?;
    let (body_start, body_end) = find_app_block_bounds(&text, DOTA_APP_ID)?;
    let body = &text[body_start..body_end];
    Some(
        find_launch_options_value(body)
            .map(|field| field.value)
            .unwrap_or_default(),
    )
}

fn steam_id64_to_account_id(steam_id64: &str) -> Option<String> {
    let steam_id = steam_id64.trim().parse::<u64>().ok()?;
    steam_id
        .checked_sub(STEAM_ID64_BASE)
        .map(|account| account.to_string())
}

fn find_localconfig_vdf(account_id: Option<&str>) -> Option<PathBuf> {
    for steam_dir in candidate_steam_dirs() {
        let userdata = steam_dir.join("userdata");
        if let Some(account_id) = account_id {
            let path = userdata.join(account_id).join("config/localconfig.vdf");
            if localconfig_has_dota(&path) {
                return Some(path);
            }
        }
        for entry in fs::read_dir(&userdata).ok()?.flatten() {
            if account_id.is_some_and(|id| entry.file_name().to_string_lossy() == id) {
                continue;
            }
            let path = entry.path().join("config/localconfig.vdf");
            if localconfig_has_dota(&path) {
                return Some(path);
            }
        }
    }
    None
}

fn localconfig_has_dota(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| find_app_block_bounds(&text, DOTA_APP_ID))
        .is_some()
}

fn candidate_steam_dirs() -> Vec<PathBuf> {
    if let Some(path) = env::var_os("DAC_STEAM_DIR").map(PathBuf::from) {
        return vec![path];
    }
    vec![
        PathBuf::from(r"C:\Program Files (x86)\Steam"),
        PathBuf::from(r"C:\Program Files\Steam"),
    ]
}

pub(crate) fn find_gsi_cfg_target() -> Option<PathBuf> {
    find_dota_dir().map(|dir| {
        dir.join("game/dota/cfg/gamestate_integration/gamestate_integration_track_auto_chess.cfg")
    })
}

pub(crate) fn install_gsi_cfg(port: u16) -> io::Result<PathBuf> {
    let path = find_gsi_cfg_target()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Dota directory not found"))?;
    fs::create_dir_all(path.parent().unwrap())?;
    let desired = gsi::install_cfg_text(port);
    if fs::read_to_string(&path).ok().as_deref() != Some(desired.as_str()) {
        fs::write(&path, desired)?;
    }
    if let Some(old_path) = path.parent().map(|dir| {
        let legacy_name = ["gamestate_integration", "dac", "tracker.cfg"].join("_");
        dir.join(legacy_name)
    }) {
        if old_path != path {
            let _ = fs::remove_file(old_path);
        }
    }
    Ok(path)
}

#[cfg(target_os = "windows")]
pub(crate) fn is_steam_running() -> bool {
    if env::var_os("DAC_TEST_NO_STEAM_SHUTDOWN").is_some() {
        return false;
    }
    process_running("steam.exe")
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn is_steam_running() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn process_running(image_name: &str) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {image_name}"), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .to_ascii_lowercase()
                .contains(&image_name.to_ascii_lowercase())
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
pub(crate) fn request_steam_shutdown() -> bool {
    if env::var_os("DAC_TEST_NO_STEAM_SHUTDOWN").is_some() {
        return false;
    }
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    candidate_steam_dirs()
        .into_iter()
        .map(|dir| dir.join("steam.exe"))
        .find(|path| path.exists())
        .and_then(|path| {
            std::process::Command::new(path)
                .arg("-shutdown")
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .ok()
        })
        .is_some()
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn request_steam_shutdown() -> bool {
    false
}

pub(crate) fn wait_for_steam_exit(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !is_steam_running() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    !is_steam_running()
}

pub(crate) fn find_autoexec_target() -> Option<PathBuf> {
    find_dota_dir().map(|dir| dir.join("game/dota/cfg/autoexec.cfg"))
}

pub(crate) fn install_autoexec() -> io::Result<PathBuf> {
    let path = find_autoexec_target()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Dota directory not found"))?;
    fs::create_dir_all(path.parent().unwrap())?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    const OLD_START: &str = concat!("// >>> ", "DAC ", "Tracker", " nettable capture >>>");
    const OLD_END: &str = concat!("// <<< ", "DAC ", "Tracker", " nettable capture <<<");
    const START: &str = "// >>> Track Auto Chess nettable capture >>>";
    const END: &str = "// <<< Track Auto Chess nettable capture <<<";
    let block_bounds = existing
        .find(START)
        .and_then(|start| existing.find(END).map(|end| (start, end, END.len())))
        .or_else(|| {
            existing.find(OLD_START).and_then(|start| {
                existing
                    .find(OLD_END)
                    .map(|end| (start, end, OLD_END.len()))
            })
        });
    let next = if let Some((start, end, end_len)) = block_bounds {
        let end = end + end_len;
        format!(
            "{}{}{}",
            &existing[..start],
            AUTOEXEC_BLOCK,
            &existing[end..]
        )
    } else {
        format!("{}\n{}", existing.trim_end(), AUTOEXEC_BLOCK)
    };
    fs::write(&path, next)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_options_are_added_without_duplicates() {
        let path = std::env::temp_dir().join(format!(
            "dac-localconfig-{}-{}.vdf",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::write(
            &path,
            r#""UserLocalConfigStore"
{
    "apps"
    {
        "570"
        {
            "LaunchOptions"        "-console -condebug"
        }
    }
}
"#,
        )
        .expect("write localconfig fixture");

        let result = apply_dota_launch_options_to_file(&path, REQUIRED_LAUNCH_FLAGS)
            .expect("launch options apply");
        let updated = fs::read_to_string(&path).expect("read updated localconfig");
        let _ = fs::remove_file(&path);
        if let Some(backup) = result.backup_path.as_ref() {
            let _ = fs::remove_file(backup);
        }

        assert_eq!(result.added, vec!["-conclearlog", "-gamestateintegration"]);
        assert!(updated.contains("-console -condebug -conclearlog -gamestateintegration"));
        assert_eq!(updated.matches("-condebug").count(), 1);
    }
}
