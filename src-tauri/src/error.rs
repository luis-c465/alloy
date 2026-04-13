use serde::ser::Serializer;
use thiserror::Error;

#[derive(Debug, Error, specta::Type)]
pub enum AppError {
    #[error("Request error: {0}")]
    RequestError(String),
    #[error("I/O error: {0}")]
    IoError(String),
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("File read error: {0}")]
    FileReadError(String),
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("Serialization error: {0}")]
    SerializationError(String),
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("Request timed out")]
    Timeout,
    #[error("Network error: {0}")]
    NetworkError(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        if value.is_timeout() {
            Self::Timeout
        } else if value.is_connect() {
            Self::NetworkError(value.to_string())
        } else {
            Self::RequestError(value.to_string())
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::IoError(value.to_string())
    }
}
