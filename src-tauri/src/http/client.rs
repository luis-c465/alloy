use std::{path::Path, sync::LazyLock, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::{
    header::{HeaderName, HeaderValue, CONTENT_TYPE},
    multipart::{Form, Part},
    redirect::Policy,
    Method, Url,
};

use crate::error::AppError;

use super::types::{
    HttpRequestData, HttpResponseData, KeyValue, MultipartField, MultipartValue, RequestBody,
};

const MULTIPART_MEMORY_WARNING_BYTES: u64 = 100 * 1024 * 1024;
const MAX_BINARY_BASE64_BYTES: usize = 5 * 1024 * 1024;

pub struct ExecutedResponse {
    pub response: HttpResponseData,
    pub binary_body: Option<Vec<u8>>,
}

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(Policy::limited(10))
        .user_agent("Alloy/0.1.0")
        .build()
        .expect("failed to construct shared reqwest client")
});

static INSECURE_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(Policy::limited(10))
        .user_agent("Alloy/0.1.0")
        .danger_accept_invalid_certs(true)
        .build()
        .expect("failed to construct insecure reqwest client")
});

fn parse_url(raw: &str) -> Result<Url, AppError> {
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        return Err(AppError::InvalidUrl("URL cannot be empty".to_string()));
    }

    if !trimmed.contains("://") {
        return Err(AppError::InvalidUrl(
            "URL must include a scheme (http:// or https://)".to_string(),
        ));
    }

    Url::parse(trimmed).map_err(|err| AppError::InvalidUrl(err.to_string()))
}

fn parse_method(method: &str) -> Result<Method, AppError> {
    let normalized = method.trim().to_ascii_uppercase();
    let parsed = Method::from_bytes(normalized.as_bytes())
        .map_err(|_| AppError::RequestError(format!("Unsupported HTTP method: {method}")))?;

    match parsed {
        Method::GET
        | Method::POST
        | Method::PUT
        | Method::PATCH
        | Method::DELETE
        | Method::HEAD
        | Method::OPTIONS => Ok(parsed),
        _ => Err(AppError::RequestError(format!(
            "Unsupported HTTP method: {method}"
        ))),
    }
}

fn map_reqwest_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Timeout
    } else if error.is_connect() {
        AppError::NetworkError(error.to_string())
    } else {
        AppError::RequestError(error.to_string())
    }
}

fn has_content_type_header(headers: &[KeyValue]) -> bool {
    headers
        .iter()
        .any(|header| header.enabled && header.key.eq_ignore_ascii_case(CONTENT_TYPE.as_str()))
}

fn file_read_error(path: &str, error: std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::NotFound {
        AppError::FileNotFound(path.to_string())
    } else {
        AppError::FileReadError(format!("{path}: {error}"))
    }
}

fn resolve_upload_filename(path: &str, filename: Option<String>) -> Result<String, AppError> {
    if let Some(filename) = filename.filter(|value| !value.trim().is_empty()) {
        return Ok(filename);
    }

    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .ok_or_else(|| {
            AppError::FileReadError(format!("could not determine filename from path: {path}"))
        })
}

fn normalize_content_type(value: &str) -> String {
    value
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn is_textual_content_type(content_type: &str) -> bool {
    let normalized = normalize_content_type(content_type);

    normalized.starts_with("text/")
        || normalized.ends_with("+json")
        || normalized.ends_with("+xml")
        || matches!(
            normalized.as_str(),
            "application/json"
                | "application/xml"
                | "application/javascript"
                | "application/x-javascript"
                | "application/x-www-form-urlencoded"
                | "application/graphql-response+json"
                | "application/problem+json"
                | "application/ld+json"
                | "application/yaml"
                | "application/x-yaml"
                | "application/xhtml+xml"
                | "image/svg+xml"
        )
}

fn looks_like_binary_data(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }

    if bytes.contains(&0) {
        return true;
    }

    let suspicious = bytes
        .iter()
        .filter(|byte| matches!(byte, 0x01..=0x08 | 0x0B | 0x0C | 0x0E..=0x1A | 0x1C..=0x1F))
        .count();

    suspicious * 10 > bytes.len()
}

fn should_treat_as_binary(content_type: &str, bytes: &[u8]) -> bool {
    let normalized = normalize_content_type(content_type);

    if normalized.is_empty() {
        return looks_like_binary_data(bytes);
    }

    if is_textual_content_type(&normalized) {
        return looks_like_binary_data(bytes);
    }

    true
}

async fn build_multipart_form(fields: Vec<MultipartField>) -> Result<Form, AppError> {
    let mut form = Form::new();

    for field in fields.into_iter().filter(|field| field.enabled) {
        let MultipartField {
            key,
            value,
            content_type,
            ..
        } = field;

        form = match value {
            MultipartValue::Text(text) => form.text(key, text),
            MultipartValue::File { path, filename } => {
                let metadata = tokio::fs::metadata(&path)
                    .await
                    .map_err(|error| file_read_error(&path, error))?;

                if !metadata.is_file() {
                    return Err(AppError::FileReadError(format!(
                        "path is not a file: {path}"
                    )));
                }

                if metadata.len() > MULTIPART_MEMORY_WARNING_BYTES {
                    eprintln!(
                        "Warning: multipart upload '{}' is larger than 100MB and will be buffered in memory",
                        path
                    );
                }

                let data = tokio::fs::read(&path)
                    .await
                    .map_err(|error| file_read_error(&path, error))?;
                let resolved_filename = resolve_upload_filename(&path, filename)?;

                let mut part = Part::bytes(data).file_name(resolved_filename);

                if let Some(content_type) = content_type.filter(|value| !value.trim().is_empty()) {
                    part = part.mime_str(&content_type).map_err(|error| {
                        AppError::RequestError(format!(
                            "invalid multipart content type '{content_type}' for field '{key}': {error}"
                        ))
                    })?;
                }

                form.part(key, part)
            }
        };
    }

    Ok(form)
}

pub async fn execute_request(request: HttpRequestData) -> Result<ExecutedResponse, AppError> {
    let HttpRequestData {
        method,
        url: raw_url,
        headers,
        query_params,
        body,
        timeout_ms,
        skip_ssl_verification,
    } = request;

    let mut url = parse_url(&raw_url)?;

    {
        let mut query_pairs = url.query_pairs_mut();
        for param in query_params.iter().filter(|param| param.enabled) {
            query_pairs.append_pair(&param.key, &param.value);
        }
    }

    let method = parse_method(&method)?;
    let is_multipart_request = matches!(&body, RequestBody::Multipart(_));
    let user_set_content_type = !is_multipart_request && has_content_type_header(&headers);

    let client = if skip_ssl_verification {
        &*INSECURE_HTTP_CLIENT
    } else {
        &*HTTP_CLIENT
    };

    let mut builder = client.request(method, url);

    if let Some(timeout_ms) = timeout_ms.filter(|timeout_ms| *timeout_ms > 0) {
        builder = builder.timeout(Duration::from_millis(timeout_ms));
    }

    for header in headers.iter().filter(|header| header.enabled) {
        if is_multipart_request && header.key.eq_ignore_ascii_case(CONTENT_TYPE.as_str()) {
            continue;
        }

        let name = match HeaderName::from_bytes(header.key.as_bytes()) {
            Ok(name) => name,
            Err(err) => {
                eprintln!(
                    "Warning: skipping invalid header name '{}': {err}",
                    header.key
                );
                continue;
            }
        };

        let value = match HeaderValue::from_str(&header.value) {
            Ok(value) => value,
            Err(err) => {
                eprintln!(
                    "Warning: skipping invalid header value for '{}': {err}",
                    header.key
                );
                continue;
            }
        };

        builder = builder.header(name, value);
    }

    builder = match body {
        RequestBody::None => builder,
        RequestBody::Json(content) => {
            let with_body = builder.body(content);
            if user_set_content_type {
                with_body
            } else {
                with_body.header(CONTENT_TYPE, "application/json")
            }
        }
        RequestBody::FormUrlEncoded(pairs) => {
            let form_data: Vec<(String, String)> = pairs
                .into_iter()
                .filter(|pair| pair.enabled)
                .map(|pair| (pair.key, pair.value))
                .collect();
            builder.form(&form_data)
        }
        RequestBody::Raw {
            content,
            content_type,
        } => {
            let with_body = builder.body(content);
            if user_set_content_type {
                with_body
            } else {
                with_body.header(CONTENT_TYPE, content_type)
            }
        }
        RequestBody::Multipart(fields) => builder.multipart(build_multipart_form(fields).await?),
    };

    let request_start = std::time::Instant::now();
    let response = builder.send().await.map_err(map_reqwest_error)?;
    let elapsed_ms = request_start.elapsed().as_millis() as u64;

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();

    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| KeyValue {
            key: key.as_str().to_string(),
            value: value.to_str().map_or_else(
                |_| String::from_utf8_lossy(value.as_bytes()).into_owned(),
                str::to_owned,
            ),
            enabled: true,
        })
        .collect::<Vec<_>>();

    let content_length = response.content_length();
    let bytes = response.bytes().await.map_err(map_reqwest_error)?;
    let size_bytes = content_length.unwrap_or(bytes.len() as u64);
    let is_binary = should_treat_as_binary(&content_type, &bytes);

    let body_base64 = (is_binary && bytes.len() <= MAX_BINARY_BASE64_BYTES)
        .then(|| BASE64_STANDARD.encode(&bytes));

    let body = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };

    Ok(ExecutedResponse {
        response: HttpResponseData {
            status: status.as_u16(),
            status_text,
            headers,
            body,
            is_binary,
            body_base64,
            content_type,
            size_bytes,
            time_ms: elapsed_ms,
        },
        binary_body: is_binary.then_some(bytes.to_vec()),
    })
}

#[cfg(test)]
mod tests {
    use std::{net::SocketAddr, sync::Arc};

    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::{oneshot, Mutex},
    };

    async fn spawn_capture_server() -> (SocketAddr, oneshot::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("expected test listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener to have an address");
        let (request_tx, request_rx) = oneshot::channel();
        let request_tx = Arc::new(Mutex::new(Some(request_tx)));

        tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("expected incoming test connection");

            let mut buffer = Vec::new();
            let mut header_end = None;

            loop {
                let mut chunk = [0_u8; 1024];
                let read = stream
                    .read(&mut chunk)
                    .await
                    .expect("expected request bytes");

                if read == 0 {
                    break;
                }

                buffer.extend_from_slice(&chunk[..read]);

                if header_end.is_none() {
                    header_end = buffer.windows(4).position(|window| window == b"\r\n\r\n");
                }

                if let Some(header_end) = header_end {
                    let header_bytes = &buffer[..header_end + 4];
                    let headers = String::from_utf8_lossy(header_bytes);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);

                    let total_length = header_end + 4 + content_length;
                    if buffer.len() >= total_length {
                        break;
                    }
                }
            }

            let request_text = String::from_utf8_lossy(&buffer).into_owned();
            if let Some(sender) = request_tx.lock().await.take() {
                let _ = sender.send(request_text);
            }

            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
                .await
                .expect("expected test response to write");
        });

        (address, request_rx)
    }

    async fn create_temp_file(contents: &str) -> String {
        let path =
            std::env::temp_dir().join(format!("alloy-multipart-test-{}.txt", uuid::Uuid::new_v4()));
        tokio::fs::write(&path, contents)
            .await
            .expect("expected temporary multipart test file to be written");
        path.to_string_lossy().into_owned()
    }

    async fn spawn_binary_response_server(
        content_type: &'static str,
        body: &'static [u8],
    ) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("expected binary test listener to bind");
        let address = listener
            .local_addr()
            .expect("expected binary test listener to have an address");

        tokio::spawn(async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .expect("expected incoming binary test connection");

            let mut buffer = [0_u8; 1024];
            let _ = stream.read(&mut buffer).await;

            let response_head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );

            stream
                .write_all(response_head.as_bytes())
                .await
                .expect("expected binary response headers to write");
            stream
                .write_all(body)
                .await
                .expect("expected binary response body to write");
        });

        address
    }

    #[tokio::test]
    async fn execute_request_get_httpbin_returns_200() {
        let request = HttpRequestData {
            method: "GET".to_string(),
            url: "https://httpbin.org/get".to_string(),
            headers: Vec::new(),
            query_params: Vec::new(),
            body: RequestBody::None,
            timeout_ms: None,
            skip_ssl_verification: false,
        };

        let response = execute_request(request)
            .await
            .expect("expected a successful response from httpbin");

        assert_eq!(response.response.status, 200);
    }

    #[tokio::test]
    async fn execute_request_multipart_sends_text_and_file_parts() {
        let (address, request_rx) = spawn_capture_server().await;
        let file_path = create_temp_file("file payload").await;

        let request = HttpRequestData {
            method: "POST".to_string(),
            url: format!("http://{address}/upload"),
            headers: vec![KeyValue {
                key: "Content-Type".to_string(),
                value: "application/json".to_string(),
                enabled: true,
            }],
            query_params: Vec::new(),
            body: RequestBody::Multipart(vec![
                MultipartField {
                    key: "description".to_string(),
                    value: MultipartValue::Text("hello multipart".to_string()),
                    content_type: None,
                    enabled: true,
                },
                MultipartField {
                    key: "attachment".to_string(),
                    value: MultipartValue::File {
                        path: file_path.clone(),
                        filename: Some("sample.txt".to_string()),
                    },
                    content_type: Some("text/plain".to_string()),
                    enabled: true,
                },
            ]),
            timeout_ms: None,
            skip_ssl_verification: false,
        };

        let response = execute_request(request)
            .await
            .expect("expected multipart request to succeed");
        let captured_request = request_rx
            .await
            .expect("expected multipart request to be captured");
        let lowercased_request = captured_request.to_ascii_lowercase();

        assert_eq!(response.response.status, 200);
        assert!(lowercased_request.contains("content-type: multipart/form-data; boundary="));
        assert!(!lowercased_request.contains("content-type: application/json"));
        assert!(captured_request.contains("name=\"description\""));
        assert!(captured_request.contains("hello multipart"));
        assert!(captured_request.contains("name=\"attachment\"; filename=\"sample.txt\""));
        assert!(captured_request.contains("Content-Type: text/plain"));
        assert!(captured_request.contains("file payload"));

        let _ = tokio::fs::remove_file(file_path).await;
    }

    #[tokio::test]
    async fn execute_request_multipart_missing_file_returns_file_not_found() {
        let missing_path = std::env::temp_dir()
            .join(format!(
                "alloy-multipart-missing-{}.txt",
                uuid::Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();

        let request = HttpRequestData {
            method: "POST".to_string(),
            url: "http://127.0.0.1:1/upload".to_string(),
            headers: Vec::new(),
            query_params: Vec::new(),
            body: RequestBody::Multipart(vec![MultipartField {
                key: "attachment".to_string(),
                value: MultipartValue::File {
                    path: missing_path.clone(),
                    filename: None,
                },
                content_type: None,
                enabled: true,
            }]),
            timeout_ms: None,
            skip_ssl_verification: false,
        };

        let error = match execute_request(request).await {
            Ok(_) => panic!("expected missing multipart file to fail"),
            Err(error) => error,
        };

        assert!(matches!(error, AppError::FileNotFound(path) if path == missing_path));
    }

    #[tokio::test]
    async fn execute_request_binary_response_sets_base64_metadata() {
        let address =
            spawn_binary_response_server("image/png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR").await;

        let request = HttpRequestData {
            method: "GET".to_string(),
            url: format!("http://{address}/image"),
            headers: Vec::new(),
            query_params: Vec::new(),
            body: RequestBody::None,
            timeout_ms: None,
            skip_ssl_verification: false,
        };

        let response = execute_request(request)
            .await
            .expect("expected binary request to succeed");

        assert!(response.response.is_binary);
        assert_eq!(response.response.content_type, "image/png");
        assert_eq!(response.response.body, "");
        assert!(response.response.body_base64.is_some());
        assert_eq!(
            response.binary_body.as_deref(),
            Some(&b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"[..])
        );
    }

    #[tokio::test]
    #[ignore = "hits httpbin.org"]
    async fn execute_request_multipart_httpbin_returns_form_and_file_echo() {
        let file_path = create_temp_file("multipart from alloy").await;

        let request = HttpRequestData {
            method: "POST".to_string(),
            url: "https://httpbin.org/post".to_string(),
            headers: Vec::new(),
            query_params: Vec::new(),
            body: RequestBody::Multipart(vec![
                MultipartField {
                    key: "name".to_string(),
                    value: MultipartValue::Text("test".to_string()),
                    content_type: None,
                    enabled: true,
                },
                MultipartField {
                    key: "avatar".to_string(),
                    value: MultipartValue::File {
                        path: file_path.clone(),
                        filename: Some("avatar.txt".to_string()),
                    },
                    content_type: Some("text/plain".to_string()),
                    enabled: true,
                },
            ]),
            timeout_ms: None,
            skip_ssl_verification: false,
        };

        let response = execute_request(request)
            .await
            .expect("expected multipart request to succeed against httpbin");

        assert_eq!(response.response.status, 200);
        assert!(response.response.body.contains("\"name\": \"test\""));
        assert!(response
            .response
            .body
            .contains("\"avatar\": \"multipart from alloy\""));

        let _ = tokio::fs::remove_file(file_path).await;
    }
}
