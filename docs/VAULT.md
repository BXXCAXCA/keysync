# Vault design

## Status

The vault now has real authenticated encryption for master-password mode and an OS keychain backend for storing a local data key.

Implemented:

- XChaCha20-Poly1305 authenticated encryption.
- Argon2id key derivation for master-password mode.
- Random salt per envelope.
- Random nonce per encryption.
- JSON envelope serialization for encrypted sync files.
- Tauri commands for master-password encryption/decryption plumbing.
- Local encrypted key record persistence in the app data vault file.
- System keychain backend using the Rust `keyring` crate.
- System keychain commands to check status, initialize a local data key, and delete it.
- UI status card for system keychain availability and data-key initialization.

Pending:

- Migrating saved key records from master-password envelopes to system-keychain data-key envelopes.
- SQLite-backed vault metadata and history storage.
- Plaintext reveal confirmation and clipboard protection.
- Optional OS-level user verification before reveal where supported.

## Envelope format

```json
{
  "version": 1,
  "algorithm": "XChaCha20-Poly1305",
  "nonce": "base64",
  "ciphertext": "base64",
  "kdf": {
    "algorithm": "Argon2id",
    "salt": "base64",
    "memoryKib": 19456,
    "iterations": 2,
    "parallelism": 1
  }
}
```

## Modes

### System keychain mode

Target default mode. A random local data encryption key is generated and stored in the OS keychain via the `keyring` crate. The current commands can initialize, detect, and delete the data key under:

```text
service: app.keysync.ai
account: vault-data-key
```

The next step is to use this data key to encrypt new local vault records by default. Existing saved records still use master-password envelopes until migration support is added.

### Master password mode

Optional mode. The app derives a data encryption key from the user's master password using Argon2id, then encrypts vault payloads with XChaCha20-Poly1305. The master password is not stored.

## Security notes

- Provider credentials must not be logged.
- Error messages should be redacted before display.
- Sync files must contain only encrypted envelopes.
- Plaintext reveal must require system verification or master password unlock.
- Future clipboard copy should auto-clear after a short timeout.
