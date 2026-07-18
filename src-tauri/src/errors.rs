use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum KeySyncError {
    #[error("provider error: {0}")]
    Provider(String),
    #[error("vault error: {0}")]
    Vault(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("sync error: {0}")]
    Sync(String),
    #[error("network error: {0}")]
    Network(String),
}

#[derive(Debug, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
}

impl From<KeySyncError> for ErrorPayload {
    fn from(value: KeySyncError) -> Self {
        let code = match value {
            KeySyncError::Provider(_) => "provider_error",
            KeySyncError::Vault(_) => "vault_error",
            KeySyncError::Storage(_) => "storage_error",
            KeySyncError::Sync(_) => "sync_error",
            KeySyncError::Network(_) => "network_error",
        };
        Self {
            code,
            message: value.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, KeySyncError>;
