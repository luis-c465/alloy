use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use toml::Value;

use crate::{
    environment::types::EnvironmentData,
    error::AppError,
    http::types::KeyValue,
    workspace::fs::{atomic_write, ensure_alloy_dir},
};

const ENVIRONMENTS_DIR: &str = "environments";
const CONFIG_FILE: &str = "config.toml";

#[derive(Serialize, Deserialize)]
struct EnvironmentVariableToml {
    value: String,
    #[serde(default = "default_enabled")]
    enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Serialize)]
struct EnvironmentToml {
    variables: BTreeMap<String, EnvironmentVariableToml>,
}

#[derive(Serialize)]
struct WorkspaceConfigToml<'a> {
    active_environment: Option<&'a str>,
}

pub async fn list_environments(workspace_path: &Path) -> Result<Vec<EnvironmentData>, AppError> {
    let env_dir = ensure_alloy_dir(workspace_path)
        .await?
        .join(ENVIRONMENTS_DIR);

    let mut entries = tokio::fs::read_dir(&env_dir).await?;
    let mut environments = Vec::new();

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
            continue;
        };

        if extension != "toml" {
            continue;
        }

        let Some(name) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };

        environments.push(read_environment_file(&path, name.to_string()).await?);
    }

    environments.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(environments)
}

pub async fn read_environment(
    workspace_path: &Path,
    name: &str,
) -> Result<EnvironmentData, AppError> {
    let file_path = environment_file_path(workspace_path, name).await?;
    read_environment_file(&file_path, sanitize_environment_name(name)?).await
}

pub async fn write_environment(
    workspace_path: &Path,
    env: &EnvironmentData,
) -> Result<(), AppError> {
    let sanitized = sanitize_environment_name(&env.name)?;
    let file_path = environment_file_path(workspace_path, &sanitized).await?;

    let mut variables = BTreeMap::new();
    for variable in &env.variables {
        variables.insert(
            variable.key.clone(),
            EnvironmentVariableToml {
                value: variable.value.clone(),
                enabled: variable.enabled,
            },
        );
    }

    let content = toml::to_string_pretty(&EnvironmentToml { variables })
        .map_err(|error| AppError::SerializationError(error.to_string()))?;

    atomic_write(&file_path, content.as_bytes()).await?;
    Ok(())
}

pub async fn delete_environment(workspace_path: &Path, name: &str) -> Result<(), AppError> {
    let file_path = environment_file_path(workspace_path, name).await?;
    tokio::fs::remove_file(file_path).await?;
    Ok(())
}

pub async fn read_active_environment(workspace_path: &Path) -> Result<Option<String>, AppError> {
    let config_path = workspace_path.join(".alloy").join(CONFIG_FILE);
    let exists = tokio::fs::try_exists(&config_path).await?;
    if !exists {
        return Ok(None);
    }

    let content = tokio::fs::read_to_string(config_path).await?;
    if content.trim().is_empty() {
        return Ok(None);
    }

    let value: Value = toml::from_str(&content)
        .map_err(|error| AppError::ParseError(format!("Invalid .alloy/config.toml: {error}")))?;

    let active = value
        .get("active_environment")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    Ok(active)
}

pub async fn write_active_environment(
    workspace_path: &Path,
    name: Option<&str>,
) -> Result<(), AppError> {
    let alloy_dir = ensure_alloy_dir(workspace_path).await?;
    let config_path = alloy_dir.join(CONFIG_FILE);

    let sanitized = match name {
        Some(value) => Some(sanitize_environment_name(value)?),
        None => None,
    };

    let content = toml::to_string_pretty(&WorkspaceConfigToml {
        active_environment: sanitized.as_deref(),
    })
    .map_err(|error| AppError::SerializationError(error.to_string()))?;

    atomic_write(&config_path, content.as_bytes()).await?;
    Ok(())
}

async fn read_environment_file(path: &Path, name: String) -> Result<EnvironmentData, AppError> {
    let content = tokio::fs::read_to_string(path).await?;
    let toml_value: Value = toml::from_str(&content).map_err(|error| {
        AppError::ParseError(format!(
            "Invalid environment TOML {}: {error}",
            path.display()
        ))
    })?;

    let mut variables = Vec::new();
    let variable_table = toml_value
        .get("variables")
        .and_then(Value::as_table)
        .cloned()
        .unwrap_or_default();

    for (key, value) in variable_table {
        // New format: inline table with `value` and `enabled` fields.
        // Old format (backward compat): plain scalar string.
        let (var_value, enabled) = if let Some(table) = value.as_table() {
            let v = table
                .get("value")
                .map(|v| toml_value_to_string(v))
                .transpose()
                .map_err(|message| {
                    AppError::ParseError(format!(
                        "Invalid variable value for '{key}' in {}: {message}",
                        path.display()
                    ))
                })?
                .unwrap_or_default();
            let e = table
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            (v, e)
        } else {
            // Legacy plain scalar format — treat as enabled.
            let v = toml_value_to_string(&value).map_err(|message| {
                AppError::ParseError(format!(
                    "Invalid variable value for '{key}' in {}: {message}",
                    path.display()
                ))
            })?;
            (v, true)
        };

        variables.push(KeyValue {
            key,
            value: var_value,
            enabled,
        });
    }

    variables.sort_by(|a, b| a.key.to_lowercase().cmp(&b.key.to_lowercase()));

    Ok(EnvironmentData { name, variables })
}

async fn environment_file_path(workspace_path: &Path, name: &str) -> Result<PathBuf, AppError> {
    let sanitized = sanitize_environment_name(name)?;
    let env_dir = ensure_alloy_dir(workspace_path)
        .await?
        .join(ENVIRONMENTS_DIR);
    Ok(env_dir.join(format!("{sanitized}.toml")))
}

fn sanitize_environment_name(name: &str) -> Result<String, AppError> {
    let sanitized: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_whitespace() { '-' } else { ch })
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();

    if sanitized.is_empty() {
        return Err(AppError::ParseError(
            "Environment name cannot be empty after sanitization".to_string(),
        ));
    }

    Ok(sanitized)
}

fn toml_value_to_string(value: &Value) -> Result<String, String> {
    match value {
        Value::String(value) => Ok(value.clone()),
        Value::Integer(value) => Ok(value.to_string()),
        Value::Float(value) => Ok(value.to_string()),
        Value::Boolean(value) => Ok(value.to_string()),
        Value::Datetime(value) => Ok(value.to_string()),
        Value::Array(_) | Value::Table(_) => {
            Err("only scalar values are supported in [variables]".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn environment_toml_round_trip() {
        let workspace = std::env::temp_dir().join(format!("alloy-env-config-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&workspace).await.unwrap();

        let env = EnvironmentData {
            name: "Local Dev".to_string(),
            variables: vec![
                KeyValue {
                    key: "base_url".to_string(),
                    value: "http://localhost:3000".to_string(),
                    enabled: true,
                },
                KeyValue {
                    key: "api_key".to_string(),
                    value: "dev-key-123".to_string(),
                    enabled: true,
                },
            ],
        };

        write_environment(&workspace, &env).await.unwrap();
        let loaded = read_environment(&workspace, "Local Dev").await.unwrap();

        assert_eq!(loaded.name, "local-dev");
        assert_eq!(loaded.variables.len(), 2);
        assert!(loaded
            .variables
            .iter()
            .any(|kv| kv.key == "base_url" && kv.value == "http://localhost:3000" && kv.enabled));
        assert!(loaded
            .variables
            .iter()
            .any(|kv| kv.key == "api_key" && kv.value == "dev-key-123" && kv.enabled));

        write_active_environment(&workspace, Some("Local Dev"))
            .await
            .unwrap();
        let active = read_active_environment(&workspace).await.unwrap();
        assert_eq!(active, Some("local-dev".to_string()));

        write_active_environment(&workspace, None).await.unwrap();
        let cleared = read_active_environment(&workspace).await.unwrap();
        assert_eq!(cleared, None);

        tokio::fs::remove_dir_all(workspace).await.unwrap();
    }

    #[tokio::test]
    async fn environment_toml_preserves_disabled_variables() {
        let workspace = std::env::temp_dir().join(format!("alloy-env-disabled-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&workspace).await.unwrap();

        let env = EnvironmentData {
            name: "staging".to_string(),
            variables: vec![
                KeyValue {
                    key: "active_var".to_string(),
                    value: "yes".to_string(),
                    enabled: true,
                },
                KeyValue {
                    key: "disabled_var".to_string(),
                    value: "secret".to_string(),
                    enabled: false,
                },
            ],
        };

        write_environment(&workspace, &env).await.unwrap();
        let loaded = read_environment(&workspace, "staging").await.unwrap();

        assert_eq!(loaded.variables.len(), 2);

        let active = loaded
            .variables
            .iter()
            .find(|kv| kv.key == "active_var")
            .unwrap();
        assert!(active.enabled);
        assert_eq!(active.value, "yes");

        let disabled = loaded
            .variables
            .iter()
            .find(|kv| kv.key == "disabled_var")
            .unwrap();
        assert!(!disabled.enabled);
        assert_eq!(disabled.value, "secret");

        tokio::fs::remove_dir_all(workspace).await.unwrap();
    }

    #[tokio::test]
    async fn environment_toml_reads_legacy_plain_string_format() {
        let workspace = std::env::temp_dir().join(format!("alloy-env-legacy-{}", Uuid::new_v4()));
        let env_dir = workspace.join(".alloy").join("environments");
        tokio::fs::create_dir_all(&env_dir).await.unwrap();

        // Write a legacy-format TOML file (plain key = "value").
        let legacy_content = "[variables]\nbase_url = \"http://localhost:3000\"\n";
        tokio::fs::write(env_dir.join("legacy.toml"), legacy_content)
            .await
            .unwrap();

        let loaded = read_environment(&workspace, "legacy").await.unwrap();
        assert_eq!(loaded.variables.len(), 1);
        assert_eq!(loaded.variables[0].key, "base_url");
        assert_eq!(loaded.variables[0].value, "http://localhost:3000");
        assert!(loaded.variables[0].enabled);

        tokio::fs::remove_dir_all(workspace).await.unwrap();
    }
}
