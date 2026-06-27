# Vault design

## Status

The vault now has real authenticated encryption for master-password mode and system-keychain mode.

Implemented:

- XChaCha20-Poly1305 authenticated encryption.
- Argon2id key derivation for master-password mode.
- Random salt per master-password envelope.
- Random nonce per encryption.
- JSON envelope serialization for encrypted sync files.
- Tauri commands for master-password encryption/decryption plumbing.
- Local encrypted key record persistence in the app data vault file.
- System keychain backend using the Rust `keyring` crate.
- System keychain commands to check status, initialize a local data key, and delete it.
- New local vault records encrypted with the system-keychain data key by default.
- Master-password record save/unlock retained for legacy records and optional mode.
- UI status card for system keychain availability and data-key initialization.

Pending:

- Migrating existing master-password records to system-keychain data-key envelopes.
- SQLite-backed vault metadata and history storage.
- Plaintext reveal confirmation and clipboard protection.
- Optional OS-level user verification before reveal where supported.

## Envelope format

Master-password envelopes include KDF parameters:

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

System-keychain data-key envelopes use the same algorithm and omit `kdf` because the data key is loaded from the OS keychain.

## Modes

### System keychain mode

Default mode. A random local data encryption key is generated and stored in the OS keychain via the `keyring` crate. The app can initialize, detect, and delete the data key under:

```text
service: app.keysync.ai
account: vault-data-key
```

New local vault records are encrypted with this data key by default. If the data key is missing during save, the save command creates it before encrypting the record.

### Master password mode

Optional and legacy-compatible mode. The app derives a data encryption key from the user's master password using Argon2id, then encrypts vault payloads with XChaCha20-Poly1305. The master password is not stored.

The UI keeps a secondary "Save with master password" action and falls back to master-password unlock when a selected record cannot be opened with the system data key.

## Security notes

- Provider credentials must not be logged.
- Error messages should be redacted before display.
- Sync files must contain only encrypted envelopes.
- Plaintext reveal must require system verification or master password unlock.
- Future clipboard copy should auto-clear after a short timeout.
