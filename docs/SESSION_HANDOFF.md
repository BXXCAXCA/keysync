# Session handoff and project memory

This document preserves the working context from the ChatGPT development sessions for KeySync AI. It is intended for future conversation switches, agent handoffs, and resuming development without re-asking solved questions.

It is a condensed project memory, not a verbatim ChatGPT transcript. The original raw chat transcript is not available inside the repository, so this file records the actionable decisions, implementation state, constraints, and next steps.

## User workflow preferences

- The user usually says `继续` to mean: continue implementing the next most valuable task.
- Do not repeatedly ask for confirmation when the next task is clear.
- Prefer small, low-risk commits over one giant refactor.
- Keep status updates concise and in Chinese when chatting with the user.
- Be transparent about anything not actually verified.
- Never claim `npm run build`, `cargo check`, `cargo fmt`, `cargo clippy`, or CI passed unless that exact command/status was actually observed.
- The current work is being done directly on `BXXCAXCA/keysync` `main` through GitHub connector operations.

## Product goal

KeySync AI is a local-first cross-platform desktop client for:

- managing LLM provider API keys
- encrypting local credentials
- syncing encrypted configuration through WebDAV
- testing providers and listing models
- running lightweight streaming model chats
- preserving local chat conversations

The intended stack is Tauri v2 + Rust + React + TypeScript. The design prioritizes local data, credential encryption, and reusable provider adapters.

## User requirements captured from earlier planning

- Cross-platform desktop application.
- Local-first API key manager.
- API keys must be encrypted.
- Prefer OS system keychain for default local encryption.
- Master password mode remains available for legacy records and WebDAV config unlock.
- WebDAV can store encrypted key/config payloads.
- Provider support should be adapter-based.
- First provider scope:
  - OpenAI Chat
  - OpenAI Responses
  - OpenAI-compatible custom endpoints
  - Google Gemini
  - Anthropic Claude
- Chat MVP should support:
  - multi-turn messages
  - streaming output
  - stop generation
  - system prompt
  - temperature
  - max output tokens
  - approximate context length trimming
  - image input mapping for supported providers
  - local conversation persistence

## Current implementation summary

### Frontend

The frontend is still centered around `src/App.tsx`, but several reusable pieces have been extracted:

- `src/lib/chat.ts`
  - `ChatRole`
  - `ChatMessage`
  - `initialMessages`
  - `normalizeChatRole`
  - `appendAssistantDelta`
  - `createClientId`
  - model parameter parsers
  - context trimming helper
  - conversation title helper
- `src/hooks/useChatStreamEvents.ts`
  - owns Tauri `chat-stream-event` subscription
  - filters by active stream ID
  - handles start/delta/usage/error/done stream events
  - triggers conversation persistence after terminal stream events
- `src/hooks/useConversations.ts`
  - owns sidebar conversation summaries and active conversation ID
  - wraps list/load/save/delete Tauri conversation commands
  - normalizes persisted roles
  - serializes model parameters for saved conversations
- `src/components/WebDavSyncCard.tsx`
  - owns WebDAV sync panel JSX
  - receives config, saved summary, sync message, busy state, and callbacks from `App.tsx`

`src/App.tsx` still owns a lot of UI and orchestration state, especially vault, keychain, provider/model, model parameters, image composer, and WebDAV side effects.

### Backend

Rust/Tauri backend currently includes:

- provider templates and adapters
- provider tests and model listing
- streaming chat commands
- abortable stream cancellation
- encrypted vault records
- system keychain data-key support
- master-password unlock/save path
- WebDAV vault/config commands
- SQLite local conversation persistence

Conversation saves are now atomic at the SQLite level: the conversation upsert, old message deletion, new message inserts, and commit run inside one transaction.

### CI and validation

The repository has GitHub Actions CI configured in `.github/workflows/ci.yml`:

- `Frontend build`
- `Rust cargo check`
- `Rust fmt and clippy` as non-blocking quality job

Important limitation: no local build or cargo command has been run in the current ChatGPT environment. Previous workflow/status checks often returned no run records through the available connector wrapper. Treat compile status as unknown until verified.

## Important repository files

### High-level docs

- `README.md` — project overview, current implementation, architecture doc links.
- `docs/ARCHITECTURE.md` — architecture notes.
- `docs/PROVIDERS.md` — provider adapter direction.
- `docs/VAULT.md` — vault/encryption direction.
- `docs/SYNC.md` — WebDAV sync direction.
- `docs/STREAMING.md` — stream event and provider streaming behavior.
- `docs/PERSISTENCE.md` — local SQLite conversation persistence.
- `docs/CI.md` — CI commands and troubleshooting.
- `docs/FRONTEND.md` — current frontend extraction structure.
- `docs/SESSION_HANDOFF.md` — this handoff memory.
- `docs/DEVELOPMENT_LOG.md` — chronological implementation log.
- `docs/DOCUMENTATION_INDEX.md` — navigation index for project docs.

### Frontend source

- `src/App.tsx`
  - still main shell and orchestration point
  - now uses extracted chat/conversation/WebDAV UI helpers
- `src/lib/chat.ts`
  - pure chat helper functions and UI chat types
- `src/lib/tauri.ts`
  - TypeScript wrappers around Tauri commands
- `src/types.ts`
  - shared frontend types for providers, streams, conversations, vault, WebDAV
- `src/hooks/useChatStreamEvents.ts`
  - stream event listener hook
- `src/hooks/useConversations.ts`
  - local conversation state and persistence hook
- `src/components/WebDavSyncCard.tsx`
  - WebDAV sync panel component
- `src/styles.css`
  - app layout and UI styling

### Backend source

- `src-tauri/src/commands/providers.rs`
  - provider test/list/chat stream commands
  - stream abort registry
  - provider dispatch for OpenAI-compatible, Responses, Gemini, Anthropic
- `src-tauri/src/commands/conversations.rs`
  - local conversation list/load/save/delete commands
  - atomic save transaction
- `src-tauri/src/storage/mod.rs`
  - SQLite connection setup and migration runner
  - includes `connection_mut` for transactions
- `src-tauri/migrations/0001_init.sql`
  - providers, model cache, conversations, messages, sync state tables
- `src-tauri/src/providers/types.rs`
  - provider and stream data types
- `src-tauri/src/providers/mod.rs`
  - provider template exports

## Recent implementation milestones

### Streaming and chat

- Added OpenAI-compatible streaming chat through Tauri events.
- Added OpenAI Responses streaming branch.
- Added Gemini and Anthropic streaming branches.
- Added stop generation through backend abort handles.
- Frontend now pre-generates stream IDs and filters events by active stream ID.
- Stream handling moved from `App.tsx` into `useChatStreamEvents`.

### Image and model params

- Added pending image selection UI.
- Added `UnifiedMessage.images` mapping.
- Mapped images for OpenAI Chat/compatible, OpenAI Responses, Gemini, and Anthropic request formats.
- Wired temperature, max tokens, and approximate context length trimming into requests.

### Persistence

- Added SQLite-backed conversation list/load/save/delete commands.
- Added conversation sidebar in UI.
- Conversations auto-save after stream completion, stream error, stop, and failed stream start.
- Added `docs/PERSISTENCE.md`.
- Changed conversation save to use a SQLite transaction.
- Moved frontend conversation state/persistence into `useConversations`.

### Frontend refactor

- Added `src/lib/chat.ts` and migrated App to use it.
- Added `src/hooks/useChatStreamEvents.ts` and migrated App to use it.
- Added `src/hooks/useConversations.ts` and migrated App to use it.
- Added `src/components/WebDavSyncCard.tsx` and migrated WebDAV panel JSX to it.
- Added and updated `docs/FRONTEND.md` to track this extraction.

### CI/docs

- Added CI workflow for frontend build, Rust cargo check, and Rust fmt/clippy.
- Expanded CI documentation.
- Linked frontend, CI, persistence, and other docs from README.

## Known risks and open issues

- TypeScript build has not been locally verified after the latest refactors.
- Rust build/check has not been locally verified after the latest backend changes.
- CI status may not be visible through the current connector wrapper; check Actions manually or with more specific workflow tools if available.
- `src/App.tsx` is still large and should continue to be split.
- WebDAV state/actions still live in `App.tsx`; only the WebDAV JSX has been extracted.
- API key vault card and system keychain card are still inline in `App.tsx`.
- Conflict review card is still inline in `App.tsx`.
- Provider/model/model-params cards are still inline in `App.tsx`.
- Previous image turns are displayed as text markers and are not restored as real image attachments in loaded conversations.
- Conversation WebDAV sync is not implemented; WebDAV currently syncs encrypted vault/config data, not chat history.
- Message ordering relies on SQLite `rowid` rather than an explicit sequence column.
- `handleLoadConversation` still uses `setTimeout` to restore selected model after provider change. This works but should be replaced with a cleaner loading-conversation guard.
- `initialMessages` array is reused; cloning initial messages may be safer for future mutation-heavy changes.

## Suggested next tasks

1. Verify TypeScript with `npm run build` or CI.
2. Verify Rust with `cargo check --manifest-path src-tauri/Cargo.toml`.
3. If builds fail, fix blocking errors before further refactors.
4. Extract `useWebDavSync` so WebDAV state/actions move out of `App.tsx`.
5. Extract API key vault and system keychain cards into components.
6. Extract conflict review card.
7. Extract provider/model/model-params cards.
8. Improve conversation loading to avoid `setTimeout` for model restore.
9. Add persisted image attachment restore support.
10. Add explicit message ordering column/migration.
11. Consider adding a lockfile and switch CI frontend install to `npm ci` after lockfile is committed.

## Resume instruction for future agents

When the user says `继续`, inspect this file and `docs/DEVELOPMENT_LOG.md`, then continue the next useful task. Prefer build verification before more refactoring if CI/local command access is available. If build verification is not available, continue with small, isolated refactors and document all assumptions.
