# CI containers

Prebuilt images intended to speed up GitHub Actions jobs by baking in
large, slow-to-install dependencies. These are designed for Linux jobs
that can use `job.container` in workflows.

## Images

- `base`: Ubuntu 24.04 with common build tools and utilities
- `rust`: `base` plus Bun, Node.js, and Rust (stable, minimal profile)

> Additional images (e.g. `bun-node`, `tauri-linux`, `publish`) may be
> defined in the build script. Run the build command with `--list` to see
> all available targets.

## Build

```
REGISTRY=ghcr.io/anomalyco TAG=24.04 bun ./packages/containers/script/build.ts
REGISTRY=ghcr.io/anomalyco TAG=24.04 bun ./packages/containers/script/build.ts --push
```

## Workflow usage

```yaml
jobs:
  build-cli:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/anomalyco/build/bun-node:24.04
```

## Notes

- These images only help Linux jobs. macOS and Windows jobs cannot run
  inside Linux containers.
- `--push` publishes multi-arch (amd64 + arm64) images using Buildx.
- If a job uses Docker Buildx, the container needs access to the host
  Docker daemon (or `docker-in-docker` with privileged mode).
