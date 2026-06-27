# KeySync AI

KeySync AI is a local-first cross-platform desktop client for managing LLM API keys, testing providers, syncing encrypted configuration through WebDAV, and running lightweight model chats.

## Goals

- Encrypted API key storage with a system-keychain-first design and optional master password mode.
- Provider adapters for OpenAI, OpenAI Responses, Google Gemini, Anthropic Claude, and OpenAI-compatible custom endpoints.
- Model list fetching, API key validation, and minimal model request testing.
- Lightweight multi-turn chat with streaming output, stop generation, and image-input support planned for the MVP.
- WebDAV sync for encrypted keys and configuration; chat history remains local by default.

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
- OpenAI-compatible model listing and minimal key test commands.
- OpenAI Chat reuses the OpenAI-compatible adapter.
- OpenAI Responses minimal test command.
- Vault, WebDAV, proxy, SQLite, Gemini, and Anthropic module boundaries.

## Architecture

See:

- `docs/ARCHITECTURE.md`
- `docs/PROVIDERS.md`

## License

Apache-2.0
