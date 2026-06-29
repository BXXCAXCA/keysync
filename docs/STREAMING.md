# Streaming chat

KeySync AI uses one frontend-facing event contract for all provider streaming adapters.

## Frontend contract

The frontend pre-generates a `streamId`, stores it as the active stream before invoking the backend, and passes it to `start_chat_stream_with_key`. This makes event filtering race-free because the UI knows the active stream ID before the backend can emit `start` or `delta`.

The backend still returns `ChatStartResult { streamId }`. If older callers omit `streamId`, the backend generates one with UUID fallback.

Event payload shape:

```ts
interface ChatStreamPayload {
  streamId: string;
  event:
    | { type: "start" }
    | { type: "delta"; text: string }
    | { type: "usage"; inputTokens?: number; outputTokens?: number }
    | { type: "done" }
    | { type: "error"; code: string; message: string };
}
```

The UI appends each `delta.text` to the active assistant message and switches the composer from **Send** to **Stop** while a stream is active. Events whose `streamId` does not match the active stream are ignored.

## Model parameters

The right-side model parameter controls are wired into each chat request.

- `temperature` is parsed as a finite number and sent as the unified request temperature. Invalid input falls back to `0.7`.
- `maxTokens` is parsed as a positive integer and sent as the provider max output token field. Invalid input falls back to `512`.
- `contextLength` is parsed as a positive integer and used by the frontend to trim recent chat history before sending. This is a lightweight approximation based on text length rather than provider-specific tokenization. Invalid input falls back to `8192`.

The current user turn is always retained even if its estimated size exceeds the context budget.

## Image input

The chat composer can attach one or more local image files. The frontend reads them as base64 and sends them through `UnifiedMessage.images` with `{ mediaType, dataBase64 }`.

Provider request mapping:

| Provider kind | Image mapping |
| --- | --- |
| `openai_chat` / `openai_compatible` / `custom` | Chat message `content` array with `image_url.url = data:<media>;base64,<data>` |
| `openai_responses` | `input` content item `{ type: "input_image", image_url: "data:<media>;base64,<data>" }` |
| `google_gemini` | `parts[].inlineData = { mimeType, data }` |
| `anthropic_claude` | `content` block `{ type: "image", source: { type: "base64", media_type, data } }` |

Pure text messages still use the provider's simple text shape where possible, so existing text-only calls remain compatible.

## Supported provider paths

| Provider kind | Endpoint style | Parser |
| --- | --- | --- |
| `openai_chat` | `POST /chat/completions` with `stream: true` | `choices[0].delta.content` |
| `openai_compatible` / `custom` | `POST /chat/completions` with `stream: true` | `choices[0].delta.content` |
| `openai_responses` | `POST /responses` with `stream: true` | `response.output_text.delta` |
| `google_gemini` | `:streamGenerateContent?alt=sse` | `candidates[0].content.parts[].text` |
| `anthropic_claude` | `POST /messages` with `stream: true` | `content_block_delta.delta.text` |

## Stop behavior

`start_chat_stream_with_key` wraps each provider stream future in `Abortable` and stores the matching `AbortHandle` under the returned `streamId`.

`stop_chat_stream(streamId)` removes the handle from the active stream registry, calls `abort()`, and emits a final `done` event so the UI can immediately return to the idle state. Dropping the aborted stream future also drops the underlying request/response future, so the HTTP streaming read is cancelled instead of merely suppressing UI updates.

The SSE read loop still checks the active registry between chunks. This keeps normal completion, external cleanup, and abort cleanup safe even if a provider finishes at nearly the same time as the user presses **Stop**.

## Current limitations

- Only text deltas are emitted.
- Image attachments require a provider/model that actually supports vision input.
- Context trimming uses a simple estimate and is not yet backed by a provider-specific tokenizer.
- System prompt handling differs by provider because upstream APIs use different formats.
- Usage accounting is best-effort because providers expose usage metadata in different chunks.
