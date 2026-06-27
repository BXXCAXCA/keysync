use crate::errors::{KeySyncError, Result};

pub const KEYCHAIN_SERVICE: &str = "app.keysync.ai";
pub const DATA_KEY_ACCOUNT: &str = "vault-data-key";

pub trait KeychainBackend: Send + Sync {
    fn set_secret(&self, service: &str, account: &str, secret: &[u8]) -> Result<()>;
    fn get_secret(&self, service: &str, account: &str) -> Result<Vec<u8>>;
    fn delete_secret(&self, service: &str, account: &str) -> Result<()>;
}

/// Placeholder backend used until the OS-specific keychain crate is wired.
/// The crypto envelope is already real; this layer only owns the persistence
/// mechanism for the generated data encryption key.
pub struct UnsupportedKeychainBackend;

impl KeychainBackend for UnsupportedKeychainBackend {
    fn set_secret(&self, _service: &str, _account: &str, _secret: &[u8]) -> Result<()> {
        Err(KeySyncError::Vault("system keychain backend is not wired yet".into()))
    }

    fn get_secret(&self, _service: &str, _account: &str) -> Result<Vec<u8>> {
        Err(KeySyncError::Vault("system keychain backend is not wired yet".into()))
    }

    fn delete_secret(&self, _service: &str, _account: &str) -> Result<()> {
        Err(KeySyncError::Vault("system keychain backend is not wired yet".into()))
    }
}
