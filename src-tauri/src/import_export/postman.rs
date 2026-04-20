#![allow(dead_code)]

use std::{collections::HashMap, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::Value;
use url::form_urlencoded::Serializer;

use crate::{
    error::AppError,
    http::types::KeyValue,
    workspace::{
        serializer::serialize_http_file,
        types::{HttpFileData, HttpFileRequest},
    },
};

const MAX_DIRECTORY_DEPTH: usize = 10;

/// Result of importing a Postman collection, including any non-fatal warnings
/// about skipped features (e.g. file upload fields).
#[taurpc::ipc_type]
pub struct ImportResult {
    pub created_files: Vec<String>,
    pub warnings: Vec<String>,
}
const MAX_NAME_LENGTH: usize = 200;
const DEFAULT_MULTIPART_BOUNDARY: &str = "----AlloyPostmanImportBoundary";

#[derive(Debug, Deserialize)]
pub struct PostmanCollection {
    pub info: PostmanInfo,
    #[serde(default)]
    pub item: Vec<PostmanItem>,
    #[serde(default)]
    pub variable: Vec<PostmanVariable>,
    pub auth: Option<PostmanAuth>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanInfo {
    pub name: String,
    pub schema: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanVariable {
    pub key: Option<String>,
    pub id: Option<String>,
    pub value: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanItem {
    pub name: String,
    #[serde(default)]
    pub item: Vec<PostmanItem>,
    pub request: Option<PostmanRequest>,
    pub auth: Option<PostmanAuth>,
    #[serde(default)]
    pub variable: Vec<PostmanVariable>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanRequest {
    Detailed(Box<PostmanRequestObject>),
    RawUrl(String),
}

#[derive(Debug, Deserialize)]
pub struct PostmanRequestObject {
    pub method: Option<String>,
    #[serde(default)]
    pub header: Vec<PostmanHeader>,
    pub body: Option<PostmanBody>,
    pub url: Option<PostmanUrl>,
    pub auth: Option<PostmanAuth>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanHeader {
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanBody {
    pub mode: Option<String>,
    pub raw: Option<String>,
    #[serde(default)]
    pub urlencoded: Vec<PostmanKeyValue>,
    #[serde(default)]
    pub formdata: Vec<PostmanFormData>,
    pub file: Option<PostmanFileBody>,
    pub options: Option<PostmanBodyOptions>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanBodyOptions {
    pub raw: Option<PostmanRawOptions>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanRawOptions {
    pub language: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanKeyValue {
    pub key: String,
    pub value: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanFormData {
    pub key: String,
    pub value: Option<String>,
    pub src: Option<Value>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub content_type: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanFileBody {
    pub src: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanUrl {
    Raw(String),
    Detailed(PostmanUrlObject),
}

#[derive(Debug, Deserialize)]
pub struct PostmanUrlObject {
    pub raw: Option<String>,
    pub protocol: Option<String>,
    pub host: Option<PostmanStringList>,
    pub path: Option<PostmanPathList>,
    pub port: Option<String>,
    #[serde(default)]
    pub query: Vec<PostmanQueryParam>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanStringList {
    String(String),
    List(Vec<String>),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanPathList {
    String(String),
    List(Vec<PostmanPathSegment>),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanPathSegment {
    String(String),
    Variable(PostmanPathVariable),
}

#[derive(Debug, Deserialize)]
pub struct PostmanPathVariable {
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct PostmanQueryParam {
    pub key: String,
    pub value: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanAuth {
    #[serde(rename = "type")]
    pub kind: String,
    pub basic: Option<Value>,
    pub bearer: Option<Value>,
    pub apikey: Option<Value>,
    pub noauth: Option<Value>,
}

pub fn parse_postman_collection(json: &str) -> Result<PostmanCollection, AppError> {
    let collection: PostmanCollection = serde_json::from_str(json).map_err(|error| {
        AppError::ParseError(format!("Failed to parse Postman collection JSON: {error}"))
    })?;

    if let Some(schema) = collection.info.schema.as_deref() {
        let normalized = schema.to_ascii_lowercase();
        // Accept any v2.x Postman collection schema rather than pinning to
        // specific minor versions.  This prevents future Postman exports
        // (e.g. v2.2.0) from being rejected outright.
        if !normalized.contains("postman.com/json/collection/v2") {
            return Err(AppError::ParseError(format!(
                "Unsupported Postman collection schema: {schema}"
            )));
        }
    }

    Ok(collection)
}

pub fn postman_to_workspace(
    collection: &PostmanCollection,
    workspace_path: &Path,
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

    let mut created_paths = Vec::new();
    let mut warnings = Vec::new();
    import_items(
        &collection.item,
        workspace_path,
        0,
        collection.auth.as_ref(),
        &mut created_paths,
        &mut warnings,
    )?;

    Ok(ImportResult {
        created_files: created_paths,
        warnings,
    })
}

fn import_items(
    items: &[PostmanItem],
    parent_path: &Path,
    depth: usize,
    inherited_auth: Option<&PostmanAuth>,
    created_paths: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<(), AppError> {
    if depth >= MAX_DIRECTORY_DEPTH {
        return Err(AppError::ParseError(format!(
            "Postman folder nesting exceeds the supported depth of {MAX_DIRECTORY_DEPTH}"
        )));
    }

    let mut file_name_counts = HashMap::<String, usize>::new();
    let mut directory_name_counts = HashMap::<String, usize>::new();

    for item in items {
        let scoped_auth = scoped_auth(item.auth.as_ref(), inherited_auth);

        if !item.item.is_empty() {
            let directory_name = unique_available_name(
                parent_path,
                sanitize_path_segment(&item.name, "collection"),
                &mut directory_name_counts,
                None,
            );
            let directory_path = parent_path.join(directory_name);
            std::fs::create_dir_all(&directory_path)?;

            import_items(
                &item.item,
                &directory_path,
                depth + 1,
                scoped_auth,
                created_paths,
                warnings,
            )?;

            continue;
        }

        let Some(request) = item.request.as_ref() else {
            warnings.push(format!(
                "'{}': skipped — item does not contain a request",
                item.name
            ));
            continue;
        };

        let file_stem = unique_available_name(
            parent_path,
            sanitize_path_segment(&item.name, "request"),
            &mut file_name_counts,
            Some("http"),
        );
        let file_path = parent_path.join(format!("{file_stem}.http"));
        let request_data = postman_item_to_http_request(item, request, scoped_auth, warnings)?;
        let http_file = HttpFileData {
            path: file_path.to_string_lossy().into_owned(),
            requests: vec![request_data],
            variables: Vec::new(),
        };

        std::fs::write(&file_path, serialize_http_file(&http_file))?;
        created_paths.push(file_path.to_string_lossy().into_owned());
    }

    Ok(())
}

fn postman_item_to_http_request(
    item: &PostmanItem,
    request: &PostmanRequest,
    inherited_auth: Option<&PostmanAuth>,
    warnings: &mut Vec<String>,
) -> Result<HttpFileRequest, AppError> {
    let mut normalized = normalize_request(request, &item.name, warnings)?;
    let request_auth = match request {
        PostmanRequest::Detailed(details) => scoped_auth(details.auth.as_ref(), inherited_auth),
        PostmanRequest::RawUrl(_) => inherited_auth,
    };

    apply_auth(&mut normalized.url, &mut normalized.headers, request_auth);

    Ok(HttpFileRequest {
        name: Some(item.name.trim().to_string()).filter(|value| !value.is_empty()),
        method: normalized.method,
        url: normalized.url,
        headers: normalized.headers,
        variables: Vec::new(),
        body: normalized.body,
        body_type: normalized.body_type,
        commands: Vec::new(),
        pre_request_script: None,
        post_response_script: None,
    })
}

struct NormalizedRequest {
    method: String,
    url: String,
    headers: Vec<KeyValue>,
    body: Option<String>,
    body_type: String,
}

fn normalize_request(
    request: &PostmanRequest,
    request_name: &str,
    warnings: &mut Vec<String>,
) -> Result<NormalizedRequest, AppError> {
    match request {
        PostmanRequest::RawUrl(url) => Ok(NormalizedRequest {
            method: "GET".to_string(),
            url: url.trim().to_string(),
            headers: Vec::new(),
            body: None,
            body_type: "none".to_string(),
        }),
        PostmanRequest::Detailed(request) => {
            let method = request
                .method
                .as_deref()
                .unwrap_or("GET")
                .trim()
                .to_uppercase();
            let url = resolve_url(request.url.as_ref(), request_name)?;
            let mut headers = request
                .header
                .iter()
                .filter(|header| !header.disabled && !header.key.trim().is_empty())
                .map(|header| KeyValue {
                    key: header.key.trim().to_string(),
                    value: header.value.clone(),
                    enabled: true,
                })
                .collect::<Vec<_>>();

            let normalized_body =
                normalize_body(request.body.as_ref(), &mut headers, request_name, warnings);

            Ok(NormalizedRequest {
                method: if method.is_empty() {
                    "GET".to_string()
                } else {
                    method
                },
                url,
                headers,
                body: normalized_body.body,
                body_type: normalized_body.body_type,
            })
        }
    }
}

struct NormalizedBody {
    body: Option<String>,
    body_type: String,
}

fn normalize_body(
    body: Option<&PostmanBody>,
    headers: &mut Vec<KeyValue>,
    request_name: &str,
    warnings: &mut Vec<String>,
) -> NormalizedBody {
    let Some(body) = body else {
        return NormalizedBody {
            body: None,
            body_type: "none".to_string(),
        };
    };

    if body.disabled {
        return NormalizedBody {
            body: None,
            body_type: "none".to_string(),
        };
    }

    match body.mode.as_deref().unwrap_or("raw") {
        "raw" => normalize_raw_body(body, headers),
        "urlencoded" => normalize_urlencoded_body(body, headers),
        "formdata" => normalize_formdata_body(body, headers, request_name, warnings),
        "file" => {
            let src = body
                .file
                .as_ref()
                .and_then(|file| file.src.as_deref())
                .unwrap_or("<unknown>");
            warnings.push(format!(
                "'{request_name}': file body reference skipped ({src}) \
                 — file uploads must be re-configured manually"
            ));
            NormalizedBody {
                body: None,
                body_type: "none".to_string(),
            }
        }
        _ => NormalizedBody {
            body: body.raw.clone().filter(|value| !value.is_empty()),
            body_type: "raw".to_string(),
        },
    }
}

fn normalize_raw_body(body: &PostmanBody, headers: &mut Vec<KeyValue>) -> NormalizedBody {
    let content = body.raw.clone().unwrap_or_default();
    let language = body
        .options
        .as_ref()
        .and_then(|options| options.raw.as_ref())
        .and_then(|raw| raw.language.as_deref())
        .map(str::to_ascii_lowercase);

    let has_json_header = find_header(headers, "content-type")
        .map(|value| value.to_ascii_lowercase().contains("json"))
        .unwrap_or(false);

    if has_json_header || matches!(language.as_deref(), Some("json")) {
        ensure_header(headers, "Content-Type", "application/json");
        return NormalizedBody {
            body: Some(content),
            body_type: "json".to_string(),
        };
    }

    NormalizedBody {
        body: Some(content).filter(|value| !value.is_empty()),
        body_type: "raw".to_string(),
    }
}

fn normalize_urlencoded_body(body: &PostmanBody, headers: &mut Vec<KeyValue>) -> NormalizedBody {
    let mut serializer = Serializer::new(String::new());

    for field in body.urlencoded.iter().filter(|field| !field.disabled) {
        serializer.append_pair(&field.key, field.value.as_deref().unwrap_or(""));
    }

    ensure_header(headers, "Content-Type", "application/x-www-form-urlencoded");
    let encoded = serializer.finish();

    NormalizedBody {
        body: (!encoded.is_empty()).then_some(encoded),
        body_type: "form-urlencoded".to_string(),
    }
}

fn normalize_formdata_body(
    body: &PostmanBody,
    headers: &mut Vec<KeyValue>,
    request_name: &str,
    warnings: &mut Vec<String>,
) -> NormalizedBody {
    let mut lines = Vec::new();
    let mut skipped_file_fields = Vec::new();

    for field in body.formdata.iter().filter(|field| !field.disabled) {
        match field.kind.as_deref() {
            Some("file") => skipped_file_fields.push(field.key.clone()),
            _ => {
                lines.push(format!("--{DEFAULT_MULTIPART_BOUNDARY}"));
                lines.push(format!(
                    "Content-Disposition: form-data; name=\"{}\"",
                    field.key.replace('"', "\\\"")
                ));

                if let Some(content_type) = field
                    .content_type
                    .as_deref()
                    .filter(|value| !value.is_empty())
                {
                    lines.push(format!("Content-Type: {content_type}"));
                }

                lines.push(String::new());
                lines.push(field.value.clone().unwrap_or_default());
            }
        }
    }

    if !skipped_file_fields.is_empty() {
        warnings.push(format!(
            "'{request_name}': multipart file fields skipped ({}) \
             — file uploads must be re-configured manually",
            skipped_file_fields.join(", ")
        ));
    }

    if lines.is_empty() {
        return NormalizedBody {
            body: None,
            body_type: "none".to_string(),
        };
    }

    lines.push(format!("--{DEFAULT_MULTIPART_BOUNDARY}--"));
    let content_type = format!("multipart/form-data; boundary={DEFAULT_MULTIPART_BOUNDARY}");
    ensure_header(headers, "Content-Type", &content_type);

    NormalizedBody {
        body: Some(lines.join("\r\n")),
        body_type: "raw".to_string(),
    }
}

fn resolve_url(url: Option<&PostmanUrl>, request_name: &str) -> Result<String, AppError> {
    let Some(url) = url else {
        return Err(AppError::ParseError(format!(
            "Postman request '{request_name}' does not include a URL"
        )));
    };

    let resolved = match url {
        PostmanUrl::Raw(raw) => raw.trim().to_string(),
        PostmanUrl::Detailed(details) => {
            if let Some(raw) = details
                .raw
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                raw.trim().to_string()
            } else {
                build_url_from_parts(details)
            }
        }
    };

    if resolved.is_empty() {
        return Err(AppError::ParseError(format!(
            "Postman request '{request_name}' has an empty URL"
        )));
    }

    Ok(resolved)
}

fn build_url_from_parts(details: &PostmanUrlObject) -> String {
    let host = match details.host.as_ref() {
        Some(PostmanStringList::String(value)) => value.clone(),
        Some(PostmanStringList::List(values)) => values.join("."),
        None => String::new(),
    };

    let mut url = String::new();
    if let Some(protocol) = details
        .protocol
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        url.push_str(protocol);
        url.push_str("://");
    }

    url.push_str(&host);

    if let Some(port) = details.port.as_deref().filter(|value| !value.is_empty()) {
        url.push(':');
        url.push_str(port);
    }

    let path = match details.path.as_ref() {
        Some(PostmanPathList::String(value)) => value.trim_matches('/').to_string(),
        Some(PostmanPathList::List(values)) => values
            .iter()
            .map(|segment| match segment {
                PostmanPathSegment::String(value) => value.clone(),
                PostmanPathSegment::Variable(variable) => variable.value.clone(),
            })
            .collect::<Vec<_>>()
            .join("/"),
        None => String::new(),
    };

    if !path.is_empty() {
        if !url.ends_with('/') {
            url.push('/');
        }
        url.push_str(&path);
    }

    let query = details
        .query
        .iter()
        .filter(|value| !value.disabled && !value.key.trim().is_empty())
        .fold(Serializer::new(String::new()), |mut serializer, value| {
            serializer.append_pair(&value.key, value.value.as_deref().unwrap_or(""));
            serializer
        })
        .finish();

    if !query.is_empty() {
        if url.contains('?') {
            url.push('&');
        } else {
            url.push('?');
        }
        url.push_str(&query);
    }

    url
}

fn apply_auth(url: &mut String, headers: &mut Vec<KeyValue>, auth: Option<&PostmanAuth>) {
    let Some(auth) = auth else {
        return;
    };

    match auth.kind.to_ascii_lowercase().as_str() {
        "basic" => {
            if has_header(headers, "authorization") {
                return;
            }

            let username = get_auth_attr(auth.basic.as_ref(), "username").unwrap_or_default();
            let password = get_auth_attr(auth.basic.as_ref(), "password").unwrap_or_default();
            let encoded = BASE64_STANDARD.encode(format!("{username}:{password}"));
            headers.push(KeyValue {
                key: "Authorization".to_string(),
                value: format!("Basic {encoded}"),
                enabled: true,
            });
        }
        "bearer" => {
            if has_header(headers, "authorization") {
                return;
            }

            if let Some(token) = get_auth_attr(auth.bearer.as_ref(), "token") {
                headers.push(KeyValue {
                    key: "Authorization".to_string(),
                    value: format!("Bearer {token}"),
                    enabled: true,
                });
            }
        }
        "apikey" => {
            let Some(key) = get_auth_attr(auth.apikey.as_ref(), "key") else {
                return;
            };
            let value = get_auth_attr(auth.apikey.as_ref(), "value").unwrap_or_default();
            let location = get_auth_attr(auth.apikey.as_ref(), "in")
                .unwrap_or_else(|| "header".to_string())
                .to_ascii_lowercase();

            if location == "query" {
                let separator = if url.contains('?') { '&' } else { '?' };
                url.push(separator);
                let mut serializer = Serializer::new(String::new());
                serializer.append_pair(&key, &value);
                url.push_str(&serializer.finish());
            } else if !has_header(headers, &key) {
                headers.push(KeyValue {
                    key,
                    value,
                    enabled: true,
                });
            }
        }
        _ => {}
    }
}

fn scoped_auth<'a>(
    current: Option<&'a PostmanAuth>,
    inherited: Option<&'a PostmanAuth>,
) -> Option<&'a PostmanAuth> {
    match current {
        Some(auth) if auth.kind.eq_ignore_ascii_case("noauth") || auth.noauth.is_some() => None,
        Some(auth) => Some(auth),
        None => inherited,
    }
}

fn get_auth_attr(value: Option<&Value>, key: &str) -> Option<String> {
    let value = value?;

    match value {
        Value::Array(items) => items.iter().find_map(|item| {
            let object = item.as_object()?;
            let item_key = object.get("key")?.as_str()?;
            if item_key != key {
                return None;
            }

            value_to_string(object.get("value"))
        }),
        Value::Object(object) => value_to_string(object.get(key)),
        _ => None,
    }
}

fn value_to_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Bool(boolean) => Some(boolean.to_string()),
        Value::Number(number) => Some(number.to_string()),
        Value::Null => None,
        other => Some(other.to_string()),
    }
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

fn unique_name(base: String, counts: &mut HashMap<String, usize>) -> String {
    let next_count = counts.entry(base.clone()).or_insert(0);
    *next_count += 1;

    if *next_count == 1 {
        return base;
    }

    let suffix = format!("-{}", *next_count);
    let allowed_len = MAX_NAME_LENGTH.saturating_sub(suffix.len());
    let mut trimmed = base;
    if trimmed.len() > allowed_len {
        trimmed.truncate(allowed_len);
        trimmed = trimmed.trim_end_matches(['.', ' ']).to_string();
    }

    format!("{trimmed}{suffix}")
}

fn unique_available_name(
    parent_path: &Path,
    base: String,
    counts: &mut HashMap<String, usize>,
    extension: Option<&str>,
) -> String {
    loop {
        let candidate = unique_name(base.clone(), counts);
        let path = match extension {
            Some(extension) => parent_path.join(format!("{candidate}.{extension}")),
            None => parent_path.join(&candidate),
        };

        if !path.exists() {
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

fn find_header<'a>(headers: &'a [KeyValue], key: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|header| header.key.eq_ignore_ascii_case(key))
        .map(|header| header.value.as_str())
}

fn has_header(headers: &[KeyValue], key: &str) -> bool {
    find_header(headers, key).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_postman_collection_accepts_v21() {
        let collection = parse_postman_collection(
            r#"{
                "info": {
                    "name": "Sample",
                    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
                },
                "item": []
            }"#,
        )
        .unwrap();

        assert_eq!(collection.info.name, "Sample");
    }

    #[test]
    fn postman_to_workspace_creates_nested_http_files() {
        let workspace = temp_workspace("postman-import");
        let collection = parse_postman_collection(
            r#"{
                "info": {
                    "name": "Imported Collection",
                    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
                },
                "item": [
                    {
                        "name": "Users",
                        "item": [
                            {
                                "name": "Get Users",
                                "request": {
                                    "method": "GET",
                                    "url": {
                                        "raw": "{{baseUrl}}/users"
                                    }
                                }
                            }
                        ]
                    },
                    {
                        "name": "Create User",
                        "request": {
                            "method": "POST",
                            "header": [{
                                "key": "Content-Type",
                                "value": "application/json"
                            }],
                            "body": {
                                "mode": "raw",
                                "raw": "{\"name\":\"Alice\"}",
                                "options": { "raw": { "language": "json" } }
                            },
                            "url": {
                                "raw": "{{baseUrl}}/users"
                            }
                        }
                    }
                ]
            }"#,
        )
        .unwrap();

        let result = postman_to_workspace(&collection, &workspace).unwrap();

        assert_eq!(result.created_files.len(), 2);
        let nested_file = workspace.join("Users").join("Get Users.http");
        let top_level_file = workspace.join("Create User.http");
        assert!(nested_file.exists());
        assert!(top_level_file.exists());

        let top_level_content = std::fs::read_to_string(top_level_file).unwrap();
        assert!(top_level_content.contains("POST {{baseUrl}}/users HTTP/1.1"));
        assert!(top_level_content.contains("Content-Type: application/json"));
        assert!(top_level_content.contains("{\"name\":\"Alice\"}"));
    }

    #[test]
    fn duplicate_request_names_get_numbered_suffixes() {
        let workspace = temp_workspace("postman-duplicates");
        let collection = parse_postman_collection(
            r#"{
                "info": { "name": "Dupes", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
                "item": [
                    { "name": "Get Users", "request": { "method": "GET", "url": { "raw": "https://example.com/users/1" } } },
                    { "name": "Get Users", "request": { "method": "GET", "url": { "raw": "https://example.com/users/2" } } }
                ]
            }"#,
        )
        .unwrap();

        postman_to_workspace(&collection, &workspace).unwrap();

        assert!(workspace.join("Get Users.http").exists());
        assert!(workspace.join("Get Users-2.http").exists());
    }

    #[test]
    fn request_auth_is_converted_to_headers() {
        let workspace = temp_workspace("postman-auth");
        let collection = parse_postman_collection(
            r#"{
                "info": { "name": "Auth", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
                "item": [
                    {
                        "name": "Bearer Auth",
                        "request": {
                            "method": "GET",
                            "auth": {
                                "type": "bearer",
                                "bearer": [{ "key": "token", "value": "{{token}}" }]
                            },
                            "url": { "raw": "https://example.com/me" }
                        }
                    }
                ]
            }"#,
        )
        .unwrap();

        postman_to_workspace(&collection, &workspace).unwrap();

        let content = std::fs::read_to_string(workspace.join("Bearer Auth.http")).unwrap();
        assert!(content.contains("Authorization: Bearer {{token}}"));
    }

    #[test]
    fn postman_import_accepts_v2_schema_variants() {
        // Future v2.2.0 schema should be accepted.
        let json = r#"{
            "info": {
                "name": "Test",
                "schema": "https://schema.getpostman.com/json/collection/v2.2.0/collection.json"
            },
            "item": []
        }"#;
        assert!(parse_postman_collection(json).is_ok());

        // v1.0.0 should be rejected.
        let json_v1 = r#"{
            "info": {
                "name": "Test",
                "schema": "https://schema.getpostman.com/json/collection/v1.0.0/collection.json"
            },
            "item": []
        }"#;
        assert!(parse_postman_collection(json_v1).is_err());
    }

    fn temp_workspace(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("alloy-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
}
