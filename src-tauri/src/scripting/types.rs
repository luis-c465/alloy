use crate::http::types::KeyValue;
use std::collections::HashMap;

#[taurpc::ipc_type]
pub struct ScriptConsoleEntry {
    pub level: String, // "log", "warn", "error", "info", "debug"
    pub message: String,
    pub phase: String, // "pre-request" or "post-response"
}

#[taurpc::ipc_type]
pub struct ScriptResult {
    pub success: bool,
    pub error: Option<String>,
    pub console_output: Vec<ScriptConsoleEntry>,
    pub modified_environment_variables: Vec<KeyValue>,
    pub unset_environment_variables: Vec<String>,
}

pub struct PreRequestScriptContext {
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub query_params: Vec<KeyValue>,
    pub body: Option<String>,
    pub body_type: String,
    pub environment_variables: HashMap<String, String>,
    /// Request-scoped variables (narrowest scope, wins over environment on
    /// template resolution). Scripts read/write this via `alloy.variables.*`.
    /// Flows both in and out of the script execution.
    pub local_variables: HashMap<String, String>,
    pub request_name: Option<String>,
}

pub struct PostResponseScriptContext {
    pub method: String,
    pub url: String,
    pub request_headers: Vec<KeyValue>,
    pub response_status: u16,
    pub response_status_text: String,
    pub response_headers: Vec<KeyValue>,
    pub response_body: String,
    pub response_time_ms: u64,
    pub response_size_bytes: u64,
    pub environment_variables: HashMap<String, String>,
    pub request_name: Option<String>,
}

// What the pre-request script may have mutated
pub struct PreRequestScriptMutations {
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub query_params: Vec<KeyValue>,
    pub body: Option<String>,
}
