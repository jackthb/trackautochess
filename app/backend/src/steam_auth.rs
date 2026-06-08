use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    time::{Duration, Instant},
};

const STEAM_OPENID_URL: &str = "https://steamcommunity.com/openid/login";
const RETURN_PORT: u16 = 27034;

pub fn steam_login_with_opener<F>(timeout: Duration, open: F) -> Result<(String, String), String>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let listener = TcpListener::bind(("127.0.0.1", RETURN_PORT))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|err| format!("failed to start Steam callback listener: {err}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("failed to configure Steam callback listener: {err}"))?;
    let port = listener.local_addr().map_err(|err| err.to_string())?.port();
    let return_url = format!("http://127.0.0.1:{port}");
    let login_url = format!(
        "{STEAM_OPENID_URL}?openid.ns={}&openid.mode=checkid_setup&openid.return_to={}&openid.realm={}&openid.identity={}&openid.claimed_id={}",
        enc("http://specs.openid.net/auth/2.0"),
        enc(&return_url),
        enc(&return_url),
        enc("http://specs.openid.net/auth/2.0/identifier_select"),
        enc("http://specs.openid.net/auth/2.0/identifier_select"),
    );
    open(&login_url)?;

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                let params = handle_callback(stream)?;
                let claimed = params.get("openid.claimed_id").cloned().unwrap_or_default();
                let steam_id = claimed
                    .rsplit('/')
                    .next()
                    .filter(|value| value.chars().all(|ch| ch.is_ascii_digit()))
                    .ok_or_else(|| "Steam callback did not include a Steam ID".to_owned())?
                    .to_owned();
                verify_assertion(&params)?;
                let name = fetch_steam_name(&steam_id).unwrap_or_else(|| steam_id.clone());
                return Ok((steam_id, name));
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(err) => return Err(format!("Steam callback listener failed: {err}")),
        }
    }
    Err("Steam login timed out".to_owned())
}

fn handle_callback(mut stream: TcpStream) -> Result<BTreeMap<String, String>, String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|err| err.to_string())?);
    let mut first = String::new();
    reader
        .read_line(&mut first)
        .map_err(|err| err.to_string())?;
    let path = first
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "bad Steam callback request".to_owned())?;
    let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
    let params = parse_query(query);
    let ok = params.contains_key("openid.claimed_id");
    let message = if ok {
        "Login successful. You can close this tab."
    } else {
        "Login failed. No Steam ID was returned."
    };
    let status = if ok { "200 OK" } else { "400 Bad Request" };
    let body = format!("<!doctype html><body style=\"font-family:sans-serif;padding:48px\"><h2>{message}</h2></body>");
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .map_err(|err| err.to_string())?;
    if ok {
        Ok(params)
    } else {
        Err("Steam callback missing claimed_id".to_owned())
    }
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
                if let Ok(hex) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
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
    use super::normalize_steam_name;

    #[test]
    fn normalize_steam_name_strips_cdata() {
        assert_eq!(normalize_steam_name("<![CDATA[Jack]]>"), "Jack");
    }

    #[test]
    fn normalize_steam_name_unescapes_xml_entities() {
        assert_eq!(normalize_steam_name("Jack &amp; Jill"), "Jack & Jill");
    }
}
