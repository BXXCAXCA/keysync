use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;

use crate::errors::{KeySyncError, Result};

pub const KEYCHAIN_SERVICE: &str = "app.keysync.ai";
pub const DATA_KEY_ACCOUNT: &str = "vault-data-key";

pub trait KeychainBackend: Send + Sync {
    fn set_secret(&self, service: &str, account: &str, secret: &[u8]) -> Result<()>;
    fn get_secret(&self, service: &str, account: &str) -> Result<Vec<u8>>;
    fn delete_secret(&self, service: &str, account: &str) -> Result<()>;
}

pub struct SystemKeychainBackend;

impl KeychainBackend for SystemKeychainBackend {
    fn set_secret(&self, service: &str, account: &str, secret: &[u8]) -> Result<()> {
        let entry = keyring::Entry::new(service, account)
            .map_err(|err| KeySyncError::Vault(format!("failed to open system keychain entry: {err}")))?;
        let encoded = STANDARD.encode(secret);
        entry
            .set_password(&encoded)
            .map_err(|err| KeySyncError::Vault(format!("failed to save secret to system keychain: {err}")))
    }

    fn get_secret(&self, service: &str, account: &str) -> Result<Vec<u8>> {
        let entry = keyring::Entry::new(service, account)
            .map_err(|err| KeySyncError::Vault(format!("failed to open system keychain entry: {err}")))?;
        let encoded = entry
            .get_password()
            .map_err(|err| KeySyncError::Vault(format!("failed to read secret from system keychain: {err}")))?;
        STANDARD
            .decode(encoded)
            .map_err(|err| KeySyncError::Vault(format!("failed to decode system keychain secret: {err}")))
    }

    fn delete_secret(&self, service: &str, account: &str) -> Result<()> {
        let entry = keyring::Entry::new(service, account)
            .map_err(|err| KeySyncError::Vault(format!("failed to open system keychain entry: {err}")))?;
        entry
            .delete_credential()
            .map_err(|err| KeySyncError::Vault(format!("failed to delete secret from system keychain: {err}")))
    }
}

pub fn system_backend() -> SystemKeychainBackend {
    SystemKeychainBackend
}

pub fn save_data_key(secret: &[u8]) -> Result<()> {
    system_backend().set_secret(KEYCHAIN_SERVICE, DATA_KEY_ACCOUNT, secret)
}

pub fn load_data_key() -> Result<Vec<u8>> {
    system_backend().get_secret(KEYCHAIN_SERVICE, DATA_KEY_ACCOUNT)
}

pub fn delete_data_key() -> Result<()> {
    system_backend().delete_secret(KEYCHAIN_SERVICE, DATA_KEY_ACCOUNT)
}

pub fn load_or_create_data_key() -> Result<Vec<u8>> {
    match load_data_key() {
        Ok(secret) if secret.len() == 32 => Ok(secret),
        Ok(_) => Err(KeySyncError::Vault(
            "system keychain data key has invalid length".into(),
        )),
        Err(_) => {
            let mut data_key = vec![0_u8; 32];
            rand::thread_rng().fill_bytes(&mut data_key);
            save_data_key(&data_key)?;
            Ok(data_key)
        }
    }
}
