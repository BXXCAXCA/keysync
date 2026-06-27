use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfig {
    pub endpoint: String,
    pub username: String,
    pub password_secret_id: String,
    pub remote_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncConflictPolicy {
    AutoMergeAndKeepConflictCopies,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEnvelope<T> {
    pub version: u32,
    pub device_id: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub payload: T,
}

pub struct WebDavSyncService;

impl WebDavSyncService {
    pub fn new() -> Self { Self }
    pub fn remote_paths() -> Vec<&'static str> {
        vec!["/KeySyncAI/vault.sync.json.enc", "/KeySyncAI/settings.sync.json.enc", "/KeySyncAI/history.sync.json.enc"]
    }
}
