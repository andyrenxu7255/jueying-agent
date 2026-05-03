# OpenCode Desktop (Electron)

Native OpenCode desktop app, built with Electron.

## Prerequisites

Running the desktop app requires Electron dependencies. See the [Electron documentation](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites) for setup instructions.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop-electron dev
```

## Build

```bash
bun run --cwd packages/desktop-electron build
```

## See Also

- `AGENTS.md` for package-specific coding guidelines
- Root `CONTRIBUTING.md` for full development setup
