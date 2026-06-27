# KeySync AI

KeySync AI is a local-first cross-platform desktop client for managing LLM provider credentials, testing providers, syncing encrypted configuration through WebDAV, and running lightweight model chats.

## Goals

- Encrypted credential storage with a system-keychain-first design and optional master password mode.
- Provider adapters for OpenAI, OpenAI Responses, Google Gemini, Anthropic Claude, and OpenAI-compatible custom endpoints.
- Model list fetching, provider validation, and minimal model request testing.
- Lightweight multi-turn chat with streaming output, stop generation, and image-input support planned for the MVP.
- WebDAV sync for encrypted credentials and configuration; chat history remains local by default.

## Development

```bash
pnpm install
pnpm tauri dev
```

Required toolchain:

- Node.js 20+
- pnpm 9+
- Rust stable
- Tauri v2 prerequisites for your OS

## Current implementation

- Tauri + React shell.
- Three-column client UI prototype.
- Provider template loading from Rust.
- OpenAI-compatible model listing and minimal provider test commands.
- OpenAI Chat reuses the OpenAI-compatible adapter.
- OpenAI Responses minimal test command and streaming chat.
- Gemini model listing, minimal `generateContent` provider test, and streaming chat.
- Anthropic Claude built-in model list, minimal Messages API provider test, and streaming chat.
- OpenAI-compatible streaming chat through Tauri events.
- Stop generation for active chat streams.
- Real master-password vault encryption envelope using XChaCha20-Poly1305 and Argon2id.
- Local encrypted vault record file for saved provider credentials.
- Manual WebDAV test/upload/download for the encrypted vault file.
- WebDAV encrypted config storage, merge downloads, and conflict review UI.
- Vault, WebDAV, proxy, SQLite, Gemini, and Anthropic module boundaries.

## Architecture

See:

- `docs/ARCHITECTURE.md`
- `docs/PROVIDERS.md`
- `docs/VAULT.md`
- `docs/SYNC.md`

## License

Apache-2.0
