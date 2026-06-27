use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct VaultSecurityProfile {
    pub default_mode: &'static str,
    pub optional_mode: &'static str,
    pub plaintext_reveal_policy: &'static str,
    pub sync_file_policy: &'static str,
}

#[tauri::command]
pub fn vault_security_profile() -> VaultSecurityProfile {
    VaultSecurityProfile {
        default_mode: "system_keychain",
        optional_mode: "master_password",
        plaintext_reveal_policy: "requires_system_verification_or_master_password",
        sync_file_policy: "encrypted_json_only",
    }
}
