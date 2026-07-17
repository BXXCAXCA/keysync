# Development log

This file records the implementation history captured from the ChatGPT development sessions. It is a practical changelog, not a verbatim transcript.

## Working mode

- Repository: `BXXCAXCA/keysync`
- Branch: `main`
- User continuation command: `继续`
- Preferred workflow: make small focused commits, document assumptions, avoid repeated confirmation questions when the next step is clear.
- Verification caveat: local build/check commands have not been run in the ChatGPT environment unless a future log entry explicitly says so.

## Foundation

- Initialized KeySync AI as a Tauri + React + Rust application.
- Added README and architecture documentation.
- Added provider template loading from Rust into the frontend.
- Added the main app shell with provider list, chat panel, and inspector panel.

## Provider adapter direction

Provider support is organized around a unified adapter approach. Current and planned first-class providers are:

- OpenAI Chat
- OpenAI Responses
- OpenAI-compatible endpoints
- Google Gemini
- Anthropic Claude
- Custom provider configuration

## Local credential and sync foundation

- Added encrypted local record handling.
- Added default OS keychain data-key path.
- Kept master-password compatibility for older records and saved remote-sync configuration.
- Added manual WebDAV test, upload, download, saved config, and unlock flows.
- Added conflict review behavior for remote copies.

## Streaming chat

- Added OpenAI-compatible streaming chat through Tauri events.
- Added OpenAI Responses streaming branch.
- Added Gemini streaming branch.
- Added Anthropic streaming branch.
- Added stop generation through backend abort handles.
- Frontend now pre-generates stream IDs and filters stream events by active stream ID.
- Stream event handling moved from `App.tsx` into `src/hooks/useChatStreamEvents.ts`.

## Image input and model parameters

- Added image picker and pending image chips to the chat composer.
- Added `UnifiedMessage.images` support.
- Added provider-specific image mapping for OpenAI-style, Responses, Gemini, and Anthropic requests.
- Added system prompt, temperature, max output tokens, and context length controls.
- Added lightweight frontend context trimming.
- Added shared chat helpers in `src/lib/chat.ts`.
- Added SQLite-backed model caching and preferences: favorites, hide/show, aliases, and saved default parameters.

## Conversation persistence

- Added SQLite-backed conversation list, load, save, and delete commands.
- Added file-backed SQLite opening and migrations.
- Added conversation sidebar in the frontend.
- Conversations auto-save after stream completion, stream error, stop, and failed stream start.
- Wrapped conversation saves in a SQLite transaction to avoid partial writes.
- Moved frontend conversation state and persistence into `src/hooks/useConversations.ts`.
- Added an explicit SQLite `messages.sequence` migration so message ordering no longer relies on insertion `rowid` alone.
- Restored persisted image attachments into loaded conversations, the message UI, and subsequent provider context.
- Removed the delayed `setTimeout` model restore during conversation loading; the selected model is now set before switching provider state.

## Frontend extraction progress

Created and wired:

- `src/lib/chat.ts`
- `src/hooks/useChatStreamEvents.ts`
- `src/hooks/useConversations.ts`
- `src/components/WebDavSyncCard.tsx`

Still inline in `src/App.tsx`:

- local record management cards
- system keychain card
- conflict review card
- active provider card
- model list card
- model parameter card
- image composer behavior
- WebDAV side-effect functions

## Documentation added or updated

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PROVIDERS.md`
- `docs/VAULT.md`
- `docs/SYNC.md`
- `docs/STREAMING.md`
- `docs/PERSISTENCE.md`
- `docs/CI.md`
- `docs/FRONTEND.md`
- `docs/SESSION_HANDOFF.md`
- `docs/DEVELOPMENT_LOG.md`
- `docs/DOCUMENTATION_INDEX.md`

## Verification status

Verified locally on 2026-07-18:

- `npm run build` — passed (`tsc && vite build`).

Still unverified because this environment has no Rust/Cargo toolchain:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

Previous workflow/status checks through the available connector returned no useful run records.

## Current next-step queue

1. Run or inspect CI/build status.
2. Fix any TypeScript build failures from recent refactors.
3. Fix any Rust build or formatting failures.
4. Extract `useWebDavSync`.
5. Extract the remaining inspector cards into components.
6. Remove the `setTimeout` model restore workaround during conversation loading.
7. Persist and restore image attachments for saved conversations.
8. Add explicit message ordering in SQLite.
