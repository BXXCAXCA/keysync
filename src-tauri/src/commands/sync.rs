use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct WebDavSyncProfile {
    pub default_sync: Vec<&'static str>,
    pub optional_sync: Vec<&'static str>,
    pub conflict_policy: &'static str,
}

#[tauri::command]
pub fn webdav_sync_profile() -> WebDavSyncProfile {
    WebDavSyncProfile {
        default_sync: vec!["encrypted_keys", "provider_config", "model_preferences", "proxy_settings"],
        optional_sync: vec!["conversation_history"],
        conflict_policy: "auto_merge_non_conflicting_items_keep_conflict_copies",
    }
}
