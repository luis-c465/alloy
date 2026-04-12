mod commands;
mod environment;
mod error;
mod history;
mod http;
mod workspace;

use commands::http::{Api, ApiImpl};
use history::db::HistoryDb;
use specta_typescript::{BigIntExportBehavior, Typescript};
use std::sync::Arc;
use tauri::Manager;
use taurpc::Router;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub async fn run() {
    let router = Router::new()
        .export_config(
            Typescript::default()
                .header("// @ts-nocheck\n")
                .bigint(BigIntExportBehavior::Number),
        )
        .merge(ApiImpl.into_handler());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("history.db");
            let db = HistoryDb::new(&db_path)
                .map_err(|error| std::io::Error::other(error.to_string()))?;

            app.manage(Arc::new(db));

            Ok(())
        })
        .invoke_handler(router.into_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
