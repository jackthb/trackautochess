use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::{Duration, Instant},
};

const STEAM_OPENID_URL: &str = "https://steamcommunity.com/openid/login";
const RETURN_PORT: u16 = 27034;
const CALLBACK_PATH: &str = "/steam/callback";
const MAX_REQUEST_LINE_BYTES: usize = 16 * 1024;
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(2);

fn login_state() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|err| format!("could not generate login state: {err}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[derive(Debug, Clone)]
pub struct SteamLoginResult {
    pub steam_id: String,
    pub steam_name: String,
    pub supabase_session: Option<SupabaseSession>,
}

#[derive(Debug, Clone)]
pub struct SupabaseSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: Option<i64>,
}

pub fn steam_login_with_opener<F>(
    timeout: Duration,
    supabase_auth_url: Option<&str>,
    open: F,
) -> Result<SteamLoginResult, String>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let supabase_auth_url = supabase_auth_url
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let listener = TcpListener::bind(("127.0.0.1", RETURN_PORT))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|err| format!("failed to start Steam callback listener: {err}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("failed to configure Steam callback listener: {err}"))?;
    let port = listener.local_addr().map_err(|err| err.to_string())?.port();
    let state = login_state()?;
    let return_url = format!("http://127.0.0.1:{port}{CALLBACK_PATH}?state={state}");
    let login_url = supabase_auth_url
        .map(|url| desktop_auth_start_url(url, &return_url))
        .unwrap_or_else(|| steam_openid_login_url(&return_url));
    open(&login_url)?;

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                // Unrelated requests must not cancel a pending login.
                let params = match handle_callback(stream, &state, deadline) {
                    Ok(params) => params,
                    Err(_) => continue,
                };
                if let Some(error) = params.get("error").filter(|value| !value.trim().is_empty()) {
                    return Err(format!("Supabase auth exchange failed: {error}"));
                }
                if let Some(login) = desktop_session_login_from_params(&params)? {
                    return Ok(login);
                }
                let claimed = params.get("openid.claimed_id").cloned().unwrap_or_default();
                let steam_id = claimed
                    .rsplit('/')
                    .next()
                    .filter(|value| crate::supabase::parse_valid_steam_id64(value).is_some())
                    .ok_or_else(|| "Steam callback did not include a Steam ID".to_owned())?
                    .to_owned();
                let name = fetch_steam_name(&steam_id).unwrap_or_else(|| steam_id.clone());
                let supabase_session = match supabase_auth_url {
                    Some(url) => match exchange_supabase_session(url, &params) {
                        Ok(session) => Some(session),
                        Err(err) => {
                            verify_assertion(&params)?;
                            eprintln!(
                                "Steam login succeeded, but Supabase auth exchange failed: {err}"
                            );
                            None
                        }
                    },
                    None => {
                        verify_assertion(&params)?;
                        None
                    }
                };
                return Ok(SteamLoginResult {
                    steam_id,
                    steam_name: name,
                    supabase_session,
                });
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(err) => return Err(format!("Steam callback listener failed: {err}")),
        }
    }
    Err("Steam login timed out".to_owned())
}

fn steam_openid_login_url(return_url: &str) -> String {
    format!(
        "{STEAM_OPENID_URL}?openid.ns={}&openid.mode=checkid_setup&openid.return_to={}&openid.realm={}&openid.identity={}&openid.claimed_id={}",
        enc("http://specs.openid.net/auth/2.0"),
        enc(return_url),
        enc(return_url),
        enc("http://specs.openid.net/auth/2.0/identifier_select"),
        enc("http://specs.openid.net/auth/2.0/identifier_select"),
    )
}

fn desktop_auth_start_url(auth_url: &str, return_url: &str) -> String {
    let mut base = auth_url.trim().to_owned();
    let query = base
        .find('?')
        .map(|index| base.split_off(index))
        .unwrap_or_default();
    if base.ends_with("/callback") {
        base.truncate(base.len() - "/callback".len());
    }
    let separator = if query.is_empty() { '?' } else { '&' };
    format!(
        "{base}{query}{separator}desktop_return_to={}",
        enc(return_url)
    )
}

fn desktop_session_login_from_params(
    params: &BTreeMap<String, String>,
) -> Result<Option<SteamLoginResult>, String> {
    let Some(steam_id) = params
        .get("steam_id")
        .filter(|value| crate::supabase::parse_valid_steam_id64(value).is_some())
        .cloned()
    else {
        return Ok(None);
    };
    let access_token = params
        .get("access_token")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| "Desktop auth callback did not include an access token".to_owned())?;
    let refresh_token = params
        .get("refresh_token")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| "Desktop auth callback did not include a refresh token".to_owned())?;
    let steam_name = params
        .get("steam_name")
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_steam_name(value))
        .unwrap_or_else(|| steam_id.clone());
    Ok(Some(SteamLoginResult {
        steam_id,
        steam_name,
        supabase_session: Some(SupabaseSession {
            access_token,
            refresh_token,
            expires_at: session_expires_at(params),
        }),
    }))
}

fn session_expires_at(params: &BTreeMap<String, String>) -> Option<i64> {
    params
        .get("expires_at")
        .and_then(|value| value.parse::<i64>().ok())
        .or_else(|| {
            params
                .get("expires_in")
                .and_then(|value| value.parse::<i64>().ok())
                .map(|seconds| chrono::Utc::now().timestamp() + seconds)
        })
}

fn exchange_supabase_session(
    auth_url: &str,
    params: &BTreeMap<String, String>,
) -> Result<SupabaseSession, String> {
    let mut query = params
        .iter()
        .filter(|(key, _)| key.starts_with("openid."))
        .map(|(key, value)| format!("{}={}", enc(key), enc(value)))
        .collect::<Vec<_>>();
    query.push("desktop=1".to_owned());
    let separator = if auth_url.contains('?') { '&' } else { '?' };
    let url = format!("{auth_url}{separator}{}", query.join("&"));
    let response = ureq::get(&url)
        .call()
        .map_err(crate::supabase::describe_ureq_error)?;
    let body = response.into_string().map_err(|err| err.to_string())?;
    let value = serde_json::from_str::<serde_json::Value>(&body).map_err(|err| err.to_string())?;
    if let Some(error) = value.get("error").and_then(serde_json::Value::as_str) {
        return Err(format!("Supabase auth exchange failed: {error}"));
    }
    let access_token = value
        .get("access_token")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Supabase auth exchange did not return an access token".to_owned())?
        .to_owned();
    let refresh_token = value
        .get("refresh_token")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Supabase auth exchange did not return a refresh token".to_owned())?
        .to_owned();
    let expires_at = value
        .get("expires_at")
        .and_then(serde_json::Value::as_i64)
        .or_else(|| {
            value
                .get("expires_at")
                .and_then(serde_json::Value::as_str)
                .and_then(|value| value.parse::<i64>().ok())
        })
        .or_else(|| {
            value
                .get("expires_in")
                .and_then(serde_json::Value::as_i64)
                .map(|seconds| chrono::Utc::now().timestamp() + seconds)
        });

    Ok(SupabaseSession {
        access_token,
        refresh_token,
        expires_at,
    })
}

fn handle_callback(
    mut stream: TcpStream,
    expected_state: &str,
    login_deadline: Instant,
) -> Result<BTreeMap<String, String>, String> {
    let deadline = login_deadline.min(Instant::now() + CALLBACK_READ_TIMEOUT);
    let mut request = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Steam callback request timed out".to_owned());
        }
        stream
            .set_read_timeout(Some(remaining))
            .map_err(|err| err.to_string())?;
        let mut byte = [0];
        if stream.read(&mut byte).map_err(|err| err.to_string())? == 0 {
            return Err("incomplete Steam callback request".to_owned());
        }
        request.push(byte[0]);
        if request.len() > MAX_REQUEST_LINE_BYTES {
            return Err("Steam callback request too large".to_owned());
        }
        // Consume the bounded header block too: closing a TCP socket with
        // unread request headers can reset the browser before it sees our reply.
        if request.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let first = std::str::from_utf8(&request)
        .map_err(|err| err.to_string())?
        .lines()
        .next()
        .unwrap_or_default();
    let params = validate_callback_request(first, expected_state)?;
    // Do not reflect errors, tokens, or other callback input into HTML.
    let body = "<!doctype html><body>Login response received. Return to Track Auto Chess.</body>";
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|err| err.to_string())?;
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .map_err(|err| err.to_string())?;
    Ok(params)
}

fn validate_callback_request(
    first: &str,
    expected_state: &str,
) -> Result<BTreeMap<String, String>, String> {
    let mut parts = first.split_whitespace();
    if parts.next() != Some("GET") {
        return Err("invalid callback method".to_owned());
    }
    let target = parts
        .next()
        .ok_or_else(|| "missing callback target".to_owned())?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return Err("invalid callback path".to_owned());
    }
    let params = parse_query(query);
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Err("invalid callback state".to_owned());
    }
    Ok(params)
}

fn verify_assertion(params: &BTreeMap<String, String>) -> Result<(), String> {
    let mut form = params.clone();
    form.insert("openid.mode".to_owned(), "check_authentication".to_owned());
    let body = form
        .iter()
        .map(|(key, value)| format!("{}={}", enc(key), enc(value)))
        .collect::<Vec<_>>()
        .join("&");
    let response = ureq::post(STEAM_OPENID_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&body)
        .map_err(|err| err.to_string())?;
    let text = response.into_string().map_err(|err| err.to_string())?;
    if text.contains("is_valid:true") {
        Ok(())
    } else {
        Err("Steam rejected the OpenID assertion".to_owned())
    }
}

fn fetch_steam_name(steam_id: &str) -> Option<String> {
    let url = format!("https://steamcommunity.com/profiles/{steam_id}/?xml=1");
    let text = ureq::get(&url).call().ok()?.into_string().ok()?;
    text.split_once("<steamID>")
        .and_then(|(_, rest)| rest.split_once("</steamID>"))
        .map(|(name, _)| normalize_steam_name(name))
        .filter(|name| !name.is_empty())
}

pub fn normalize_steam_name(value: &str) -> String {
    let trimmed = value.trim();
    let without_cdata = trimmed
        .strip_prefix("<![CDATA[")
        .and_then(|rest| rest.strip_suffix("]]>"))
        .unwrap_or(trimmed);
    html_unescape(without_cdata.trim())
}

fn parse_query(query: &str) -> BTreeMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            Some((dec(key), dec(value)))
        })
        .collect()
}

fn enc(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            b' ' => vec!['+'],
            other => format!("%{other:02X}").chars().collect(),
        })
        .collect()
}

fn dec(value: &str) -> String {
    let mut out = Vec::new();
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                if let Some(hex) = std::str::from_utf8(&bytes[i + 1..i + 3])
                    .ok()
                    .and_then(|text| u8::from_str_radix(text, 16).ok())
                {
                    out.push(hex);
                    i += 2;
                }
            }
            byte => out.push(byte),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

#[cfg(test)]
mod tests {
    use super::{dec, enc, normalize_steam_name, steam_login_with_opener};
    use super::{
        desktop_session_login_from_params, handle_callback, login_state, validate_callback_request,
        MAX_REQUEST_LINE_BYTES,
    };
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{Arc, Mutex},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn callback_requires_current_state_and_exact_path() {
        assert!(validate_callback_request(
            "GET /steam/callback?state=current HTTP/1.1\r\n",
            "current"
        )
        .is_ok());
        for request in [
            "GET /steam/callback HTTP/1.1\r\n",
            "GET /steam/callback?state=old HTTP/1.1\r\n",
            "GET /other?state=current HTTP/1.1\r\n",
            "POST /steam/callback?state=current HTTP/1.1\r\n",
        ] {
            assert!(validate_callback_request(request, "current").is_err());
        }
        assert_ne!(login_state().unwrap(), login_state().unwrap());
    }

    #[test]
    fn desktop_callback_rejects_invalid_steam_ids() {
        for id in [
            "",
            "1",
            "76561197960265727",
            "76561202255233024",
            "not-an-id",
        ] {
            let params = [
                ("steam_id".into(), id.into()),
                ("access_token".into(), "token".into()),
                ("refresh_token".into(), "token".into()),
            ]
            .into_iter()
            .collect();
            assert!(desktop_session_login_from_params(&params)
                .unwrap()
                .is_none());
        }
    }

    #[test]
    fn callback_bounds_incomplete_and_oversized_requests() {
        for oversized in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
            let (server, _) = listener.accept().unwrap();
            if oversized {
                client
                    .write_all(&vec![b'x'; MAX_REQUEST_LINE_BYTES + 1])
                    .unwrap();
            }
            let start = Instant::now();
            let result = handle_callback(server, "state", start + Duration::from_millis(100));
            assert!(result.is_err());
            assert!(start.elapsed() < Duration::from_secs(2));
        }
        assert_eq!(dec("%aé"), "aé");
    }

    #[test]
    fn normalize_steam_name_strips_cdata() {
        assert_eq!(normalize_steam_name("<![CDATA[Player]]>"), "Player");
    }

    #[test]
    fn normalize_steam_name_unescapes_xml_entities() {
        assert_eq!(
            normalize_steam_name("Player &amp; Opponent"),
            "Player & Opponent"
        );
    }

    #[test]
    fn desktop_supabase_login_opens_web_start_and_accepts_session_callback() {
        let callback_thread = Arc::new(Mutex::new(None));
        let callback_thread_for_open = callback_thread.clone();

        let result = steam_login_with_opener(
            Duration::from_secs(2),
            Some("https://www.trackautochess.test/api/auth/steam/callback"),
            |url| {
                assert!(
                    url.starts_with("https://www.trackautochess.test/api/auth/steam?"),
                    "desktop auth should start on the web auth route, opened {url}"
                );
                let return_to =
                    query_param(url, "desktop_return_to").expect("desktop_return_to param");
                let handle = thread::spawn(move || {
                    // Rejected requests must leave the listener available for
                    // the legitimate redirect that follows.
                    let authority = return_to
                        .strip_prefix("http://")
                        .unwrap()
                        .split('/')
                        .next()
                        .unwrap();
                    for target in [
                        "/steam/callback",
                        "/steam/callback?state=wrong",
                        "/wrong?state=wrong",
                    ] {
                        let mut stream = TcpStream::connect(authority).unwrap();
                        write!(stream, "GET {target} HTTP/1.1\r\nHost: {authority}\r\n\r\n")
                            .unwrap();
                        let mut response = String::new();
                        let _ = stream.read_to_string(&mut response);
                    }
                    send_session_callback(&return_to);
                });
                *callback_thread_for_open.lock().unwrap() = Some(handle);
                Ok(())
            },
        )
        .expect("desktop Supabase login should succeed");

        if let Some(handle) = callback_thread.lock().unwrap().take() {
            handle.join().expect("callback thread should finish");
        }

        assert_eq!(result.steam_id, "76561198000000001");
        assert_eq!(result.steam_name, "Player");
        let session = result
            .supabase_session
            .expect("desktop callback should include Supabase session");
        assert_eq!(session.access_token, "access-token");
        assert_eq!(session.refresh_token, "refresh-token");
        assert!(
            session.expires_at.unwrap_or_default() > chrono::Utc::now().timestamp(),
            "expires_in should be converted to an absolute timestamp"
        );
    }

    fn query_param(url: &str, key: &str) -> Option<String> {
        let query = url.split_once('?')?.1;
        query.split('&').find_map(|pair| {
            let (name, value) = pair.split_once('=')?;
            (dec(name) == key).then(|| dec(value))
        })
    }

    fn send_session_callback(return_to: &str) {
        let target = return_to
            .strip_prefix("http://")
            .expect("desktop return URL should be http loopback");
        let (authority, path) = target
            .split_once('/')
            .map(|(authority, path)| (authority, format!("/{path}")))
            .unwrap_or((target, "/".to_owned()));
        let query = [
            ("steam_id", "76561198000000001"),
            ("steam_name", "Player"),
            ("access_token", "access-token"),
            ("refresh_token", "refresh-token"),
            ("expires_in", "3600"),
        ]
        .into_iter()
        .map(|(key, value)| format!("{}={}", enc(key), enc(value)))
        .collect::<Vec<_>>()
        .join("&");
        let path = if path.contains('?') {
            format!("{path}&{query}")
        } else {
            format!("{path}?{query}")
        };
        let mut stream = TcpStream::connect(authority).expect("connect to desktop callback");
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"
        )
        .expect("write callback request");
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .expect("read callback response");
        assert!(response.contains("Login response received"));
    }
}
