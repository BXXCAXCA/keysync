use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use crate::errors::{KeySyncError, Result};

const DATA_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const SALT_LEN: usize = 16;
const KDF_MEMORY_KIB: u32 = 19 * 1024;
const KDF_ITERATIONS: u32 = 2;
const KDF_PARALLELISM: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEnvelope {
    pub version: u32,
    pub algorithm: String,
    pub nonce: String,
    pub ciphertext: String,
    pub kdf: Option<KdfEnvelope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfEnvelope {
    pub algorithm: String,
    pub salt: String,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

pub fn generate_data_key() -> [u8; DATA_KEY_LEN] {
    let mut key = [0_u8; DATA_KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}

pub fn seal_with_data_key(data_key: &[u8; DATA_KEY_LEN], plaintext: &[u8]) -> Result<VaultEnvelope> {
    let mut nonce = [0_u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let cipher = XChaCha20Poly1305::new_from_slice(data_key)
        .map_err(|_| KeySyncError::Vault("invalid data key length".into()))?;
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext)
        .map_err(|_| KeySyncError::Vault("failed to encrypt vault payload".into()))?;

    Ok(VaultEnvelope {
        version: 1,
        algorithm: "XChaCha20-Poly1305".into(),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
        kdf: None,
    })
}

pub fn open_with_data_key(data_key: &[u8; DATA_KEY_LEN], envelope: &VaultEnvelope) -> Result<Vec<u8>> {
    ensure_algorithm(envelope)?;
    let nonce = decode_fixed::<NONCE_LEN>(&envelope.nonce, "nonce")?;
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|err| KeySyncError::Vault(format!("invalid ciphertext encoding: {err}")))?;
    let cipher = XChaCha20Poly1305::new_from_slice(data_key)
        .map_err(|_| KeySyncError::Vault("invalid data key length".into()))?;
    cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| KeySyncError::Vault("failed to decrypt vault payload".into()))
}

pub fn seal_with_master_password(master_password: &str, plaintext: &[u8]) -> Result<VaultEnvelope> {
    let mut salt = [0_u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let mut data_key = derive_key(master_password, &salt, KDF_MEMORY_KIB, KDF_ITERATIONS, KDF_PARALLELISM)?;
    let mut envelope = seal_with_data_key(&data_key, plaintext)?;
    data_key.zeroize();
    envelope.kdf = Some(KdfEnvelope {
        algorithm: "Argon2id".into(),
        salt: STANDARD.encode(salt),
        memory_kib: KDF_MEMORY_KIB,
        iterations: KDF_ITERATIONS,
        parallelism: KDF_PARALLELISM,
    });
    Ok(envelope)
}

pub fn open_with_master_password(master_password: &str, envelope: &VaultEnvelope) -> Result<Vec<u8>> {
    let kdf = envelope
        .kdf
        .as_ref()
        .ok_or_else(|| KeySyncError::Vault("vault envelope does not include KDF parameters".into()))?;
    if kdf.algorithm != "Argon2id" {
        return Err(KeySyncError::Vault(format!("unsupported KDF: {}", kdf.algorithm)));
    }

    let salt = decode_fixed::<SALT_LEN>(&kdf.salt, "salt")?;
    let mut data_key = derive_key(master_password, &salt, kdf.memory_kib, kdf.iterations, kdf.parallelism)?;
    let result = open_with_data_key(&data_key, envelope);
    data_key.zeroize();
    result
}

pub fn envelope_to_string(envelope: &VaultEnvelope) -> Result<String> {
    serde_json::to_string(envelope).map_err(|err| KeySyncError::Vault(format!("failed to serialize vault envelope: {err}")))
}

pub fn envelope_from_string(serialized: &str) -> Result<VaultEnvelope> {
    serde_json::from_str(serialized).map_err(|err| KeySyncError::Vault(format!("failed to parse vault envelope: {err}")))
}

fn derive_key(master_password: &str, salt: &[u8; SALT_LEN], memory_kib: u32, iterations: u32, parallelism: u32) -> Result<[u8; DATA_KEY_LEN]> {
    let params = Params::new(memory_kib, iterations, parallelism, Some(DATA_KEY_LEN))
        .map_err(|err| KeySyncError::Vault(format!("invalid Argon2id parameters: {err}")))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut output = [0_u8; DATA_KEY_LEN];
    argon2
        .hash_password_into(master_password.as_bytes(), salt, &mut output)
        .map_err(|err| KeySyncError::Vault(format!("failed to derive master key: {err}")))?;
    Ok(output)
}

fn ensure_algorithm(envelope: &VaultEnvelope) -> Result<()> {
    if envelope.version != 1 {
        return Err(KeySyncError::Vault(format!("unsupported vault envelope version: {}", envelope.version)));
    }
    if envelope.algorithm != "XChaCha20-Poly1305" {
        return Err(KeySyncError::Vault(format!("unsupported vault algorithm: {}", envelope.algorithm)));
    }
    Ok(())
}

fn decode_fixed<const N: usize>(input: &str, label: &str) -> Result<[u8; N]> {
    let decoded = STANDARD
        .decode(input)
        .map_err(|err| KeySyncError::Vault(format!("invalid {label} encoding: {err}")))?;
    decoded
        .try_into()
        .map_err(|_| KeySyncError::Vault(format!("invalid {label} length")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn master_password_roundtrip() {
        let envelope = seal_with_master_password("correct horse battery staple", b"secret-api-key").unwrap();
        let plaintext = open_with_master_password("correct horse battery staple", &envelope).unwrap();
        assert_eq!(plaintext, b"secret-api-key");
    }

    #[test]
    fn wrong_password_fails() {
        let envelope = seal_with_master_password("right", b"secret-api-key").unwrap();
        assert!(open_with_master_password("wrong", &envelope).is_err());
    }
}
