use crate::{
    error::AppError,
    http::types::HttpRequestData,
    import_export::curl::{curl_to_request, request_to_curl},
};

#[taurpc::procedures(path = "import_export", export_to = "../src/bindings.ts")]
pub trait ImportExportApi {
    async fn export_curl(request: HttpRequestData) -> Result<String, AppError>;
    async fn import_curl(curl_command: String) -> Result<HttpRequestData, AppError>;
}

#[derive(Clone, Default)]
pub struct ImportExportApiImpl;

#[taurpc::resolvers]
impl ImportExportApi for ImportExportApiImpl {
    async fn export_curl(self, request: HttpRequestData) -> Result<String, AppError> {
        Ok(request_to_curl(&request))
    }

    async fn import_curl(self, curl_command: String) -> Result<HttpRequestData, AppError> {
        curl_to_request(&curl_command)
    }
}
