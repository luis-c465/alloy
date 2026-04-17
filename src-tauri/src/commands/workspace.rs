use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::OnceCell;

use crate::{
    error::AppError,
    workspace::{
        folder_config,
        fs,
        parser::parse_http_file,
        serializer::serialize_http_file,
        types::{FileEntry, FolderConfig, FolderConfigEntry, HttpFileData},
    },
};

#[taurpc::ipc_type]
pub struct PickedFile {
    pub path: String,
    pub name: String,
    pub size_bytes: Option<u64>,
}

#[taurpc::procedures(path = "workspace", export_to = "../src/bindings.ts")]
pub trait WorkspaceApi {
    async fn pick_workspace_folder() -> Result<Option<String>, AppError>;
    async fn pick_file() -> Result<Option<PickedFile>, AppError>;
    async fn list_files(workspace_path: String) -> Result<Vec<FileEntry>, AppError>;
    async fn read_http_file(file_path: String) -> Result<HttpFileData, AppError>;
    async fn write_http_file(file_path: String, data: HttpFileData) -> Result<(), AppError>;
    async fn create_http_file(dir_path: String, file_name: String) -> Result<String, AppError>;
    async fn create_directory(parent_path: String, dir_name: String) -> Result<String, AppError>;
    async fn delete_path(target_path: String) -> Result<(), AppError>;
    async fn rename_path(from_path: String, to_path: String) -> Result<(), AppError>;
    async fn ensure_workspace(workspace_path: String) -> Result<(), AppError>;
    async fn get_folder_config(
        workspace_path: String,
        folder_path: String,
    ) -> Result<FolderConfig, AppError>;
    async fn set_folder_config(
        workspace_path: String,
        folder_path: String,
        config: FolderConfig,
    ) -> Result<(), AppError>;
    async fn list_folder_configs(
        workspace_path: String,
    ) -> Result<Vec<FolderConfigEntry>, AppError>;
}

#[derive(Clone)]
pub struct WorkspaceApiImpl {
    pub app_handle: std::sync::Arc<OnceCell<AppHandle<tauri::Wry>>>,
}

impl WorkspaceApiImpl {
    fn app_handle(&self) -> Result<AppHandle<tauri::Wry>, AppError> {
        self.app_handle
            .get()
            .cloned()
            .ok_or_else(|| AppError::RequestError("App handle is not initialized".to_string()))
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

    async fn pick_file(self) -> Result<Option<PickedFile>, AppError> {
        let app_handle = self.app_handle()?;

        tokio::task::spawn_blocking(move || {
            let Some(file_path) = app_handle.dialog().file().blocking_pick_file() else {
                return Ok(None);
            };

            let path = file_path.into_path().map_err(|error| {
                AppError::RequestError(format!("Selected file is not a local path: {error}"))
            })?;

            let metadata = std::fs::metadata(&path).map_err(|error| {
                AppError::IoError(format!(
                    "Failed to read file metadata for {}: {error}",
                    path.display()
                ))
            })?;

            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned());

            Ok(Some(PickedFile {
                path: path.to_string_lossy().into_owned(),
                name,
                size_bytes: Some(metadata.len()),
            }))
        })
        .await
        .map_err(|error| AppError::RequestError(format!("Failed to open file picker: {error}")))?
    }

    async fn list_files(self, workspace_path: String) -> Result<Vec<FileEntry>, AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        fs::list_directory(&workspace).await
    }

    async fn read_http_file(self, file_path: String) -> Result<HttpFileData, AppError> {
        let path = PathBuf::from(&file_path);
        reject_path_traversal(&path)?;

        if !path.exists() || !path.is_file() {
            return Err(AppError::IoError(format!(
                "File does not exist: {}",
                path.display()
            )));
        }

        let content = fs::read_file_content(&path).await?;
        parse_http_file(&content, &file_path)
    }

    async fn write_http_file(
        self,
        file_path: String,
        mut data: HttpFileData,
    ) -> Result<(), AppError> {
        let path = PathBuf::from(&file_path);
        reject_path_traversal(&path)?;

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
        fs::atomic_write(&path, content.as_bytes()).await?;
        Ok(())
    }

    async fn create_http_file(
        self,
        dir_path: String,
        file_name: String,
    ) -> Result<String, AppError> {
        let dir = PathBuf::from(&dir_path);
        reject_path_traversal(&dir)?;

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

    async fn create_directory(
        self,
        parent_path: String,
        dir_name: String,
    ) -> Result<String, AppError> {
        let parent = PathBuf::from(&parent_path);
        reject_path_traversal(&parent)?;

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
        let path = PathBuf::from(&target_path);
        reject_path_traversal(&path)?;
        fs::delete_path(&path).await
    }

    async fn rename_path(self, from_path: String, to_path: String) -> Result<(), AppError> {
        let from = PathBuf::from(&from_path);
        let to = PathBuf::from(&to_path);
        reject_path_traversal(&from)?;
        reject_path_traversal(&to)?;

        if !from.exists() {
            return Err(AppError::IoError(format!(
                "Path does not exist: {}",
                from.display()
            )));
        }

        fs::rename_path(&from, &to).await?;

        // After renaming an HTTP/REST file, update any @name values that still
        // match the old file stem so they reflect the new filename.
        if is_http_file(&to) {
            if let Err(e) = update_request_names_after_rename(&from, &to).await {
                // Non-fatal: the rename already succeeded; just log the error.
                eprintln!("Warning: could not update @name in {to_path}: {e}");
            }
        }

        Ok(())
    }

    async fn ensure_workspace(self, workspace_path: String) -> Result<(), AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        fs::ensure_alloy_dir(&workspace).await?;
        Ok(())
    }

    async fn get_folder_config(
        self,
        workspace_path: String,
        folder_path: String,
    ) -> Result<FolderConfig, AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        let folder = validate_folder_path_in_workspace(&workspace, &folder_path)?;

        folder_config::read_folder_config(&folder).await
    }

    async fn set_folder_config(
        self,
        workspace_path: String,
        folder_path: String,
        config: FolderConfig,
    ) -> Result<(), AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        let folder = validate_folder_path_in_workspace(&workspace, &folder_path)?;

        folder_config::write_folder_config(&folder, &config).await
    }

    async fn list_folder_configs(
        self,
        workspace_path: String,
    ) -> Result<Vec<FolderConfigEntry>, AppError> {
        let workspace = validate_workspace_path(&workspace_path)?;
        let folders = list_directories_recursive(&workspace, 0)?;
        let mut entries = Vec::new();

        for folder in folders {
            if !folder_config::folder_config_exists(&folder).await? {
                continue;
            }
            let config = folder_config::read_folder_config(&folder).await?;
            entries.push(FolderConfigEntry {
                folder_path: folder.to_string_lossy().into_owned(),
                config,
            });
        }

        Ok(entries)
    }
}

const MAX_FOLDER_SCAN_DEPTH: usize = 10;

fn list_directories_recursive(path: &Path, depth: usize) -> Result<Vec<PathBuf>, AppError> {
    if depth > MAX_FOLDER_SCAN_DEPTH {
        return Ok(Vec::new());
    }

    let mut results = vec![path.to_path_buf()];
    let read_dir = std::fs::read_dir(path).map_err(|error| {
        AppError::IoError(format!("Failed to list directory {}: {error}", path.display()))
    })?;

    for entry in read_dir {
        let entry = entry.map_err(|error| {
            AppError::IoError(format!("Failed to read directory entry: {error}"))
        })?;
        let file_type = entry.file_type().map_err(|error| {
            AppError::IoError(format!(
                "Failed to read file type for {}: {error}",
                entry.path().display()
            ))
        })?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".alloy" {
            continue;
        }

        let child_path = entry.path();
        results.extend(list_directories_recursive(&child_path, depth + 1)?);
    }

    Ok(results)
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

    // Canonicalize to resolve symlinks and '..' segments.
    std::fs::canonicalize(&path).map_err(|error| {
        AppError::IoError(format!(
            "Cannot resolve workspace path {}: {error}",
            path.display()
        ))
    })
}

fn validate_folder_path_in_workspace(
    workspace: &Path,
    folder_path: &str,
) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(folder_path);
    reject_path_traversal(&path)?;
    let canonical = fs::assert_within_directory(workspace, &path)?;

    if !canonical.is_dir() {
        return Err(AppError::IoError(format!(
            "Folder path is not a directory: {}",
            canonical.display()
        )));
    }

    Ok(canonical)
}

/// Reject paths that contain `..` segments, preventing directory traversal.
fn reject_path_traversal(path: &Path) -> Result<(), AppError> {
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err(AppError::IoError(format!(
                "Path contains disallowed '..' segment: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn is_http_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("http") | Some("rest")
    )
}

fn path_stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// After renaming an HTTP/REST file, rewrite any `@name` value that still
/// equals the sanitized form of the **old** stem so it reflects the new stem.
async fn update_request_names_after_rename(from: &Path, to: &Path) -> Result<(), AppError> {
    let old_name = fs::stem_to_request_name(&path_stem(from));
    let new_name = fs::stem_to_request_name(&path_stem(to));

    if old_name == new_name {
        return Ok(());
    }

    let to_path_str = to.to_string_lossy().to_string();
    let content = fs::read_file_content(to).await?;
    let mut data = parse_http_file(&content, &to_path_str)?;

    let mut changed = false;
    for request in &mut data.requests {
        if request.name.as_deref() == Some(&old_name) {
            request.name = Some(new_name.clone());
            // Also update the "name" entry in commands if present.
            for (key, value) in &mut request.commands {
                if key == "name" {
                    *value = Some(new_name.clone());
                }
            }
            changed = true;
        }
    }

    if changed {
        let updated = serialize_http_file(&data);
        fs::atomic_write(to, updated.as_bytes()).await?;
    }

    Ok(())
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
