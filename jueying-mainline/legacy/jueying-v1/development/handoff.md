# Handoff

Date: 2026-05-02
Scope: UX-audit-driven fixes across M1/M2/M3 and app graph sync

## Completed

### Graph updates

- Updated `development/app-graph/hotpaths.json`
- Updated `development/app-graph/edge-confidence.json`
- Updated `development/app-graph/diagnostic-queries.md`
- Updated `development/app-graph/incident-response-mapping.json`
- Updated `development/app-graph/graph-changelog.md` (v1.7 entry)

### M1 (ingress / acceptance / progress / memory)

File: `agent-harness/apps/gateway-adapter/src/index.ts`

- Added hard checks for workflow `plan.ok` and `dispatch.ok`
- Replaced false-positive acceptance reply with actionable failure text
- Changed memory recall return shape to include degradation signal
- Added user-visible degradation prefix when recall is unavailable
- Added warning logs for memory persist non-2xx/failures
- Added in-progress notifications (state-change based, capped)

### M2 (retrieval quality visibility / admin observability)

Files:
- `agent-harness/services/executor-gateway/src/executor/retrieval-aware-executor.ts`
- `agent-harness/apps/web-portal/src/index.ts`

- Retrieval failure now returns detailed reason (`retrieval_query_http_<status>` or degradation reason)
- Fixed admin retrieval trace query to project item count from `result_summary->>'item_count'`

### M3 (callback reliability / completion guard)

Files:
- `agent-harness/services/executor-gateway/src/index.ts`
- `agent-harness/services/workflow/src/index.ts`

- Added `postWorkflowWithRetry` for stage callback and completion callback
- Added completion guard: reject `/complete` with 409 when unresolved stages remain
- Added audit event `workflow.complete.rejected` for rejected completion attempts

### Hermes endpoint consistency

File: `agent-harness/services/hermes-adapter/src/index.ts`

- Fixed endpoint from `/internal/facts` to `/internal/facts/write`
- Added warning log when fact-retrieval returns non-2xx

## Validation

### Passed

- `npm run type-check --workspace @agent-harness/executor-gateway`
- `npm run type-check --workspace @agent-harness/workflow-service`
- `npm run type-check --workspace @agent-harness/hermes-adapter`

### Known pre-existing environment issues

- `@agent-harness/gateway-adapter` type-check still fails on missing `officeparser` typings
- Full workspace type-check still contains pre-existing missing `redis` typings in other packages

## Regression checklist to run next

- `RC-001-gateway-ingress`
- `RC-005-memory-continuity`
- `RC-003-executor-callback`
- `RC-002-workflow-core`
- `RC-004-retrieval-data-layer`

## Related detailed handoff

- `development/DEV-16-UX审计修复交接.md`
