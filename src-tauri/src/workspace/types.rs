use crate::http::types::KeyValue;

#[taurpc::ipc_type]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[taurpc::ipc_type]
pub struct HttpFileRequest {
    pub name: Option<String>,
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub variables: Vec<KeyValue>,
    pub body: Option<String>,
    pub body_type: String,
    pub commands: Vec<(String, Option<String>)>,
}

#[taurpc::ipc_type]
pub struct HttpFileData {
    pub path: String,
    pub requests: Vec<HttpFileRequest>,
    pub variables: Vec<KeyValue>,
}

#[taurpc::ipc_type]
pub struct WorkspaceInfo {
    pub path: String,
    pub name: String,
}

#[taurpc::ipc_type]
pub struct FolderConfig {
    pub headers: Vec<KeyValue>,
    pub variables: Vec<KeyValue>,
    pub auth_type: String,
    pub auth_bearer: Option<String>,
    pub auth_basic_username: Option<String>,
    pub auth_basic_password: Option<String>,
}

#[taurpc::ipc_type]
pub struct FolderConfigEntry {
    pub folder_path: String,
    pub config: FolderConfig,
}
