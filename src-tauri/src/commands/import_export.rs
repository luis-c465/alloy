use crate::{
    error::AppError,
    http::types::HttpRequestData,
    import_export::{
        curl::{curl_to_request, request_to_curl},
        openapi::{
            openapi_to_workspace, preview_openapi, FolderStrategy, NamingStrategy,
            OpenApiImportOptions as InternalOpenApiImportOptions,
        },
        postman::{parse_postman_collection, postman_to_workspace, ImportResult},
    },
};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::OnceCell;

#[taurpc::procedures(path = "import_export", export_to = "../src/bindings.ts")]
pub trait ImportExportApi {
    async fn export_curl(request: HttpRequestData) -> Result<String, AppError>;
    async fn import_curl(curl_command: String) -> Result<HttpRequestData, AppError>;
    async fn import_postman_collection(
        json_content: String,
        workspace_path: String,
    ) -> Result<ImportResult, AppError>;
    async fn pick_import_file() -> Result<Option<String>, AppError>;
    async fn pick_openapi_file() -> Result<Option<String>, AppError>;
    async fn fetch_openapi_url(url: String) -> Result<String, AppError>;
    async fn preview_openapi(content: String) -> Result<OpenApiPreview, AppError>;
    async fn import_openapi(
        content: String,
        workspace_path: String,
        options: OpenApiImportOptions,
    ) -> Result<ImportResult, AppError>;
}

#[taurpc::ipc_type]
pub struct OpenApiPreview {
    pub title: String,
    pub version: String,
    pub openapi_version: String,
    pub servers: Vec<String>,
    pub operation_count: u32,
    pub tag_names: Vec<String>,
    pub method_counts: Vec<(String, u32)>,
}

#[taurpc::ipc_type]
pub struct OpenApiImportOptions {
    pub folder_strategy: String,
    pub naming_strategy: String,
    pub include_deprecated: bool,
    pub server_index: u32,
}

#[derive(Clone)]
pub struct ImportExportApiImpl {
    pub app_handle: std::sync::Arc<OnceCell<AppHandle<tauri::Wry>>>,
}

impl ImportExportApiImpl {
    fn app_handle(&self) -> Result<AppHandle<tauri::Wry>, AppError> {
        self.app_handle
            .get()
            .cloned()
            .ok_or_else(|| AppError::RequestError("App handle is not initialized".to_string()))
    }
}

#[taurpc::resolvers]
impl ImportExportApi for ImportExportApiImpl {
    async fn export_curl(self, request: HttpRequestData) -> Result<String, AppError> {
        Ok(request_to_curl(&request))
    }

    async fn import_curl(self, curl_command: String) -> Result<HttpRequestData, AppError> {
        curl_to_request(&curl_command)
    }

    async fn import_postman_collection(
        self,
        json_content: String,
        workspace_path: String,
    ) -> Result<ImportResult, AppError> {
        tokio::task::spawn_blocking(move || {
            let collection = parse_postman_collection(&json_content)?;
            postman_to_workspace(&collection, std::path::Path::new(&workspace_path))
        })
        .await
        .map_err(|error| {
            AppError::RequestError(format!(
                "Failed to import Postman collection in background task: {error}"
            ))
        })?
    }

    async fn pick_import_file(self) -> Result<Option<String>, AppError> {
        let app_handle = self.app_handle()?;

        tokio::task::spawn_blocking(move || {
            let Some(file_path) = app_handle
                .dialog()
                .file()
                .add_filter("JSON Files", &["json"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };

            let path = file_path.into_path().map_err(|error| {
                AppError::RequestError(format!("Selected file is not a local path: {error}"))
            })?;

            let content = std::fs::read_to_string(&path).map_err(|error| {
                AppError::IoError(format!("Failed to read {}: {error}", path.display()))
            })?;

            Ok(Some(content))
        })
        .await
        .map_err(|error| AppError::RequestError(format!("Failed to open file picker: {error}")))?
    }

    async fn pick_openapi_file(self) -> Result<Option<String>, AppError> {
        let app_handle = self.app_handle()?;

        tokio::task::spawn_blocking(move || {
            let Some(file_path) = app_handle
                .dialog()
                .file()
                .add_filter("OpenAPI Files", &["json", "yaml", "yml"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };

            let path = file_path.into_path().map_err(|error| {
                AppError::RequestError(format!("Selected file is not a local path: {error}"))
            })?;

            let content = std::fs::read_to_string(&path).map_err(|error| {
                AppError::IoError(format!("Failed to read {}: {error}", path.display()))
            })?;

            Ok(Some(content))
        })
        .await
        .map_err(|error| AppError::RequestError(format!("Failed to open file picker: {error}")))?
    }

    async fn fetch_openapi_url(self, url: String) -> Result<String, AppError> {
        let response = reqwest::get(&url)
            .await
            .map_err(|error| AppError::RequestError(format!("Failed to fetch {url}: {error}")))?;

        let status = response.status();
        if !status.is_success() {
            return Err(AppError::RequestError(format!(
                "Failed to fetch OpenAPI URL ({status})"
            )));
        }

        response.text().await.map_err(|error| {
            AppError::RequestError(format!("Failed to read OpenAPI URL response: {error}"))
        })
    }

    async fn preview_openapi(self, content: String) -> Result<OpenApiPreview, AppError> {
        tokio::task::spawn_blocking(move || preview_openapi(&content))
            .await
            .map_err(|error| {
                AppError::RequestError(format!(
                    "Failed to preview OpenAPI in background task: {error}"
                ))
            })?
            .map(|preview| OpenApiPreview {
                title: preview.title,
                version: preview.version,
                openapi_version: preview.openapi_version,
                servers: preview.servers,
                operation_count: preview.operation_count,
                tag_names: preview.tag_names,
                method_counts: preview.method_counts,
            })
    }

    async fn import_openapi(
        self,
        content: String,
        workspace_path: String,
        options: OpenApiImportOptions,
    ) -> Result<ImportResult, AppError> {
        tokio::task::spawn_blocking(move || {
            let internal_options = InternalOpenApiImportOptions {
                folder_strategy: match options.folder_strategy.as_str() {
                    "path" => FolderStrategy::Path,
                    "flat" => FolderStrategy::Flat,
                    _ => FolderStrategy::Tags,
                },
                naming_strategy: match options.naming_strategy.as_str() {
                    "summary" => NamingStrategy::Summary,
                    "methodPath" => NamingStrategy::MethodPath,
                    _ => NamingStrategy::OperationId,
                },
                include_deprecated: options.include_deprecated,
                server_index: options.server_index as usize,
            };

            openapi_to_workspace(
                &content,
                std::path::Path::new(&workspace_path),
                &internal_options,
            )
        })
        .await
        .map_err(|error| {
            AppError::RequestError(format!("Failed to import OpenAPI in background task: {error}"))
        })?
    }
}
