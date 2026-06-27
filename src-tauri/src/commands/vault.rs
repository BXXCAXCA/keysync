use serde::Serialize;

use crate::errors::{ErrorPayload, KeySyncError};
use crate::vault::VaultService;

#[derive(Debug, Serialize)]
pub struct VaultSecurityProfile {
    pub default_mode: &'static str,
    pub optional_mode: &'static str,
    pub plaintext_reveal_policy: &'static str,
    pub sync_file_policy: &'static str,
    pub envelope_algorithm: &'static str,
    pub kdf_algorithm: &'static str,
    pub system_keychain_status: &'static str,
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
