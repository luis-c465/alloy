use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::OnceCell;

use crate::{
    error::AppError,
    workspace::{
        fs,
        parser::parse_http_file,
        serializer::serialize_http_file,
        types::{FileEntry, HttpFileData},
    },
};

#[taurpc::procedures(path = "workspace", export_to = "../src/bindings.ts")]
pub trait WorkspaceApi {
    async fn pick_workspace_folder() -> Result<Option<String>, AppError>;
    async fn list_files(workspace_path: String) -> Result<Vec<FileEntry>, AppError>;
    async fn read_http_file(file_path: String) -> Result<HttpFileData, AppError>;
    async fn write_http_file(file_path: String, data: HttpFileData) -> Result<(), AppError>;
    async fn create_http_file(dir_path: String, file_name: String) -> Result<String, AppError>;
    async fn create_directory(parent_path: String, dir_name: String) -> Result<String, AppError>;
    async fn delete_path(target_path: String) -> Result<(), AppError>;
    async fn rename_path(from_path: String, to_path: String) -> Result<(), AppError>;
    async fn ensure_workspace(workspace_path: String) -> Result<(), AppError>;
}

#[derive(Clone)]
pub struct WorkspaceApiImpl {
    pub app_handle: std::sync::Arc<OnceCell<AppHandle<tauri::Wry>>>,
}

impl WorkspaceApiImpl {
    fn app_handle(&self) -> Result<AppHandle<tauri::Wry>, AppError> {
        self.app_handle.get().cloned().ok_or_else(|| {
            AppError::RequestError("App handle is not initialized".to_string())
        })
    }
}

#[taurpc::resolvers]
impl WorkspaceApi for WorkspaceApiImpl {
    async fn pick_workspace_folder(self) -> Result<Option<String>, AppError> {
        let app_handle = self.app_handle()?;
        tokio::task::spawn_blocking(move || {
            app_handle
                .dialog()
                .file()
                .blocking_pick_folder()
                .map(|value| value.to_string())
        })
        .await
        .map_err(|error| AppError::RequestError(format!("Failed to open folder picker: {error}")))
    }

    async fn list_files(self, workspace_path: String) -> Result<Vec<FileEntry>, AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        fs::list_directory(&workspace).await
    }

    async fn read_http_file(self, file_path: String) -> Result<HttpFileData, AppError> {
        let path = PathBuf::from(&file_path);
        if !path.exists() || !path.is_file() {
            return Err(AppError::IoError(format!(
                "File does not exist: {}",
                path.display()
            )));
        }

        let content = fs::read_file_content(&path).await?;
        parse_http_file(&content, &file_path)
    }

    async fn write_http_file(self, file_path: String, mut data: HttpFileData) -> Result<(), AppError> {
        let path = PathBuf::from(&file_path);
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                return Err(AppError::IoError(format!(
                    "Parent directory does not exist: {}",
                    parent.display()
                )));
            }
        }

        data.path = file_path;
        let content = serialize_http_file(&data);
        tokio::fs::write(path, content).await?;
        Ok(())
    }

    async fn create_http_file(self, dir_path: String, file_name: String) -> Result<String, AppError> {
        let dir = PathBuf::from(&dir_path);
        if !dir.exists() || !dir.is_dir() {
            return Err(AppError::IoError(format!(
                "Directory does not exist: {}",
                dir.display()
            )));
        }

        validate_name_segment(&file_name)?;
        let normalized_name = if file_name.ends_with(".http") || file_name.ends_with(".rest") {
            file_name
        } else {
            format!("{file_name}.http")
        };

        let path = dir.join(normalized_name);
        fs::create_http_file(&path).await?;
        Ok(path.to_string_lossy().to_string())
    }

    async fn create_directory(self, parent_path: String, dir_name: String) -> Result<String, AppError> {
        let parent = PathBuf::from(&parent_path);
        if !parent.exists() || !parent.is_dir() {
            return Err(AppError::IoError(format!(
                "Parent directory does not exist: {}",
                parent.display()
            )));
        }

        validate_name_segment(&dir_name)?;
        let path = parent.join(dir_name);
        fs::create_directory(&path).await?;
        Ok(path.to_string_lossy().to_string())
    }

    async fn delete_path(self, target_path: String) -> Result<(), AppError> {
        fs::delete_path(Path::new(&target_path)).await
    }

    async fn rename_path(self, from_path: String, to_path: String) -> Result<(), AppError> {
        let from = PathBuf::from(&from_path);
        if !from.exists() {
            return Err(AppError::IoError(format!(
                "Path does not exist: {}",
                from.display()
            )));
        }

        fs::rename_path(Path::new(&from_path), Path::new(&to_path)).await
    }

    async fn ensure_workspace(self, workspace_path: String) -> Result<(), AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        fs::ensure_alloy_dir(&workspace).await?;
        Ok(())
    }
}

fn validate_workspace_path(workspace_path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(workspace_path);
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

    Ok(path)
}

fn validate_name_segment(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::ParseError("Name cannot be empty".to_string()));
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::ParseError(
            "Name cannot contain path separators".to_string(),
        ));
    }

    Ok(())
}
