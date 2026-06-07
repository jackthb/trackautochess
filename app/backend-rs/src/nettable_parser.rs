use std::{collections::BTreeMap, fmt, fs, io, path::Path};

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Object(BTreeMap<String, Value>),
    Array(Vec<Value>),
    String(String),
    I32(i32),
    U64(u64),
    F32(f32),
}

impl Value {
    pub fn to_json(&self) -> String {
        match self {
            Value::Object(map) => {
                let fields = map
                    .iter()
                    .map(|(k, v)| format!("{}:{}", json_string(k), v.to_json()))
                    .collect::<Vec<_>>()
                    .join(",");
                format!("{{{fields}}}")
            }
            Value::Array(values) => format!(
                "[{}]",
                values
                    .iter()
                    .map(Value::to_json)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Value::String(value) => json_string(value),
            Value::I32(value) => value.to_string(),
            Value::U64(value) => value.to_string(),
            Value::F32(value) => {
                if value.is_finite() {
                    value.to_string()
                } else {
                    "null".to_owned()
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError(String);

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ParseError {}

#[derive(Debug, Clone, PartialEq)]
pub struct NettableRow {
    pub table_name: String,
    pub key: String,
    pub raw: Value,
}

pub type ParsedLog = BTreeMap<String, BTreeMap<String, Value>>;

pub fn parse_vbkv(bytes: &[u8]) -> Result<Value, ParseError> {
    if bytes.len() < 8 || &bytes[..4] != b"VBKV" {
        return Err(ParseError("bad VBKV magic".to_owned()));
    }
    let mut cursor = Cursor { bytes, pos: 8 };
    let ty = cursor.u8()?;
    if ty != 0 {
        return Err(ParseError("root is not a subkey".to_owned()));
    }
    let name = cursor.cstring()?;
    if !name.is_empty() {
        return Err(ParseError("root key name is not empty".to_owned()));
    }
    parse_object(&mut cursor)
}

pub fn parse_log(path: &Path) -> io::Result<ParsedLog> {
    let body = fs::read_to_string(path)?;
    Ok(parse_log_text(&body))
}

pub fn parse_log_text(body: &str) -> ParsedLog {
    let mut out: BTreeMap<String, BTreeMap<String, Value>> = BTreeMap::new();
    let mut table: Option<String> = None;
    let mut key: Option<String> = None;
    let mut hex = String::new();

    let flush =
        |out: &mut ParsedLog, table: &Option<String>, key: &Option<String>, hex: &mut String| {
            if let (Some(table), Some(key)) = (table, key) {
                if let Ok(bytes) = decode_hex(hex) {
                    if let Ok(value) = parse_vbkv(&bytes) {
                        out.entry(table.clone())
                            .or_default()
                            .insert(key.clone(), value);
                    }
                }
            }
            hex.clear();
        };

    for line in body.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("[stringtables] table ") {
            flush(&mut out, &table, &key, &mut hex);
            table = rest.split_whitespace().next().map(str::to_owned);
            key = None;
            continue;
        }
        if !trimmed.starts_with("[stringtables]") {
            continue;
        }
        if let Some((_, rest)) = trimmed.split_once(':') {
            let candidate = rest.trim();
            if !candidate.starts_with('>') && !candidate.is_empty() {
                flush(&mut out, &table, &key, &mut hex);
                key = Some(candidate.to_owned());
                continue;
            }
        }
        if let Some(idx) = trimmed.find(">>") {
            let after = &trimmed[idx + 2..];
            for token in after.split_whitespace() {
                if token.len() == 8 && token.chars().all(|c| c.is_ascii_hexdigit()) {
                    hex.push_str(token);
                }
            }
        }
    }
    flush(&mut out, &table, &key, &mut hex);
    out
}

pub fn extract_rows(path: &Path) -> io::Result<Vec<NettableRow>> {
    let parsed = parse_log(path)?;
    Ok(rows_from_parsed(parsed))
}

pub fn rows_from_parsed(parsed: ParsedLog) -> Vec<NettableRow> {
    let mut rows = Vec::new();
    for (table_name, entries) in parsed {
        if !table_name.starts_with("CustomNetTable_") {
            continue;
        }
        for (key, raw) in entries {
            rows.push(NettableRow {
                table_name: table_name.clone(),
                key,
                raw,
            });
        }
    }
    rows
}

fn parse_object(cursor: &mut Cursor<'_>) -> Result<Value, ParseError> {
    let mut map = BTreeMap::new();
    loop {
        let ty = cursor.u8()?;
        if ty == 0x0b {
            break;
        }
        let name = cursor.cstring()?;
        let value = match ty {
            0x00 => parse_object(cursor)?,
            0x01 => Value::String(cursor.cstring()?),
            0x02 => Value::I32(cursor.i32_le()?),
            0x03 => Value::F32(f32::from_bits(cursor.u32_le()?)),
            0x07 => Value::U64(cursor.u64_le()?),
            other => return Err(ParseError(format!("unknown VBKV type 0x{other:02x}"))),
        };
        insert_value(&mut map, name, value);
    }
    Ok(Value::Object(map))
}

fn insert_value(map: &mut BTreeMap<String, Value>, name: String, value: Value) {
    match map.remove(&name) {
        None => {
            map.insert(name, value);
        }
        Some(Value::Array(mut values)) => {
            values.push(value);
            map.insert(name, Value::Array(values));
        }
        Some(existing) => {
            map.insert(name, Value::Array(vec![existing, value]));
        }
    }
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl Cursor<'_> {
    fn u8(&mut self) -> Result<u8, ParseError> {
        if self.pos >= self.bytes.len() {
            return Err(ParseError("unexpected EOF".to_owned()));
        }
        let value = self.bytes[self.pos];
        self.pos += 1;
        Ok(value)
    }

    fn cstring(&mut self) -> Result<String, ParseError> {
        let start = self.pos;
        while self.pos < self.bytes.len() && self.bytes[self.pos] != 0 {
            self.pos += 1;
        }
        if self.pos >= self.bytes.len() {
            return Err(ParseError("unterminated string".to_owned()));
        }
        let value = String::from_utf8_lossy(&self.bytes[start..self.pos]).into_owned();
        self.pos += 1;
        Ok(value)
    }

    fn fixed<const N: usize>(&mut self) -> Result<[u8; N], ParseError> {
        if self.pos + N > self.bytes.len() {
            return Err(ParseError("unexpected EOF".to_owned()));
        }
        let mut out = [0; N];
        out.copy_from_slice(&self.bytes[self.pos..self.pos + N]);
        self.pos += N;
        Ok(out)
    }

    fn i32_le(&mut self) -> Result<i32, ParseError> {
        Ok(i32::from_le_bytes(self.fixed()?))
    }

    fn u32_le(&mut self) -> Result<u32, ParseError> {
        Ok(u32::from_le_bytes(self.fixed()?))
    }

    fn u64_le(&mut self) -> Result<u64, ParseError> {
        Ok(u64::from_le_bytes(self.fixed()?))
    }
}

fn decode_hex(hex: &str) -> Result<Vec<u8>, ParseError> {
    if hex.len() % 2 != 0 {
        return Err(ParseError("odd-length hex".to_owned()));
    }
    let mut out = Vec::with_capacity(hex.len() / 2);
    let bytes = hex.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = hex_nibble(bytes[i])?;
        let lo = hex_nibble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_nibble(byte: u8) -> Result<u8, ParseError> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(ParseError("invalid hex".to_owned())),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn wrap(mut body: Vec<u8>) -> Vec<u8> {
        let mut out = b"VBKV\xaa\xbb\xcc\xdd".to_vec();
        out.append(&mut body);
        out
    }

    fn root(entries: Vec<u8>) -> Vec<u8> {
        let mut out = vec![0, 0];
        out.extend(entries);
        out.push(0x0b);
        out
    }

    fn key(name: &str) -> Vec<u8> {
        let mut out = name.as_bytes().to_vec();
        out.push(0);
        out
    }

    fn string(name: &str, value: &str) -> Vec<u8> {
        let mut out = vec![1];
        out.extend(key(name));
        out.extend(key(value));
        out
    }

    fn int32(name: &str, value: i32) -> Vec<u8> {
        let mut out = vec![2];
        out.extend(key(name));
        out.extend(value.to_le_bytes());
        out
    }

    fn format_block(table: &str, key: &str, blob: &[u8]) -> String {
        let mut lines = vec![format!("[stringtables] table {table} 1")];
        lines.push(format!("[stringtables]    0 : {key}"));
        for chunk in blob.chunks(24) {
            let ascii = ".".repeat(24);
            let groups = chunk
                .chunks(4)
                .map(|g| g.iter().map(|b| format!("{b:02x}")).collect::<String>())
                .collect::<Vec<_>>()
                .join(" ");
            lines.push(format!("[stringtables]    >>  {ascii} {groups}"));
        }
        lines.join("\n")
    }

    #[test]
    fn parses_vbkv_strings_and_ints() {
        let mut entries = string("name", "jack");
        entries.extend(int32("rank", 7));
        let parsed = parse_vbkv(&wrap(root(entries))).unwrap();
        assert_eq!(parsed.to_json(), r#"{"name":"jack","rank":7}"#);
    }

    #[test]
    fn duplicate_keys_become_arrays() {
        let mut entries = string("k", "a");
        entries.extend(string("k", "b"));
        let parsed = parse_vbkv(&wrap(root(entries))).unwrap();
        assert_eq!(parsed.to_json(), r#"{"k":["a","b"]}"#);
    }

    #[test]
    fn parses_stringtable_log() {
        let mut entries = string("name", "jack");
        entries.extend(int32("rank", 7));
        let blob = wrap(root(entries));
        let log = format_block("CustomNetTable_dac_table", "player_info", &blob);
        let parsed = parse_log_text(&log);
        assert_eq!(
            parsed["CustomNetTable_dac_table"]["player_info"].to_json(),
            r#"{"name":"jack","rank":7}"#
        );
    }
}
