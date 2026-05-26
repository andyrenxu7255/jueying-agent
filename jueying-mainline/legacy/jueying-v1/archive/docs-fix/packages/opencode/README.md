# @opencode-ai/opencode

The core package of OpenCode — an AI-powered coding assistant that runs in your terminal.

## Overview

This package contains the main server, CLI, TUI (terminal user interface), session management, provider integrations, and tool execution engine for OpenCode.

## Key modules

- **`src/server/`** — HTTP server with REST API (Hono) and experimental Effect HttpApi routes
- **`src/cli/`** — Command-line interface and TUI entry point
- **`src/session/`** — Session management, prompt handling, LLM interaction, message processing, and compaction
- **`src/provider/`** — AI provider integrations (OpenAI, Anthropic, Google, etc.) and model management
- **`src/tool/`** — Tool definitions and execution (file edit, bash, search, glob, grep, etc.)
- **`src/config/`** — Configuration loading, validation, and schema definitions
- **`src/effect/`** — Shared Effect runtime, layers, instance state management, and app runtime
- **`src/mcp/`** — Model Context Protocol server management and authentication
- **`src/lsp/`** — Language Server Protocol integration for diagnostics and code intelligence
- **`src/acp/`** — Agent Client Protocol server for editor integration
- **`src/storage/`** — Database schema and persistence layer (Drizzle/SQLite)
- **`src/sync/`** — Event sourcing and sync system for multi-device session replay
- **`src/bus/`** — Event bus for inter-service communication
- **`src/pty/`** — Pseudo-terminal management for interactive shell sessions
- **`src/file/`** — File operations, watching, and search (ripgrep integration)
- **`src/skill/`** — Skill discovery and management system
- **`src/plugin/`** — Plugin metadata and loading

## Development

See the root `CONTRIBUTING.md` for development setup and contribution guidelines.

See `AGENTS.md` for coding conventions and Effect patterns used in this package.
