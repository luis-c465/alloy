use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    http::types::KeyValue,
    workspace::{fs, types::FolderConfig},
};

pub const FOLDER_CONFIG_FILE_NAME: &str = "folder.toml";

#[derive(Serialize, Deserialize, Default)]
struct FolderConfigToml {
    #[serde(default)]
    headers: Vec<KeyValue>,
    #[serde(default)]
    variables: Vec<KeyValue>,
    #[serde(default)]
    auth: FolderAuthToml,
}

#[derive(Serialize, Deserialize)]
struct FolderAuthToml {
    #[serde(default = "default_auth_type")]
    auth_type: String,
    #[serde(default)]
    bearer: Option<String>,
    #[serde(default)]
    basic_username: Option<String>,
    #[serde(default)]
    basic_password: Option<String>,
}

impl Default for FolderAuthToml {
    fn default() -> Self {
        Self {
            auth_type: default_auth_type(),
            bearer: None,
            basic_username: None,
            basic_password: None,
        }
    }
}

fn default_auth_type() -> String {
    "none".to_string()
}

fn normalize_auth_type(value: &str) -> String {
    // "inherit" is not a valid auth type for folders (only for requests).
    // Any unrecognised value — including a hand-edited "inherit" — falls
    // back to "none" so it can never propagate into the inheritance chain.
    match value.to_ascii_lowercase().as_str() {
        "bearer" => "bearer".to_string(),
        "basic" => "basic".to_string(),
        _ => "none".to_string(),
    }
}

pub fn default_folder_config() -> FolderConfig {
    FolderConfig {
        headers: Vec::new(),
        variables: Vec::new(),
        auth_type: "none".to_string(),
        auth_bearer: None,
        auth_basic_username: None,
        auth_basic_password: None,
    }
}

fn to_folder_config(data: FolderConfigToml) -> FolderConfig {
    FolderConfig {
        headers: data.headers,
        variables: data.variables,
        auth_type: normalize_auth_type(&data.auth.auth_type),
        auth_bearer: data.auth.bearer,
        auth_basic_username: data.auth.basic_username,
        auth_basic_password: data.auth.basic_password,
    }
}

fn to_toml_data(config: &FolderConfig) -> FolderConfigToml {
    FolderConfigToml {
        headers: config.headers.clone(),
        variables: config.variables.clone(),
        auth: FolderAuthToml {
            auth_type: normalize_auth_type(&config.auth_type),
            bearer: config.auth_bearer.clone(),
            basic_username: config.auth_basic_username.clone(),
            basic_password: config.auth_basic_password.clone(),
        },
    }
}

fn folder_config_path(folder_path: &Path) -> PathBuf {
    folder_path.join(FOLDER_CONFIG_FILE_NAME)
}

pub async fn folder_config_exists(folder_path: &Path) -> Result<bool, AppError> {
    let config_path = folder_config_path(folder_path);
    Ok(tokio::fs::try_exists(config_path).await?)
}

pub async fn read_folder_config(folder_path: &Path) -> Result<FolderConfig, AppError> {
    let config_path = folder_config_path(folder_path);
    let exists = tokio::fs::try_exists(&config_path).await?;
    if !exists {
        return Ok(default_folder_config());
    }

    let content = fs::read_file_content(&config_path).await?;
    let parsed: FolderConfigToml = toml::from_str(&content).map_err(|error| {
        AppError::ParseError(format!(
            "Failed to parse folder config {}: {error}",
            config_path.display()
        ))
    })?;

    Ok(to_folder_config(parsed))
}

pub async fn write_folder_config(
    folder_path: &Path,
    config: &FolderConfig,
) -> Result<(), AppError> {
    let path = folder_config_path(folder_path);
    let toml_data = to_toml_data(config);
    let content = toml::to_string_pretty(&toml_data).map_err(|error| {
        AppError::SerializationError(format!(
            "Failed to serialize folder config {}: {error}",
            path.display()
        ))
    })?;

    fs::atomic_write(&path, content.as_bytes()).await
}

pub async fn load_folder_chain(
    workspace_path: &Path,
    file_path: &Path,
) -> Result<Vec<(String, FolderConfig)>, AppError> {
    let canonical_workspace = std::fs::canonicalize(workspace_path).map_err(|error| {
        AppError::IoError(format!(
            "Cannot resolve workspace path {}: {error}",
            workspace_path.display()
        ))
    })?;
    let canonical_file = std::fs::canonicalize(file_path).map_err(|error| {
        AppError::IoError(format!(
            "Cannot resolve file path {}: {error}",
            file_path.display()
        ))
    })?;

    if !canonical_file.starts_with(&canonical_workspace) {
        return Err(AppError::IoError(format!(
            "Request file is outside workspace: {}",
            file_path.display()
        )));
    }

    let mut folders = Vec::new();
    let mut current = canonical_file.parent().map(|value| value.to_path_buf());

    while let Some(path) = current {
        if !path.starts_with(&canonical_workspace) {
            break;
        }
        folders.push(path.clone());

        if path == canonical_workspace {
            break;
        }

        current = path.parent().map(|value| value.to_path_buf());
    }

    folders.reverse();

    let mut entries = Vec::new();
    for folder in folders {
        if !folder_config_exists(&folder).await? {
            continue;
        }
        let folder_path = folder.to_string_lossy().into_owned();
        let config = read_folder_config(&folder).await?;
        entries.push((folder_path, config));
    }

    Ok(entries)
}
