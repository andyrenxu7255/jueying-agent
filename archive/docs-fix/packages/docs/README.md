# @opencode-ai/docs

The OpenCode documentation website, built with [Mintlify](https://mintlify.com/).

## Overview

This package contains the source for the OpenCode docs site hosted at [opencode.ai/docs](https://opencode.ai/docs). It uses Mintlify's documentation framework with MDX support.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/docs dev
```

This starts a local Mintlify dev server with hot-reload.

## Key Files

- `docs.json` — Mintlify configuration (navigation, colors, branding)
- `index.mdx` — Documentation landing page
- `quickstart.mdx` — Getting started guide
- `development.mdx` — Contributing and development setup

## Adding New Pages

1. Create a new `.mdx` file in the package root.
2. Add a navigation entry in `docs.json` under the appropriate `group`.
3. Restart the dev server to pick up navigation changes.

## See Also

- `packages/web/src/content/docs/` — Additional documentation content served by the main website (Astro/Starlight)
- Root `CONTRIBUTING.md` for full development setup
