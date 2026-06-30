use std::path::PathBuf;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;
use uuid::Uuid;

use crate::errors::{ErrorPayload, KeySyncError};
use crate::providers::ImageAttachment;
use crate::storage::StorageService;

const LOCAL_DB_FILE: &str = "keysync.local.sqlite3";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model_id: String,
    pub system_prompt: Option<String>,
    pub params: Value,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub attachments: Vec<ImageAttachment>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub summary: ConversationSummary,
    pub messages: Vec<StoredMessage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConversationInput {
    pub id: Option<String>,
    pub title: String,
    pub provider_id: String,
    pub model_id: String,
    pub system_prompt: Option<String>,
    pub params: Value,
    pub messages: Vec<SaveMessageInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMessageInput {
    pub id: Option<String>,
    pub role: String,
    pub content: String,
    pub attachments: Vec<ImageAttachment>,
}

#[tauri::command]
pub fn list_conversations(app: tauri::AppHandle) -> std::result::Result<Vec<ConversationSummary>, ErrorPayload> {
    let service = open_storage(&app)?;
    let mut statement = service
        .connection()
        .prepare(
            "SELECT c.id, c.title, c.provider_id, c.model_id, c.system_prompt, c.params_json, c.created_at, c.updated_at, \
                    COALESCE((SELECT COUNT(1) FROM messages m WHERE m.conversation_id = c.id), 0) AS message_count \
             FROM conversations c ORDER BY c.updated_at DESC",
        )
        .map_err(storage_error)?;

    let rows = statement
        .query_map([], map_summary_row)
        .map_err(storage_error)?;

    let mut conversations = Vec::new();
    for row in rows {
        conversations.push(row.map_err(storage_error)?);
    }
    Ok(conversations)
}

#[tauri::command]
pub fn load_conversation(app: tauri::AppHandle, conversation_id: String) -> std::result::Result<ConversationDetail, ErrorPayload> {
    let service = open_storage(&app)?;
    load_conversation_detail(&service, &conversation_id)
}

#[tauri::command]
pub fn save_conversation(app: tauri::AppHandle, input: SaveConversationInput) -> std::result::Result<ConversationDetail, ErrorPayload> {
    if input.provider_id.trim().is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Storage("provider id is required".into())));
    }
    if input.model_id.trim().is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Storage("model id is required".into())));
    }

    let service = open_storage(&app)?;
    let conversation_id = match input.id.as_deref().filter(|value| !value.trim().is_empty()) {
        Some(value) => {
            Uuid::parse_str(value)
                .map_err(|err| ErrorPayload::from(KeySyncError::Storage(format!("invalid conversation id: {err}"))))?
                .to_string()
        }
        None => Uuid::new_v4().to_string(),
    };
    let now = chrono::Utc::now().to_rfc3339();
    let title = input
        .title
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    let title = if title.is_empty() { "Untitled conversation".to_owned() } else { title };
    let params_json = serde_json::to_string(&input.params)
        .map_err(|err| ErrorPayload::from(KeySyncError::Storage(format!("serialize conversation params: {err}"))))?;

    service
        .connection()
        .execute(
            "INSERT INTO conversations (id, title, provider_id, model_id, system_prompt, params_json, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
             ON CONFLICT(id) DO UPDATE SET \
                title = excluded.title, \
                provider_id = excluded.provider_id, \
                model_id = excluded.model_id, \
                system_prompt = excluded.system_prompt, \
                params_json = excluded.params_json, \
                updated_at = excluded.updated_at",
            params![
                conversation_id,
                title,
                input.provider_id.trim(),
                input.model_id.trim(),
                input.system_prompt.as_deref(),
                params_json,
                now,
                now,
            ],
        )
        .map_err(storage_error)?;

    service
        .connection()
        .execute("DELETE FROM messages WHERE conversation_id = ?1", params![conversation_id])
        .map_err(storage_error)?;

    for message in input.messages {
        if message.role.trim().is_empty() || (message.content.trim().is_empty() && message.attachments.is_empty()) {
            continue;
        }
        let message_id = match message.id.as_deref().filter(|value| !value.trim().is_empty()) {
            Some(value) => Uuid::parse_str(value)
                .map_err(|err| ErrorPayload::from(KeySyncError::Storage(format!("invalid message id: {err}"))))?
                .to_string(),
            None => Uuid::new_v4().to_string(),
        };
        let attachments_json = serde_json::to_string(&message.attachments)
            .map_err(|err| ErrorPayload::from(KeySyncError::Storage(format!("serialize message attachments: {err}"))))?;
        service
            .connection()
            .execute(
                "INSERT INTO messages (id, conversation_id, role, content, attachments_json, token_usage_json, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
                params![message_id, conversation_id, message.role.trim(), message.content, attachments_json, now],
            )
            .map_err(storage_error)?;
    }

    load_conversation_detail(&service, &conversation_id)
}

#[tauri::command]
pub fn delete_conversation(app: tauri::AppHandle, conversation_id: String) -> std::result::Result<bool, ErrorPayload> {
    let service = open_storage(&app)?;
    parse_uuid(&conversation_id, "conversation")?;
    service
        .connection()
        .execute("DELETE FROM messages WHERE conversation_id = ?1", params![conversation_id])
        .map_err(storage_error)?;
    let deleted = service
        .connection()
        .execute("DELETE FROM conversations WHERE id = ?1", params![conversation_id])
        .map_err(storage_error)?;
    Ok(deleted > 0)
}

fn load_conversation_detail(service: &StorageService, conversation_id: &str) -> std::result::Result<ConversationDetail, ErrorPayload> {
    parse_uuid(conversation_id, "conversation")?;
    let summary = service
        .connection()
        .query_row(
            "SELECT c.id, c.title, c.provider_id, c.model_id, c.system_prompt, c.params_json, c.created_at, c.updated_at, \
                    COALESCE((SELECT COUNT(1) FROM messages m WHERE m.conversation_id = c.id), 0) AS message_count \
             FROM conversations c WHERE c.id = ?1",
            params![conversation_id],
            map_summary_row,
        )
        .optional()
        .map_err(storage_error)?
        .ok_or_else(|| ErrorPayload::from(KeySyncError::Storage("conversation not found".into())))?;

    let mut statement = service
        .connection()
        .prepare(
            "SELECT id, conversation_id, role, content, attachments_json, created_at \
             FROM messages WHERE conversation_id = ?1 ORDER BY rowid ASC",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![conversation_id], |row| {
            let attachments_json: String = row.get(4)?;
            let attachments = serde_json::from_str(&attachments_json).unwrap_or_default();
            Ok(StoredMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                attachments,
                created_at: row.get(5)?,
            })
        })
        .map_err(storage_error)?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(storage_error)?);
    }

    Ok(ConversationDetail { summary, messages })
}

fn map_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationSummary> {
    let params_json: String = row.get(5)?;
    let params = serde_json::from_str(&params_json).unwrap_or_else(|_| Value::Object(Default::default()));
    let message_count: i64 = row.get(8)?;
    Ok(ConversationSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        provider_id: row.get(2)?,
        model_id: row.get(3)?,
        system_prompt: row.get(4)?,
        params,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        message_count: message_count.max(0) as u32,
    })
}

fn open_storage(app: &tauri::AppHandle) -> std::result::Result<StorageService, ErrorPayload> {
    StorageService::open(&local_db_path(app)?).map_err(ErrorPayload::from)
}

fn local_db_path(app: &tauri::AppHandle) -> std::result::Result<PathBuf, ErrorPayload> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| ErrorPayload::from(KeySyncError::Storage(format!("failed to resolve app data directory: {err}"))))?;
    Ok(dir.join(LOCAL_DB_FILE))
}

fn parse_uuid(value: &str, label: &str) -> std::result::Result<Uuid, ErrorPayload> {
    Uuid::parse_str(value).map_err(|err| ErrorPayload::from(KeySyncError::Storage(format!("invalid {label} id: {err}"))))
}

fn storage_error(err: rusqlite::Error) -> ErrorPayload {
    ErrorPayload::from(KeySyncError::Storage(err.to_string()))
}
