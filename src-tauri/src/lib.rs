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
            commands::conversations::list_conversations,
            commands::conversations::load_conversation,
            commands::conversations::save_conversation,
            commands::conversations::delete_conversation,
            commands::models::save_model_cache,
            commands::models::list_cached_models,
            commands::models::update_model_preferences,
            commands::vault::vault_security_profile,
            commands::vault::vault_system_keychain_status,
            commands::vault::vault_init_system_data_key,
            commands::vault::vault_delete_system_data_key,
            commands::vault::vault_encrypt_with_master_password,
            commands::vault::vault_decrypt_with_master_password,
            commands::vault::vault_list_secret_records,
            commands::vault::vault_list_conflict_records,
            commands::vault::vault_save_secret_with_master_password,
            commands::vault::vault_save_secret_with_system_keychain,
            commands::vault::vault_decrypt_secret_with_master_password,
            commands::vault::vault_decrypt_secret_with_system_keychain,
            commands::vault::vault_migrate_secret_to_system_keychain,
            commands::vault::vault_delete_secret_record,
            commands::vault::vault_rename_secret_record,
            commands::sync::webdav_sync_profile,
            commands::sync::webdav_test_connection,
            commands::sync::webdav_upload_local_vault,
            commands::sync::webdav_download_remote_vault,
            commands::sync::webdav_save_config_with_master_password,
            commands::sync::webdav_load_saved_config_summary,
            commands::sync::webdav_unlock_saved_config,
            commands::sync::webdav_test_saved_connection,
            commands::sync::webdav_upload_local_vault_with_saved_config,
            commands::sync::webdav_download_remote_vault_with_saved_config,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run KeySync AI");
}
