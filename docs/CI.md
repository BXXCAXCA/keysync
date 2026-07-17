# CI and local validation

The repository uses GitHub Actions workflow `.github/workflows/ci.yml` as the first reliable compilation signal for remote-only development.

## Triggers

CI runs on:

- pushes to `main`
- pull requests targeting `main`
- manual `workflow_dispatch`

Concurrent runs for the same ref are cancelled so only the latest run keeps executing.

## Frontend build

The frontend job uses Node.js 20 and runs:

```bash
npm ci --no-audit --no-fund
npm run build
```

`npm run build` is defined in `package.json` as:

```bash
tsc && vite build
```

This validates TypeScript strict-mode compilation and Vite production bundling.

The repository includes a committed `package-lock.json`, so CI uses `npm ci` for reproducible installs. Node dependency caching can be added later if CI duration becomes a concern.

## Rust cargo check

The blocking Rust job installs Linux dependencies needed for Tauri checks on Ubuntu 24.04, then runs:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

This job is the first backend compilation gate and should be fixed before new feature work continues.

## Rust quality

Formatting and Clippy run in a separate advisory job with `continue-on-error: true`:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

This keeps quality feedback visible without hiding the primary compile signal while the codebase is still being actively bootstrapped. Once the historical Rust files are rustfmt-clean and clippy-clean, remove `continue-on-error` so this job becomes blocking.

Cargo dependency caching is enabled with `Swatinem/rust-cache` for the `src-tauri` workspace in both Rust jobs.

## Local reproduction

Use the same commands as CI:

```bash
npm ci --no-audit --no-fund
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

On Linux, install the Tauri dependencies first:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

## Expected first-failure areas

Because recent work touched both the frontend and backend, the first useful CI run may expose one of these areas:

- TypeScript strict-mode issues in `src/App.tsx` around persisted conversation typing.
- Tauri command argument shape mismatches between `src/lib/tauri.ts` and Rust command signatures.
- Rust formatting differences after large command modules were added.
- Clippy warnings in SQLite persistence helpers.

Fix blocking jobs first: `Frontend build` and `Rust cargo check`. Treat `Rust fmt and clippy` as cleanup until it is made blocking.

## Notes

CI is the first reliable compilation signal for remote-only development. When a blocking run fails, treat the first failing step as the next development priority before adding new features.
