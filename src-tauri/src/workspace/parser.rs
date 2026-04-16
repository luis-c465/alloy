use rest_parser::{Body, RestFlavor, RestFormat};

use crate::{
    error::AppError,
    http::types::KeyValue,
    workspace::types::{HttpFileData, HttpFileRequest},
};

const REQUEST_VARIABLE_COMMAND: &str = "var";

pub fn parse_http_file(content: &str, file_path: &str) -> Result<HttpFileData, AppError> {
    let rest_format = RestFormat::parse(content, RestFlavor::Generic)
        .map_err(|error| AppError::ParseError(format!("Failed to parse {file_path}: {error}")))?;
    let request_variables_by_block = extract_request_variables_by_block(content);

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
        .enumerate()
        .map(|(request_index, request)| {
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
            let (command_variables, commands) = split_request_variables(commands);
            let variables_from_block = request_variables_by_block
                .get(request_index)
                .cloned()
                .unwrap_or_default();
            let variables = if variables_from_block.is_empty() {
                command_variables
            } else {
                variables_from_block
            };

            HttpFileRequest {
                name: request.name,
                method: request.method.raw,
                url: request.url.raw,
                headers,
                variables,
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

fn split_request_variables(
    commands: Vec<(String, Option<String>)>,
) -> (Vec<KeyValue>, Vec<(String, Option<String>)>) {
    let mut variables = Vec::new();
    let mut filtered_commands = Vec::new();

    for (command, value) in commands {
        if let Some(variable) = parse_request_variable(&command, value.as_deref()) {
            variables.push(variable);
            continue;
        }

        if command != REQUEST_VARIABLE_COMMAND && !command.starts_with("var ") {
            filtered_commands.push((command, value));
            continue;
        }
    }

    (variables, filtered_commands)
}

fn extract_request_variables_by_block(content: &str) -> Vec<Vec<KeyValue>> {
    let mut blocks = Vec::new();
    let mut current_block: Option<usize> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("###") {
            blocks.push(Vec::new());
            current_block = Some(blocks.len() - 1);
            continue;
        }

        let Some(block_index) = current_block else {
            continue;
        };

        if let Some(variable) = parse_request_variable_line(trimmed) {
            blocks[block_index].push(variable);
        }
    }

    blocks
}

fn parse_request_variable_line(line: &str) -> Option<KeyValue> {
    let content = line
        .strip_prefix("# @var ")
        .or_else(|| line.strip_prefix("// @var "))?;
    let (key, value) = content.split_once('=')?;
    build_request_variable(key.trim(), value.trim())
}

fn parse_request_variable(command: &str, value: Option<&str>) -> Option<KeyValue> {
    let combined = if command == REQUEST_VARIABLE_COMMAND {
        value?
    } else if let Some(key_fragment) = command.strip_prefix("var ") {
        match value {
            Some(value_fragment) if !value_fragment.trim().is_empty() => {
                return build_request_variable(
                    key_fragment.trim(),
                    value_fragment.trim_start_matches('=').trim(),
                );
            }
            _ => key_fragment,
        }
    } else {
        return None;
    };

    if let Some((key, value)) = combined.split_once('=') {
        return build_request_variable(key.trim(), value.trim());
    }

    None
}

fn build_request_variable(key: &str, value: &str) -> Option<KeyValue> {
    if key.is_empty() {
        return None;
    }

    Some(KeyValue {
        key: key.to_string(),
        value: value.to_string(),
        enabled: true,
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
        assert!(request.variables.is_empty());
    }

    #[test]
    fn parse_request_level_variables_from_var_commands() {
        let content = "###\n# @name GetUsers\n# @var base_url = https://example.com\n# @var token = abc123\nGET {{base_url}}/users HTTP/1.1\nAuthorization: Bearer {{token}}\n";

        let parsed = parse_http_file(content, "request-vars.http").unwrap();

        assert_eq!(parsed.requests.len(), 1);
        let request = &parsed.requests[0];
        assert_eq!(request.variables.len(), 2);
        assert_eq!(request.variables[0].key, "base_url");
        assert_eq!(request.variables[0].value, "https://example.com");
        assert_eq!(request.variables[1].key, "token");
        assert_eq!(request.variables[1].value, "abc123");
        assert!(!request.commands.iter().any(|(key, _)| key == "var"));
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
