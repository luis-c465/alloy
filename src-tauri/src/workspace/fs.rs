use std::path::{Path, PathBuf};
use std::{future::Future, pin::Pin};

use crate::{error::AppError, workspace::types::FileEntry};

const MAX_DEPTH: usize = 10;
const HTTP_TEMPLATE: &str = "### New Request\n# @name NewRequest\nGET https://example.com HTTP/1.1\n\n";

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
    tokio::fs::write(path, HTTP_TEMPLATE).await?;
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
        tokio::fs::write(root.join("z-last.http"), "").await.unwrap();
        tokio::fs::write(root.join("a-first.txt"), "").await.unwrap();
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
}
