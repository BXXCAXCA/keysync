# CI

The repository uses GitHub Actions workflow `.github/workflows/ci.yml`.

## Triggers

CI runs on:

- pushes to `main`
- pull requests targeting `main`
- manual `workflow_dispatch`

Concurrent runs for the same ref are cancelled so only the latest run keeps executing.

## Frontend job

The frontend job uses Node.js 20 and runs:

```bash
npm install --no-audit --no-fund
npm run build
```

`npm run build` is defined in `package.json` as:

```bash
tsc && vite build
```

The workflow intentionally does not enable `actions/setup-node` dependency caching yet because the repository does not currently include a package lockfile. Once a lockfile is committed, npm caching can be re-enabled safely.

## Rust job

The Rust job installs Linux dependencies needed for Tauri builds/checks on Ubuntu 24.04, then runs:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Cargo dependency caching is enabled with `Swatinem/rust-cache` for the `src-tauri` workspace.

## Notes

CI is the first reliable compilation signal for remote-only development. When a run fails, treat the first failing step as the next development priority before adding new features.
