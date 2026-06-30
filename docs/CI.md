# CI

The repository uses GitHub Actions workflow `.github/workflows/ci.yml`.

## Triggers

CI runs on:

- pushes to `main`
- pull requests targeting `main`
- manual `workflow_dispatch`

Concurrent runs for the same ref are cancelled so only the latest run keeps executing.

## Frontend build

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

This keeps quality feedback visible without hiding the primary compile signal while the codebase is still being actively bootstrapped. Once the historical Rust files are rustfmt-clean and clippy-clean, this job can be made blocking.

Cargo dependency caching is enabled with `Swatinem/rust-cache` for the `src-tauri` workspace in both Rust jobs.

## Notes

CI is the first reliable compilation signal for remote-only development. When a blocking run fails, treat the first failing step as the next development priority before adding new features.
