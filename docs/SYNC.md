# WebDAV sync

## Status

The MVP WebDAV sync layer now supports manual encrypted vault file operations, encrypted local storage for WebDAV credentials, and basic record-level merge on download.

Implemented:

- WebDAV connection test using `PROPFIND` with `Depth: 0`.
- Remote directory creation using `MKCOL` before upload.
- Upload of the local encrypted vault file to `vault.sync.json.enc`.
- Download of `vault.sync.json.enc` into the local app data vault file.
- Local vault backup before overwrite or merge.
- Record-level merge by secret record ID.
- Conflict copies for records with the same ID but different encrypted payload or metadata.
- Frontend WebDAV panel for endpoint, remote directory, username, and password.
- Saving WebDAV configuration to `webdav.config.json`.
- Encrypting the saved WebDAV password with the master-password vault envelope.
- Loading saved WebDAV config summaries without exposing the password.
- Unlocking saved WebDAV config with the master password for test/upload/download.

Pending:

- Sync metadata such as ETag, revision, and device ID.
- Conflict review UI.
- Settings/model preference sync.
- Optional conversation history sync.
- Moving WebDAV config into a unified settings store.

## Remote layout

For a WebDAV endpoint and remote directory such as:

```text
endpoint: https://dav.example.com/remote.php/dav/files/user
remoteDir: KeySyncAI
```

The MVP uploads:

```text
https://dav.example.com/remote.php/dav/files/user/KeySyncAI/vault.sync.json.enc
```

## Merge behavior

Download now defaults to merge mode rather than destructive overwrite.

Rules:

- Remote records with new IDs are added locally.
- Remote records with matching IDs and identical metadata/payload are skipped.
- Remote records with matching IDs but different metadata or encrypted payload are kept as a new local record with a fresh UUID.
- Conflict copies are renamed with `[conflict remote]` so users can inspect them later.
- Before merge or overwrite, the existing local vault is backed up as `vault.local.<timestamp>.backup.json`.

This is intentionally conservative: it preserves data first and leaves human conflict review for a later UI.

## Local config file

The local WebDAV config file stores metadata plus an encrypted password envelope:

```json
{
  "version": 1,
  "endpoint": "https://dav.example.com/remote.php/dav/files/user",
  "username": "user",
  "remoteDir": "KeySyncAI",
  "encryptedPassword": "{...vault envelope...}",
  "updatedAt": "timestamp"
}
```

The summary command returns endpoint, username, remote directory, and whether a password is present. It does not return plaintext or encrypted password content.

## Safety model

The synced vault file contains encrypted payloads only. Plaintext API keys are not written to the WebDAV file. WebDAV passwords are saved locally only as encrypted vault envelopes. Download merge keeps conflict copies instead of deleting or silently overwriting data.
