# @opencode-ai/desktop-electron

This package contains the Electron-based desktop application for OpenCode.

## Stack

- **Electron** for native desktop shell
- **TypeScript** throughout main, renderer, and preload scripts
- **Bun** for package management and scripts

## Conventions

- Follow the root `AGENTS.md` for general coding guidelines.
- Prefer the shared `@opencode-ai/opencode` package for core logic rather than duplicating it here.
- Keep Electron-specific code isolated to this package; do not import Electron APIs from other packages.
