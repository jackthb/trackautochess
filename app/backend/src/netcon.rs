//! TCP client for Dota's `-netconport` remote console.
//!
//! With `-netconport <port>` in the launch options, Dota listens on
//! 127.0.0.1:<port> and accepts the same commands as the in-game console.
//! Sending `dumpstringtable ...` over this socket writes the dump to
//! console.log exactly like the autoexec key binds do - but without synthetic
//! keystrokes, so capture keeps working while Dota is unfocused, minimized,
//! or the player is typing somewhere else.

use std::{
    io::Write,
    net::{SocketAddr, TcpStream},
    time::Duration,
};

/// Port Dota's netcon listens on. Must match the `-netconport` launch flag in
/// [`crate::nettable_setup::REQUIRED_LAUNCH_FLAGS`].
pub(crate) const NETCON_PORT: u16 = 2425;

/// Keep the capture loop responsive: a dead/absent listener must fail fast so
/// the keystroke fallback still fires on its normal cadence.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(250);
const WRITE_TIMEOUT: Duration = Duration::from_millis(250);

/// Send console commands over the netcon socket.
///
/// Connects per call: dumps are seconds apart, and a fresh connection avoids
/// tracking socket health across Dota restarts.
pub(crate) fn send_console_commands(port: u16, commands: &[&str]) -> Result<(), String> {
    if commands.is_empty() {
        return Ok(());
    }
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|err| format!("netcon connect failed: {err}"))?;
    stream
        .set_write_timeout(Some(WRITE_TIMEOUT))
        .map_err(|err| format!("netcon configure failed: {err}"))?;
    let mut payload = String::new();
    for command in commands {
        payload.push_str(command);
        payload.push('\n');
    }
    stream
        .write_all(payload.as_bytes())
        .map_err(|err| format!("netcon write failed: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Read, net::TcpListener, sync::mpsc, thread};

    #[test]
    fn sends_newline_terminated_commands() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut received = String::new();
            stream.read_to_string(&mut received).expect("read");
            tx.send(received).expect("send");
        });

        send_console_commands(port, &["echo one", "echo two"]).expect("send commands");

        let received = rx.recv_timeout(Duration::from_secs(2)).expect("recv");
        assert_eq!(received, "echo one\necho two\n");
    }

    #[test]
    fn fails_fast_when_nothing_listens() {
        // Bind-and-drop to get a port that's almost certainly closed.
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
            listener.local_addr().expect("local addr").port()
        };
        let started = std::time::Instant::now();
        let result = send_console_commands(port, &["echo nope"]);
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
