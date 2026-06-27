pub mod crypto;
pub mod keychain;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultMode {
    SystemKeychain,
    MasterPassword,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretPayload {
    pub api_key: String,
    pub organization_id: Option<String>,
    pub project_id: Option<String>,
    pub custom_headers: Vec<(String, String)>,
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

    pub fn encrypt_for_sync_with_master_password(&self, master_password: &str, plaintext: &[u8]) -> Result<String> {
        let envelope = crypto::seal_with_master_password(master_password, plaintext)?;
        crypto::envelope_to_string(&envelope)
    }

    pub fn decrypt_from_sync_with_master_password(&self, master_password: &str, ciphertext: &str) -> Result<Vec<u8>> {
        let envelope = crypto::envelope_from_string(ciphertext)?;
        crypto::open_with_master_password(master_password, &envelope)
    }
}
