# Frontend structure

The current React frontend is intentionally still MVP-oriented, but new shared chat utilities have started moving out of `src/App.tsx`.

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

Unknown roles should be treated as `assistant` until the UI supports custom roles. This prevents unknown persisted roles from leaking into CSS class names or provider context construction.

### Context trimming

`buildContextMessages` is a lightweight frontend approximation. It estimates text length and image cost, then keeps the newest messages under the configured context budget. This is intentionally not provider-tokenizer exact.

## App migration checklist

When wiring `src/App.tsx` to `src/lib/chat.ts`, make the changes in one small commit and verify these exact replacements:

1. Replace the local `ChatMessage` type with `import type { ChatMessage } from "./lib/chat"`.
2. Remove the local `initialMessages` constant and import it from `./lib/chat`.
3. Remove local `appendAssistantDelta`, `parseFiniteNumber`, `parsePositiveInt`, `buildContextMessages`, and `titleFromMessages` implementations and import them from `./lib/chat`.
4. Replace `createStreamId()` with `createClientId("stream")`.
5. Replace `message.role as ChatMessage["role"]` during persisted conversation loading with `normalizeChatRole(message.role)`.
6. Keep `PendingImage`, `StoredCredentialPayload`, and `readImageFile` in `App.tsx` until the composer is extracted.
7. Run the frontend build after the migration: `npm run build`.

Expected `App.tsx` import shape after step 1:

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

Expected persisted conversation mapping after step 5:

```ts
...detail.messages.map((message) => ({
  role: normalizeChatRole(message.role),
  content: message.content,
}))
```

## Planned extraction order

1. Wire `src/App.tsx` to import helpers from `src/lib/chat.ts`.
2. Move stream event handling into a `useChatStream` hook.
3. Move conversation persistence into a `useConversations` hook.
4. Move vault/WebDAV side panels into smaller inspector components.
5. Keep provider request types in `src/types.ts` and Tauri wrappers in `src/lib/tauri.ts`.
