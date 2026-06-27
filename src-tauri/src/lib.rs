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
            commands::providers::list_models_with_key,
            commands::providers::test_provider_with_key,
            commands::providers::start_chat_stream_with_key,
            commands::providers::stop_chat_stream,
            commands::vault::vault_security_profile,
            commands::vault::vault_encrypt_with_master_password,
            commands::vault::vault_decrypt_with_master_password,
            commands::vault::vault_list_secret_records,
            commands::vault::vault_save_secret_with_master_password,
            commands::vault::vault_decrypt_secret_with_master_password,
            commands::vault::vault_delete_secret_record,
            commands::sync::webdav_sync_profile,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run KeySync AI");
}
