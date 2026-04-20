use rest_parser::{Body, RestFlavor, RestFormat};

use crate::{
    error::AppError,
    http::types::KeyValue,
    workspace::types::{HttpFileData, HttpFileRequest},
};

const REQUEST_VARIABLE_COMMAND: &str = "var";
const PRE_REQUEST_START_TAG: &str = "# @pre-request";
const PRE_REQUEST_END_TAG: &str = "# @end-pre-request";
const POST_RESPONSE_START_TAG: &str = "# @post-response";
const POST_RESPONSE_END_TAG: &str = "# @end-post-response";

#[derive(Clone, Default)]
struct ScriptBlocks {
    pre_request_script: Option<String>,
    post_response_script: Option<String>,
}

#[derive(Copy, Clone)]
enum ScriptBlockType {
    PreRequest,
    PostResponse,
}

pub fn parse_http_file(content: &str, file_path: &str) -> Result<HttpFileData, AppError> {
    let (script_blocks_by_block, cleaned_content) =
        extract_request_scripts_and_clean_content(content);
    let rest_format = RestFormat::parse(&cleaned_content, RestFlavor::Generic)
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
            let script_blocks = script_blocks_by_block
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
                pre_request_script: script_blocks.pre_request_script,
                post_response_script: script_blocks.post_response_script,
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

fn extract_request_scripts_and_clean_content(content: &str) -> (Vec<ScriptBlocks>, String) {
    let mut script_blocks = Vec::new();
    let mut current_block: Option<usize> = None;
    let mut active_script: Option<ScriptBlockType> = None;
    let mut active_script_lines: Vec<String> = Vec::new();
    let mut cleaned_lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("###") {
            finalize_active_script(
                &mut script_blocks,
                &mut active_script,
                &mut active_script_lines,
                current_block,
            );
            script_blocks.push(ScriptBlocks::default());
            current_block = Some(script_blocks.len() - 1);
            cleaned_lines.push(line.to_string());
            continue;
        }

        if current_block.is_none() {
            cleaned_lines.push(line.to_string());
            continue;
        }

        if let Some(script_type) = active_script {
            if is_script_end_tag(trimmed, script_type) {
                finalize_active_script(
                    &mut script_blocks,
                    &mut active_script,
                    &mut active_script_lines,
                    current_block,
                );
                continue;
            }

            if !trimmed.starts_with('#') {
                finalize_active_script(
                    &mut script_blocks,
                    &mut active_script,
                    &mut active_script_lines,
                    current_block,
                );
                cleaned_lines.push(line.to_string());
                continue;
            }

            active_script_lines.push(strip_script_comment_prefix(line));
            continue;
        }

        if let Some(script_type) = parse_script_start_tag(trimmed) {
            active_script = Some(script_type);
            active_script_lines.clear();
            continue;
        }

        cleaned_lines.push(line.to_string());
    }

    finalize_active_script(
        &mut script_blocks,
        &mut active_script,
        &mut active_script_lines,
        current_block,
    );

    let cleaned_content = cleaned_lines.join("\n");
    (script_blocks, cleaned_content)
}

fn finalize_active_script(
    script_blocks: &mut [ScriptBlocks],
    active_script: &mut Option<ScriptBlockType>,
    active_script_lines: &mut Vec<String>,
    current_block: Option<usize>,
) {
    let Some(block_index) = current_block else {
        *active_script = None;
        active_script_lines.clear();
        return;
    };

    let Some(script_type) = active_script.take() else {
        return;
    };

    let script = if active_script_lines.is_empty() {
        Some(String::new())
    } else {
        Some(active_script_lines.join("\n"))
    };

    match script_type {
        ScriptBlockType::PreRequest => {
            script_blocks[block_index].pre_request_script = script;
        }
        ScriptBlockType::PostResponse => {
            script_blocks[block_index].post_response_script = script;
        }
    }

    active_script_lines.clear();
}

fn parse_script_start_tag(trimmed_line: &str) -> Option<ScriptBlockType> {
    match trimmed_line {
        PRE_REQUEST_START_TAG => Some(ScriptBlockType::PreRequest),
        POST_RESPONSE_START_TAG => Some(ScriptBlockType::PostResponse),
        _ => None,
    }
}

fn is_script_end_tag(trimmed_line: &str, active: ScriptBlockType) -> bool {
    match active {
        ScriptBlockType::PreRequest => trimmed_line == PRE_REQUEST_END_TAG,
        ScriptBlockType::PostResponse => trimmed_line == POST_RESPONSE_END_TAG,
    }
}

fn strip_script_comment_prefix(line: &str) -> String {
    if let Some(content) = line.strip_prefix("# ") {
        content.to_string()
    } else if line.trim() == "#" {
        String::new()
    } else if let Some(content) = line.strip_prefix('#') {
        content.to_string()
    } else {
        String::new()
    }
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
        assert!(!request
            .commands
            .iter()
            .any(|(key, _)| key == "pre-request" || key == "post-response"));
        assert!(request.variables.is_empty());
    }

    #[test]
    fn parse_pre_request_script() {
        let content =
            "###\n# @pre-request\n# alloy.setVar(\"a\", 1);\n# @end-pre-request\nGET https://example.com/users HTTP/1.1\n";

        let parsed = parse_http_file(content, "scripts.http").unwrap();

        assert_eq!(parsed.requests.len(), 1);
        let request = &parsed.requests[0];
        assert_eq!(
            request.pre_request_script.as_deref(),
            Some("alloy.setVar(\"a\", 1);")
        );
        assert!(request.post_response_script.is_none());
    }

    #[test]
    fn parse_pre_and_post_request_scripts() {
        let content = "###\n# @pre-request\n# const start = Date.now();\n# @end-pre-request\n# @post-response\n# console.log('done');\n# @end-post-response\nPOST https://example.com/users HTTP/1.1\n";

        let parsed = parse_http_file(content, "scripts.http").unwrap();

        assert_eq!(parsed.requests.len(), 1);
        let request = &parsed.requests[0];
        assert_eq!(
            request.pre_request_script.as_deref(),
            Some("const start = Date.now();")
        );
        assert_eq!(
            request.post_response_script.as_deref(),
            Some("console.log('done');")
        );
    }

    #[test]
    fn parse_script_blocks_with_blank_comment_lines_preserved() {
        let content =
            "###\n# @pre-request\n#\n# const start = Date.now();\n#\n# @end-pre-request\nGET https://example.com/empty HTTP/1.1\n";

        let parsed = parse_http_file(content, "scripts.http").unwrap();

        assert_eq!(
            parsed.requests[0].pre_request_script.as_deref(),
            Some("\nconst start = Date.now();\n")
        );
    }

    #[test]
    fn parse_no_script_blocks_has_none_fields() {
        let content = "###\nGET https://example.com/users HTTP/1.1\n";

        let parsed = parse_http_file(content, "basic.http").unwrap();

        let request = &parsed.requests[0];
        assert!(request.pre_request_script.is_none());
        assert!(request.post_response_script.is_none());
    }

    #[test]
    fn parse_script_round_trip_preserves_block_content() {
        let content = "###\n# @pre-request\n# const timestamp = new Date().toISOString();\n# @end-pre-request\n# @post-response\n# const id = alloy.response.json().id;\n# @end-post-response\nGET https://example.com/users HTTP/1.1\n";

        let parsed_data = parse_http_file(content, "roundtrip.http").unwrap();
        assert_eq!(
            parsed_data.requests[0].pre_request_script,
            Some("const timestamp = new Date().toISOString();".to_string())
        );
        assert_eq!(
            parsed_data.requests[0].post_response_script,
            Some("const id = alloy.response.json().id;".to_string())
        );

        let reparsed = parse_http_file(
            &crate::workspace::serializer::serialize_http_file(&parsed_data),
            "roundtrip.http",
        )
        .unwrap();

        assert_eq!(
            reparsed.requests[0].pre_request_script,
            Some("const timestamp = new Date().toISOString();".to_string())
        );
        assert_eq!(
            reparsed.requests[0].post_response_script,
            Some("const id = alloy.response.json().id;".to_string())
        );
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
