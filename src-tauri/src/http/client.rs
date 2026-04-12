use crate::error::AppError;

use super::types::{HttpRequestData, HttpResponseData};

pub async fn execute_request(_request: HttpRequestData) -> Result<HttpResponseData, AppError> {
    Ok(HttpResponseData {
        status: 200,
        status_text: "OK".to_string(),
        headers: vec![],
        body: "Stub response from Alloy backend".to_string(),
        size_bytes: 31,
        time_ms: 0,
    })
}
