use serde::{Deserialize, Serialize};

#[taurpc::ipc_type]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
pub enum MultipartValue {
    Text(String),
    File {
        path: String,
        filename: Option<String>,
    },
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
pub struct MultipartField {
    pub key: String,
    pub value: MultipartValue,
    pub content_type: Option<String>,
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
pub enum RequestBody {
    None,
    Json(String),
    FormUrlEncoded(Vec<KeyValue>),
    Multipart(Vec<MultipartField>),
    Raw {
        content: String,
        content_type: String,
    },
}

#[taurpc::ipc_type]
pub struct HttpRequestData {
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub query_params: Vec<KeyValue>,
    pub body: RequestBody,
    pub timeout_ms: Option<u64>,
    pub skip_ssl_verification: bool,
    pub request_variables: Vec<KeyValue>,
}

#[taurpc::ipc_type]
pub struct HttpResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<KeyValue>,
    pub body: String,
    pub is_binary: bool,
    pub body_base64: Option<String>,
    pub content_type: String,
    pub size_bytes: u64,
    pub time_ms: u64,
    /// True when the response body exceeded the maximum buffer size and was
    /// truncated.  The `size_bytes` field still reflects the full size.
    pub is_truncated: bool,
}
