# Documentation index

Use this file as the first stop when resuming KeySync AI development in a new conversation.

## Handoff and project memory

- `docs/SESSION_HANDOFF.md` — highest-priority context for future agents. Read this first after a conversation switch.
- `docs/DEVELOPMENT_LOG.md` — practical changelog of what has been implemented and what remains.
- `docs/DOCUMENTATION_INDEX.md` — this navigation file.

## Architecture and product direction

- `docs/ARCHITECTURE.md` — high-level system structure.
- `docs/PROVIDERS.md` — provider adapter notes and provider support direction.
- `docs/VAULT.md` — encrypted local record and security design notes.
- `docs/SYNC.md` — WebDAV sync design notes.

## Runtime features

- `docs/STREAMING.md` — streaming event contract, stop behavior, provider streaming notes, image mapping, and model parameter handling.
- `docs/PERSISTENCE.md` — local SQLite conversation persistence, frontend auto-save behavior, and current limitations.
- `docs/FRONTEND.md` — frontend refactor state, extracted hooks/components, and next extraction targets.

## Validation

- `docs/CI.md` — CI workflow, local reproduction commands, and first-failure triage.

## Recommended reading order for a new chat

1. `docs/SESSION_HANDOFF.md`
2. `docs/DEVELOPMENT_LOG.md`
3. `docs/FRONTEND.md`
4. `docs/CI.md`
5. The feature-specific doc for the area being changed:
   - streaming: `docs/STREAMING.md`
   - persistence: `docs/PERSISTENCE.md`
   - sync: `docs/SYNC.md`
   - provider behavior: `docs/PROVIDERS.md`
   - local encrypted records: `docs/VAULT.md`

## Current next action

Prefer build verification before more refactoring when tooling is available. If build verification is unavailable, continue with small isolated refactors and update this documentation after each step.
