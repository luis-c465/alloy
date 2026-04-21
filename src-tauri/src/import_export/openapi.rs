use std::{collections::{BTreeSet, HashMap}, path::Path};

use serde::Deserialize;
use serde_json::Value;

use crate::{
    error::AppError,
    http::types::KeyValue,
    import_export::postman::ImportResult,
    workspace::{
        serializer::serialize_http_file,
        types::{HttpFileData, HttpFileRequest},
    },
};

const MAX_NAME_LENGTH: usize = 200;
const HTTP_METHODS: [&str; 8] = [
    "get", "post", "put", "patch", "delete", "head", "options", "trace",
];

#[derive(Clone, Copy)]
pub enum FolderStrategy {
    Tags,
    Path,
    Flat,
}

#[derive(Clone, Copy)]
pub enum NamingStrategy {
    OperationId,
    Summary,
    MethodPath,
}

pub struct OpenApiImportOptions {
    pub folder_strategy: FolderStrategy,
    pub naming_strategy: NamingStrategy,
    pub include_deprecated: bool,
    pub server_index: usize,
}

pub struct OpenApiPreviewData {
    pub title: String,
    pub version: String,
    pub openapi_version: String,
    pub servers: Vec<String>,
    pub operation_count: u32,
    pub tag_names: Vec<String>,
    pub method_counts: Vec<(String, u32)>,
}

#[derive(Clone, Copy)]
enum OpenApiVersion {
    V30,
    V31,
}

#[derive(Deserialize)]
struct VersionProbe {
    openapi: String,
}

#[derive(Clone)]
struct ParsedOperation {
    path: String,
    method: String,
    operation_id: Option<String>,
    summary: Option<String>,
    tags: Vec<String>,
    deprecated: bool,
    header_params: Vec<String>,
    request_content_type: Option<String>,
}

struct ParsedSpec {
    title: String,
    version: String,
    openapi_version: String,
    servers: Vec<String>,
    operations: Vec<ParsedOperation>,
}

pub fn preview_openapi(content: &str) -> Result<OpenApiPreviewData, AppError> {
    let parsed = parse_openapi(content)?;

    let mut tags = BTreeSet::new();
    let mut method_counts = HashMap::<String, u32>::new();

    for operation in &parsed.operations {
        for tag in &operation.tags {
            if !tag.trim().is_empty() {
                tags.insert(tag.trim().to_string());
            }
        }

        *method_counts.entry(operation.method.clone()).or_insert(0) += 1;
    }

    let mut sorted_method_counts = method_counts.into_iter().collect::<Vec<_>>();
    sorted_method_counts.sort_by(|a, b| a.0.cmp(&b.0));

    Ok(OpenApiPreviewData {
        title: parsed.title,
        version: parsed.version,
        openapi_version: parsed.openapi_version,
        servers: parsed.servers,
        operation_count: parsed.operations.len() as u32,
        tag_names: tags.into_iter().collect(),
        method_counts: sorted_method_counts,
    })
}

pub fn openapi_to_workspace(
    content: &str,
    workspace_path: &Path,
    options: &OpenApiImportOptions,
) -> Result<ImportResult, AppError> {
    if !workspace_path.exists() {
        return Err(AppError::IoError(format!(
            "Workspace path does not exist: {}",
            workspace_path.display()
        )));
    }

    if !workspace_path.is_dir() {
        return Err(AppError::IoError(format!(
            "Workspace path is not a directory: {}",
            workspace_path.display()
        )));
    }

    let parsed = parse_openapi(content)?;
    let base_url = parsed
        .servers
        .get(options.server_index)
        .cloned()
        .unwrap_or_default();

    let mut created_files = Vec::new();
    let mut warnings = Vec::new();
    let mut file_name_counts = HashMap::<String, usize>::new();

    for operation in parsed.operations {
        if operation.deprecated && !options.include_deprecated {
            continue;
        }

        let folder_path = resolve_folder_path(workspace_path, options.folder_strategy, &operation)?;
        let request_name = resolve_request_name(options.naming_strategy, &operation);

        let file_stem = unique_available_file_stem(
            &folder_path,
            &sanitize_path_segment(&request_name, "request"),
            &mut file_name_counts,
        );
        let file_path = folder_path.join(format!("{file_stem}.http"));

        let mut headers = operation
            .header_params
            .iter()
            .map(|name| KeyValue {
                key: name.clone(),
                value: format!("{{{{{name}}}}}"),
                enabled: true,
            })
            .collect::<Vec<_>>();

        if let Some(content_type) = operation.request_content_type.as_deref() {
            ensure_header(&mut headers, "Content-Type", content_type);
        }

        let request = HttpFileRequest {
            name: Some(request_name),
            method: operation.method,
            url: format!("{{{{base_url}}}}{}", convert_path_parameters(&operation.path)),
            headers,
            variables: Vec::new(),
            body: None,
            body_type: "none".to_string(),
            commands: Vec::new(),
            pre_request_script: None,
            post_response_script: None,
        };

        let http_file = HttpFileData {
            path: file_path.to_string_lossy().into_owned(),
            requests: vec![request],
            variables: vec![KeyValue {
                key: "base_url".to_string(),
                value: base_url.clone(),
                enabled: true,
            }],
        };

        std::fs::write(&file_path, serialize_http_file(&http_file)).map_err(|error| {
            AppError::IoError(format!("Failed to write {}: {error}", file_path.display()))
        })?;

        created_files.push(file_path.to_string_lossy().into_owned());
    }

    if created_files.is_empty() {
        warnings.push("No operations were imported from this specification".to_string());
    }

    Ok(ImportResult {
        created_files,
        warnings,
    })
}

fn parse_openapi(content: &str) -> Result<ParsedSpec, AppError> {
    let value = parse_content_to_json(content)?;
    let version = detect_openapi_version(&value)?;

    validate_with_crate(&value, version)?;

    let title = value
        .get("info")
        .and_then(|info| info.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("Imported OpenAPI")
        .to_string();
    let version_label = value
        .get("info")
        .and_then(|info| info.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let openapi_version = value
        .get("openapi")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let servers = value
        .get("servers")
        .and_then(Value::as_array)
        .map(|servers| {
            servers
                .iter()
                .filter_map(|server| server.get("url").and_then(Value::as_str))
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let operations = collect_operations(&value)?;

    Ok(ParsedSpec {
        title,
        version: version_label,
        openapi_version,
        servers,
        operations,
    })
}

fn parse_content_to_json(content: &str) -> Result<Value, AppError> {
    serde_json::from_str(content)
        .or_else(|_| serde_yaml_ng::from_str(content))
        .map_err(|error| AppError::ParseError(format!("Failed to parse OpenAPI document: {error}")))
}

fn detect_openapi_version(value: &Value) -> Result<OpenApiVersion, AppError> {
    let probe: VersionProbe = serde_json::from_value(value.clone()).map_err(|error| {
        AppError::ParseError(format!("Invalid OpenAPI metadata: {error}"))
    })?;

    let normalized = probe.openapi.trim();
    if !normalized.starts_with('3') {
        return Err(AppError::ParseError(format!(
            "Unsupported OpenAPI version '{normalized}'. Only OpenAPI 3.0.x and 3.1.x are supported"
        )));
    }

    if normalized.starts_with("3.0") {
        return Ok(OpenApiVersion::V30);
    }

    if normalized.starts_with("3.1") {
        return Ok(OpenApiVersion::V31);
    }

    Err(AppError::ParseError(format!(
        "Unsupported OpenAPI version '{normalized}'. Only OpenAPI 3.0.x and 3.1.x are supported"
    )))
}

fn validate_with_crate(value: &Value, version: OpenApiVersion) -> Result<(), AppError> {
    match version {
        OpenApiVersion::V30 => {
            serde_json::from_value::<openapiv3::OpenAPI>(value.clone()).map_err(|error| {
                AppError::ParseError(format!("Failed to validate OpenAPI 3.0.x document: {error}"))
            })?;
        }
        OpenApiVersion::V31 => {
            let json = serde_json::to_string(value).map_err(|error| {
                AppError::ParseError(format!("Failed to prepare OpenAPI 3.1 document: {error}"))
            })?;
            oas3::from_json(&json).map_err(|error| {
                AppError::ParseError(format!("Failed to validate OpenAPI 3.1.x document: {error}"))
            })?;
        }
    }

    Ok(())
}

fn collect_operations(spec: &Value) -> Result<Vec<ParsedOperation>, AppError> {
    let mut operations = Vec::new();

    let Some(paths) = spec.get("paths").and_then(Value::as_object) else {
        return Ok(operations);
    };

    for (path, path_item) in paths {
        let path_object = path_item.as_object().ok_or_else(|| {
            AppError::ParseError(format!("Invalid path item for '{path}'"))
        })?;

        let path_parameters = path_object
            .get("parameters")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        for method in HTTP_METHODS {
            let Some(operation) = path_object.get(method) else {
                continue;
            };

            let operation_object = operation.as_object().ok_or_else(|| {
                AppError::ParseError(format!("Invalid operation object for '{method} {path}'"))
            })?;

            let operation_parameters = operation_object
                .get("parameters")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            let merged_parameters = merge_parameters(spec, &path_parameters, &operation_parameters);
            let header_params = extract_header_parameters(spec, &merged_parameters);

            let request_content_type = operation_object
                .get("requestBody")
                .and_then(|body| resolve_reference(spec, body))
                .and_then(|body| body.get("content").and_then(Value::as_object).cloned())
                .and_then(|content| preferred_content_type(&content));

            let tags = operation_object
                .get("tags")
                .and_then(Value::as_array)
                .map(|tags| {
                    tags
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            operations.push(ParsedOperation {
                path: path.clone(),
                method: method.to_ascii_uppercase(),
                operation_id: operation_object
                    .get("operationId")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                summary: operation_object
                    .get("summary")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                tags,
                deprecated: operation_object
                    .get("deprecated")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                header_params,
                request_content_type,
            });
        }
    }

    Ok(operations)
}

fn merge_parameters(spec: &Value, path_parameters: &[Value], operation_parameters: &[Value]) -> Vec<Value> {
    let mut merged = Vec::new();
    let mut seen = BTreeSet::new();

    for parameter in path_parameters.iter().chain(operation_parameters.iter()) {
        let Some(resolved) = resolve_reference(spec, parameter) else {
            continue;
        };

        let Some(parameter_name) = resolved.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(parameter_location) = resolved.get("in").and_then(Value::as_str) else {
            continue;
        };

        let key = format!("{parameter_location}:{parameter_name}");
        if seen.insert(key) {
            merged.push(resolved);
        }
    }

    merged
}

fn extract_header_parameters(spec: &Value, parameters: &[Value]) -> Vec<String> {
    let mut headers = Vec::new();

    for parameter in parameters {
        let Some(resolved) = resolve_reference(spec, parameter) else {
            continue;
        };

        if resolved.get("in").and_then(Value::as_str) != Some("header") {
            continue;
        }

        let Some(name) = resolved.get("name").and_then(Value::as_str) else {
            continue;
        };

        if name.eq_ignore_ascii_case("content-type") {
            continue;
        }

        headers.push(name.to_string());
    }

    headers
}

fn resolve_reference(spec: &Value, value: &Value) -> Option<Value> {
    let object = value.as_object()?;

    let Some(reference) = object.get("$ref").and_then(Value::as_str) else {
        return Some(value.clone());
    };

    if !reference.starts_with("#/") {
        return None;
    }

    let pointer = &reference[1..];
    spec.pointer(pointer).cloned()
}

fn preferred_content_type(content: &serde_json::Map<String, Value>) -> Option<String> {
    if content.contains_key("application/json") {
        return Some("application/json".to_string());
    }

    content.keys().next().cloned()
}

fn resolve_folder_path(
    workspace_path: &Path,
    strategy: FolderStrategy,
    operation: &ParsedOperation,
) -> Result<std::path::PathBuf, AppError> {
    match strategy {
        FolderStrategy::Flat => Ok(workspace_path.to_path_buf()),
        FolderStrategy::Tags => {
            let tag = operation
                .tags
                .first()
                .map(|value| sanitize_path_segment(value, "untagged"))
                .unwrap_or_else(|| "untagged".to_string());
            let folder = workspace_path.join(tag);
            std::fs::create_dir_all(&folder).map_err(|error| {
                AppError::IoError(format!("Failed to create {}: {error}", folder.display()))
            })?;
            Ok(folder)
        }
        FolderStrategy::Path => {
            let first_segment = operation
                .path
                .trim_start_matches('/')
                .split('/')
                .find(|segment| !segment.trim().is_empty())
                .unwrap_or("root");
            let folder = workspace_path.join(sanitize_path_segment(first_segment, "root"));
            std::fs::create_dir_all(&folder).map_err(|error| {
                AppError::IoError(format!("Failed to create {}: {error}", folder.display()))
            })?;
            Ok(folder)
        }
    }
}

fn resolve_request_name(strategy: NamingStrategy, operation: &ParsedOperation) -> String {
    let chosen = match strategy {
        NamingStrategy::OperationId => operation.operation_id.as_deref(),
        NamingStrategy::Summary => operation.summary.as_deref(),
        NamingStrategy::MethodPath => None,
    };

    chosen
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            operation
                .summary
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| {
            operation
                .operation_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| format!("{} {}", operation.method, operation.path))
}

fn convert_path_parameters(path: &str) -> String {
    let mut result = String::with_capacity(path.len() + 16);
    let mut chars = path.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '{' {
            result.push_str("{{");

            while let Some(next) = chars.next() {
                if next == '}' {
                    result.push_str("}}");
                    break;
                }
                result.push(next);
            }

            continue;
        }

        result.push(character);
    }

    result
}

fn sanitize_path_segment(value: &str, fallback: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());

    for character in value.trim().chars() {
        if matches!(
            character,
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
        ) {
            sanitized.push('-');
            continue;
        }

        if character.is_control() {
            continue;
        }

        sanitized.push(character);
    }

    let mut normalized = sanitized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['.', ' '])
        .to_string();

    if normalized.is_empty() {
        normalized = fallback.to_string();
    }

    if normalized.len() > MAX_NAME_LENGTH {
        normalized.truncate(MAX_NAME_LENGTH);
        normalized = normalized.trim_end_matches(['.', ' ']).to_string();
    }

    normalized
}

fn unique_available_file_stem(
    parent_path: &Path,
    base: &str,
    counts: &mut HashMap<String, usize>,
) -> String {
    loop {
        let key = format!("{}::{base}", parent_path.display());
        let next = counts.entry(key).or_insert(0);
        *next += 1;

        let suffix = if *next > 1 {
            format!("-{}", *next)
        } else {
            String::new()
        };

        let allowed_len = MAX_NAME_LENGTH.saturating_sub(suffix.len());
        let mut stem = base.to_string();
        if stem.len() > allowed_len {
            stem.truncate(allowed_len);
            stem = stem.trim_end_matches(['.', ' ']).to_string();
        }

        let candidate = format!("{stem}{suffix}");
        let candidate_path = parent_path.join(format!("{candidate}.http"));

        if !candidate_path.exists() {
            return candidate;
        }
    }
}

fn ensure_header(headers: &mut Vec<KeyValue>, key: &str, value: &str) {
    if let Some(existing) = headers
        .iter_mut()
        .find(|header| header.key.eq_ignore_ascii_case(key))
    {
        if existing.value.trim().is_empty() {
            existing.value = value.to_string();
        }
        return;
    }

    headers.push(KeyValue {
        key: key.to_string(),
        value: value.to_string(),
        enabled: true,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_path_params_to_http_template_variables() {
        assert_eq!(
            convert_path_parameters("/users/{userId}/posts/{postId}"),
            "/users/{{userId}}/posts/{{postId}}"
        );
    }

    #[test]
    fn detects_openapi_versions() {
        let v30 = serde_json::json!({"openapi": "3.0.3"});
        let v31 = serde_json::json!({"openapi": "3.1.1"});

        assert!(matches!(detect_openapi_version(&v30).unwrap(), OpenApiVersion::V30));
        assert!(matches!(detect_openapi_version(&v31).unwrap(), OpenApiVersion::V31));
    }

    #[test]
    fn rejects_non_openapi_three_specs() {
        let swagger = serde_json::json!({"openapi": "2.0"});
        assert!(detect_openapi_version(&swagger).is_err());
    }
}
