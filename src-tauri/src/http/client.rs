use std::{sync::LazyLock, time::Duration};

use reqwest::{
    header::{HeaderName, HeaderValue, CONTENT_TYPE},
    redirect::Policy,
    Method, Url,
};

use crate::error::AppError;

use super::types::{HttpRequestData, HttpResponseData, KeyValue, RequestBody};

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(Policy::limited(10))
        .user_agent("Alloy/0.1.0")
        .build()
        .expect("failed to construct shared reqwest client")
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

pub async fn execute_request(request: HttpRequestData) -> Result<HttpResponseData, AppError> {
    let mut url = parse_url(&request.url)?;

    {
        let mut query_pairs = url.query_pairs_mut();
        for param in request.query_params.iter().filter(|param| param.enabled) {
            query_pairs.append_pair(&param.key, &param.value);
        }
    }

    let method = parse_method(&request.method)?;
    let user_set_content_type = has_content_type_header(&request.headers);

    let mut builder = HTTP_CLIENT.request(method, url);

    for header in request.headers.iter().filter(|header| header.enabled) {
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

    builder = match request.body {
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
    };

    let request_start = std::time::Instant::now();
    let response = builder.send().await.map_err(map_reqwest_error)?;
    let elapsed_ms = request_start.elapsed().as_millis() as u64;

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();

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
    // TODO: For large payloads, stream/chunk the response body instead of buffering all text in memory.
    // TODO: Detect binary content-types and handle with a non-text response path.
    let body = response.text().await.map_err(map_reqwest_error)?;
    let size_bytes = content_length.unwrap_or(body.len() as u64);

    Ok(HttpResponseData {
        status: status.as_u16(),
        status_text,
        headers,
        body,
        size_bytes,
        time_ms: elapsed_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn execute_request_get_httpbin_returns_200() {
        let request = HttpRequestData {
            method: "GET".to_string(),
            url: "https://httpbin.org/get".to_string(),
            headers: Vec::new(),
            query_params: Vec::new(),
            body: RequestBody::None,
        };

        let response = execute_request(request)
            .await
            .expect("expected a successful response from httpbin");

        assert_eq!(response.status, 200);
    }
}
