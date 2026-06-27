use std::fs;
use std::path::Path;

use uuid::Uuid;

use crate::errors::{KeySyncError, Result};
use crate::vault::{SecretPayload, SecretRecord, VaultFile};

use super::crypto;

#[derive(Debug, Clone, Default)]
pub struct VaultMergeReport {
    pub added: usize,
    pub unchanged: usize,
    pub conflicts: usize,
}

impl VaultFile {
    pub fn empty(device_id: String) -> Self {
        Self { version: 1, device_id, records: Vec::new() }
    }
}

pub fn load_or_empty(path: &Path, device_id: String) -> Result<VaultFile> {
    if !path.exists() {
        return Ok(VaultFile::empty(device_id));
    }

    let content = fs::read_to_string(path).map_err(|err| KeySyncError::Vault(format!("failed to read vault file: {err}")))?;
    if content.trim().is_empty() {
        return Ok(VaultFile::empty(device_id));
    }

    parse_vault_file(&content)
}

pub fn parse_vault_file(content: &str) -> Result<VaultFile> {
    serde_json::from_str(content).map_err(|err| KeySyncError::Vault(format!("failed to parse vault file: {err}")))
}

pub fn save(path: &Path, vault_file: &VaultFile) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| KeySyncError::Vault(format!("failed to create vault directory: {err}")))?;
    }

    let content = serialize_vault_file(vault_file)?;
    fs::write(path, content).map_err(|err| KeySyncError::Vault(format!("failed to write vault file: {err}")))
}

pub fn serialize_vault_file(vault_file: &VaultFile) -> Result<String> {
    serde_json::to_string_pretty(vault_file).map_err(|err| KeySyncError::Vault(format!("failed to serialize vault file: {err}")))
}

pub fn create_record(provider_id: String, display_name: String, payload: SecretPayload, master_password: &str) -> Result<SecretRecord> {
    if provider_id.trim().is_empty() {
        return Err(KeySyncError::Vault("provider id is required".into()));
    }
    if display_name.trim().is_empty() {
        return Err(KeySyncError::Vault("display name is required".into()));
    }
    if payload.api_key.trim().is_empty() {
        return Err(KeySyncError::Vault("API key is required".into()));
    }
    if master_password.is_empty() {
        return Err(KeySyncError::Vault("master password is required".into()));
    }

    let plaintext = serde_json::to_vec(&payload).map_err(|err| KeySyncError::Vault(format!("failed to serialize secret payload: {err}")))?;
    let envelope = crypto::seal_with_master_password(master_password, &plaintext)?;
    let encrypted_payload = crypto::envelope_to_string(&envelope)?;

    Ok(SecretRecord {
        id: Uuid::new_v4(),
        provider_id,
        display_name,
        encrypted_payload,
        updated_at: chrono::Utc::now(),
    })
}

pub fn decrypt_record(record: &SecretRecord, master_password: &str) -> Result<SecretPayload> {
    if master_password.is_empty() {
        return Err(KeySyncError::Vault("master password is required".into()));
    }

    let envelope = crypto::envelope_from_string(&record.encrypted_payload)?;
    let plaintext = crypto::open_with_master_password(master_password, &envelope)?;
    serde_json::from_slice(&plaintext).map_err(|err| KeySyncError::Vault(format!("failed to parse decrypted secret payload: {err}")))
}

pub fn upsert_record(vault_file: &mut VaultFile, record: SecretRecord) {
    if let Some(existing) = vault_file.records.iter_mut().find(|item| item.id == record.id) {
        *existing = record;
    } else {
        vault_file.records.push(record);
    }
}

pub fn delete_record(vault_file: &mut VaultFile, record_id: Uuid) -> bool {
    let original_len = vault_file.records.len();
    vault_file.records.retain(|record| record.id != record_id);
    vault_file.records.len() != original_len
}

pub fn merge_remote_records(local: &mut VaultFile, remote: VaultFile) -> VaultMergeReport {
    let mut report = VaultMergeReport::default();

    for remote_record in remote.records {
        match local.records.iter().position(|record| record.id == remote_record.id) {
            None => {
                local.records.push(remote_record);
                report.added += 1;
            }
            Some(index) => {
                let local_record = &local.records[index];
                if local_record.provider_id == remote_record.provider_id
                    && local_record.display_name == remote_record.display_name
                    && local_record.encrypted_payload == remote_record.encrypted_payload
                {
                    report.unchanged += 1;
                } else {
                    let mut conflict_record = remote_record;
                    conflict_record.id = Uuid::new_v4();
                    conflict_record.display_name = format!("{} [conflict remote]", conflict_record.display_name);
                    conflict_record.updated_at = chrono::Utc::now();
                    local.records.push(conflict_record);
                    report.conflicts += 1;
                }
            }
        }
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: Uuid, payload: &str) -> SecretRecord {
        SecretRecord {
            id,
            provider_id: "openai".into(),
            display_name: "key".into(),
            encrypted_payload: payload.into(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn merge_adds_new_records() {
        let id = Uuid::new_v4();
        let mut local = VaultFile { version: 1, device_id: "local".into(), records: Vec::new() };
        let remote = VaultFile { version: 1, device_id: "remote".into(), records: vec![record(id, "a")] };
        let report = merge_remote_records(&mut local, remote);
        assert_eq!(report.added, 1);
        assert_eq!(local.records.len(), 1);
    }

    #[test]
    fn merge_keeps_conflicting_remote_copy() {
        let id = Uuid::new_v4();
        let mut local = VaultFile { version: 1, device_id: "local".into(), records: vec![record(id, "local")] };
        let remote = VaultFile { version: 1, device_id: "remote".into(), records: vec![record(id, "remote")] };
        let report = merge_remote_records(&mut local, remote);
        assert_eq!(report.conflicts, 1);
        assert_eq!(local.records.len(), 2);
        assert!(local.records.iter().any(|item| item.display_name.ends_with("[conflict remote]")));
    }
}
