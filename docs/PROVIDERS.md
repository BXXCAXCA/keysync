# Provider implementation notes

## Implemented

The backend exposes provider commands used by the UI:

- `list_models_with_key(config, apiKey)`
- `test_provider_with_key(config, apiKey, model?)`
- `start_chat_stream_with_key(config, apiKey, request)` for OpenAI-compatible and Gemini streaming
- `stop_chat_stream(streamId)` for cooperative stream cancellation

## OpenAI-compatible

The OpenAI-compatible adapter performs:

1. `GET {baseUrl}{modelsPath}` with bearer authentication.
2. Parsing of OpenAI-compatible `{ data: [{ id }] }` model lists.
3. Basic model capability classification from model IDs.
4. `POST {baseUrl}{chatPath}` with a minimal non-streaming `ping` request.
5. `POST {baseUrl}{chatPath}` with `stream: true` for SSE chat streaming.
6. Error normalization with simple secret redaction.

OpenAI Chat reuses the OpenAI-compatible adapter because the official Chat Completions API follows the same `/models` and `/chat/completions` shape.

## OpenAI Responses

OpenAI Responses has its own minimal test path using `/responses` and `max_output_tokens`.

Streaming for Responses is not implemented yet.

## Gemini

Gemini now supports:

1. `GET {baseUrl}/models` with the `x-goog-api-key` header.
2. Parsing Gemini `{ models: [...] }` responses.
3. Capability mapping from `supportedGenerationMethods`:
   - `generateContent` -> `chat`
   - `embedContent` / `batchEmbedContents` -> `embedding`
4. Context window mapping from `inputTokenLimit`.
5. Minimal `POST {baseUrl}/models/{model}:generateContent` request with a `ping` prompt.
6. Streaming `POST {baseUrl}/models/{model}:streamGenerateContent?alt=sse` wired into the shared Tauri chat stream event path.

## Anthropic Claude

Anthropic now supports:

1. A built-in Claude model list for UI selection.
2. Minimal `POST {baseUrl}/messages` request with `x-api-key` and `anthropic-version` headers.
3. A `ping` prompt with `max_tokens: 1` for key validation.

Anthropic does not currently use a remote model listing endpoint in this MVP. Streaming is not implemented yet.

## Pending

- OpenAI Responses streaming.
- Anthropic streaming.
- Provider-specific proxy plumbing in the shared HTTP client.
- Richer multimodal request mapping for Gemini and Anthropic.
