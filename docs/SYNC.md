# WebDAV sync

## Status

The MVP WebDAV sync layer now supports manual encrypted vault file operations and encrypted local storage for WebDAV credentials.

Implemented:

- WebDAV connection test using `PROPFIND` with `Depth: 0`.
- Remote directory creation using `MKCOL` before upload.
- Upload of the local encrypted vault file to `vault.sync.json.enc`.
- Download of `vault.sync.json.enc` into the local app data vault file.
- Frontend WebDAV panel for endpoint, remote directory, username, and password.
- Saving WebDAV configuration to `webdav.config.json`.
- Encrypting the saved WebDAV password with the master-password vault envelope.
- Loading saved WebDAV config summaries without exposing the password.
- Unlocking saved WebDAV config with the master password for test/upload/download.

Pending:

- Conflict detection and merge.
- Sync metadata such as ETag, revision, and device ID.
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

The synced vault file contains encrypted payloads only. Plaintext API keys are not written to the WebDAV file. WebDAV passwords are saved locally only as encrypted vault envelopes. The first implementation intentionally requires manual upload/download so users can verify provider compatibility before automatic sync and conflict handling are added.
