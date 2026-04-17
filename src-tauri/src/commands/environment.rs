use std::{collections::HashMap, sync::Arc};

use handlebars::Handlebars;

use crate::{
    environment::{
        config,
        resolver::resolve_template,
        types::{EnvironmentData, EnvironmentList},
    },
    error::AppError,
    http::types::KeyValue,
};

#[taurpc::procedures(path = "environment", export_to = "../src/bindings.ts")]
pub trait EnvironmentApi {
    async fn list_environments(workspace_path: String) -> Result<EnvironmentList, AppError>;
    async fn read_environment(
        workspace_path: String,
        name: String,
    ) -> Result<EnvironmentData, AppError>;
    async fn save_environment(workspace_path: String, env: EnvironmentData)
        -> Result<(), AppError>;
    async fn delete_environment(workspace_path: String, name: String) -> Result<(), AppError>;
    async fn set_active_environment(
        workspace_path: String,
        name: Option<String>,
    ) -> Result<(), AppError>;
    async fn resolve_url_preview(
        url: String,
        workspace_path: String,
        env_name: Option<String>,
        request_variables: Vec<KeyValue>,
    ) -> Result<String, AppError>;
}

#[derive(Clone)]
pub struct EnvironmentApiImpl {
    pub hbs: Arc<Handlebars<'static>>,
}

impl EnvironmentApiImpl {
    fn merge_request_variables(
        request_variables: Vec<KeyValue>,
        mut variables: HashMap<String, String>,
    ) -> HashMap<String, String> {
        for variable in request_variables
            .into_iter()
            .filter(|variable| variable.enabled)
        {
            let key = variable.key.trim();
            if key.is_empty() {
                continue;
            }

            variables.insert(key.to_string(), variable.value);
        }

        variables
    }
}

#[taurpc::resolvers]
impl EnvironmentApi for EnvironmentApiImpl {
    async fn list_environments(self, workspace_path: String) -> Result<EnvironmentList, AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        let environments = config::list_environments(&workspace).await?;
        let active = config::read_active_environment(&workspace).await?;

        Ok(EnvironmentList {
            environments,
            active,
        })
    }

    async fn read_environment(
        self,
        workspace_path: String,
        name: String,
    ) -> Result<EnvironmentData, AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        config::read_environment(&workspace, &name).await
    }

    async fn save_environment(
        self,
        workspace_path: String,
        env: EnvironmentData,
    ) -> Result<(), AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        config::write_environment(&workspace, &env).await
    }

    async fn delete_environment(
        self,
        workspace_path: String,
        name: String,
    ) -> Result<(), AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        config::delete_environment(&workspace, &name).await
    }

    async fn set_active_environment(
        self,
        workspace_path: String,
        name: Option<String>,
    ) -> Result<(), AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        config::write_active_environment(&workspace, name.as_deref()).await
    }

    async fn resolve_url_preview(
        self,
        url: String,
        workspace_path: String,
        env_name: Option<String>,
        request_variables: Vec<KeyValue>,
    ) -> Result<String, AppError> {
        let variables = if let Some(env_name) = env_name {
            let workspace = validate_workspace_path(&workspace_path)?;
            let env = config::read_environment(&workspace, &env_name).await?;
            env.variables
                .into_iter()
                .filter(|variable| variable.enabled)
                .map(|variable| (variable.key, variable.value))
                .collect::<HashMap<_, _>>()
        } else {
            HashMap::new()
        };
        let variables = Self::merge_request_variables(request_variables, variables);

        resolve_template(&self.hbs, &url, &variables)
    }
}

fn validate_workspace_path(workspace_path: &str) -> Result<std::path::PathBuf, AppError> {
    let path = std::path::PathBuf::from(workspace_path);
    if !path.exists() {
        return Err(AppError::IoError(format!(
            "Workspace path does not exist: {}",
            path.display()
        )));
    }

    if !path.is_dir() {
        return Err(AppError::IoError(format!(
            "Workspace path is not a directory: {}",
            path.display()
        )));
    }

    // Canonicalize to resolve symlinks and '..' segments.
    std::fs::canonicalize(&path).map_err(|error| {
        AppError::IoError(format!(
            "Cannot resolve workspace path {}: {error}",
            path.display()
        ))
    })
}
