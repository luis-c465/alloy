use crate::{
    error::AppError,
    http::{
        self,
        types::{HttpRequestData, HttpResponseData},
    },
};

#[taurpc::procedures(export_to = "../src/bindings.ts")]
pub trait Api {
    async fn send_request(request: HttpRequestData) -> Result<HttpResponseData, AppError>;
}

#[derive(Clone)]
pub struct ApiImpl;

#[taurpc::resolvers]
impl Api for ApiImpl {
    async fn send_request(self, request: HttpRequestData) -> Result<HttpResponseData, AppError> {
        http::client::execute_request(request).await
    }
}
