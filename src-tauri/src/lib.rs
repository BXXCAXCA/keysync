pub mod commands;
pub mod errors;
pub mod providers;
pub mod proxy;
pub mod storage;
pub mod sync;
pub mod vault;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::app::app_status,
            commands::providers::list_provider_templates,
            commands::providers::test_provider_placeholder,
            commands::vault::vault_security_profile,
            commands::sync::webdav_sync_profile,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run KeySync AI");
}
