pub mod crypto;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultMode {
    SystemKeychain,
    MasterPassword,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRecord {
    pub id: Uuid,
    pub provider_id: String,
    pub display_name: String,
    pub encrypted_payload: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    pub version: u32,
    pub device_id: String,
    pub records: Vec<SecretRecord>,
}

pub struct VaultService;

impl VaultService {
    pub fn new() -> Self { Self }
    pub fn encrypt_for_sync(&self, plaintext: &[u8]) -> crate::errors::Result<String> { crypto::seal_placeholder(plaintext) }
    pub fn decrypt_from_sync(&self, ciphertext: &str) -> crate::errors::Result<Vec<u8>> { crypto::open_placeholder(ciphertext) }
}
