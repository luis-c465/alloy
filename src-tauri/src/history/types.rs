#[taurpc::ipc_type]
pub struct HistoryEntry {
    pub id: i64,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub status_text: Option<String>,
    pub time_ms: Option<u64>,
    pub size_bytes: Option<u64>,
    pub timestamp: String,
    pub request_headers: String,
    pub request_body: Option<String>,
    pub response_headers: Option<String>,
    pub response_body: Option<String>,
}

#[taurpc::ipc_type]
pub struct HistoryListEntry {
    pub id: i64,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub time_ms: Option<u64>,
    pub size_bytes: Option<u64>,
    pub timestamp: String,
}

#[taurpc::ipc_type]
pub struct HistoryFilter {
    pub query: Option<String>,
    pub method: Option<String>,
    pub status_min: Option<u16>,
    pub status_max: Option<u16>,
    pub limit: u32,
}
