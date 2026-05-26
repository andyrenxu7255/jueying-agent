# @opencode-ai/slack

A Slack bot that integrates OpenCode into your Slack workspace, allowing team members to interact with OpenCode directly from Slack channels.

## Overview

This package provides a Slack application (bot) that connects to the OpenCode server, enabling users to send prompts, receive responses, and manage sessions through Slack messages and commands.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/slack dev
```

## Key Directories

- `src/` — Bot source code
  - `src/app.ts` — Slack app initialization and event handlers
  - `src/handlers/` — Message and interaction handlers

## Configuration

The Slack bot requires the following environment variables:

- `SLACK_BOT_TOKEN` — Bot User OAuth Token (starts with `xoxb-`)
- `SLACK_SIGNING_SECRET` — Signing secret from the Slack app configuration
- `OPENCODE_SERVER_URL` — URL of the OpenCode server instance

## See Also

- Root `CONTRIBUTING.md` for full development setup
- [Slack API Documentation](https://api.slack.com/)
