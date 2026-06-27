# Provider implementation notes

## Implemented in this milestone

The backend now exposes two real provider commands:

- `list_models_with_key(config, apiKey)`
- `test_provider_with_key(config, apiKey, model?)`

The OpenAI-compatible adapter performs:

1. `GET {baseUrl}{modelsPath}` with bearer authentication.
2. Parsing of OpenAI-compatible `{ data: [{ id }] }` model lists.
3. Basic model capability classification from model IDs.
4. `POST {baseUrl}{chatPath}` with a minimal non-streaming `ping` request.
5. Error normalization with simple secret redaction.

OpenAI Chat reuses the OpenAI-compatible adapter because the official Chat Completions API follows the same `/models` and `/chat/completions` shape.

OpenAI Responses has its own minimal test path using `/responses` and `max_output_tokens`.

## Next steps

- Add encrypted vault persistence so the UI no longer needs temporary API key input.
- Add provider-specific Gemini and Anthropic model parsing.
- Add streaming response parsers and cancellation.
- Add proxy plumbing to the shared HTTP client.
