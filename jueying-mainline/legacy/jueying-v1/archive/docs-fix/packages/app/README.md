# @opencode-ai/app

The shared web UI for OpenCode, built with SolidJS.

## Overview

This package contains the web interface components used by both the OpenCode desktop app and the web client. It provides the session management UI, message rendering, file browsing, and configuration panels.

## Development

From the repo root:

```bash
bun install
bun dev
```

To run the web app against a local backend:

```bash
bun run --cwd packages/app dev
```

This starts a local dev server at `http://localhost:5173`. The OpenCode server must be running for full functionality (see root CONTRIBUTING.md).

## E2E Testing

Playwright starts the Vite dev server automatically via `webServer`, and UI tests expect an opencode backend at `localhost:4096` by default.

```bash
bunx playwright install chromium
bun run test:e2e:local
bun run test:e2e:local -- --grep "settings"
```

Environment options:

- `PLAYWRIGHT_SERVER_HOST` / `PLAYWRIGHT_SERVER_PORT` (backend address, default: `localhost:4096`)
- `PLAYWRIGHT_PORT` (Vite dev server port, default: `3000`)
- `PLAYWRIGHT_BASE_URL` (override base URL, default: `http://localhost:<PLAYWRIGHT_PORT>`)

## Key Directories

- `src/components/` — Shared UI components
- `src/context/` — SolidJS context providers (command, file, layout, models, etc.)
- `src/pages/` — Page-level components (home, session, error)
- `src/i18n/` — Internationalization files
- `src/utils/` — Utility functions (diffs, persist, prompt, etc.)

## See Also

- Root `CONTRIBUTING.md` for full development setup
- `AGENTS.md` for package-specific coding guidelines
