use crate::http::types::KeyValue;

#[taurpc::ipc_type]
pub struct EnvironmentData {
    pub name: String,
    pub variables: Vec<KeyValue>,
}

#[taurpc::ipc_type]
pub struct EnvironmentList {
    pub environments: Vec<EnvironmentData>,
    pub active: Option<String>,
}
