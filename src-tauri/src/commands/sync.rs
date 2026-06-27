use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::errors::{ErrorPayload, KeySyncError};
use crate::sync::{WebDavConfig, WebDavSyncResult, WebDavSyncService};
use crate::vault::{store, VaultFile, VaultService};

const LOCAL_VAULT_FILE: &str = "vault.local.json";
const WEBDAV_CONFIG_FILE: &str = "webdav.config.json";
const LOCAL_DEVICE_ID: &str = "local-device";

#[derive(Debug, Serialize)]
pub struct WebDavSyncProfile {
    pub default_sync: Vec<&'static str>,
    pub optional_sync: Vec<&'static str>,
    pub conflict_policy: &'static str,
    pub remote_vault_file: &'static str,
    pub local_config_file: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWebDavConfigFile {
    pub version: u32,
    pub endpoint: String,
    pub username: String,
    pub remote_dir: String,
    pub encrypted_password: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfigSummary {
    pub endpoint: String,
    pub username: String,
    pub remote_dir: String,
    pub has_password: bool,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<&SavedWebDavConfigFile> for WebDavConfigSummary {
    fn from(value: &SavedWebDavConfigFile) -> Self {
        Self {
            endpoint: value.endpoint.clone(),
            username: value.username.clone(),
            remote_dir: value.remote_dir.clone(),
            has_password: !value.encrypted_password.trim().is_empty(),
            updated_at: value.updated_at,
        }
    }
}

#[tauri::command]
pub fn webdav_sync_profile() -> WebDavSyncProfile {
    WebDavSyncProfile {
        default_sync: vec!["encrypted_keys", "provider_config", "model_preferences", "proxy_settings"],
        optional_sync: vec!["conversation_history"],
        conflict_policy: "merge_by_record_id_keep_conflict_copies",
        remote_vault_file: "vault.sync.json.enc",
        local_config_file: WEBDAV_CONFIG_FILE,
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
    upload_local_vault_with_config(&app, &config).await
}

#[tauri::command]
pub async fn webdav_download_remote_vault(app: tauri::AppHandle, config: WebDavConfig, overwrite: bool) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    download_remote_vault_with_config(&app, &config, overwrite).await
}

#[tauri::command]
pub fn webdav_save_config_with_master_password(app: tauri::AppHandle, config: WebDavConfig, master_password: String) -> std::result::Result<WebDavConfigSummary, ErrorPayload> {
    validate_config_for_save(&config)?;
    if master_password.is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Sync("master password is required to save WebDAV config".into())));
    }

    let encrypted_password = VaultService::new()
        .encrypt_for_sync_with_master_password(&master_password, config.password.as_bytes())
        .map_err(ErrorPayload::from)?;

    let saved = SavedWebDavConfigFile {
        version: 1,
        endpoint: config.endpoint,
        username: config.username,
        remote_dir: config.remote_dir,
        encrypted_password,
        updated_at: chrono::Utc::now(),
    };

    save_webdav_config_file(&app, &saved)?;
    Ok(WebDavConfigSummary::from(&saved))
}

#[tauri::command]
pub fn webdav_load_saved_config_summary(app: tauri::AppHandle) -> std::result::Result<Option<WebDavConfigSummary>, ErrorPayload> {
    let Some(saved) = load_optional_webdav_config_file(&app)? else {
        return Ok(None);
    };
    Ok(Some(WebDavConfigSummary::from(&saved)))
}

#[tauri::command]
pub fn webdav_unlock_saved_config(app: tauri::AppHandle, master_password: String) -> std::result::Result<WebDavConfig, ErrorPayload> {
    let saved = load_required_webdav_config_file(&app)?;
    decrypt_saved_webdav_config(saved, &master_password)
}

#[tauri::command]
pub async fn webdav_test_saved_connection(app: tauri::AppHandle, master_password: String) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    let config = webdav_unlock_saved_config(app, master_password)?;
    webdav_test_connection(config).await
}

#[tauri::command]
pub async fn webdav_upload_local_vault_with_saved_config(app: tauri::AppHandle, master_password: String) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    let config = webdav_unlock_saved_config(app.clone(), master_password)?;
    upload_local_vault_with_config(&app, &config).await
}

#[tauri::command]
pub async fn webdav_download_remote_vault_with_saved_config(app: tauri::AppHandle, master_password: String, overwrite: bool) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    let config = webdav_unlock_saved_config(app.clone(), master_password)?;
    download_remote_vault_with_config(&app, &config, overwrite).await
}

async fn upload_local_vault_with_config(app: &tauri::AppHandle, config: &WebDavConfig) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    let path = local_vault_path(app)?;
    let content = fs::read(&path)
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to read local vault before upload: {err}"))))?;

    WebDavSyncService::new()
        .map_err(ErrorPayload::from)?
        .upload_vault(config, content)
        .await
        .map_err(ErrorPayload::from)
}

async fn download_remote_vault_with_config(app: &tauri::AppHandle, config: &WebDavConfig, overwrite: bool) -> std::result::Result<WebDavSyncResult, ErrorPayload> {
    let path = local_vault_path(app)?;
    let (mut result, content) = WebDavSyncService::new()
        .map_err(ErrorPayload::from)?
        .download_vault(config)
        .await
        .map_err(ErrorPayload::from)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to create app data directory: {err}"))))?;
    }

    if overwrite || !path.exists() {
        backup_existing_file(&path)?;
        fs::write(&path, content)
            .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to write downloaded vault: {err}"))))?;
        result.message = if overwrite { "Remote vault downloaded and local vault overwritten after backup".into() } else { "Remote vault downloaded as local vault".into() };
        return Ok(result);
    }

    let remote_content = String::from_utf8(content)
        .map_err(|_| ErrorPayload::from(KeySyncError::Sync("downloaded vault is not valid UTF-8 JSON".into())))?;
    let remote_vault = store::parse_vault_file(&remote_content).map_err(ErrorPayload::from)?;
    let mut local_vault = VaultService::new()
        .load_file(&path, LOCAL_DEVICE_ID.to_owned())
        .map_err(ErrorPayload::from)?;

    backup_existing_file(&path)?;
    let merge_report = store::merge_remote_records(&mut local_vault, remote_vault);
    local_vault.device_id = LOCAL_DEVICE_ID.to_owned();
    local_vault.version = 1;
    VaultService::new().save_file(&path, &local_vault).map_err(ErrorPayload::from)?;

    result.message = format!(
        "Remote vault merged into local vault. Added: {}, unchanged: {}, conflicts kept: {}",
        merge_report.added, merge_report.unchanged, merge_report.conflicts
    );
    Ok(result)
}

fn validate_config_for_save(config: &WebDavConfig) -> std::result::Result<(), ErrorPayload> {
    if config.endpoint.trim().is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Sync("WebDAV endpoint is required".into())));
    }
    if config.username.trim().is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Sync("WebDAV username is required".into())));
    }
    if config.password.is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Sync("WebDAV password is required".into())));
    }
    Ok(())
}

fn decrypt_saved_webdav_config(saved: SavedWebDavConfigFile, master_password: &str) -> std::result::Result<WebDavConfig, ErrorPayload> {
    if master_password.is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Sync("master password is required to unlock WebDAV config".into())));
    }

    let password_bytes = VaultService::new()
        .decrypt_from_sync_with_master_password(master_password, &saved.encrypted_password)
        .map_err(ErrorPayload::from)?;
    let password = String::from_utf8(password_bytes)
        .map_err(|_| ErrorPayload::from(KeySyncError::Sync("decrypted WebDAV password is not valid UTF-8".into())))?;

    Ok(WebDavConfig {
        endpoint: saved.endpoint,
        username: saved.username,
        password,
        remote_dir: saved.remote_dir,
    })
}

fn load_required_webdav_config_file(app: &tauri::AppHandle) -> std::result::Result<SavedWebDavConfigFile, ErrorPayload> {
    load_optional_webdav_config_file(app)?.ok_or_else(|| ErrorPayload::from(KeySyncError::Sync("saved WebDAV config not found".into())))
}

fn load_optional_webdav_config_file(app: &tauri::AppHandle) -> std::result::Result<Option<SavedWebDavConfigFile>, ErrorPayload> {
    let path = webdav_config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to read saved WebDAV config: {err}"))))?;
    let saved = serde_json::from_str(&content)
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to parse saved WebDAV config: {err}"))))?;
    Ok(Some(saved))
}

fn save_webdav_config_file(app: &tauri::AppHandle, config: &SavedWebDavConfigFile) -> std::result::Result<(), ErrorPayload> {
    let path = webdav_config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to create app data directory: {err}"))))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to serialize WebDAV config: {err}"))))?;
    fs::write(path, content)
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to write saved WebDAV config: {err}"))))
}

fn backup_existing_file(path: &Path) -> std::result::Result<Option<PathBuf>, ErrorPayload> {
    if !path.exists() {
        return Ok(None);
    }

    let parent = path.parent().ok_or_else(|| ErrorPayload::from(KeySyncError::Sync("local vault path has no parent directory".into())))?;
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let backup_path = parent.join(format!("vault.local.{timestamp}.backup.json"));
    fs::copy(path, &backup_path)
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to backup local vault before sync: {err}"))))?;
    Ok(Some(backup_path))
}

fn local_vault_path(app: &tauri::AppHandle) -> std::result::Result<PathBuf, ErrorPayload> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to resolve app data directory: {err}"))))?;
    Ok(dir.join(LOCAL_VAULT_FILE))
}

fn webdav_config_path(app: &tauri::AppHandle) -> std::result::Result<PathBuf, ErrorPayload> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| ErrorPayload::from(KeySyncError::Sync(format!("failed to resolve app data directory: {err}"))))?;
    Ok(dir.join(WEBDAV_CONFIG_FILE))
}
