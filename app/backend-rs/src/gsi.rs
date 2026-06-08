use std::{
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

pub const DEFAULT_PORT: u16 = 4001;
pub const DAC_WORKSHOP_ID: &str = "1613886175";
pub const GSI_STALE_AFTER: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GsiState {
    pub game_state: String,
    pub custom_game: String,
    last_payload: Option<Instant>,
    fired_post_game: bool,
    pub payload_count: u64,
}

impl Default for GsiState {
    fn default() -> Self {
        Self {
            game_state: String::new(),
            custom_game: String::new(),
            last_payload: None,
            fired_post_game: false,
            payload_count: 0,
        }
    }
}

impl GsiState {
    pub fn apply_payload(&mut self, body: &str) -> GsiEvent {
        self.payload_count += 1;
        self.last_payload = Some(Instant::now());
        self.game_state = json_string(body, "game_state").unwrap_or_default();
        self.custom_game = json_string(body, "customgamename").unwrap_or_default();

        if self.custom_game.contains(DAC_WORKSHOP_ID)
            && self.game_state == "DOTA_GAMERULES_STATE_POST_GAME"
            && !self.fired_post_game
        {
            self.fired_post_game = true;
            return GsiEvent::DacPostGame;
        }
        if self.game_state != "DOTA_GAMERULES_STATE_POST_GAME" {
            self.fired_post_game = false;
        }
        GsiEvent::Payload
    }

    #[allow(dead_code)]
    pub fn is_dac_active(&self) -> bool {
        let Some(last_payload) = self.last_payload else {
            return false;
        };
        last_payload.elapsed() <= GSI_STALE_AFTER && self.custom_game.contains(DAC_WORKSHOP_ID)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GsiEvent {
    Payload,
    DacPostGame,
}

#[allow(dead_code)]
pub struct GsiServer {
    state: Arc<Mutex<GsiState>>,
}

impl GsiServer {
    #[allow(dead_code)]
    pub fn spawn(port: u16) -> io::Result<Self> {
        Self::spawn_with_callback(port, |_| {})
    }

    pub fn spawn_with_callback<F>(port: u16, on_event: F) -> io::Result<Self>
    where
        F: Fn(GsiEvent) + Send + Sync + 'static,
    {
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        let state = Arc::new(Mutex::new(GsiState::default()));
        let thread_state = Arc::clone(&state);
        let on_event = Arc::new(on_event);
        thread::Builder::new()
            .name("gsi-listener-rs".to_owned())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let state = Arc::clone(&thread_state);
                    let on_event = Arc::clone(&on_event);
                    let _ = handle_stream(stream, state, on_event);
                }
            })
            .map_err(io::Error::other)?;
        Ok(Self { state })
    }

    #[allow(dead_code)]
    pub fn state(&self) -> GsiState {
        self.state.lock().expect("gsi state poisoned").clone()
    }

    #[allow(dead_code)]
    pub fn is_dac_active(&self) -> bool {
        self.state
            .lock()
            .expect("gsi state poisoned")
            .is_dac_active()
    }
}

pub fn install_cfg_text(port: u16) -> String {
    format!(
        r#""DAC Tools GSI"
{{
    "uri"           "http://127.0.0.1:{port}"
    "timeout"       "5.0"
    "buffer"        "0.1"
    "throttle"      "30.0"
    "heartbeat"     "30.0"
    "data"
    {{
        "map"       "1"
        "player"    "1"
    }}
}}
"#
    )
}

fn handle_stream<F>(
    mut stream: TcpStream,
    state: Arc<Mutex<GsiState>>,
    on_event: Arc<F>,
) -> io::Result<()>
where
    F: Fn(GsiEvent) + Send + Sync + 'static,
{
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer)?;
    let request = String::from_utf8_lossy(&buffer);
    if let Some(body) = request.split("\r\n\r\n").nth(1) {
        let event = state
            .lock()
            .expect("gsi state poisoned")
            .apply_payload(body);
        if event == GsiEvent::DacPostGame {
            on_event(event);
        }
    }
    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")?;
    Ok(())
}

fn json_string(body: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let (_, rest) = body.split_once(&marker)?;
    let (_, rest) = rest.split_once(':')?;
    let start = rest.find('"')? + 1;
    let mut escaped = false;
    let mut out = String::new();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_dac_post_game_once() {
        let mut state = GsiState::default();
        let payload = r#"{"map":{"game_state":"DOTA_GAMERULES_STATE_POST_GAME","customgamename":"dota_addons/1613886175/dac"}}"#;
        assert_eq!(state.apply_payload(payload), GsiEvent::DacPostGame);
        assert_eq!(state.apply_payload(payload), GsiEvent::Payload);
        assert!(state.is_dac_active());
    }

    #[test]
    fn cfg_points_to_local_listener() {
        let cfg = install_cfg_text(4001);
        assert!(cfg.contains("http://127.0.0.1:4001"));
        assert!(cfg.contains("heartbeat"));
    }
}
