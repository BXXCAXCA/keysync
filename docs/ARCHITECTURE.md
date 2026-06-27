# KeySync AI Architecture

## Product boundary

KeySync AI is a local-first LLM API key manager with a lightweight chat client. It should not start as a cloud account system, team admin system, or commercial password manager clone.

## MVP decisions

- Cross-platform desktop: Tauri v2 + React + Rust.
- Local-first data model.
- API keys must never be stored in plaintext.
- Default secret unlock mode: OS keychain.
- Optional unlock mode: master password.
- WebDAV sync stores encrypted JSON files only.
- Chat history is stored in SQLite locally by default; encrypted-history mode is optional.
- Provider support is implemented through adapters, not UI-specific branches.

## Modules

```text
Frontend React UI
  ├─ Provider list
  ├─ Conversation panel
  ├─ Inspector: key/model/params/proxy
  └─ Tauri invoke bridge

Rust Core
  ├─ commands        Tauri command layer
  ├─ providers       OpenAI/Gemini/Claude/compatible adapters
  ├─ vault           encryption, keychain, master password mode
  ├─ storage         SQLite local data
  ├─ sync            WebDAV encrypted sync
  ├─ proxy           global/provider proxy settings
  └─ errors          normalized error payloads
```

## Provider adapter contract

Every provider adapter should implement model listing, provider testing, and streaming chat through a unified interface. Provider-specific APIs are normalized into `ModelInfo`, `UnifiedChatRequest`, `ChatStreamEvent`, `TestResult`, and user-facing error payloads.

## Sync policy

Default WebDAV sync includes encrypted key records, provider configuration, model preferences, and proxy settings. Conversation history stays local by default and can later be enabled explicitly.

## Roadmap

1. Bootstrap Tauri shell and module boundaries.
2. Implement local vault with real authenticated encryption.
3. Implement OpenAI-compatible model list and chat streaming.
4. Add OpenAI Responses, Gemini, and Anthropic adapters.
5. Add SQLite conversation persistence.
6. Add encrypted WebDAV sync with conflict handling.
