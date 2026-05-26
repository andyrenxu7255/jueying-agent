# @opencode-ai/enterprise

The OpenCode enterprise dashboard — a web application for enterprise account and organization management.

## Overview

This package provides the enterprise-facing web interface for managing OpenCode organizations, billing, team members, and workspace settings at scale.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/enterprise dev
```

## Build

```bash
bun run --cwd packages/enterprise build
```

## Key Directories

- `src/` — Frontend application source (UI components, styles, global types)
- `src/app.tsx` — Application entry point
- `src/app.css` — Global styles

## See Also

- Root `CONTRIBUTING.md` for full development setup
