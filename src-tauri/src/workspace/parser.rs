use rest_parser::{Body, RestFlavor, RestFormat};

use crate::{
    error::AppError,
    http::types::KeyValue,
    workspace::types::{HttpFileData, HttpFileRequest},
};

pub fn parse_http_file(content: &str, file_path: &str) -> Result<HttpFileData, AppError> {
    let rest_format = RestFormat::parse(content, RestFlavor::Generic)
        .map_err(|error| AppError::ParseError(format!("Failed to parse {file_path}: {error}")))?;

    let variables = rest_format
        .variables
        .into_iter()
        .map(|(key, value)| KeyValue {
            key,
            value: value.raw,
            enabled: true,
        })
        .collect();

    let requests = rest_format
        .requests
        .into_iter()
        .map(|request| {
            let headers: Vec<KeyValue> = request
                .headers
                .into_iter()
                .map(|(key, value)| KeyValue {
                    key,
                    value: value.raw,
                    enabled: true,
                })
                .collect();

            let content_type_header = headers
                .iter()
                .find(|header| header.key.eq_ignore_ascii_case("content-type"))
                .map(|header| header.value.to_lowercase());

            let body_type = match content_type_header {
                Some(content_type) if content_type.contains("json") => "json".to_string(),
                Some(content_type) if content_type.contains("x-www-form-urlencoded") => {
                    "form-urlencoded".to_string()
                }
                _ => "raw".to_string(),
            };

            let body = request.body.map(|body| match body {
                Body::Text(template) => template.raw,
                Body::LoadFromFile { filepath, .. } => format!("@file:{}", filepath.raw),
                Body::SaveToFile { text, filepath } => {
                    format!("@save:{}:{}", filepath.raw, text.raw)
                }
            });

            let commands = request.commands.into_iter().collect();

            HttpFileRequest {
                name: request.name,
                method: request.method.raw,
                url: request.url.raw,
                headers,
                body,
                body_type,
                commands,
            }
        })
        .collect();

    Ok(HttpFileData {
        path: file_path.to_string(),
        requests,
        variables,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_request_file() {
        let content = "###\nPOST https://example.com HTTP/1.1\nContent-Type: application/json\n\n{\"ok\":true}\n";

        let parsed = parse_http_file(content, "sample.http").unwrap();

        assert_eq!(parsed.requests.len(), 1);
        let request = &parsed.requests[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.url, "https://example.com");
        assert_eq!(request.headers.len(), 1);
        assert_eq!(request.headers[0].key, "Content-Type");
        assert_eq!(request.headers[0].value, "application/json");
        assert_eq!(request.body.as_deref(), Some("{\"ok\":true}"));
    }

    #[test]
    fn parse_multiple_requests_with_variables() {
        let content = "@base_url = https://example.com\n@token = abc123\n\n###\nGET {{base_url}}/one HTTP/1.1\nAuthorization: Bearer {{token}}\n\n###\nPOST {{base_url}}/two HTTP/1.1\nContent-Type: application/json\n\n{\"hello\": \"world\"}\n";

        let parsed = parse_http_file(content, "multi.http").unwrap();

        assert_eq!(parsed.variables.len(), 2);
        assert_eq!(parsed.requests.len(), 2);
        assert_eq!(parsed.requests[0].url, "{{base_url}}/one");
        assert_eq!(parsed.requests[1].method, "POST");
        assert_eq!(parsed.requests[1].body_type, "json");
        assert_eq!(
            parsed.requests[1].body,
            Some("{\"hello\": \"world\"}".to_string())
        );
    }

    #[test]
    fn parse_magic_comments_commands() {
        let content = "###\n# @name GetUsers\n# @no-log\nGET https://example.com/users HTTP/1.1\n";

        let parsed = parse_http_file(content, "commands.http").unwrap();

        assert_eq!(parsed.requests.len(), 1);
        let request = &parsed.requests[0];
        assert_eq!(request.name.as_deref(), Some("GetUsers"));
        assert!(request.commands.iter().any(|(key, _)| key == "no-log"));
    }

    #[test]
    fn parse_load_from_file_body_as_special_marker() {
        let content = "###\nPOST https://example.com/upload HTTP/1.1\nContent-Type: application/json\n\n< payload.json\n";

        let parsed = parse_http_file(content, "load.http").unwrap();

        assert_eq!(parsed.requests.len(), 1);
        assert_eq!(
            parsed.requests[0].body.as_deref(),
            Some("@file:payload.json")
        );
    }
}
