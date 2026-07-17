use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::errors::{ErrorPayload, KeySyncError};
use crate::providers::ProviderTemplate;
use crate::vault::{crypto, keychain};

const LOCAL_SETTINGS_FILE: &str = "settings.local.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppSettings {
    pub global_proxy_url: Option<String>,
    pub provider_proxy_urls: BTreeMap<String, String>,
    pub provider_proxy_disabled: BTreeSet<String>,
    pub custom_provider_templates: Vec<ProviderTemplate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedSettingsFile {
    version: u32,
    encrypted_payload: String,
}

#[tauri::command]
pub fn load_app_settings(app: tauri::AppHandle) -> std::result::Result<AppSettings, ErrorPayload> {
    let path = local_settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&path).map_err(|error| {
        ErrorPayload::from(KeySyncError::Storage(format!(
            "read local settings: {error}"
        )))
    })?;
    let encrypted: EncryptedSettingsFile = serde_json::from_str(&content).map_err(|error| {
        ErrorPayload::from(KeySyncError::Storage(format!(
            "parse local settings: {error}"
        )))
    })?;
    if encrypted.version != 1 {
        return Err(ErrorPayload::from(KeySyncError::Storage(format!(
            "unsupported local settings version: {}",
            encrypted.version
        ))));
    }

    let data_key = fixed_data_key(&keychain::load_data_key().map_err(ErrorPayload::from)?)?;
    let envelope = crypto::envelope_from_string(&encrypted.encrypted_payload).map_err(ErrorPayload::from)?;
    let plaintext = crypto::open_with_data_key(&data_key, &envelope).map_err(ErrorPayload::from)?;
    serde_json::from_slice(&plaintext).map_err(|error| {
        ErrorPayload::from(KeySyncError::Storage(format!(
            "parse decrypted local settings: {error}"
        )))
    })
}

#[tauri::command]
pub fn save_app_settings(
    app: tauri::AppHandle,
    settings: AppSettings,
) -> std::result::Result<AppSettings, ErrorPayload> {
    let settings = normalize_settings(settings);
    let plaintext = serde_json::to_vec(&settings).map_err(|error| {
        ErrorPayload::from(KeySyncError::Storage(format!(
            "serialize local settings: {error}"
        )))
    })?;
    let data_key = fixed_data_key(&keychain::load_or_create_data_key().map_err(ErrorPayload::from)?)?;
    let envelope = crypto::seal_with_data_key(&data_key, &plaintext).map_err(ErrorPayload::from)?;
    let encrypted = EncryptedSettingsFile {
        version: 1,
        encrypted_payload: crypto::envelope_to_string(&envelope).map_err(ErrorPayload::from)?,
    };
    let content = serde_json::to_string_pretty(&encrypted).map_err(|error| {
        ErrorPayload::from(KeySyncError::Storage(format!(
            "serialize encrypted local settings: {error}"
        )))
    })?;
    let path = local_settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ErrorPayload::from(KeySyncError::Storage(format!(
                "create settings directory: {error}"
            )))
        })?;
    }
    fs::write(path, content).map_err(|error| {
        ErrorPayload::from(KeySyncError::Storage(format!(
            "write encrypted local settings: {error}"
        )))
    })?;
    Ok(settings)
}

pub fn local_settings_path(app: &tauri::AppHandle) -> std::result::Result<PathBuf, ErrorPayload> {
    let dir = app.path().app_data_dir().map_err(|error| {
        ErrorPayload::from(KeySyncError::Storage(format!(
            "resolve app data directory: {error}"
        )))
    })?;
    Ok(dir.join(LOCAL_SETTINGS_FILE))
}

pub fn has_encrypted_local_settings(
    app: &tauri::AppHandle,
) -> std::result::Result<bool, ErrorPayload> {
    Ok(local_settings_path(app)?.exists())
}

fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings.global_proxy_url = settings
        .global_proxy_url
        .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned()));
    settings.provider_proxy_urls = settings
        .provider_proxy_urls
        .into_iter()
        .filter_map(|(provider_id, url)| {
            let provider_id = provider_id.trim();
            let url = url.trim();
            (!provider_id.is_empty() && !url.is_empty())
                .then(|| (provider_id.to_owned(), url.to_owned()))
        })
        .collect();
    settings.provider_proxy_disabled = settings
        .provider_proxy_disabled
        .into_iter()
        .filter_map(|provider_id| {
            let provider_id = provider_id.trim();
            (!provider_id.is_empty()).then(|| provider_id.to_owned())
        })
        .collect();
    settings.custom_provider_templates = settings
        .custom_provider_templates
        .into_iter()
        .filter(|template| {
            !template.id.trim().is_empty()
                && !template.name.trim().is_empty()
                && !template.base_url.trim().is_empty()
                && template.editable
        })
        .collect();
    settings
}

fn fixed_data_key(data_key: &[u8]) -> std::result::Result<[u8; 32], ErrorPayload> {
    data_key.try_into().map_err(|_| {
        ErrorPayload::from(KeySyncError::Vault(
            "system keychain data key must be 32 bytes".into(),
        ))
    })
}
