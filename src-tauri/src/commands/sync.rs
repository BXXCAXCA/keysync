use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

use crate::errors::{ErrorPayload, KeySyncError};
use crate::sync::{WebDavConfig, WebDavSyncResult, WebDavSyncService};

const LOCAL_VAULT_FILE: &str = "vault.local.json";

#[derive(Debug, Serialize)]
pub struct WebDavSyncProfile {
    pub default_sync: Vec<&'static str>,
    pub optional_sync: Vec<&'static str>,
    pub conflict_policy: &'static str,
    pub remote_vault_file: &'static str,
}

#[tauri::command]
pub fn webdav_sync_profile() -> WebDavSyncProfile {
    WebDavSyncProfile {
        default_sync: vec!["encrypted_keys", "provider_config", "model_preferences", "proxy_settings"],
        optional_sync: vec!["conversation_history"],
        conflict_policy: "manual_upload_download_first_auto_merge_later",
        remote_vault_file: "vault.sync.json.enc",
    }
}

#[tauri::command]
pub async fn webdav_test_connection(config: WebDavConfig) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    WebDavSyncService::new()
        .map_err(ErrorPayload::from)?
        .test_connection(&config)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn webdav_upload_local_vault(app: tauri::AppHandle, config: WebDavConfig) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    let path = local_vault_path(&app)?;
    let content = fs::read(&path)
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to read local vault before upload: {err}"))))?;

    WebDavSyncService::new()
        .map_err(ErrorPayload::from)?
        .upload_vault(&config, content)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn webdav_download_remote_vault(app: tauri::AppHandle, config: WebDavConfig, overwrite: bool) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    let path = local_vault_path(&app)?;
    if path.exists() && !overwrite {
        return Err(ErrorPayload::from(KeySyncError::Sync(
            "local vault already exists; pass overwrite=true to replace it".into(),
        )));
    }

    let (result, content) = WebDavSyncService::new()
        .map_err(ErrorPayload::from)?
        .download_vault(&config)
        .await
        .map_err(ErrorPayload::from)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to create app data directory: {err}"))))?;
    }

    fs::write(&path, content)
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to write downloaded vault: {err}"))))?;

    Ok(result)
}

fn local_vault_path(app: &tauri::AppHandle) -> std::result::Result<PathBuf, ErrorPayload> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to resolve app data directory: {err}"))))?;
    Ok(dir.join(LOCAL_VAULT_FILE))
}
