# Project API Specification

The OpenCode server exposes a REST API over HTTP. The API is split into global routes (no instance context) and instance-scoped routes (require a directory/workspace context via `x-opencode-directory` header or `directory` query param).

### Global routes

```
GET  /health                          -> { healthy: true, version: string }
GET  /event                           -> SSE stream of global events
GET  /config                          -> Config
PATCH /config                         -> Config
POST /dispose                         -> boolean
POST /upgrade                         -> boolean
```

### Control plane routes

```
PUT    /auth/:providerID              -> boolean
DELETE /auth/:providerID              -> boolean
POST   /log                          -> boolean
```

### Workspace routes (control plane)

```
GET    /experimental/workspace/adaptor  -> Adaptor[]
POST   /experimental/workspace          -> Workspace
GET    /experimental/workspace          -> Workspace[]
GET    /experimental/workspace/status   -> WorkspaceStatus
DELETE /experimental/workspace/:id      -> boolean
POST   /experimental/workspace/:id/session-restore -> Session
```

### Instance routes

Instance-scoped routes require a running instance context.

#### Session

```
GET    /session                         -> Session[]
GET    /session/status                  -> SessionStatus[]
GET    /session/:sessionID              -> Session
GET    /session/:sessionID/children     -> Session[]
GET    /session/:sessionID/todo         -> Todo[]
POST   /session                         -> Session
DELETE /session/:sessionID              -> boolean
PATCH  /session/:sessionID              -> Session
POST   /session/:sessionID/init         -> boolean
POST   /session/:sessionID/fork         -> Session
POST   /session/:sessionID/abort        -> boolean
POST   /session/:sessionID/share        -> Session
DELETE /session/:sessionID/share        -> Session
POST   /session/:sessionID/summarize    -> boolean
GET    /session/:sessionID/diff         -> FileDiff[]
GET    /session/:sessionID/message      -> { info: Message, parts: Part[] }[]
GET    /session/:sessionID/message/:messageID -> { info: Message, parts: Part[] }
DELETE /session/:sessionID/message/:messageID -> boolean
DELETE /session/:sessionID/message/:messageID/part/:partID -> boolean
PATCH  /session/:sessionID/message/:messageID/part/:partID -> Part
POST   /session/:sessionID/message      -> { info: Message, parts: Part[] }
POST   /session/:sessionID/prompt_async -> { info: Message, parts: Part[] }
POST   /session/:sessionID/command      -> { info: Message, parts: Part[] }
POST   /session/:sessionID/shell        -> { info: Message, parts: Part[] }
POST   /session/:sessionID/revert       -> Session
POST   /session/:sessionID/unrevert     -> Session
POST   /session/:sessionID/permissions/:permissionID -> boolean
```

> **Deprecated:** `POST /session/:sessionID/permissions/:permissionID` is deprecated. Use the `POST /permission/:requestID/reply` endpoint under the Permission section instead.

#### Question

```
GET  /question                         -> Question[]
POST /question/:requestID/reply        -> boolean
POST /question/:requestID/reject       -> boolean
```

#### Permission

```
GET  /permission                       -> Permission[]
POST /permission/:requestID/reply      -> boolean
```

#### Provider

```
GET  /provider                         -> Provider[]
GET  /provider/auth                    -> ProviderAuth[]
POST /provider/:providerID/oauth/authorize -> boolean
POST /provider/:providerID/oauth/callback  -> boolean
```

#### Config

```
GET    /config                         -> Config
PATCH  /config                         -> Config
GET    /config/providers               -> { providers: Provider[], default: Record<string, string> }
```

#### Project

```
GET    /project                        -> Project[]
GET    /project/current                -> Project
POST   /project/git/init               -> boolean
PATCH  /project/:projectID             -> Project
```

#### File and search

```
GET /find                              -> TextSearchResult[]
GET /find/file                         -> string[]
GET /find/symbol                       -> Symbol[]
GET /file                              -> File[]
GET /file/content                      -> { type: "raw" | "patch", content: string }
GET /file/status                       -> File[]
```

#### Event

```
GET /event                             -> SSE stream of instance events
```

#### MCP

```
GET    /mcp                            -> MCPStatus[]
POST   /mcp                            -> boolean
POST   /mcp/:name/auth                 -> boolean
POST   /mcp/:name/auth/callback        -> boolean
POST   /mcp/:name/auth/authenticate    -> boolean
DELETE /mcp/:name/auth                 -> boolean
POST   /mcp/:name/connect              -> boolean
POST   /mcp/:name/disconnect           -> boolean
```

#### PTY

```
GET    /pty                            -> PTY[]
POST   /pty                            -> PTY
GET    /pty/:ptyID                     -> PTY
PUT    /pty/:ptyID                     -> PTY
DELETE /pty/:ptyID                     -> boolean
GET    /pty/:ptyID/connect             -> WebSocket
```

#### TUI

```
GET  /tui/control/next                 -> TUIRequest
POST /tui/control/response             -> boolean
POST /tui/append-prompt                -> boolean
POST /tui/open-help                    -> boolean
POST /tui/open-sessions                -> boolean
POST /tui/open-themes                  -> boolean
POST /tui/open-models                  -> boolean
POST /tui/submit-prompt                -> boolean
POST /tui/clear-prompt                 -> boolean
POST /tui/execute-command              -> boolean
POST /tui/show-toast                   -> boolean
POST /tui/publish                      -> boolean
POST /tui/select-session               -> boolean
```

#### Sync

```
POST /sync/start                       -> boolean
POST /sync/replay                      -> boolean
POST /sync/history                     -> SyncEvent[]
```

#### Instance-level

```
POST /instance/dispose                  -> boolean
GET  /path                             -> Path
GET  /vcs                              -> VCS
GET  /vcs/diff                         -> Diff[]
GET  /command                          -> Command[]
GET  /agent                            -> Agent[]
GET  /skill                            -> Skill[]
GET  /lsp                              -> LSPStatus
GET  /formatter                        -> FormatterStatus
```

#### Experimental

```
GET  /experimental/console             -> ConsoleInfo
GET  /experimental/console/orgs        -> Org[]
POST /experimental/console/switch      -> boolean
GET  /experimental/tool/ids            -> string[]
GET  /experimental/tool                -> Tool[]
POST /experimental/worktree            -> Worktree
GET  /experimental/worktree            -> Worktree[]
DELETE /experimental/worktree          -> boolean
POST /experimental/worktree/reset      -> boolean
GET  /experimental/session             -> Session[]
GET  /experimental/resource            -> Resource[]
```

### Experimental HttpApi routes

These routes are gated behind `OPENCODE_EXPERIMENTAL_HTTPAPI` and provide the same functionality using Effect HttpApi instead of Hono. See `specs/effect/http-api.md` for details.
