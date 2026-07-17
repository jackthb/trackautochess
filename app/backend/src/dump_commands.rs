use std::{thread, time::Duration};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{BOOL, FALSE, HWND, LPARAM, TRUE},
    System::Threading::{AttachThreadInput, GetCurrentThreadId},
    UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        },
        WindowsAndMessaging::{
            EnumWindows, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
            SetForegroundWindow, ShowWindow, SW_RESTORE,
        },
    },
};

#[derive(Debug, Clone, Copy)]
pub enum DumpKey {
    F16,
    F20,
    F21,
    F22,
    F23,
    F24,
}

#[cfg(target_os = "windows")]
impl DumpKey {
    fn virtual_key(self) -> u16 {
        match self {
            DumpKey::F16 => 0x7f,
            DumpKey::F20 => 0x83,
            DumpKey::F21 => 0x84,
            DumpKey::F22 => 0x85,
            DumpKey::F23 => 0x86,
            DumpKey::F24 => 0x87,
        }
    }
}

/// Send dump keys only if Dota already owns the foreground window.
/// Used for the live cadence so we never spam keys into other apps.
pub fn send_dump_keys_if_dota_focused(keys: &[DumpKey]) -> Result<(), String> {
    if !dota_has_foreground_focus() {
        return Err("Dota is not focused".to_owned());
    }
    send_dump_keys(keys)
}

/// Briefly force Dota to the foreground, send dump keys, then restore the
/// previous foreground window when possible.
///
/// Used for post-game `end_board` chase and manual "check active match" —
/// cases where missing the dump is worse than a short focus flash.
pub fn send_dump_keys_forcing_dota_focus(keys: &[DumpKey]) -> Result<(), String> {
    if dota_has_foreground_focus() {
        return send_dump_keys(keys);
    }

    #[cfg(target_os = "windows")]
    {
        let previous = unsafe { GetForegroundWindow() };
        focus_dota_window()?;
        // Give Windows a beat to actually transfer foreground ownership.
        thread::sleep(Duration::from_millis(75));
        if !dota_has_foreground_focus() {
            return Err("Could not bring Dota to the foreground for dump keys".to_owned());
        }
        let result = send_dump_keys(keys);
        if !previous.is_null() && previous != unsafe { GetForegroundWindow() } {
            let _ = force_foreground_window(previous);
        }
        return result;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = keys;
        Err("forcing Dota focus for dumps is only supported on Windows".to_owned())
    }
}

#[cfg(target_os = "windows")]
pub fn dota_has_foreground_focus() -> bool {
    let Some(dota_pid) = dota_process_id() else {
        return false;
    };
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return false;
    }
    let mut foreground_pid = 0_u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut foreground_pid);
    }
    foreground_pid == dota_pid
}

#[cfg(not(target_os = "windows"))]
pub fn dota_has_foreground_focus() -> bool {
    false
}

pub fn send_dump_keys(keys: &[DumpKey]) -> Result<(), String> {
    for key in keys {
        send_key(*key)?;
        thread::sleep(Duration::from_millis(80));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_key(key: DumpKey) -> Result<(), String> {
    let vk = key.virtual_key();
    let mut inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(format!(
            "SendInput sent {sent}/{} events for {key:?}",
            inputs.len()
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn send_key(_key: DumpKey) -> Result<(), String> {
    Err("focused dump-key fallback is only supported on Windows".to_owned())
}

#[cfg(target_os = "windows")]
fn focus_dota_window() -> Result<(), String> {
    let hwnd = find_dota_main_window().ok_or_else(|| "Dota window not found".to_owned())?;
    force_foreground_window(hwnd)
}

#[cfg(target_os = "windows")]
fn force_foreground_window(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }

        let foreground = GetForegroundWindow();
        let target_tid = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());
        let foreground_tid = if foreground.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, std::ptr::null_mut())
        };
        let current_tid = GetCurrentThreadId();

        // AttachThreadInput lets SetForegroundWindow beat the foreground lock
        // when another process currently owns focus (e.g. this Electron app).
        if foreground_tid != 0 && foreground_tid != current_tid {
            AttachThreadInput(current_tid, foreground_tid, TRUE);
        }
        if target_tid != 0 && target_tid != current_tid {
            AttachThreadInput(current_tid, target_tid, TRUE);
        }

        let ok = SetForegroundWindow(hwnd) != 0;

        if target_tid != 0 && target_tid != current_tid {
            AttachThreadInput(current_tid, target_tid, FALSE);
        }
        if foreground_tid != 0 && foreground_tid != current_tid {
            AttachThreadInput(current_tid, foreground_tid, FALSE);
        }

        if ok {
            Ok(())
        } else {
            Err("SetForegroundWindow failed".to_owned())
        }
    }
}

#[cfg(target_os = "windows")]
struct EnumDotaWindowState {
    pid: u32,
    hwnd: HWND,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_dota_windows(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam as *mut EnumDotaWindowState);
    if IsWindowVisible(hwnd) == 0 {
        return TRUE;
    }
    let mut window_pid = 0_u32;
    GetWindowThreadProcessId(hwnd, &mut window_pid);
    if window_pid == state.pid {
        state.hwnd = hwnd;
        return FALSE; // stop enumeration
    }
    TRUE
}

#[cfg(target_os = "windows")]
fn find_dota_main_window() -> Option<HWND> {
    let pid = dota_process_id()?;
    let mut state = EnumDotaWindowState {
        pid,
        hwnd: std::ptr::null_mut(),
    };
    unsafe {
        EnumWindows(
            Some(enum_dota_windows),
            &mut state as *mut EnumDotaWindowState as LPARAM,
        );
    }
    if state.hwnd.is_null() {
        None
    } else {
        Some(state.hwnd)
    }
}

#[cfg(target_os = "windows")]
fn dota_process_id() -> Option<u32> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let output = std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq dota2.exe", "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().find_map(|line| {
        let mut fields = line.trim().trim_matches('"').split("\",\"");
        let image = fields.next()?;
        let pid = fields.next()?;
        image
            .eq_ignore_ascii_case("dota2.exe")
            .then(|| pid.parse::<u32>().ok())
            .flatten()
    })
}
