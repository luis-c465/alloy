use std::sync::Arc;

use tokio::sync::OnceCell;

use crate::{
    error::AppError,
    history::{
        db::HistoryDb,
        types::{HistoryEntry, HistoryFilter, HistoryListEntry},
    },
};

#[taurpc::procedures(path = "history", export_to = "../src/bindings.ts")]
pub trait HistoryApi {
    async fn list_history(filter: HistoryFilter) -> Result<Vec<HistoryListEntry>, AppError>;
    async fn get_history_entry(id: i64) -> Result<Option<HistoryEntry>, AppError>;
    async fn delete_history_entry(id: i64) -> Result<(), AppError>;
    async fn clear_history() -> Result<(), AppError>;
}

#[derive(Clone)]
pub struct HistoryApiImpl {
    pub db: Arc<OnceCell<Arc<HistoryDb>>>,
}

impl HistoryApiImpl {
    async fn history_db(&self) -> Result<Arc<HistoryDb>, AppError> {
        self.db.get().cloned().ok_or_else(|| {
            AppError::RequestError("History database is not initialized".to_string())
        })
    }
}

#[taurpc::resolvers]
impl HistoryApi for HistoryApiImpl {
    async fn list_history(self, filter: HistoryFilter) -> Result<Vec<HistoryListEntry>, AppError> {
        self.history_db().await?.list(&filter).await
    }

    async fn get_history_entry(self, id: i64) -> Result<Option<HistoryEntry>, AppError> {
        self.history_db().await?.get(id).await
    }

    async fn delete_history_entry(self, id: i64) -> Result<(), AppError> {
        self.history_db().await?.delete(id).await
    }

    async fn clear_history(self) -> Result<(), AppError> {
        self.history_db().await?.clear().await
    }
}
