use std::{thread, time::Duration};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
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
    Err("dump hotkeys are only supported on Windows".to_owned())
}
