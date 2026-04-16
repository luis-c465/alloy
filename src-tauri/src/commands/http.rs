use crate::{
    environment::{config, resolver},
    error::AppError,
    history::{db::HistoryDb, types::HistoryEntry},
    http::{
        self,
        client::ExecutedResponse,
        types::{HttpRequestData, HttpResponseData, KeyValue, RequestBody},
    },
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use handlebars::Handlebars;
use std::{collections::HashMap, path::Path, sync::Arc};
use tauri::{AppHandle, Wry};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::{Mutex, OnceCell};

#[taurpc::procedures(export_to = "../src/bindings.ts")]
pub trait Api {
    async fn send_request(request: HttpRequestData) -> Result<HttpResponseData, AppError>;
    async fn send_request_with_env(
        request: HttpRequestData,
        environment_name: Option<String>,
        workspace_path: Option<String>,
    ) -> Result<HttpResponseData, AppError>;
    async fn save_response_to_file(
        body_base64: Option<String>,
        suggested_filename: Option<String>,
    ) -> Result<bool, AppError>;
}

#[derive(Clone)]
pub struct ApiImpl {
    pub db: Arc<OnceCell<Arc<HistoryDb>>>,
    pub app_handle: Arc<OnceCell<AppHandle<Wry>>>,
    pub hbs: Arc<Handlebars<'static>>,
    pub last_binary_response: Arc<Mutex<Option<Vec<u8>>>>,
}

impl ApiImpl {
    async fn history_db(&self) -> Result<Arc<HistoryDb>, AppError> {
        self.db.get().cloned().ok_or_else(|| {
            AppError::RequestError("History database is not initialized".to_string())
        })
    }

    fn merge_request_variables(
        request: &HttpRequestData,
        mut variables: HashMap<String, String>,
    ) -> HashMap<String, String> {
        for variable in request
            .request_variables
            .iter()
            .filter(|variable| variable.enabled)
        {
            let key = variable.key.trim();
            if key.is_empty() {
                continue;
            }

            variables.insert(key.to_string(), variable.value.clone());
        }

        variables
    }

    async fn resolve_with_environment(
        &self,
        request: HttpRequestData,
        environment_name: Option<String>,
        workspace_path: Option<String>,
    ) -> Result<HttpRequestData, AppError> {
        match (workspace_path, environment_name) {
            (Some(workspace), Some(environment)) => {
                let env = config::read_environment(Path::new(&workspace), &environment).await?;
                let environment_variables: HashMap<String, String> = env
                    .variables
                    .into_iter()
                    .filter(|variable| variable.enabled)
                    .map(|variable| (variable.key, variable.value))
                    .collect();
                let variables = Self::merge_request_variables(&request, environment_variables);
                resolver::resolve_request(&self.hbs, &request, &variables)
            }
            (None, None) => {
                let variables = Self::merge_request_variables(&request, HashMap::new());
                resolver::resolve_request(&self.hbs, &request, &variables)
            }
            _ => Err(AppError::RequestError(
                "Both environment_name and workspace_path are required for environment resolution"
                    .to_string(),
            )),
        }
    }

    fn app_handle(&self) -> Result<AppHandle<Wry>, AppError> {
        self.app_handle
            .get()
            .cloned()
            .ok_or_else(|| AppError::RequestError("App handle is not initialized".to_string()))
    }

    async fn try_insert_history(
        &self,
        request: &HttpRequestData,
        response: &HttpResponseData,
    ) -> Result<(), AppError> {
        let db = self.history_db().await?;

        let request_headers = serde_json::to_string(&request.headers)
            .map_err(|error| AppError::SerializationError(error.to_string()))?;
        let response_headers = serde_json::to_string(&response.headers)
            .map_err(|error| AppError::SerializationError(error.to_string()))?;

        let entry = HistoryEntry {
            id: 0,
            method: request.method.clone(),
            url: request.url.clone(),
            status: Some(response.status),
            status_text: Some(response.status_text.clone()),
            time_ms: Some(response.time_ms),
            size_bytes: Some(response.size_bytes),
            timestamp: Utc::now().to_rfc3339(),
            request_headers,
            request_body: request_body_to_string(&request.body),
            response_headers: Some(response_headers),
            response_body: Some(response.body.clone()),
        };

        db.insert(&entry).await?;
        Ok(())
    }
}

#[taurpc::resolvers]
impl Api for ApiImpl {
    async fn send_request(self, request: HttpRequestData) -> Result<HttpResponseData, AppError> {
        self.send_request_with_env(request, None, None).await
    }

    async fn send_request_with_env(
        self,
        request: HttpRequestData,
        environment_name: Option<String>,
        workspace_path: Option<String>,
    ) -> Result<HttpResponseData, AppError> {
        let resolved_request = self
            .resolve_with_environment(request, environment_name, workspace_path)
            .await?;

        let request_for_history = resolved_request;
        let request_for_send = request_for_history.clone();

        let ExecutedResponse {
            response,
            binary_body,
        } = http::client::execute_request(request_for_send).await?;

        *self.last_binary_response.lock().await = binary_body;

        if let Err(error) = self
            .try_insert_history(&request_for_history, &response)
            .await
        {
            eprintln!("Failed to insert history entry: {error}");
        }

        Ok(response)
    }

    async fn save_response_to_file(
        self,
        body_base64: Option<String>,
        suggested_filename: Option<String>,
    ) -> Result<bool, AppError> {
        let bytes = if let Some(body_base64) = body_base64.filter(|value| !value.is_empty()) {
            BASE64_STANDARD.decode(body_base64).map_err(|error| {
                AppError::ParseError(format!("Invalid response body base64: {error}"))
            })?
        } else {
            self.last_binary_response
                .lock()
                .await
                .clone()
                .ok_or_else(|| {
                    AppError::RequestError("No binary response is available to save".to_string())
                })?
        };

        let app_handle = self.app_handle()?;
        let suggested_filename = suggested_filename
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "response.bin".to_string());

        let file_path = tokio::task::spawn_blocking(move || {
            app_handle
                .dialog()
                .file()
                .set_file_name(&suggested_filename)
                .blocking_save_file()
        })
        .await
        .map_err(|error| AppError::RequestError(format!("Failed to open save dialog: {error}")))?;

        let Some(file_path) = file_path else {
            return Ok(false);
        };

        let path = file_path.into_path().map_err(|error| {
            AppError::RequestError(format!(
                "Selected save location is not a local path: {error}"
            ))
        })?;

        tokio::fs::write(&path, bytes).await.map_err(|error| {
            AppError::IoError(format!(
                "Failed to save response to {}: {error}",
                path.display()
            ))
        })?;

        Ok(true)
    }
}

fn request_body_to_string(body: &RequestBody) -> Option<String> {
    match body {
        RequestBody::None => None,
        RequestBody::Json(content) => Some(content.clone()),
        RequestBody::Raw { content, .. } => Some(content.clone()),
        RequestBody::FormUrlEncoded(values) => Some(
            serde_json::to_string(values).unwrap_or_else(|_| key_values_as_pairs(values).join("&")),
        ),
        RequestBody::Multipart(fields) => Some(serde_json::to_string(fields).unwrap_or_default()),
    }
}

fn key_values_as_pairs(values: &[KeyValue]) -> Vec<String> {
    values
        .iter()
        .filter(|item| item.enabled)
        .map(|item| format!("{}={}", item.key, item.value))
        .collect()
}

