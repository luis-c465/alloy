mod commands;
mod error;
mod http;

use commands::http::{Api, ApiImpl};
use specta_typescript::{BigIntExportBehavior, Typescript};
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
        .invoke_handler(router.into_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
