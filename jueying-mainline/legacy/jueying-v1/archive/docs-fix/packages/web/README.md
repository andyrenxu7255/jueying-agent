# @opencode-ai/web

The OpenCode marketing and documentation website, built with [Astro](https://astro.build/) and [Starlight](https://starlight.astro.build/).

## Overview

This package serves the public-facing OpenCode website at [opencode.ai](https://opencode.ai), including the landing page, documentation, and blog content. Documentation pages are written in MDX and live under `src/content/docs/`.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/web dev
```

## Key Directories

- `src/pages/` — Astro page routes (landing, download, pricing, etc.)
- `src/content/docs/` — Documentation MDX files (ACP, CLI, Go, IDE, LSP, SDK)
- `src/components/` — Shared UI components
- `src/assets/` — Static assets (images, screenshots)
- `src/styles/` — Global styles and Tailwind configuration
- `astro.config.mjs` — Astro and Starlight configuration

## Adding Documentation

1. Create a new `.mdx` file in `src/content/docs/`.
2. Add a sidebar entry in `astro.config.mjs` under the `sidebar` configuration.
3. The Starlight dev server will hot-reload automatically.

## See Also

- `packages/docs/` — Mintlify-based documentation (alternative docs site)
- Root `CONTRIBUTING.md` for full development setup
