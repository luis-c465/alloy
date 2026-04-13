use std::{path::Path, time::Duration};

use rusqlite::{params, params_from_iter, types::Value, Connection};
use tokio::sync::{Mutex, MutexGuard};

use crate::{
    error::AppError,
    history::types::{HistoryEntry, HistoryFilter, HistoryListEntry},
};

const MAX_RESPONSE_BODY_BYTES: usize = 1024 * 1024;
const TRUNCATED_MARKER: &str = "\n[TRUNCATED]";
const DB_LOCK_TIMEOUT: Duration = Duration::from_secs(5);

pub struct HistoryDb {
    pub conn: Mutex<Connection>,
}

impl HistoryDb {
    pub fn new(db_path: &Path) -> Result<Self, AppError> {
        let conn = Connection::open(db_path).map_err(|error| {
            AppError::RequestError(format!("Failed to open history DB: {error}"))
        })?;

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              method TEXT NOT NULL,
              url TEXT NOT NULL,
              status INTEGER,
              status_text TEXT,
              time_ms INTEGER,
              size_bytes INTEGER,
              timestamp TEXT NOT NULL DEFAULT (datetime('now')),
              request_headers TEXT NOT NULL DEFAULT '[]',
              request_body TEXT,
              response_headers TEXT,
              response_body TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);
            CREATE INDEX IF NOT EXISTS idx_history_method ON history(method);
            ",
        )
        .map_err(|error| {
            AppError::RequestError(format!("Failed to initialize history schema: {error}"))
        })?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Acquire the database connection with a timeout to prevent deadlocks
    /// if a previous lock holder panicked.
    async fn acquire_conn(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        tokio::time::timeout(DB_LOCK_TIMEOUT, self.conn.lock())
            .await
            .map_err(|_| {
                AppError::RequestError(
                    "History database lock timed out — the database may be in a bad state"
                        .to_string(),
                )
            })
    }

    pub async fn insert(&self, entry: &HistoryEntry) -> Result<i64, AppError> {
        let response_body = entry
            .response_body
            .as_deref()
            .map(truncate_large_response_body);

        let conn = self.acquire_conn().await?;
        conn.execute(
            "
            INSERT INTO history (
                method,
                url,
                status,
                status_text,
                time_ms,
                size_bytes,
                timestamp,
                request_headers,
                request_body,
                response_headers,
                response_body
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ",
            params![
                entry.method,
                entry.url,
                entry.status,
                entry.status_text,
                entry.time_ms.map(|value| value as i64),
                entry.size_bytes.map(|value| value as i64),
                entry.timestamp,
                entry.request_headers,
                entry.request_body,
                entry.response_headers,
                response_body,
            ],
        )
        .map_err(|error| {
            AppError::RequestError(format!("Failed to insert history entry: {error}"))
        })?;

        Ok(conn.last_insert_rowid())
    }

    pub async fn list(&self, filter: &HistoryFilter) -> Result<Vec<HistoryListEntry>, AppError> {
        let mut sql = String::from(
            "
            SELECT id, method, url, status, time_ms, timestamp
            FROM history
            WHERE 1 = 1
            ",
        );
        let mut bind_values: Vec<Value> = Vec::new();

        if let Some(query) = filter
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            sql.push_str(" AND url LIKE ?");
            bind_values.push(Value::Text(format!("%{query}%")));
        }

        if let Some(method) = filter
            .method
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            sql.push_str(" AND method = ?");
            bind_values.push(Value::Text(method.to_string()));
        }

        match (filter.status_min, filter.status_max) {
            (Some(min), Some(max)) => {
                sql.push_str(" AND status BETWEEN ? AND ?");
                bind_values.push(Value::Integer(i64::from(min)));
                bind_values.push(Value::Integer(i64::from(max)));
            }
            (Some(min), None) => {
                sql.push_str(" AND status >= ?");
                bind_values.push(Value::Integer(i64::from(min)));
            }
            (None, Some(max)) => {
                sql.push_str(" AND status <= ?");
                bind_values.push(Value::Integer(i64::from(max)));
            }
            (None, None) => {}
        }

        sql.push_str(" ORDER BY timestamp DESC LIMIT ?");
        let limit = if filter.limit == 0 {
            100_i64
        } else {
            i64::from(filter.limit)
        };
        bind_values.push(Value::Integer(limit));

        let conn = self.acquire_conn().await?;
        let mut statement = conn.prepare(&sql).map_err(|error| {
            AppError::RequestError(format!("Failed to prepare history list query: {error}"))
        })?;

        let rows = statement
            .query_map(params_from_iter(bind_values), |row| {
                let status = get_optional_u16(row, 3)?;
                let time_ms = get_optional_u64(row, 4)?;

                Ok(HistoryListEntry {
                    id: row.get(0)?,
                    method: row.get(1)?,
                    url: row.get(2)?,
                    status,
                    time_ms,
                    timestamp: row.get(5)?,
                })
            })
            .map_err(|error| {
                AppError::RequestError(format!("Failed to query history list: {error}"))
            })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
            AppError::RequestError(format!("Failed to map history list rows: {error}"))
        })
    }

    pub async fn get(&self, id: i64) -> Result<Option<HistoryEntry>, AppError> {
        let conn = self.acquire_conn().await?;
        let mut statement = conn
            .prepare(
                "
                SELECT id, method, url, status, status_text, time_ms, size_bytes,
                       timestamp, request_headers, request_body, response_headers, response_body
                FROM history
                WHERE id = ?
                ",
            )
            .map_err(|error| {
                AppError::RequestError(format!("Failed to prepare history get query: {error}"))
            })?;

        let row_result = statement.query_row([id], |row| {
            let status = get_optional_u16(row, 3)?;
            let time_ms = get_optional_u64(row, 5)?;
            let size_bytes = get_optional_u64(row, 6)?;

            Ok(HistoryEntry {
                id: row.get(0)?,
                method: row.get(1)?,
                url: row.get(2)?,
                status,
                status_text: row.get(4)?,
                time_ms,
                size_bytes,
                timestamp: row.get(7)?,
                request_headers: row.get(8)?,
                request_body: row.get(9)?,
                response_headers: row.get(10)?,
                response_body: row.get(11)?,
            })
        });

        match row_result {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(AppError::RequestError(format!(
                "Failed to fetch history entry {id}: {error}"
            ))),
        }
    }

    pub async fn delete(&self, id: i64) -> Result<(), AppError> {
        let conn = self.acquire_conn().await?;
        conn.execute("DELETE FROM history WHERE id = ?", [id])
            .map_err(|error| {
                AppError::RequestError(format!("Failed to delete history entry {id}: {error}"))
            })?;
        Ok(())
    }

    pub async fn clear(&self) -> Result<(), AppError> {
        let conn = self.acquire_conn().await?;
        conn.execute("DELETE FROM history", [])
            .map_err(|error| AppError::RequestError(format!("Failed to clear history: {error}")))?;
        Ok(())
    }

    pub async fn delete_older_than_days(&self, days: u32) -> Result<u64, AppError> {
        let conn = self.acquire_conn().await?;
        let removed = conn
            .execute(
                "DELETE FROM history WHERE timestamp < datetime('now', '-' || ? || ' days')",
                [i64::from(days)],
            )
            .map_err(|error| {
                AppError::RequestError(format!("Failed to delete old history entries: {error}"))
            })?;

        Ok(removed as u64)
    }
}

fn truncate_large_response_body(body: &str) -> String {
    if body.len() <= MAX_RESPONSE_BODY_BYTES {
        return body.to_string();
    }

    let mut cutoff = MAX_RESPONSE_BODY_BYTES;
    while !body.is_char_boundary(cutoff) {
        cutoff -= 1;
    }

    let mut truncated = body[..cutoff].to_string();
    truncated.push_str(TRUNCATED_MARKER);
    truncated
}

fn get_optional_u16(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<Option<u16>> {
    let value: Option<i64> = row.get(index)?;
    value
        .map(|inner| {
            u16::try_from(inner).map_err(|_| {
                rusqlite::Error::FromSqlConversionFailure(
                    index,
                    rusqlite::types::Type::Integer,
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("Value {inner} out of range for u16"),
                    )),
                )
            })
        })
        .transpose()
}

fn get_optional_u64(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<Option<u64>> {
    let value: Option<i64> = row.get(index)?;
    value
        .map(|inner| {
            u64::try_from(inner).map_err(|_| {
                rusqlite::Error::FromSqlConversionFailure(
                    index,
                    rusqlite::types::Type::Integer,
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("Value {inner} out of range for u64"),
                    )),
                )
            })
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn create_test_db_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("alloy-history-{}.db", Uuid::new_v4()))
    }

    fn sample_entry(method: &str, url: &str, status: Option<u16>) -> HistoryEntry {
        HistoryEntry {
            id: 0,
            method: method.to_string(),
            url: url.to_string(),
            status,
            status_text: status.map(|s| s.to_string()),
            time_ms: Some(123),
            size_bytes: Some(456),
            timestamp: "2026-01-01 00:00:00".to_string(),
            request_headers: "[]".to_string(),
            request_body: Some("{}".to_string()),
            response_headers: Some("[]".to_string()),
            response_body: Some("ok".to_string()),
        }
    }

    #[tokio::test]
    async fn insert_and_get_entry_by_id() {
        let db_path = create_test_db_path();
        let db = HistoryDb::new(&db_path).unwrap();

        let entry = sample_entry("GET", "https://example.com/a", Some(200));
        let id = db.insert(&entry).await.unwrap();

        let fetched = db.get(id).await.unwrap().unwrap();
        assert_eq!(fetched.id, id);
        assert_eq!(fetched.method, "GET");
        assert_eq!(fetched.url, "https://example.com/a");
        assert_eq!(fetched.status, Some(200));
        assert_eq!(fetched.request_headers, "[]");
        assert_eq!(fetched.response_body.as_deref(), Some("ok"));

        let _ = std::fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn list_honors_limit_in_reverse_chronological_order() {
        let db_path = create_test_db_path();
        let db = HistoryDb::new(&db_path).unwrap();

        for i in 0..10 {
            let mut entry = sample_entry("GET", &format!("https://example.com/{i}"), Some(200));
            entry.timestamp = format!("2026-01-01 00:00:{i:02}");
            db.insert(&entry).await.unwrap();
        }

        let results = db
            .list(&HistoryFilter {
                query: None,
                method: None,
                status_min: None,
                status_max: None,
                limit: 5,
            })
            .await
            .unwrap();

        assert_eq!(results.len(), 5);
        assert!(results[0].timestamp >= results[1].timestamp);
        assert!(results[1].timestamp >= results[2].timestamp);

        let _ = std::fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn list_filters_by_method() {
        let db_path = create_test_db_path();
        let db = HistoryDb::new(&db_path).unwrap();

        db.insert(&sample_entry("GET", "https://example.com/get", Some(200)))
            .await
            .unwrap();
        db.insert(&sample_entry("POST", "https://example.com/post", Some(201)))
            .await
            .unwrap();

        let results = db
            .list(&HistoryFilter {
                query: None,
                method: Some("GET".to_string()),
                status_min: None,
                status_max: None,
                limit: 100,
            })
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].method, "GET");

        let _ = std::fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn list_filters_by_url_query_pattern() {
        let db_path = create_test_db_path();
        let db = HistoryDb::new(&db_path).unwrap();

        db.insert(&sample_entry(
            "GET",
            "https://api.example.com/users",
            Some(200),
        ))
        .await
        .unwrap();
        db.insert(&sample_entry(
            "GET",
            "https://api.example.com/orders",
            Some(200),
        ))
        .await
        .unwrap();

        let results = db
            .list(&HistoryFilter {
                query: Some("users".to_string()),
                method: None,
                status_min: None,
                status_max: None,
                limit: 100,
            })
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert!(results[0].url.contains("users"));

        let _ = std::fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn clear_removes_all_entries() {
        let db_path = create_test_db_path();
        let db = HistoryDb::new(&db_path).unwrap();

        db.insert(&sample_entry("GET", "https://example.com/1", Some(200)))
            .await
            .unwrap();
        db.insert(&sample_entry("GET", "https://example.com/2", Some(200)))
            .await
            .unwrap();

        db.clear().await.unwrap();

        let results = db
            .list(&HistoryFilter {
                query: None,
                method: None,
                status_min: None,
                status_max: None,
                limit: 100,
            })
            .await
            .unwrap();

        assert!(results.is_empty());

        let _ = std::fs::remove_file(db_path);
    }
}
