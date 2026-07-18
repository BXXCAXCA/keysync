use std::path::PathBuf;

use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;

use crate::errors::{ErrorPayload, KeySyncError};
use crate::providers::ModelInfo;
use crate::storage::StorageService;

const LOCAL_DB_FILE: &str = "keysync.local.sqlite3";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModelPreferencesInput {
    pub provider_id: String,
    pub model_id: String,
    pub is_favorite: bool,
    pub is_hidden: bool,
    pub alias: Option<String>,
    pub default_params: Option<Value>,
}

#[tauri::command]
pub fn save_model_cache(
    app: tauri::AppHandle,
    provider_id: String,
    models: Vec<ModelInfo>,
) -> std::result::Result<Vec<ModelInfo>, ErrorPayload> {
    if provider_id.trim().is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Storage(
            "provider id is required for model cache".into(),
        )));
    }

    let mut storage = open_storage(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = storage
        .connection_mut()
        .transaction()
        .map_err(storage_error)?;

    for model in models {
        if model.id.trim().is_empty() {
            continue;
        }
        let capabilities_json =
            serde_json::to_string(&model.capabilities).map_err(serialization_error)?;
        let model_key = model_cache_key(&provider_id, &model.id);
        transaction
            .execute(
                "INSERT INTO model_cache (id, provider_id, model_id, display_name, capabilities_json, context_window, is_favorite, is_hidden, alias, default_params_json, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, NULL, NULL, ?7) \
                 ON CONFLICT(id) DO UPDATE SET \
                    display_name = excluded.display_name, \
                    capabilities_json = excluded.capabilities_json, \
                    context_window = excluded.context_window, \
                    updated_at = excluded.updated_at",
                params![
                    model_key,
                    provider_id.trim(),
                    model.id,
                    model.display_name,
                    capabilities_json,
                    model.context_window.map(|value| value as i64),
                    now,
                ],
            )
            .map_err(storage_error)?;
    }

    transaction.commit().map_err(storage_error)?;
    list_cached_models_for_provider(&storage, provider_id.trim())
}

#[tauri::command]
pub fn list_cached_models(
    app: tauri::AppHandle,
    provider_id: String,
) -> std::result::Result<Vec<ModelInfo>, ErrorPayload> {
    let storage = open_storage(&app)?;
    list_cached_models_for_provider(&storage, provider_id.trim())
}

#[tauri::command]
pub fn update_model_preferences(
    app: tauri::AppHandle,
    input: UpdateModelPreferencesInput,
) -> std::result::Result<ModelInfo, ErrorPayload> {
    if input.provider_id.trim().is_empty() || input.model_id.trim().is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Storage(
            "provider id and model id are required for model preferences".into(),
        )));
    }

    let storage = open_storage(&app)?;
    let alias = input.alias.filter(|value| !value.trim().is_empty());
    let default_params_json = input
        .default_params
        .map(|value| serde_json::to_string(&value).map_err(serialization_error))
        .transpose()?;
    let changed = storage
        .connection()
        .execute(
            "UPDATE model_cache \
             SET is_favorite = ?1, is_hidden = ?2, alias = ?3, default_params_json = ?4, updated_at = ?5 \
             WHERE provider_id = ?6 AND model_id = ?7",
            params![
                if input.is_favorite { 1_i64 } else { 0_i64 },
                if input.is_hidden { 1_i64 } else { 0_i64 },
                alias,
                default_params_json,
                chrono::Utc::now().to_rfc3339(),
                input.provider_id.trim(),
                input.model_id.trim(),
            ],
        )
        .map_err(storage_error)?;

    if changed == 0 {
        return Err(ErrorPayload::from(KeySyncError::Storage(
            "model must be loaded before its preferences can be saved".into(),
        )));
    }

    load_cached_model(&storage, input.provider_id.trim(), input.model_id.trim())
}

fn list_cached_models_for_provider(
    storage: &StorageService,
    provider_id: &str,
) -> std::result::Result<Vec<ModelInfo>, ErrorPayload> {
    let mut statement = storage
        .connection()
        .prepare(
            "SELECT model_id, display_name, capabilities_json, context_window, is_favorite, is_hidden, alias, default_params_json \
             FROM model_cache WHERE provider_id = ?1 \
             ORDER BY is_favorite DESC, is_hidden ASC, display_name COLLATE NOCASE ASC",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![provider_id], |row| map_model_row(row, provider_id))
        .map_err(storage_error)?;

    let mut models = Vec::new();
    for row in rows {
        models.push(row.map_err(storage_error)?);
    }
    Ok(models)
}

fn load_cached_model(
    storage: &StorageService,
    provider_id: &str,
    model_id: &str,
) -> std::result::Result<ModelInfo, ErrorPayload> {
    storage
        .connection()
        .query_row(
            "SELECT model_id, display_name, capabilities_json, context_window, is_favorite, is_hidden, alias, default_params_json \
             FROM model_cache WHERE provider_id = ?1 AND model_id = ?2",
            params![provider_id, model_id],
            |row| map_model_row(row, provider_id),
        )
        .optional()
        .map_err(storage_error)?
        .ok_or_else(|| ErrorPayload::from(KeySyncError::Storage("model not found after preference update".into())))
}

fn map_model_row(row: &rusqlite::Row<'_>, provider_id: &str) -> rusqlite::Result<ModelInfo> {
    let capabilities_json: String = row.get(2)?;
    let default_params_json: Option<String> = row.get(7)?;
    Ok(ModelInfo {
        id: row.get(0)?,
        display_name: row.get(1)?,
        provider_id: provider_id.to_owned(),
        capabilities: serde_json::from_str(&capabilities_json).unwrap_or_default(),
        context_window: row
            .get::<_, Option<i64>>(3)?
            .map(|value| value.max(0) as u64),
        is_favorite: row.get::<_, i64>(4)? != 0,
        is_hidden: row.get::<_, i64>(5)? != 0,
        alias: row.get(6)?,
        default_params: default_params_json.and_then(|value| serde_json::from_str(&value).ok()),
    })
}

fn model_cache_key(provider_id: &str, model_id: &str) -> String {
    format!("{provider_id}:{model_id}")
}

fn open_storage(app: &tauri::AppHandle) -> std::result::Result<StorageService, ErrorPayload> {
    let path = local_db_path(app)?;
    StorageService::open(&path).map_err(ErrorPayload::from)
}

fn local_db_path(app: &tauri::AppHandle) -> std::result::Result<PathBuf, ErrorPayload> {
    let dir = app.path().app_data_dir().map_err(|err| {
        ErrorPayload::from(KeySyncError::Storage(format!(
            "failed to resolve app data directory: {err}"
        )))
    })?;
    Ok(dir.join(LOCAL_DB_FILE))
}

fn serialization_error(error: serde_json::Error) -> ErrorPayload {
    ErrorPayload::from(KeySyncError::Storage(format!(
        "serialize model cache data: {error}"
    )))
}

fn storage_error(error: rusqlite::Error) -> ErrorPayload {
    ErrorPayload::from(KeySyncError::Storage(error.to_string()))
}
