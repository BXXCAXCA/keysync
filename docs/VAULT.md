# Vault design

## Status

This milestone replaces the placeholder vault encoding with a real authenticated encryption envelope for master-password mode.

Implemented:

- XChaCha20-Poly1305 authenticated encryption.
- Argon2id key derivation for master-password mode.
- Random salt per envelope.
- Random nonce per encryption.
- JSON envelope serialization for encrypted sync files.
- Tauri commands for master-password encryption/decryption plumbing.
- System keychain interface boundary.

Pending:

- OS-specific keychain backend implementation.
- Encrypted key record persistence in SQLite/sync JSON.
- UI flow for adding/editing/revealing keys.
- Clipboard protection and plaintext reveal confirmation.

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

Target default mode. A random data encryption key is generated locally and stored in the OS keychain. The encrypted vault payload can be synced safely through WebDAV. The keychain backend interface is defined, but OS-specific persistence is pending.

### Master password mode

Optional mode. The app derives a data encryption key from the user's master password using Argon2id, then encrypts vault payloads with XChaCha20-Poly1305. The master password is not stored.

## Security notes

- API keys must not be logged.
- Error messages should be redacted before display.
- Sync files must contain only encrypted envelopes.
- Plaintext reveal must require system verification or master password unlock.
- Future clipboard copy should auto-clear after a short timeout.
