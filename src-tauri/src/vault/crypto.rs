use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::errors::{KeySyncError, Result};

/// Placeholder encoding so the project skeleton can be wired end-to-end.
/// Replace this with XChaCha20-Poly1305/AES-GCM backed by a DEK stored in
/// system keychain or unlocked through an Argon2id-derived master password.
pub fn seal_placeholder(plaintext: &[u8]) -> Result<String> {
    Ok(format!("ks1.placeholder.{}", STANDARD.encode(plaintext)))
}

pub fn open_placeholder(ciphertext: &str) -> Result<Vec<u8>> {
    let encoded = ciphertext
        .strip_prefix("ks1.placeholder.")
        .ok_or_else(|| KeySyncError::Vault("unsupported vault ciphertext envelope".into()))?;

    STANDARD.decode(encoded).map_err(|err| KeySyncError::Vault(format!("failed to decode placeholder ciphertext: {err}")))
}
