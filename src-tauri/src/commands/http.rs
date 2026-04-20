use crate::{
    environment::{config, resolver},
    error::AppError,
    history::{db::HistoryDb, types::HistoryEntry},
    http::{
        self,
        client::ExecutedResponse,
        types::{HttpRequestData, HttpResponseData, KeyValue, RequestBody, SendRequestResult},
    },
    scripting::{
        run_post_response_script, run_pre_request_script,
        types::{PostResponseScriptContext, PreRequestScriptContext, ScriptResult},
    },
    workspace::{folder_config, types::FolderConfig},
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use handlebars::Handlebars;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, RwLock},
};
use tauri::{AppHandle, Wry};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::{Mutex, OnceCell};

#[taurpc::procedures(export_to = "../src/bindings.ts")]
pub trait Api {
    async fn send_request(request: HttpRequestData) -> Result<SendRequestResult, AppError>;
    async fn send_request_with_env(
        request: HttpRequestData,
        environment_name: Option<String>,
        workspace_path: Option<String>,
    ) -> Result<SendRequestResult, AppError>;
    async fn save_response_to_file(
        body_base64: Option<String>,
        suggested_filename: Option<String>,
    ) -> Result<bool, AppError>;
}

#[derive(Clone)]
pub struct ApiImpl {
    pub db: Arc<OnceCell<Arc<HistoryDb>>>,
    pub app_handle: Arc<OnceCell<AppHandle<Wry>>>,
    pub hbs: Arc<RwLock<Handlebars<'static>>>,
    pub last_binary_response: Arc<Mutex<Option<Vec<u8>>>>,
}

impl ApiImpl {
    fn enabled_key_values(values: Vec<KeyValue>) -> Vec<KeyValue> {
        values
            .into_iter()
            .filter(|value| value.enabled)
            .filter(|value| !value.key.trim().is_empty())
            .collect()
    }

    fn merge_key_values_by_key(base: &mut Vec<KeyValue>, next_values: Vec<KeyValue>) {
        for value in next_values {
            let key = value.key.trim();
            if key.is_empty() {
                continue;
            }

            if let Some(existing_index) = base
                .iter()
                .position(|existing| existing.key.trim().eq_ignore_ascii_case(key))
            {
                base[existing_index] = value;
            } else {
                base.push(value);
            }
        }
    }

    fn merge_request_variables(
        mut variables: HashMap<String, String>,
        values: &[KeyValue],
    ) -> HashMap<String, String> {
        for variable in values.iter().filter(|variable| variable.enabled) {
            let key = variable.key.trim();
            if key.is_empty() {
                continue;
            }

            variables.insert(key.to_string(), variable.value.clone());
        }

        variables
    }

    async fn load_folder_chain_configs(
        workspace_path: Option<&str>,
        file_path: Option<&str>,
    ) -> Result<Vec<(String, FolderConfig)>, AppError> {
        let Some(workspace_path) = workspace_path else {
            return Ok(Vec::new());
        };
        let Some(file_path) = file_path else {
            return Ok(Vec::new());
        };

        folder_config::load_folder_chain(Path::new(workspace_path), Path::new(file_path)).await
    }

    fn normalize_auth_type(value: Option<&str>) -> String {
        match value.unwrap_or("none").to_ascii_lowercase().as_str() {
            "inherit" => "inherit".to_string(),
            "bearer" => "bearer".to_string(),
            "basic" => "basic".to_string(),
            _ => "none".to_string(),
        }
    }

    fn select_inherited_folder_auth(chain: &[(String, FolderConfig)]) -> Option<&FolderConfig> {
        // Walk from innermost folder outward, returning the first folder that
        // actually configures auth (i.e. auth_type != "none"). This ensures a
        // folder with auth_type = "none" doesn't shadow a real auth setting
        // defined in a parent folder.
        chain
            .iter()
            .rev()
            .find(|(_, config)| config.auth_type != "none")
            .map(|(_, config)| config)
    }

    fn resolve_auth_values(
        request: &HttpRequestData,
        folder_chain: &[(String, FolderConfig)],
    ) -> (String, Option<String>, Option<String>, Option<String>) {
        let request_auth_type = Self::normalize_auth_type(request.auth_type.as_deref());

        if request_auth_type == "inherit" {
            if let Some(config) = Self::select_inherited_folder_auth(folder_chain) {
                let config_auth_type = Self::normalize_auth_type(Some(&config.auth_type));
                return (
                    config_auth_type,
                    config.auth_bearer.clone(),
                    config.auth_basic_username.clone(),
                    config.auth_basic_password.clone(),
                );
            }

            return ("none".to_string(), None, None, None);
        }

        (
            request_auth_type,
            request.auth_bearer.clone(),
            request.auth_basic_username.clone(),
            request.auth_basic_password.clone(),
        )
    }

    fn get_authorization_header_value(
        auth_type: &str,
        auth_bearer: Option<&str>,
        auth_basic_username: Option<&str>,
        auth_basic_password: Option<&str>,
    ) -> Option<String> {
        if auth_type == "bearer" {
            let token = auth_bearer.unwrap_or_default().trim();
            if token.is_empty() {
                return None;
            }
            return Some(format!("Bearer {token}"));
        }

        if auth_type == "basic" {
            let username = auth_basic_username.unwrap_or_default();
            let password = auth_basic_password.unwrap_or_default();
            return Some(format!(
                "Basic {}",
                BASE64_STANDARD.encode(format!("{username}:{password}"))
            ));
        }

        None
    }

    fn apply_authorization_header(headers: &mut Vec<KeyValue>, auth_value: Option<String>) {
        if auth_value.is_none() {
            return;
        }

        headers.retain(|header| !header.key.trim().eq_ignore_ascii_case("authorization"));

        headers.push(KeyValue {
            key: "Authorization".to_string(),
            value: auth_value.unwrap_or_default(),
            enabled: true,
        });
    }

    async fn history_db(&self) -> Result<Arc<HistoryDb>, AppError> {
        self.db.get().cloned().ok_or_else(|| {
            AppError::RequestError("History database is not initialized".to_string())
        })
    }

    /// Prepare the request for script execution: merge folder configs, select
    /// the effective auth type, and gather the merged variable map. Crucially,
    /// this does **not** perform handlebars template resolution and does not
    /// compute the final Authorization header — both are deferred so that
    /// pre-request scripts see raw `{{template}}` placeholders and can affect
    /// variables before substitution happens.
    async fn prepare_request(
        &self,
        mut request: HttpRequestData,
        environment_name: Option<String>,
        workspace_path: Option<String>,
    ) -> Result<(HttpRequestData, HashMap<String, String>), AppError> {
        let folder_chain = Self::load_folder_chain_configs(
            workspace_path.as_deref(),
            request.file_path.as_deref(),
        )
        .await?;

        let mut merged_folder_headers = Vec::new();
        for (_, config) in &folder_chain {
            let headers = Self::enabled_key_values(config.headers.clone());
            Self::merge_key_values_by_key(&mut merged_folder_headers, headers);
        }
        let request_headers = Self::enabled_key_values(request.headers.clone());
        Self::merge_key_values_by_key(&mut merged_folder_headers, request_headers);
        request.headers = merged_folder_headers;

        let (
            resolved_auth_type,
            resolved_auth_bearer,
            resolved_auth_basic_username,
            resolved_auth_basic_password,
        ) = Self::resolve_auth_values(&request, &folder_chain);
        request.auth_type = Some(resolved_auth_type);
        // These may still contain {{templates}} — intentional, they are resolved
        // later in `finalize_request` with the post-script variable map.
        request.auth_bearer = resolved_auth_bearer;
        request.auth_basic_username = resolved_auth_basic_username;
        request.auth_basic_password = resolved_auth_basic_password;

        let mut merged_variables = HashMap::new();

        match (workspace_path, environment_name) {
            (Some(workspace), Some(environment)) => {
                let env = config::read_environment(Path::new(&workspace), &environment).await?;
                merged_variables = env
                    .variables
                    .into_iter()
                    .filter(|variable| variable.enabled)
                    .filter(|variable| !variable.key.trim().is_empty())
                    .map(|variable| (variable.key.trim().to_string(), variable.value))
                    .collect();
            }
            (Some(_), None) | (None, None) => {}
            (None, Some(_)) => return Err(AppError::RequestError(
                "Both environment_name and workspace_path are required for environment resolution"
                    .to_string(),
            )),
        }

        for (_, config) in &folder_chain {
            merged_variables = Self::merge_request_variables(merged_variables, &config.variables);
        }

        merged_variables =
            Self::merge_request_variables(merged_variables, &request.request_variables);

        Ok((request, merged_variables))
    }

    /// Finalize the request: perform handlebars template resolution on URL,
    /// headers, body, query params, and auth credentials, then compute and
    /// apply the Authorization header from the resolved auth values.
    fn finalize_request(
        &self,
        request: &HttpRequestData,
        merged_variables: &HashMap<String, String>,
    ) -> Result<HttpRequestData, AppError> {
        let mut resolved_request = resolver::resolve_request(&self.hbs, request, merged_variables)?;

        let resolved_auth_value = Self::get_authorization_header_value(
            &Self::normalize_auth_type(resolved_request.auth_type.as_deref()),
            resolved_request.auth_bearer.as_deref(),
            resolved_request.auth_basic_username.as_deref(),
            resolved_request.auth_basic_password.as_deref(),
        );
        Self::apply_authorization_header(&mut resolved_request.headers, resolved_auth_value);

        Ok(resolved_request)
    }

    /// Merge two variable maps, with `overrides` winning on key conflicts. Used
    /// to layer request-scoped (`alloy.variables`) on top of environment vars
    /// so that the narrower scope wins during template resolution.
    fn overlay_variables(
        mut base: HashMap<String, String>,
        overrides: HashMap<String, String>,
    ) -> HashMap<String, String> {
        for (key, value) in overrides {
            base.insert(key, value);
        }
        base
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
    async fn send_request(self, request: HttpRequestData) -> Result<SendRequestResult, AppError> {
        self.send_request_with_env(request, None, None).await
    }

    async fn send_request_with_env(
        self,
        request: HttpRequestData,
        environment_name: Option<String>,
        workspace_path: Option<String>,
    ) -> Result<SendRequestResult, AppError> {
        // Phase 1 — prepare: merge folders, pick auth type, gather variables.
        // The request still contains raw {{template}} placeholders so the
        // pre-request script can influence substitution via env/variable
        // mutations.
        let (mut prepared_request, mut merged_variables) = self
            .prepare_request(request, environment_name, workspace_path)
            .await?;

        let mut pre_script_result: Option<ScriptResult> = None;
        let mut post_script_result: Option<ScriptResult> = None;

        // Phase 2 — run pre-request script on the unresolved request, then
        // apply any mutations and variable changes back.
        if let Some(script) = prepared_request
            .pre_request_script
            .as_ref()
            .filter(|script| !script.trim().is_empty())
            .cloned()
        {
            let pre_request_context = PreRequestScriptContext {
                method: prepared_request.method.clone(),
                url: prepared_request.url.clone(),
                headers: prepared_request.headers.clone(),
                query_params: prepared_request.query_params.clone(),
                body: request_body_to_string(&prepared_request.body),
                body_type: request_body_type_name(&prepared_request.body),
                environment_variables: merged_variables.clone(),
                local_variables: HashMap::new(),
                request_name: None,
            };

            let (script_ctx, mutations, result) = tokio::task::spawn_blocking(move || {
                run_pre_request_script(&script, pre_request_context)
            })
            .await
            .map_err(|error| {
                AppError::RequestError(format!("Pre-request script panicked: {error}"))
            })?;

            pre_script_result = Some(result);

            // Merge variable changes: environment scope first, request/local
            // scope on top (narrowest scope wins, matching Postman semantics).
            merged_variables = Self::overlay_variables(
                script_ctx.environment_variables,
                script_ctx.local_variables,
            );

            prepared_request.method = mutations.method;
            prepared_request.url = mutations.url;
            prepared_request.headers = mutations.headers;
            prepared_request.query_params = mutations.query_params;
            prepared_request.body =
                apply_script_body_to_request(prepared_request.body, mutations.body);
        }

        // Phase 3 — finalize: resolve handlebars templates and build the
        // Authorization header using the (possibly script-modified) variable
        // map.
        let resolved_request = self.finalize_request(&prepared_request, &merged_variables)?;

        let request_for_send = resolved_request.clone();
        let request_for_history = resolved_request;

        let ExecutedResponse {
            response,
            binary_body,
        } = http::client::execute_request(request_for_send).await?;

        *self.last_binary_response.lock().await = binary_body;

        if let Some(script) = request_for_history
            .post_response_script
            .as_ref()
            .filter(|script| !script.trim().is_empty())
            .cloned()
        {
            let post_response_context = PostResponseScriptContext {
                method: request_for_history.method.clone(),
                url: request_for_history.url.clone(),
                request_headers: request_for_history.headers.clone(),
                response_status: response.status,
                response_status_text: response.status_text.clone(),
                response_headers: response.headers.clone(),
                response_body: response.body.clone(),
                response_time_ms: response.time_ms,
                response_size_bytes: response.size_bytes,
                environment_variables: merged_variables,
                request_name: None,
            };

            let (_updated_ctx, result) = tokio::task::spawn_blocking(move || {
                run_post_response_script(&script, post_response_context)
            })
            .await
            .map_err(|error| {
                AppError::RequestError(format!("Post-response script panicked: {error}"))
            })?;

            post_script_result = Some(result);
        }

        if let Err(error) = self
            .try_insert_history(&request_for_history, &response)
            .await
        {
            eprintln!("Failed to insert history entry: {error}");
        }

        Ok(SendRequestResult {
            response,
            pre_script_result,
            post_script_result,
        })
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

fn request_body_type_name(body: &RequestBody) -> String {
    match body {
        RequestBody::None => "none",
        RequestBody::Json(_) => "json",
        RequestBody::FormUrlEncoded(_) => "form-urlencoded",
        RequestBody::Multipart(_) => "form-data",
        RequestBody::Raw { .. } => "raw",
    }
    .to_string()
}

fn apply_script_body_to_request(body: RequestBody, new_body: Option<String>) -> RequestBody {
    match body {
        RequestBody::Json(current) => RequestBody::Json(new_body.unwrap_or(current)),
        RequestBody::Raw {
            content,
            content_type,
            ..
        } => RequestBody::Raw {
            content: new_body.unwrap_or(content),
            content_type,
        },
        RequestBody::None => RequestBody::None,
        RequestBody::FormUrlEncoded(values) => RequestBody::FormUrlEncoded(values),
        RequestBody::Multipart(fields) => RequestBody::Multipart(fields),
    }
}

fn key_values_as_pairs(values: &[KeyValue]) -> Vec<String> {
    values
        .iter()
        .filter(|item| item.enabled)
        .map(|item| format!("{}={}", item.key, item.value))
        .collect()
}
