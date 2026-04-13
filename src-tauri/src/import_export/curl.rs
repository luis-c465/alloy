use std::path::Path;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

use crate::{
    error::AppError,
    http::types::{HttpRequestData, KeyValue, MultipartField, MultipartValue, RequestBody},
};

pub fn request_to_curl(request: &HttpRequestData) -> String {
    let mut parts = vec!["curl".to_string()];
    let method = request.method.trim().to_uppercase();

    if !method.is_empty() && method != "GET" {
        parts.push("-X".to_string());
        parts.push(shell_escape(&method));
    }

    let url = build_request_url(&request.url, &request.query_params);
    parts.push(shell_escape(&url));

    for header in request
        .headers
        .iter()
        .filter(|header| header.enabled && !header.key.trim().is_empty())
    {
        parts.push("-H".to_string());
        parts.push(shell_escape(&format!(
            "{}: {}",
            header.key.trim(),
            header.value
        )));
    }

    match &request.body {
        RequestBody::None => {}
        RequestBody::Json(content) | RequestBody::Raw { content, .. } => {
            if !content.is_empty() {
                parts.push("-d".to_string());
                parts.push(shell_escape(content));
            }
        }
        RequestBody::FormUrlEncoded(values) => {
            for value in values
                .iter()
                .filter(|value| value.enabled && !value.key.trim().is_empty())
            {
                parts.push("--data-urlencode".to_string());
                parts.push(shell_escape(&format!("{}={}", value.key, value.value)));
            }
        }
        RequestBody::Multipart(fields) => {
            for field in fields
                .iter()
                .filter(|field| field.enabled && !field.key.trim().is_empty())
            {
                parts.push("-F".to_string());
                parts.push(shell_escape(&multipart_field_to_form_arg(field)));
            }
        }
    }

    if request.skip_ssl_verification {
        parts.push("--insecure".to_string());
    }

    if let Some(timeout_ms) = request.timeout_ms.filter(|timeout_ms| *timeout_ms > 0) {
        let timeout_seconds = timeout_ms.div_ceil(1_000);
        parts.push("--max-time".to_string());
        parts.push(timeout_seconds.to_string());
    }

    parts.join(" ")
}

pub fn curl_to_request(curl_command: &str) -> Result<HttpRequestData, AppError> {
    let normalized = normalize_curl_command(curl_command);
    let mut tokens = tokenize_shell_command(&normalized)?;

    if matches!(tokens.first().map(String::as_str), Some("curl")) {
        tokens.remove(0);
    }

    if tokens.is_empty() {
        return Err(AppError::ParseError("cURL command is empty".to_string()));
    }

    let mut method: Option<String> = None;
    let mut url: Option<String> = None;
    let mut headers: Vec<KeyValue> = Vec::new();
    let mut data_segments: Vec<String> = Vec::new();
    let mut multipart_fields: Vec<MultipartField> = Vec::new();
    let mut skip_ssl_verification = false;
    let mut timeout_ms: Option<u64> = None;
    let mut basic_auth: Option<String> = None;

    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];

        match token.as_str() {
            "-X" | "--request" => {
                method = Some(required_next(&tokens, &mut index, token)?.to_uppercase());
            }
            "-H" | "--header" => {
                let header = required_next(&tokens, &mut index, token)?;
                headers.push(parse_header(&header)?);
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" => {
                data_segments.push(required_next(&tokens, &mut index, token)?);
            }
            "-F" | "--form" => {
                let form_value = required_next(&tokens, &mut index, token)?;
                multipart_fields.push(parse_form_field(&form_value)?);
            }
            "-u" | "--user" => {
                basic_auth = Some(required_next(&tokens, &mut index, token)?);
            }
            "-k" | "--insecure" => {
                skip_ssl_verification = true;
            }
            "--max-time" => {
                timeout_ms = Some(parse_timeout_ms(&required_next(
                    &tokens, &mut index, token,
                )?)?);
            }
            "--url" => {
                url = Some(required_next(&tokens, &mut index, token)?);
            }
            "--compressed" | "--location" | "--globoff" | "--http1.1" | "--http2" | "-s"
            | "--silent" | "-i" | "--include" | "-v" | "--verbose" => {}
            "-A" | "--user-agent" | "-b" | "--cookie" | "-e" | "--referer" | "-o" | "--output" => {
                let _ = required_next(&tokens, &mut index, token)?;
            }
            _ => {
                if let Some(value) = token.strip_prefix("--request=") {
                    method = Some(value.trim().to_uppercase());
                } else if let Some(value) = token.strip_prefix("--header=") {
                    headers.push(parse_header(value)?);
                } else if let Some(value) = token.strip_prefix("--data=") {
                    data_segments.push(value.to_string());
                } else if let Some(value) = token.strip_prefix("--data-raw=") {
                    data_segments.push(value.to_string());
                } else if let Some(value) = token.strip_prefix("--data-binary=") {
                    data_segments.push(value.to_string());
                } else if let Some(value) = token.strip_prefix("--form=") {
                    multipart_fields.push(parse_form_field(value)?);
                } else if let Some(value) = token.strip_prefix("--user=") {
                    basic_auth = Some(value.to_string());
                } else if let Some(value) = token.strip_prefix("--max-time=") {
                    timeout_ms = Some(parse_timeout_ms(value)?);
                } else if let Some(value) = token.strip_prefix("--url=") {
                    url = Some(value.to_string());
                } else if let Some(value) = token.strip_prefix("-X") {
                    if !value.is_empty() {
                        method = Some(value.trim().to_uppercase());
                    } else {
                        return Err(AppError::ParseError("Missing method after -X".to_string()));
                    }
                } else if let Some(value) = token.strip_prefix("-H") {
                    if !value.is_empty() {
                        headers.push(parse_header(value)?);
                    } else {
                        return Err(AppError::ParseError("Missing header after -H".to_string()));
                    }
                } else if let Some(value) = token.strip_prefix("-d") {
                    if !value.is_empty() {
                        data_segments.push(value.to_string());
                    } else {
                        return Err(AppError::ParseError("Missing body after -d".to_string()));
                    }
                } else if let Some(value) = token.strip_prefix("-F") {
                    if !value.is_empty() {
                        multipart_fields.push(parse_form_field(value)?);
                    } else {
                        return Err(AppError::ParseError(
                            "Missing form value after -F".to_string(),
                        ));
                    }
                } else if let Some(value) = token.strip_prefix("-u") {
                    if !value.is_empty() {
                        basic_auth = Some(value.to_string());
                    } else {
                        return Err(AppError::ParseError(
                            "Missing credentials after -u".to_string(),
                        ));
                    }
                } else if token.starts_with('-') {
                    // Ignore unsupported flags to stay compatible with browser-generated cURL.
                } else if url.is_none() {
                    url = Some(token.clone());
                }
            }
        }

        index += 1;
    }

    let url =
        url.ok_or_else(|| AppError::ParseError("cURL command does not include a URL".to_string()))?;

    if let Some(userpass) = basic_auth {
        let encoded = BASE64_STANDARD.encode(userpass.as_bytes());
        let has_authorization_header = headers.iter().any(|header| {
            header.enabled && header.key.trim().eq_ignore_ascii_case("authorization")
        });

        if !has_authorization_header {
            headers.push(KeyValue {
                key: "Authorization".to_string(),
                value: format!("Basic {encoded}"),
                enabled: true,
            });
        }
    }

    let (base_url, query_params) = split_url_and_query_params(&url);
    let body = if !multipart_fields.is_empty() {
        RequestBody::Multipart(multipart_fields)
    } else if !data_segments.is_empty() {
        let body_content = data_segments.join("&");
        match infer_body_from_headers(&headers, body_content) {
            Some(body) => body,
            None => RequestBody::None,
        }
    } else {
        RequestBody::None
    };

    let method = method.unwrap_or_else(|| {
        if matches!(body, RequestBody::None) {
            "GET".to_string()
        } else {
            "POST".to_string()
        }
    });

    Ok(HttpRequestData {
        method,
        url: base_url,
        headers,
        query_params,
        body,
        timeout_ms,
        skip_ssl_verification,
    })
}

fn build_request_url(base_url: &str, query_params: &[KeyValue]) -> String {
    let enabled_params: Vec<&KeyValue> = query_params
        .iter()
        .filter(|param| param.enabled && !param.key.trim().is_empty())
        .collect();

    if enabled_params.is_empty() {
        return base_url.to_string();
    }

    match reqwest::Url::parse(base_url) {
        Ok(mut url) => {
            {
                let mut query_pairs = url.query_pairs_mut();
                for param in enabled_params {
                    query_pairs.append_pair(&param.key, &param.value);
                }
            }
            url.to_string()
        }
        Err(_) => {
            let suffix = enabled_params
                .iter()
                .map(|param| format!("{}={}", param.key, param.value))
                .collect::<Vec<_>>()
                .join("&");
            let separator = if base_url.contains('?') { '&' } else { '?' };
            format!("{base_url}{separator}{suffix}")
        }
    }
}

fn multipart_field_to_form_arg(field: &MultipartField) -> String {
    match &field.value {
        MultipartValue::Text(value) => format!("{}={value}", field.key),
        MultipartValue::File { path, .. } => {
            let mut value = format!("{}=@{path}", field.key);
            if let Some(content_type) = field
                .content_type
                .as_ref()
                .filter(|value| !value.is_empty())
            {
                value.push_str(&format!(";type={content_type}"));
            }
            value
        }
    }
}

fn shell_escape(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    format!("'{}'", value.replace('\'', r#"'\''"#))
}

fn normalize_curl_command(command: &str) -> String {
    command.replace("\\\r\n", " ").replace("\\\n", " ")
}

fn required_next(tokens: &[String], index: &mut usize, flag: &str) -> Result<String, AppError> {
    let next_index = *index + 1;
    let value = tokens
        .get(next_index)
        .cloned()
        .ok_or_else(|| AppError::ParseError(format!("Missing value for {flag} in cURL command")))?;
    *index = next_index;
    Ok(value)
}

fn parse_header(value: &str) -> Result<KeyValue, AppError> {
    let (key, raw_value) = value.split_once(':').ok_or_else(|| {
        AppError::ParseError(format!("Invalid header format in cURL command: {value}"))
    })?;

    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::ParseError(
            "Header name cannot be empty".to_string(),
        ));
    }

    Ok(KeyValue {
        key: key.to_string(),
        value: raw_value.trim().to_string(),
        enabled: true,
    })
}

fn parse_form_field(value: &str) -> Result<MultipartField, AppError> {
    let (key, raw_value) = value.split_once('=').ok_or_else(|| {
        AppError::ParseError(format!(
            "Invalid multipart form field in cURL command: {value}"
        ))
    })?;

    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::ParseError(
            "Multipart field name cannot be empty".to_string(),
        ));
    }

    let (multipart_value, content_type) = if let Some(file_spec) = raw_value.strip_prefix('@') {
        let (path, content_type) = if let Some((path, metadata)) = file_spec.split_once(';') {
            let content_type = metadata
                .strip_prefix("type=")
                .map(|value| value.trim().to_string());
            (path, content_type)
        } else {
            (file_spec, None)
        };

        (
            MultipartValue::File {
                path: path.to_string(),
                filename: Path::new(path)
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned()),
            },
            content_type,
        )
    } else {
        (MultipartValue::Text(raw_value.to_string()), None)
    };

    Ok(MultipartField {
        key: key.to_string(),
        value: multipart_value,
        content_type,
        enabled: true,
    })
}

fn parse_timeout_ms(value: &str) -> Result<u64, AppError> {
    let seconds = value.trim().parse::<f64>().map_err(|error| {
        AppError::ParseError(format!("Invalid --max-time value '{value}': {error}"))
    })?;

    if !seconds.is_finite() || seconds <= 0.0 {
        return Err(AppError::ParseError(format!(
            "Invalid --max-time value '{value}': must be greater than 0"
        )));
    }

    Ok((seconds * 1000.0).round() as u64)
}

fn split_url_and_query_params(url: &str) -> (String, Vec<KeyValue>) {
    match reqwest::Url::parse(url) {
        Ok(mut parsed_url) => {
            let query_params = parsed_url
                .query_pairs()
                .map(|(key, value)| KeyValue {
                    key: key.into_owned(),
                    value: value.into_owned(),
                    enabled: true,
                })
                .collect::<Vec<_>>();
            parsed_url.set_query(None);
            (parsed_url.to_string(), query_params)
        }
        Err(_) => (url.to_string(), Vec::new()),
    }
}

fn infer_body_from_headers(headers: &[KeyValue], body_content: String) -> Option<RequestBody> {
    let content_type = headers
        .iter()
        .find(|header| header.enabled && header.key.trim().eq_ignore_ascii_case("content-type"))
        .map(|header| header.value.trim().to_ascii_lowercase());

    match content_type.as_deref() {
        Some(value) if value.contains("application/json") => Some(RequestBody::Json(body_content)),
        Some(value) if value.contains("application/x-www-form-urlencoded") => Some(
            RequestBody::FormUrlEncoded(parse_form_urlencoded_body(&body_content)),
        ),
        Some(value) => Some(RequestBody::Raw {
            content: body_content,
            content_type: value.to_string(),
        }),
        None if body_content.trim().is_empty() => None,
        None if looks_like_json(&body_content) => Some(RequestBody::Json(body_content)),
        None => Some(RequestBody::Raw {
            content: body_content,
            content_type: "text/plain".to_string(),
        }),
    }
}

fn parse_form_urlencoded_body(body: &str) -> Vec<KeyValue> {
    let params = url::form_urlencoded::parse(body.as_bytes());
    let values = params
        .map(|(key, value)| KeyValue {
            key: key.into_owned(),
            value: value.into_owned(),
            enabled: true,
        })
        .collect::<Vec<_>>();

    if values.is_empty() && !body.trim().is_empty() {
        vec![KeyValue {
            key: body.to_string(),
            value: String::new(),
            enabled: true,
        }]
    } else {
        values
    }
}

fn looks_like_json(value: &str) -> bool {
    let trimmed = value.trim();
    (trimmed.starts_with('{') && trimmed.ends_with('}'))
        || (trimmed.starts_with('[') && trimmed.ends_with(']'))
}

fn tokenize_shell_command(input: &str) -> Result<Vec<String>, AppError> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum State {
        Unquoted,
        SingleQuoted,
        DoubleQuoted,
        AnsiQuoted,
    }

    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut state = State::Unquoted;
    let chars = input.chars().collect::<Vec<_>>();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        match state {
            State::Unquoted => match ch {
                '\'' => state = State::SingleQuoted,
                '"' => state = State::DoubleQuoted,
                '$' if chars.get(index + 1) == Some(&'\'') => {
                    state = State::AnsiQuoted;
                    index += 1;
                }
                '\\' => {
                    index += 1;
                    let escaped = chars.get(index).ok_or_else(|| {
                        AppError::ParseError("Invalid trailing escape in cURL command".to_string())
                    })?;
                    current.push(*escaped);
                }
                ch if ch.is_whitespace() => {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                }
                _ => current.push(ch),
            },
            State::SingleQuoted => {
                if ch == '\'' {
                    state = State::Unquoted;
                } else {
                    current.push(ch);
                }
            }
            State::DoubleQuoted => match ch {
                '"' => state = State::Unquoted,
                '\\' => {
                    index += 1;
                    let escaped = chars.get(index).ok_or_else(|| {
                        AppError::ParseError("Invalid escape in quoted cURL argument".to_string())
                    })?;
                    current.push(match escaped {
                        'n' => '\n',
                        'r' => '\r',
                        't' => '\t',
                        other => *other,
                    });
                }
                _ => current.push(ch),
            },
            State::AnsiQuoted => {
                if ch == '\'' {
                    state = State::Unquoted;
                } else if ch == '\\' {
                    index += 1;
                    let escaped = chars.get(index).ok_or_else(|| {
                        AppError::ParseError("Invalid ANSI-C escape in cURL argument".to_string())
                    })?;
                    current.push(match escaped {
                        'n' => '\n',
                        'r' => '\r',
                        't' => '\t',
                        '\\' => '\\',
                        '\'' => '\'',
                        '0' => '\0',
                        other => *other,
                    });
                } else {
                    current.push(ch);
                }
            }
        }

        index += 1;
    }

    if state != State::Unquoted {
        return Err(AppError::ParseError(
            "Unterminated quoted string in cURL command".to_string(),
        ));
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_request() -> HttpRequestData {
        HttpRequestData {
            method: "POST".to_string(),
            url: "https://api.example.com/users".to_string(),
            headers: vec![KeyValue {
                key: "Content-Type".to_string(),
                value: "application/json".to_string(),
                enabled: true,
            }],
            query_params: vec![KeyValue {
                key: "page".to_string(),
                value: "1".to_string(),
                enabled: true,
            }],
            body: RequestBody::Json("{\"name\":\"O'Reilly\"}".to_string()),
            timeout_ms: Some(2_500),
            skip_ssl_verification: true,
        }
    }

    #[test]
    fn request_to_curl_builds_copy_pasteable_command() {
        let curl = request_to_curl(&json_request());

        assert!(curl.contains("curl -X 'POST'"));
        assert!(curl.contains("'https://api.example.com/users?page=1'"));
        assert!(curl.contains("-H 'Content-Type: application/json'"));
        assert!(curl.contains("--insecure"));
        assert!(curl.contains("--max-time 3"));
        assert!(curl.contains("O'\\''Reilly"));
    }

    #[test]
    fn curl_to_request_parses_multiline_command() {
        let command = r#"curl 'https://api.example.com/users?page=1' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{"name":"Alice"}' \
  -k \
  --max-time 3"#;

        let request = curl_to_request(command).unwrap();

        assert_eq!(request.method, "POST");
        assert_eq!(request.url, "https://api.example.com/users");
        assert_eq!(request.query_params.len(), 1);
        assert!(request.skip_ssl_verification);
        assert_eq!(request.timeout_ms, Some(3_000));

        match request.body {
            RequestBody::Json(content) => assert_eq!(content, r#"{"name":"Alice"}"#),
            _ => panic!("expected JSON body"),
        }
    }

    #[test]
    fn curl_to_request_maps_basic_auth() {
        let request = curl_to_request(
            "curl --url https://example.com -u user:pass -H 'Accept: application/json'",
        )
        .unwrap();

        let auth_header = request
            .headers
            .iter()
            .find(|header| header.key.eq_ignore_ascii_case("authorization"))
            .unwrap();

        assert_eq!(
            auth_header.value,
            format!("Basic {}", BASE64_STANDARD.encode("user:pass"))
        );
    }

    #[test]
    fn curl_to_request_rejects_unterminated_quotes() {
        let result = curl_to_request("curl 'https://example.com");
        match result {
            Ok(_) => panic!("expected parse error"),
            Err(error) => assert!(matches!(error, AppError::ParseError(_))),
        }
    }

    #[test]
    fn round_trip_preserves_core_request_fields() {
        let original = json_request();
        let imported = curl_to_request(&request_to_curl(&original)).unwrap();

        assert_eq!(imported.method, original.method);
        assert_eq!(imported.url, original.url);
        assert_eq!(imported.query_params.len(), original.query_params.len());
        assert_eq!(imported.headers.len(), original.headers.len());
        assert_eq!(imported.timeout_ms, Some(3_000));
        assert!(imported.skip_ssl_verification);

        match imported.body {
            RequestBody::Json(content) => assert_eq!(content, "{\"name\":\"O'Reilly\"}"),
            _ => panic!("expected JSON body"),
        }
    }
}
