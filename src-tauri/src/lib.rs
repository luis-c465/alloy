mod commands;
mod error;
mod http;

use commands::http::{Api, ApiImpl};
use taurpc::Router;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let router = Router::new().merge(ApiImpl.into_handler());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(router.into_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
