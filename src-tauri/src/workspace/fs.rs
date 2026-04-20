use std::path::{Path, PathBuf};
use std::{future::Future, pin::Pin};

use crate::{
    error::AppError,
    workspace::{folder_config::FOLDER_CONFIG_FILE_NAME, types::FileEntry},
};

const MAX_DEPTH: usize = 10;

/// Verify that `target` is contained within `root` after resolving symlinks
/// and `..` segments.  Returns the canonicalized target path on success.
///
/// When `target` does not exist yet (creation operations), pass its nearest
/// existing ancestor (typically the parent directory) instead.
#[allow(dead_code)]
pub fn assert_within_directory(root: &Path, target: &Path) -> Result<PathBuf, AppError> {
    let canonical_root = std::fs::canonicalize(root).map_err(|error| {
        AppError::IoError(format!(
            "Cannot resolve workspace root {}: {error}",
            root.display()
        ))
    })?;

    let canonical_target = std::fs::canonicalize(target).map_err(|error| {
        AppError::IoError(format!("Cannot resolve path {}: {error}", target.display()))
    })?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err(AppError::IoError(format!(
            "Path escapes the workspace boundary: {}",
            target.display()
        )));
    }

    Ok(canonical_target)
}

/// Convert a file stem (e.g. "get-users" or "my request") into a PascalCase
/// identifier suitable for use as an HTTP `@name` value (e.g. "GetUsers",
/// "MyRequest").  Non-alphanumeric characters act as word boundaries and are
/// stripped; digits are kept.  Returns `"NewRequest"` when the result would
/// otherwise be empty.
pub fn stem_to_request_name(stem: &str) -> String {
    let mut result = String::new();
    let mut capitalize_next = true;

    for ch in stem.chars() {
        if ch.is_alphanumeric() {
            if capitalize_next {
                result.extend(ch.to_uppercase());
                capitalize_next = false;
            } else {
                result.push(ch);
            }
        } else {
            // Treat any non-alphanumeric character as a word boundary.
            capitalize_next = true;
        }
    }

    if result.is_empty() {
        "NewRequest".to_string()
    } else {
        result
    }
}

pub async fn list_directory(root: &Path) -> Result<Vec<FileEntry>, AppError> {
    list_directory_recursive(root, 0).await
}

fn list_directory_recursive<'a>(
    path: &'a Path,
    depth: usize,
) -> Pin<Box<dyn Future<Output = Result<Vec<FileEntry>, AppError>> + Send + 'a>> {
    Box::pin(async move {
        if depth >= MAX_DEPTH {
            return Ok(Vec::new());
        }

        let mut read_dir = tokio::fs::read_dir(path).await?;
        let mut entries = Vec::new();

        while let Some(entry) = read_dir.next_entry().await? {
            let file_type = entry.file_type().await?;
            if file_type.is_symlink() {
                continue;
            }

            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = file_type.is_dir();

            if is_dir && name.starts_with('.') && name != ".alloy" {
                continue;
            }

            if !is_dir && name == FOLDER_CONFIG_FILE_NAME {
                continue;
            }

            let children = if is_dir {
                Some(list_directory_recursive(&entry_path, depth + 1).await?)
            } else {
                None
            };

            entries.push(FileEntry {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir,
                children,
            });
        }

        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
    })
}

pub async fn ensure_alloy_dir(workspace_path: &Path) -> Result<PathBuf, AppError> {
    let alloy_path = workspace_path.join(".alloy");
    let environments_path = alloy_path.join("environments");

    tokio::fs::create_dir_all(&environments_path).await?;

    Ok(alloy_path)
}

pub async fn create_http_file(path: &Path) -> Result<(), AppError> {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let request_name = stem_to_request_name(&stem);
    let template =
        format!("### {request_name}\n# @name {request_name}\nGET https://example.com HTTP/1.1\n\n");
    tokio::fs::write(path, template).await?;
    Ok(())
}

pub async fn create_directory(path: &Path) -> Result<(), AppError> {
    tokio::fs::create_dir(path).await?;
    Ok(())
}

pub async fn delete_path(path: &Path) -> Result<(), AppError> {
    let metadata = tokio::fs::metadata(path).await?;

    if metadata.is_dir() {
        match tokio::fs::remove_dir(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
                Err(AppError::IoError(format!(
                    "Cannot delete non-empty directory: {}",
                    path.display()
                )))
            }
            Err(error) => Err(error.into()),
        }
    } else {
        tokio::fs::remove_file(path).await?;
        Ok(())
    }
}

pub async fn rename_path(from: &Path, to: &Path) -> Result<(), AppError> {
    tokio::fs::rename(from, to).await?;
    Ok(())
}

pub async fn read_file_content(path: &Path) -> Result<String, AppError> {
    Ok(tokio::fs::read_to_string(path).await?)
}

/// Write `content` to `path` atomically by first writing to a temporary
/// sibling file, then renaming it into place.  This prevents a crash
/// mid-write from corrupting the target file.
pub async fn atomic_write(path: &Path, content: &[u8]) -> Result<(), AppError> {
    let tmp_path = path.with_extension("tmp");
    tokio::fs::write(&tmp_path, content)
        .await
        .map_err(|error| {
            AppError::IoError(format!(
                "Failed to write temporary file {}: {error}",
                tmp_path.display()
            ))
        })?;

    if let Err(error) = tokio::fs::rename(&tmp_path, path).await {
        // Best-effort cleanup of the temp file.
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(AppError::IoError(format!(
            "Failed to rename temporary file to {}: {error}",
            path.display()
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn list_directory_returns_sorted_tree_and_skips_hidden_dirs() {
        let root = std::env::temp_dir().join(format!("alloy-workspace-fs-{}", Uuid::new_v4()));

        tokio::fs::create_dir_all(root.join("src")).await.unwrap();
        tokio::fs::create_dir_all(root.join(".alloy").join("environments"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(root.join(".git")).await.unwrap();
        tokio::fs::write(root.join("z-last.http"), "")
            .await
            .unwrap();
        tokio::fs::write(root.join("a-first.txt"), "")
            .await
            .unwrap();
        tokio::fs::write(root.join("src").join("inner.http"), "")
            .await
            .unwrap();

        let entries = list_directory(&root).await.unwrap();

        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].name, ".alloy");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].name, "src");
        assert!(entries[1].is_dir);
        assert_eq!(entries[2].name, "a-first.txt");
        assert!(!entries[2].is_dir);
        assert_eq!(entries[3].name, "z-last.http");
        assert!(!entries[3].is_dir);

        assert!(entries.iter().all(|entry| entry.name != ".git"));

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn stem_to_request_name_handles_hyphenated_names() {
        assert_eq!(stem_to_request_name("get-users"), "GetUsers");
    }

    #[test]
    fn stem_to_request_name_handles_spaces() {
        assert_eq!(stem_to_request_name("my request"), "MyRequest");
    }

    #[test]
    fn stem_to_request_name_handles_plain_name() {
        assert_eq!(stem_to_request_name("auth"), "Auth");
    }

    #[test]
    fn stem_to_request_name_handles_already_pascal_case() {
        assert_eq!(stem_to_request_name("GetUsers"), "GetUsers");
    }

    #[test]
    fn stem_to_request_name_returns_fallback_for_empty() {
        assert_eq!(stem_to_request_name(""), "NewRequest");
        assert_eq!(stem_to_request_name("---"), "NewRequest");
    }

    #[test]
    fn assert_within_directory_allows_child_path() {
        let root = std::env::temp_dir();
        let child = root.join("some-file");
        // Create the child so canonicalize can resolve it.
        std::fs::write(&child, "").unwrap();

        let result = assert_within_directory(&root, &child);
        assert!(result.is_ok());

        std::fs::remove_file(child).unwrap();
    }

    #[test]
    fn assert_within_directory_rejects_escaping_path() {
        let root = std::env::temp_dir().join(format!("alloy-jail-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();

        // /tmp/alloy-jail-xxx/../ resolves to /tmp, which is outside root.
        // We can't canonicalize a non-existent target, but the parent exists.
        // Instead test with the canonical /tmp dir which is outside root.
        let result = assert_within_directory(&root, &std::env::temp_dir());
        assert!(result.is_err());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn create_http_file_uses_stem_as_request_name() {
        let dir = std::env::temp_dir().join(format!("alloy-create-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join("get-users.http");

        create_http_file(&path).await.unwrap();

        let content = tokio::fs::read_to_string(&path).await.unwrap();
        assert!(
            content.contains("# @name GetUsers"),
            "content was: {content}"
        );
        assert!(content.contains("### GetUsers"), "content was: {content}");

        tokio::fs::remove_dir_all(dir).await.unwrap();
    }
}
