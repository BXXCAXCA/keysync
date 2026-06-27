use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;
use uuid::Uuid;

use crate::errors::{ErrorPayload, KeySyncError};
use crate::vault::{SecretPayload, SecretRecordSummary, VaultFile, VaultService};

const LOCAL_VAULT_FILE: &str = "vault.local.json";
const LOCAL_DEVICE_ID: &str = "local-device";

#[derive(Debug, Serialize)]
pub struct VaultSecurityProfile {
    pub default_mode: &'static str,
    pub optional_mode: &'static str,
    pub plaintext_reveal_policy: &'static str,
    pub sync_file_policy: &'static str,
    pub envelope_algorithm: &'static str,
    pub kdf_algorithm: &'static str,
    pub system_keychain_status: &'static str,
    pub local_vault_file: &'static str,
}

#[tauri::command]
pub fn vault_security_profile() -> VaultSecurityProfile {
    VaultSecurityProfile {
        default_mode: "system_keychain",
        optional_mode: "master_password",
        plaintext_reveal_policy: "requires_system_verification_or_master_password",
        sync_file_policy: "encrypted_json_only",
        envelope_algorithm: "XChaCha20-Poly1305",
        kdf_algorithm: "Argon2id",
        system_keychain_status: "interface_defined_backend_pending",
        local_vault_file: LOCAL_VAULT_FILE,
    }
}

#[tauri::command]
pub fn vault_encrypt_with_master_password(plaintext: String, master_password: String) -> std::result::Result<String, ErrorPayload> {
    VaultService::new()
        .encrypt_for_sync_with_master_password(&master_password, plaintext.as_bytes())
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn vault_decrypt_with_master_password(envelope: String, master_password: String) -> std::result::Result<String, ErrorPayload> {
    let plaintext = VaultService::new()
        .decrypt_from_sync_with_master_password(&master_password, &envelope)
        .map_err(ErrorPayload::from)?;

    String::from_utf8(plaintext)
        .map_err(|_| ErrorPayload::from(KeySyncError::Vault("decrypted payload is not valid UTF-8".into())))
}

#[tauri::command]
pub fn vault_list_secret_records(app: tauri::AppHandle) -> std::result::Result<Vec<SecretRecordSummary>, ErrorPayload> {
    let path = local_vault_path(&app)?;
    let vault_file = VaultService::new().load_file(&path, LOCAL_DEVICE_ID.to_owned()).map_err(ErrorPayload::from)?;
    Ok(vault_file.records.iter().map(SecretRecordSummary::from).collect())
}

#[tauri::command]
pub fn vault_list_conflict_records(app: tauri::AppHandle) -> std::result::Result<Vec<SecretRecordSummary>, ErrorPayload> {
    let path = local_vault_path(&app)?;
    let vault_file = VaultService::new().load_file(&path, LOCAL_DEVICE_ID.to_owned()).map_err(ErrorPayload::from)?;
    Ok(vault_file
        .records
        .iter()
        .filter(|record| record.display_name.contains("[conflict remote]"))
        .map(SecretRecordSummary::from)
        .collect())
}

#[tauri::command]
pub fn vault_save_secret_with_master_password(app: tauri::AppHandle, provider_id: String, display_name: String, payload: SecretPayload, master_password: String) -> std::result::Result<SecretRecordSummary, ErrorPayload> {
    let path = local_vault_path(&app)?;
    let service = VaultService::new();
    let mut vault_file = service.load_file(&path, LOCAL_DEVICE_ID.to_owned()).map_err(ErrorPayload::from)?;
    let record = service
        .create_secret_record_with_master_password(provider_id, display_name, payload, &master_password)
        .map_err(ErrorPayload::from)?;
    crate::vault::store::upsert_record(&mut vault_file, record.clone());
    service.save_file(&path, &vault_file).map_err(ErrorPayload::from)?;
    Ok(SecretRecordSummary::from(&record))
}

#[tauri::command]
pub fn vault_decrypt_secret_with_master_password(app: tauri::AppHandle, record_id: String, master_password: String) -> std::result::Result<SecretPayload, ErrorPayload> {
    let path = local_vault_path(&app)?;
    let service = VaultService::new();
    let vault_file = service.load_file(&path, LOCAL_DEVICE_ID.to_owned()).map_err(ErrorPayload::from)?;
    let record_uuid = parse_record_id(&record_id)?;
    let record = vault_file
        .records
        .iter()
        .find(|record| record.id == record_uuid)
        .ok_or_else(|| ErrorPayload::from(KeySyncError::Vault("secret record not found".into())))?;
    service.decrypt_secret_record_with_master_password(record, &master_password).map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn vault_delete_secret_record(app: tauri::AppHandle, record_id: String) -> std::result::Result<bool, ErrorPayload> {
    let path = local_vault_path(&app)?;
    let service = VaultService::new();
    let mut vault_file: VaultFile = service.load_file(&path, LOCAL_DEVICE_ID.to_owned()).map_err(ErrorPayload::from)?;
    let deleted = crate::vault::store::delete_record(&mut vault_file, parse_record_id(&record_id)?);
    service.save_file(&path, &vault_file).map_err(ErrorPayload::from)?;
    Ok(deleted)
}

#[tauri::command]
pub fn vault_rename_secret_record(app: tauri::AppHandle, record_id: String, display_name: String) -> std::result::Result<SecretRecordSummary, ErrorPayload> {
    if display_name.trim().is_empty() {
        return Err(ErrorPayload::from(KeySyncError::Vault("display name is required".into())));
    }

    let path = local_vault_path(&app)?;
    let service = VaultService::new();
    let mut vault_file: VaultFile = service.load_file(&path, LOCAL_DEVICE_ID.to_owned()).map_err(ErrorPayload::from)?;
    let record_uuid = parse_record_id(&record_id)?;
    let record = vault_file
        .records
        .iter_mut()
        .find(|record| record.id == record_uuid)
        .ok_or_else(|| ErrorPayload::from(KeySyncError::Vault("secret record not found".into())))?;
    record.display_name = display_name.trim().to_owned();
    record.updated_at = chrono::Utc::now();
    let summary = SecretRecordSummary::from(&*record);
    service.save_file(&path, &vault_file).map_err(ErrorPayload::from)?;
    Ok(summary)
}

fn local_vault_path(app: &tauri::AppHandle) -> std::result::Result<PathBuf, ErrorPayload> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| ErrorPayload::from(KeySyncError::Vault(format!("failed to resolve app data directory: {err}"))))?;
    Ok(dir.join(LOCAL_VAULT_FILE))
}

fn parse_record_id(record_id: &str) -> std::result::Result<Uuid, ErrorPayload> {
    Uuid::parse_str(record_id).map_err(|err| ErrorPayload::from(KeySyncError::Vault(format!("invalid secret record id: {err}"))))
}
