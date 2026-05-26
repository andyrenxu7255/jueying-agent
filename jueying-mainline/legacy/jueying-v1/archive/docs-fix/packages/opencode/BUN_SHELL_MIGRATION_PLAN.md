# Bun shell migration plan

> **Status:** In progress. Phase 0 core wrappers are implemented. Remaining phases are pending.
> **Last reviewed:** 2026-04-20

Practical phased replacement of Bun `$` calls.

## Goal

Replace runtime Bun shell template-tag usage in `packages/opencode/src` with a unified `Process` API in `util/process.ts`.

Keep behavior stable while improving safety, testability, and observability.

Current baseline from audit:

- 143 runtime command invocations across 17 files
- 84 are git commands
- Largest hotspots:
  - `src/cli/cmd/github.ts` (33)
  - `src/worktree/index.ts` (22)
  - `src/lsp/server.ts` (21)
  - `src/installation/index.ts` (20)
  - `src/snapshot/index.ts` (18)

## Decisions

- Extend `src/util/process.ts` (do not create a separate exec module).
- Proceed with phased migration for both git and non-git paths.
- Keep plugin `$` compatibility in 1.x and remove in 2.0.

## Non-goals

- Do not remove plugin `$` compatibility in this effort.
- Do not redesign command semantics beyond what is needed to preserve behavior.

## Constraints

- Keep migration phased, not big-bang.
- Minimize behavioral drift.
- Keep these explicit shell-only exceptions:
  - `src/session/prompt.ts` raw command execution
  - worktree start scripts in `src/worktree/index.ts`

## Process API (`src/util/process.ts`)

Add higher-level wrappers on top of current spawn support.

### Implementation status

| Method | Status | Notes |
|--------|--------|-------|
| `Process.run(cmd, opts)` | ✅ Implemented | Full spawn with result |
| `Process.text(cmd, opts)` | ✅ Implemented | Returns trimmed stdout text |
| `Process.lines(cmd, opts)` | ✅ Implemented | Returns stdout split by newlines |
| `Process.status(cmd, opts)` | ⬜ Not implemented | Planned for Phase 0 |
| `Process.shell(command, opts)` | ⬜ Not implemented | For intentional shell execution |
| `Process.git(args, opts)` | ⬜ Not implemented | Planned for Phase 2 |
| `Process.gitText(args, opts)` | ⬜ Not implemented | Planned for Phase 2 |

### Shared options

| Option | Status | Actual name | Notes |
|--------|--------|-------------|-------|
| `cwd` | ✅ Implemented | `cwd` | Working directory |
| `env` | ✅ Implemented | `env` | Environment variables |
| `stdin` | ✅ Implemented | `stdin` | Standard input |
| `stdout` | ✅ Implemented | `stdout` | Standard output |
| `stderr` | ✅ Implemented | `stderr` | Standard error |
| `abort` | ✅ Implemented | `abort` | AbortSignal |
| `timeout` | ✅ Implemented | `timeout` | Timeout in ms |
| `kill` | ✅ Implemented | `kill` | Kill signal |
| `allowFailure` | ✅ Implemented | `nothrow` | Non-throw mode (name differs from proposal) |
| `shell` | ✅ Implemented | `shell` | Shell execution mode (not in original proposal) |
| redaction + trace | ⬜ Not implemented | - | Planned |

### Result shape

| Field | Status | Notes |
|-------|--------|-------|
| `code` | ✅ Implemented | Exit code |
| `stdout` | ✅ Implemented | Buffer type |
| `stderr` | ✅ Implemented | Buffer type |
| `duration_ms` | ⬜ Not implemented | Planned |
| `cmd` | ⬜ Not implemented | Only in RunFailedError |
| `text()` helper | ✅ Implemented | On TextResult |
| `arrayBuffer()` helper | ⬜ Not implemented | Planned |

## Phased rollout

### Phase 0: Foundation

- [x] Implement core Process wrappers in `src/util/process.ts` (`run`, `text`, `lines`)
- [ ] Implement `Process.status`, `Process.shell`
- [ ] Refactor `src/util/git.ts` to use Process only.
- [ ] Add tests for exit handling, timeout, abort, and output capture.

### Phase 1: High-impact hotspots

Migrate these first:

- `src/cli/cmd/github.ts`
- `src/worktree/index.ts`
- `src/lsp/server.ts`
- `src/installation/index.ts`
- `src/snapshot/index.ts`

Within each file, migrate git paths first where applicable.

### Phase 2: Remaining git-heavy files

Migrate git-centric call sites to `Process.git*` helpers:

- `src/file/index.ts`
- `src/project/vcs.ts`
- `src/file/watcher.ts`
- `src/storage/storage.ts`
- `src/cli/cmd/pr.ts`

### Phase 3: Remaining non-git files

Migrate residual non-git usages:

- `src/cli/cmd/tui/util/clipboard.ts`
- `src/util/archive.ts`
- `src/file/ripgrep.ts`
- `src/tool/bash.ts`
- `src/cli/cmd/uninstall.ts`

### Phase 4: Stabilize

- Remove dead wrappers and one-off patterns.
- Keep plugin `$` compatibility isolated and documented as temporary.
- Create linked 2.0 task for plugin `$` removal.

## Validation strategy

- Unit tests for new `Process` methods and options.
- Integration tests on hotspot modules.
- Smoke tests for install, snapshot, worktree, and GitHub flows.
- Regression checks for output parsing behavior.

## Risk mitigation

- File-by-file PRs with small diffs.
- Preserve behavior first, simplify second.
- Keep shell-only exceptions explicit and documented.
- Add consistent error shaping and logging at Process layer.

## Definition of done

- Runtime Bun `$` usage in `packages/opencode/src` is removed except:
  - approved shell-only exceptions
  - temporary plugin compatibility path (1.x)
- Git paths use `Process.git*` consistently.
- CI and targeted smoke tests pass.
- 2.0 issue exists for plugin `$` removal.
