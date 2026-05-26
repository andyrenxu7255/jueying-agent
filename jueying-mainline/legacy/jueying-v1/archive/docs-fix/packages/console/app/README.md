# @opencode-ai/console

The OpenCode console — a web dashboard for managing OpenCode workspaces, billing, and account settings.

## Overview

This package provides the user-facing web console for OpenCode. It allows users to manage their accounts, view billing information, configure workspaces, and administer OpenCode Go subscriptions.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/console/app dev
```

## Key Directories

- `app/src/` — Frontend application (SolidStart)
  - `app/src/i18n/` — Internationalization files for the console UI
  - `app/src/app.tsx` — Application entry point
  - `app/src/config.ts` — Console configuration
- `core/src/` — Shared business logic (account, billing, user management)
  - `core/src/account.ts` — Account management
  - `core/src/billing.ts` — Billing and subscription logic
  - `core/src/user.ts` — User management
  - `core/src/actor.ts` — Actor context and authentication
- `function/src/` — Serverless functions (auth)
- `resource/` — Infrastructure resources (SST)

## See Also

- Root `CONTRIBUTING.md` for full development setup
