# KeySync AI

[![CI](https://github.com/BXXCAXCA/keysync/actions/workflows/ci.yml/badge.svg)](https://github.com/BXXCAXCA/keysync/actions/workflows/ci.yml)

KeySync AI is a local-first cross-platform desktop client for managing LLM provider credentials, testing providers, syncing encrypted configuration through WebDAV, and running lightweight model chats.

## Goals

- Encrypted credential storage with a system-keychain-first design and optional master password mode.
- Provider adapters for OpenAI, OpenAI Responses, Google Gemini, Anthropic Claude, and OpenAI-compatible custom endpoints.
- Model list fetching, provider validation, and minimal model request testing.
- Lightweight multi-turn chat with streaming output, stop generation, image-input support, model parameter wiring, and local conversation persistence.
- WebDAV sync for encrypted credentials and configuration; chat history remains local by default.

## Development

```bash
npm ci
npm run build
npm run tauri dev
```

Rust-only checks:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Required toolchain:

- Node.js 20+
- Rust stable
- Tauri v2 prerequisites for your OS

## Continuous integration

GitHub Actions runs on pull requests and pushes to `main`.

- `Frontend build`: installs Node dependencies and runs `npm run build`.
- `Rust cargo check`: installs Linux Tauri dependencies and runs `cargo check`.
- `Rust fmt and clippy`: runs `cargo fmt --check` and `cargo clippy -D warnings`. This job is currently non-blocking so formatting/lint debt can be surfaced without blocking early MVP iteration.

See `docs/CI.md` for local reproduction commands and first-failure triage notes.

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
- Image input mapping for OpenAI Chat/Responses, Gemini, and Anthropic request formats.
- Model parameters wired into chat requests with lightweight frontend context trimming.
- SQLite-backed model cache with favorite, hide, alias, and per-model default parameter preferences.
- Local SQLite conversation persistence with sidebar conversation list.
- Shared chat helper module for message typing, ID generation, parameter parsing, and context trimming.
- Real vault encryption envelope using XChaCha20-Poly1305 and Argon2id where needed.
- System keychain backend for local data-key initialization, default record encryption, and status checks.
- Optional master-password record save/unlock for compatibility.
- Local encrypted vault record file for saved provider credentials.
- Manual WebDAV test/upload/download for the encrypted vault file.
- WebDAV encrypted config storage, merge downloads, and conflict review UI.
- Encrypted global and provider-specific proxy configuration wired to HTTP/HTTPS/SOCKS5 Provider requests.
- Vault, WebDAV, proxy, SQLite, Gemini, and Anthropic module boundaries.

## Architecture

See:

- `docs/ARCHITECTURE.md`
- `docs/PROVIDERS.md`
- `docs/VAULT.md`
- `docs/SYNC.md`
- `docs/STREAMING.md`
- `docs/PERSISTENCE.md`
- `docs/CI.md`
- `docs/FRONTEND.md`

## License

Apache-2.0
