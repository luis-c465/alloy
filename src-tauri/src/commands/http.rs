use crate::{
    environment::{config, resolver},
    error::AppError,
    history::{db::HistoryDb, types::HistoryEntry},
    http::{
        self,
        types::{HttpRequestData, HttpResponseData, KeyValue, MultipartField, RequestBody},
    },
};
use chrono::Utc;
use handlebars::Handlebars;
use std::{collections::HashMap, path::Path, sync::Arc};
use tokio::sync::OnceCell;

#[taurpc::procedures(export_to = "../src/bindings.ts")]
pub trait Api {
    async fn send_request(request: HttpRequestData) -> Result<HttpResponseData, AppError>;
    async fn send_request_with_env(
        request: HttpRequestData,
        environment_name: Option<String>,
        workspace_path: Option<String>,
    ) -> Result<HttpResponseData, AppError>;
}

#[derive(Clone)]
pub struct ApiImpl {
    pub db: Arc<OnceCell<Arc<HistoryDb>>>,
    pub hbs: Arc<Handlebars<'static>>,
}

impl ApiImpl {
    async fn history_db(&self) -> Result<Arc<HistoryDb>, AppError> {
        self.db.get().cloned().ok_or_else(|| {
            AppError::RequestError("History database is not initialized".to_string())
        })
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
                let variables: HashMap<String, String> = env
                    .variables
                    .into_iter()
                    .filter(|variable| variable.enabled)
                    .map(|variable| (variable.key, variable.value))
                    .collect();
                resolver::resolve_request(&self.hbs, &request, &variables)
            }
            (None, None) => Ok(request),
            _ => Err(AppError::RequestError(
                "Both environment_name and workspace_path are required for environment resolution"
                    .to_string(),
            )),
        }
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
        let request_for_send = clone_request(&request_for_history);

        let response = http::client::execute_request(request_for_send).await?;

        if let Err(error) = self
            .try_insert_history(&request_for_history, &response)
            .await
        {
            eprintln!("Failed to insert history entry: {error}");
        }

        Ok(response)
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

fn clone_request(request: &HttpRequestData) -> HttpRequestData {
    HttpRequestData {
        method: request.method.clone(),
        url: request.url.clone(),
        headers: request
            .headers
            .iter()
            .map(|item| KeyValue {
                key: item.key.clone(),
                value: item.value.clone(),
                enabled: item.enabled,
            })
            .collect(),
        query_params: request
            .query_params
            .iter()
            .map(|item| KeyValue {
                key: item.key.clone(),
                value: item.value.clone(),
                enabled: item.enabled,
            })
            .collect(),
        body: match &request.body {
            RequestBody::None => RequestBody::None,
            RequestBody::Json(content) => RequestBody::Json(content.clone()),
            RequestBody::FormUrlEncoded(values) => RequestBody::FormUrlEncoded(
                values
                    .iter()
                    .map(|item| KeyValue {
                        key: item.key.clone(),
                        value: item.value.clone(),
                        enabled: item.enabled,
                    })
                    .collect(),
            ),
            RequestBody::Multipart(fields) => RequestBody::Multipart(
                fields
                    .iter()
                    .map(|field| MultipartField {
                        key: field.key.clone(),
                        value: field.value.clone(),
                        content_type: field.content_type.clone(),
                        enabled: field.enabled,
                    })
                    .collect(),
            ),
            RequestBody::Raw {
                content,
                content_type,
            } => RequestBody::Raw {
                content: content.clone(),
                content_type: content_type.clone(),
            },
        },
    }
}
