# Frontend structure

The current React frontend is intentionally still MVP-oriented, but shared chat utilities have started moving out of `src/App.tsx`.

## Chat helper module

`src/lib/chat.ts` owns reusable chat-state helpers:

- `ChatRole`
- `ChatMessage`
- `initialMessages`
- `normalizeChatRole(role)`
- `appendAssistantDelta(messages, delta)`
- `createClientId(prefix)`
- `parseFiniteNumber(value, fallback)`
- `parsePositiveInt(value, fallback)`
- `estimateMessageBudget(message)`
- `buildContextMessages(messages, nextMessage, contextLength)`
- `titleFromMessages(messages)`

The helper module exists to reduce TypeScript risk in `App.tsx` and to make future extraction into hooks/components safer.

## Chat stream event hook

`src/hooks/useChatStreamEvents.ts` owns the Tauri `chat-stream-event` subscription.

The hook handles active stream filtering, busy-state updates, assistant delta appends, usage reporting, stream error display, stream cleanup, and conversation persistence after stream completion or stream errors.

The hook stores the latest callbacks and refs in an internal ref, so it can subscribe once without capturing stale App state. `src/App.tsx` now calls this hook instead of owning the raw Tauri listener directly.

## Conversation hook

`src/hooks/useConversations.ts` owns the reusable conversation store layer.

The hook manages:

- conversation summaries
- current conversation ID
- loading conversation lists from SQLite through Tauri commands
- saving the current conversation after stream completion or failure
- loading existing conversations with persisted role normalization
- deleting conversations and refreshing the sidebar list

The hook is intentionally state-oriented rather than UI-oriented. It returns normalized conversation data for `App.tsx` to apply to provider/model/message state, which keeps the hook reusable when the UI is later split into smaller components.

`src/App.tsx` now uses this hook for sidebar list state, active conversation ID, save, load, delete, and reset operations.

## Safety decisions

### Client-generated IDs

Use `createClientId(prefix)` instead of directly reading `crypto.randomUUID` in UI code. The helper uses `globalThis.crypto` when available and falls back to a timestamp/random suffix. This avoids direct global assumptions during strict TypeScript compilation and preview/test environments.

### Persisted message roles

Use `normalizeChatRole(role)` when loading persisted conversation messages. SQLite stores roles as strings, but the UI only supports:

- `system`
- `user`
- `assistant`

Unknown roles are treated as `assistant` until the UI supports custom roles. This prevents unknown persisted roles from leaking into CSS class names or provider context construction.

### Context trimming

`buildContextMessages` is a lightweight frontend approximation. It estimates text length and image cost, then keeps the newest messages under the configured context budget. This is intentionally not provider-tokenizer exact.

## Completed App migration

`src/App.tsx` now imports shared chat helpers instead of defining local copies.

The migration completed these replacements:

1. The local `ChatMessage` type was replaced with the imported type.
2. The local `initialMessages` constant was replaced with the imported constant.
3. Local helper copies for assistant deltas, parameter parsing, context trimming, and title generation were removed.
4. `createStreamId()` was replaced with `createClientId("stream")`.
5. Persisted conversation loading now uses `normalizeChatRole(message.role)` through `useConversations` instead of a type assertion.
6. The raw `chat-stream-event` listener effect moved from `App.tsx` into `useChatStreamEvents`.
7. Conversation list/current/save/load/delete/reset logic moved from `App.tsx` into `useConversations`.

Composer-only helpers remain in `App.tsx` for now:

- `PendingImage`
- `StoredCredentialPayload`
- `readImageFile`

## Planned extraction order

1. Move vault/WebDAV side panels into smaller inspector components.
2. Keep provider request types in `src/types.ts` and Tauri wrappers in `src/lib/tauri.ts`.
