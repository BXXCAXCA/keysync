# Local persistence

KeySync AI now has two local persistence paths:

- `vault.local.json` for encrypted API key records and WebDAV sync payloads.
- `keysync.local.sqlite3` for local chat conversations.

Both files are resolved under the Tauri app data directory.

## SQLite storage

The SQLite database is opened through `StorageService::open(path)`. The storage layer creates the parent directory if needed, opens a file-backed SQLite database, and applies `migrations/0001_init.sql`.

The current migration includes:

- `providers`
- `model_cache`
- `conversations`
- `messages`
- `sync_state`

Fetched models are cached in `model_cache`. Refreshing a provider updates provider metadata while preserving local preferences: favorite status, hidden status, alias, and default model parameters.

## Conversation commands

The Tauri command layer exposes:

- `list_conversations()`
- `load_conversation(conversationId)`
- `save_conversation(input)`
- `delete_conversation(conversationId)`

`save_conversation` upserts the conversation row and replaces the stored message rows for that conversation. Message order is persisted explicitly through the `messages.sequence` column and loaded by `sequence ASC`. `rowid` is only a compatibility tie-breaker for records created before the sequence migration.

## Frontend behavior

The React app loads conversation summaries on startup and shows them in the left sidebar.

A conversation is automatically saved after:

- stream completion
- stream error
- manual stop
- failed stream start after the user message has been appended

The current system prompt and model params are saved with the conversation metadata:

- provider ID
- model ID
- system prompt
- temperature
- max output tokens
- context length

Message attachments are stored in `attachments_json`. Loaded image attachments are restored into the chat view and included again when retained history is sent to a provider.

## Current limitations

- There is no full-text search yet.
- Message rows are replaced on every save instead of appended incrementally.
- Conversation sync over WebDAV is not implemented yet; only API key vault sync exists.
