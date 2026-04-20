mod commands;
mod environment;
mod error;
mod history;
mod http;
mod import_export;
mod scripting;
mod workspace;

use commands::{
    environment::{EnvironmentApi, EnvironmentApiImpl},
    history::{HistoryApi, HistoryApiImpl},
    http::{Api, ApiImpl},
    import_export::{ImportExportApi, ImportExportApiImpl},
    workspace::{WorkspaceApi, WorkspaceApiImpl},
};
use environment::resolver;
use history::db::{HistoryDb, HISTORY_RETENTION_DAYS};
use specta_typescript::{BigIntExportBehavior, Typescript};
use std::sync::{Arc, RwLock};
use tauri::Manager;
use taurpc::Router;
use tokio::sync::{Mutex, OnceCell};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub async fn run() {
    let db = Arc::new(OnceCell::<Arc<HistoryDb>>::new());
    let app_handle = Arc::new(OnceCell::<tauri::AppHandle<tauri::Wry>>::new());
    let hbs = Arc::new(RwLock::new(resolver::create_resolver()));
    let last_binary_response = Arc::new(Mutex::new(None));

    let router = Router::new()
        .export_config(
            Typescript::default()
                .header("// @ts-nocheck\n")
                .bigint(BigIntExportBehavior::Number),
        )
        .merge(
            ApiImpl {
                db: db.clone(),
                app_handle: app_handle.clone(),
                hbs: hbs.clone(),
                last_binary_response: last_binary_response.clone(),
            }
            .into_handler(),
        )
        .merge(
            WorkspaceApiImpl {
                app_handle: app_handle.clone(),
            }
            .into_handler(),
        )
        .merge(
            ImportExportApiImpl {
                app_handle: app_handle.clone(),
            }
            .into_handler(),
        )
        .merge(EnvironmentApiImpl { hbs: hbs.clone() }.into_handler())
        .merge(HistoryApiImpl { db: db.clone() }.into_handler());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            app_handle
                .set(app.handle().clone())
                .map_err(|_| std::io::Error::other("App handle was initialized more than once"))?;

            let db_path = app_data_dir.join("history.db");
            let history_db = Arc::new(
                HistoryDb::new(&db_path)
                    .map_err(|error| std::io::Error::other(error.to_string()))?,
            );

            db.set(history_db.clone()).map_err(|_| {
                std::io::Error::other("History database was initialized more than once")
            })?;

            // Prune history entries older than the configured retention period.
            let db_for_cleanup = history_db.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = db_for_cleanup
                    .delete_older_than_days(HISTORY_RETENTION_DAYS)
                    .await
                {
                    eprintln!("Failed to prune old history: {e}");
                }
            });

            app.manage(history_db);

            Ok(())
        })
        .invoke_handler(router.into_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
