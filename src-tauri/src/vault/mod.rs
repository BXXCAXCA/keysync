pub mod crypto;
pub mod keychain;
pub mod store;

use std::path::Path;

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
pub struct SecretRecordSummary {
    pub id: Uuid,
    pub provider_id: String,
    pub display_name: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<&SecretRecord> for SecretRecordSummary {
    fn from(value: &SecretRecord) -> Self {
        Self {
            id: value.id,
            provider_id: value.provider_id.clone(),
            display_name: value.display_name.clone(),
            updated_at: value.updated_at,
        }
    }
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

    pub fn load_file(&self, path: &Path, device_id: String) -> Result<VaultFile> {
        store::load_or_empty(path, device_id)
    }

    pub fn save_file(&self, path: &Path, vault_file: &VaultFile) -> Result<()> {
        store::save(path, vault_file)
    }

    pub fn create_secret_record_with_master_password(&self, provider_id: String, display_name: String, payload: SecretPayload, master_password: &str) -> Result<SecretRecord> {
        store::create_record(provider_id, display_name, payload, master_password)
    }

    pub fn decrypt_secret_record_with_master_password(&self, record: &SecretRecord, master_password: &str) -> Result<SecretPayload> {
        store::decrypt_record(record, master_password)
    }

    pub fn create_secret_record_with_data_key(&self, provider_id: String, display_name: String, payload: SecretPayload, data_key: &[u8]) -> Result<SecretRecord> {
        store::create_record_with_data_key(provider_id, display_name, payload, data_key)
    }

    pub fn decrypt_secret_record_with_data_key(&self, record: &SecretRecord, data_key: &[u8]) -> Result<SecretPayload> {
        store::decrypt_record_with_data_key(record, data_key)
    }
}
