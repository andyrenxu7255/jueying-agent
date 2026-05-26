# Copilot Provider SDK

This directory contains the Copilot provider SDK integration for OpenCode.

## Overview

The Copilot provider enables OpenCode to use GitHub Copilot as an AI model provider. This SDK handles the authentication flow and API communication with GitHub's Copilot service.

## Key Files

- **`api.ts`** — Copilot API client and request handling
- **`auth.ts`** — GitHub device-flow authentication for Copilot tokens
- **`models.ts`** — Available Copilot model definitions

## Important Notes

- Changes to these files affect only the Copilot provider. Other providers (OpenAI, Anthropic, Google, etc.) are unaffected.
- The authentication flow uses GitHub's device code grant, which requires user interaction in a browser.
- Copilot models are subject to GitHub's rate limits and terms of service.

## See Also

- `packages/opencode/src/provider/` — Parent provider directory with shared types and registry
- `packages/opencode/AGENTS.md` — Coding conventions for this package
