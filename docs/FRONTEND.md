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

`src/App.tsx` now imports the shared chat helpers instead of defining local copies:

```ts
import type { ChatMessage } from "./lib/chat";
import {
  appendAssistantDelta,
  buildContextMessages,
  createClientId,
  initialMessages,
  normalizeChatRole,
  parseFiniteNumber,
  parsePositiveInt,
  titleFromMessages,
} from "./lib/chat";
```

The first migration pass completed these replacements:

1. The local `ChatMessage` type was replaced with the imported type.
2. The local `initialMessages` constant was replaced with the imported constant.
3. Local helper copies for assistant deltas, parameter parsing, context trimming, and title generation were removed.
4. `createStreamId()` was replaced with `createClientId("stream")`.
5. Persisted conversation loading now uses `normalizeChatRole(message.role)` instead of a type assertion.

Composer-only helpers remain in `App.tsx` for now:

- `PendingImage`
- `StoredCredentialPayload`
- `readImageFile`

## Planned extraction order

1. Move stream event handling into a `useChatStream` hook.
2. Move conversation persistence into a `useConversations` hook.
3. Move vault/WebDAV side panels into smaller inspector components.
4. Keep provider request types in `src/types.ts` and Tauri wrappers in `src/lib/tauri.ts`.
