# WebDAV sync

## Status

The MVP WebDAV sync layer now supports manual encrypted vault file operations.

Implemented:

- WebDAV connection test using `PROPFIND` with `Depth: 0`.
- Remote directory creation using `MKCOL` before upload.
- Upload of the local encrypted vault file to `vault.sync.json.enc`.
- Download of `vault.sync.json.enc` into the local app data vault file.
- Frontend WebDAV panel for endpoint, remote directory, username, and password.

Pending:

- Storing WebDAV credentials in the encrypted vault instead of UI state.
- Conflict detection and merge.
- Sync metadata such as ETag, revision, and device ID.
- Settings/model preference sync.
- Optional conversation history sync.

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

## Safety model

The synced vault file contains encrypted payloads only. Plaintext API keys are not written to the WebDAV file. The first implementation intentionally requires manual upload/download so users can verify provider compatibility before automatic sync and conflict handling are added.
