# JueYing Rust Mainline

This directory is an independent Rust implementation of the executable JueYing mainline core. It does not replace the current JS/MJS app yet; it provides a typed, testable migration path for the contract engine, TaskGraph semantics, sales Gate checks, writeback policy, view-model projections, and legacy v1 bridge payloads.

See [architecture and failure boundaries](docs/architecture.md) and the [machine-readable dependency graph](graphs/rust-context-graph.json). These describe the implemented offline core separately from planned runtime services.

## Scope

- Preserve the active mainline boundary from `jueying-mainline/`.
- Keep `legacy/jueying-v1/agent-harness/` as an adapter target, not a domain model source.
- Model current executable contract enums first; future-state diagrams remain documented migration targets.
- Validate the existing P1 fixtures from `../fixtures/p1-demo`.
- Produce stable reports for Rust verification and JS/Rust compatibility review.

## Commands

Prerequisite: install a Rust toolchain that provides `cargo` and `rustc` and satisfies the workspace `rust-version`.

```bash
cd rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p jueying-cli -- verify --root ..
```

The CLI reads the existing mainline fixtures and documentation assets from the JS workspace root.

`cargo run -p jueying-cli -- verify --root .. --json` emits the detailed report. A successful fixture verification is not proof of live connector or legacy runtime behavior.
Invalid fixture roots also return a JSON error with a nonzero exit status in `--json` mode. The bridge preview fails closed on invalid contract inputs, broken or cross-task references, duplicate IDs, or ambiguous/permissive writeback decisions; low-level projection helpers are not dispatch authorization APIs. The online legacy smoke checks this preview before making any request.

From the repository mainline root, `npm run verify` also invokes these Rust checks through `npm run verify:rust`, so Rust is part of the default release gate rather than a sidecar-only validation path.
