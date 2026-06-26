# JueYing Agent Harness

This directory contains the full JueYing mainline program.

JueYing is an enterprise-grade Agent Harness for centralized management in small and mid-sized teams. The AI-native operating console is a built-in JueYing mainline module, not a separate product beside JueYing.

The historical v1 codebase remains inside this mainline directory under:

```text
legacy/jueying-v1/
```

It is the historical substrate and runtime compatibility layer for the current mainline. New work should treat `jueying-mainline/` as the working root and use the legacy tree only when a runtime service, schema, or implementation reference is needed. Content under `legacy/jueying-v1/archive/` is backup material and should not be used as a default planning source.

## Product Direction

JueYing is not a traditional project management tool and not only an Agent orchestration demo. It is a centralized enterprise Agent Harness for operating sales, delivery, governance, external facts, and human information collection.

Its core premise:

- Agent can be the operating subject for daily management.
- Human workers often contribute most by supplying missing real-world information, not by manually managing every step.
- Agent should tell humans what information is missing, why it matters, how to collect it, and how to submit evidence.
- With enough operating intent, constraints, and field information, Agent can push work forward more steadily than most human-managed loops.

## Active Docs

| Document | Purpose |
|---|---|
| [docs/DEV-23-AI原生运营系统总纲.md](./docs/DEV-23-AI原生运营系统总纲.md) | JueYing mainline philosophy, object model, agent roles, autonomy levels, and MVP loop. |
| [docs/DEV-24-JueYing应用差距复盘与整合界面路线.md](./docs/DEV-24-JueYing应用差距复盘与整合界面路线.md) | Gap review and integration/UI roadmap for making the operating console part of JueYing mainline. |
| [docs/DEV-25-用户故事线与验收旅程.md](./docs/DEV-25-用户故事线与验收旅程.md) | User journeys and acceptance baselines. |
| [docs/DEV-26-对象依赖与系统图谱.md](./docs/DEV-26-对象依赖与系统图谱.md) | Object dependencies, system graph, and state machines. |
| [docs/DEV-27-研发前决策清单与风险边界.md](./docs/DEV-27-研发前决策清单与风险边界.md) | Pre-development decision gates, risk boundaries, and non-goals. |
| [docs/DEV-28-场景故事库-销售与项目交付.md](./docs/DEV-28-场景故事库-销售与项目交付.md) | Detailed sales and project delivery stories, information gaps, evidence, UI actions, and acceptance gates. |
| [docs/DEV-29-能力覆盖矩阵与研发补洞清单.md](./docs/DEV-29-能力覆盖矩阵与研发补洞清单.md) | Scenario-to-capability coverage matrix and pre-development gap list. |
| [docs/DEV-30-销售六步法Gate驱动运营设计.md](./docs/DEV-30-销售六步法Gate驱动运营设计.md) | Authoritative sales six-step gate model and operating design. |
| [docs/DEV-31-TaskGraph与信息缺口最小契约.md](./docs/DEV-31-TaskGraph与信息缺口最小契约.md) | Minimum implementation contracts for TaskGraph, Information Gap, Evidence, SalesGateCheck, External Fact Mirror, Writeback Intent, Management Command Center, and Agent outputs. |
| [docs/DEV-32-CRM事实层对接与双向同步机制.md](./docs/DEV-32-CRM事实层对接与双向同步机制.md) | Generic CRM integration, record mirror, writeback intent, conflict handling, and CRM/Agent fact consistency. |
| [docs/DEV-33-项目管理事实层对接与双向同步机制.md](./docs/DEV-33-项目管理事实层对接与双向同步机制.md) | Generic project management integration for Jira, 禅道, TAPD, 飞书项目, self-built systems, record mirrors, and PM writeback intents. |
| [docs/DEV-34-文档图谱一致性审计与修复记录.md](./docs/DEV-34-文档图谱一致性审计与修复记录.md) | Audit record for story-line, dependency, graph, schema, and recall consistency before implementation. |
| [docs/DEV-35-核心代码实施路线与自检计划.md](./docs/DEV-35-核心代码实施路线与自检计划.md) | Executable contract implementation roadmap, delivered assets, validation commands, and next coding priorities. |
| [docs/DEV-36-JueYing主版本能力整合实施记录.md](./docs/DEV-36-JueYing主版本能力整合实施记录.md) | Implemented bridge between the JueYing mainline operating console and v1 runtime capabilities. |
| [docs/DEV-37-角色故事线逐步验收回归记录.md](./docs/DEV-37-角色故事线逐步验收回归记录.md) | Role-by-role, storyline-by-storyline, step-by-step executable acceptance regression record. |
| [docs/DEV-38-JueYing在线联调与模拟数据打通记录.md](./docs/DEV-38-JueYing在线联调与模拟数据打通记录.md) | Live Docker validation for JueYing workflow, org task, and fact runtime paths. |
| [docs/DEV-39-Rust主线重构规划与实施记录.md](./docs/DEV-39-Rust主线重构规划与实施记录.md) | Rust mainline refactor plan, module split, executable core implementation, and verification boundary. |
| [docs/context-graph.json](./docs/context-graph.json) | Machine-readable context graph. |
| [docs/context-routing.json](./docs/context-routing.json) | Machine-readable context routing. |
| [docs/scenario-coverage.json](./docs/scenario-coverage.json) | Machine-readable scenario coverage index. |
| [docs/role-storyline-acceptance.json](./docs/role-storyline-acceptance.json) | Machine-readable role storyline acceptance matrix consumed by tests, reports, APIs, and the JueYing console. |
| [docs/sales-six-step-gates.json](./docs/sales-six-step-gates.json) | Machine-readable sales six-step gates. |
| [fixtures/p1-demo/management-command-center.json](./fixtures/p1-demo/management-command-center.json) | P1 management command center fixture for executive command, automatic task decomposition, execution updates/results, scheduled tasks, condition triggers, Agent delegation, and project swimlanes. |
| [rust/README.md](./rust/README.md) | Independent Rust workspace entry point for the typed mainline core. |
| [rust/docs/architecture.md](./rust/docs/architecture.md) | Rust module architecture and migration graph. |
| [rust/graphs/rust-context-graph.json](./rust/graphs/rust-context-graph.json) | Machine-readable Rust refactor graph. |

Future development should start from the scenario library: cite at least one `SS-*`, `PD-*`, or `XS-*` story ID, then verify the corresponding capability domain before implementation. Sales work must also cite the six-step stage or Gate ID from DEV-30. Any work reading or writing CRM data must follow DEV-32; any work reading or writing external project management systems must follow DEV-33.

The role operation path test report is generated at `reports/role-operation-path-tests.json` by `npm run operation-paths:check`. It currently covers 46/46 operation paths and 671/671 assertions, materializing every role/storyline step from `docs/role-storyline-acceptance.json` into executable UI/API/contract/fixture/external-sync/legacy-bridge assertions. It also includes the executive management loop where a boss command is decomposed into executable tasks and worker progress/results are projected back into swimlanes.

## Executable Checks

Run from this directory:

```bash
npm run verify
```

This checks active docs, machine-readable graphs, sales Gate vocabulary, P1 fixtures, contract semantics, JueYing mainline integration adapters, application smoke tests, browser smoke tests, and core business red-line tests.

The default release gate also runs the independent Rust workspace through formatting, Clippy, workspace tests, and the Rust fixture verification CLI via `npm run verify:rust`.

`reports/live-legacy-bridge-smoke.json` is optional live runtime evidence from `npm run legacy:live-smoke`. It is intentionally not part of the default release gate because it requires the historical v1 services to be running.

The generated JSON Schema files live in `schemas/`; they are produced from `src/contracts/schema.mjs` by `npm run schemas:export`.

## Local App

Run the JueYing operating console:

```bash
npm run app:start
```

Then open:

```text
http://localhost:4173
```

The app serves Operating Console, Management Command Center, Sales Gate, TaskGraph, Information Gap, External Sync, JueYing Mainline Capability, Storyline Acceptance, and Contract Health views from the executable contracts, P1 fixtures, and mainline integration adapter.

Primary JueYing mainline APIs:

```text
/api/state
/api/management/command-center
/api/management/dispatch-preview
/api/management/commands
/api/evidence
/api/information-gaps/:id/reply
/api/writebacks/:id/:action
/api/external-connections/drafts
/api/sales/gates
/api/storylines
/api/operation-paths
/api/jueying/mainline/capabilities
/api/jueying/mainline/bridge-preview
/api/jueying/mainline/runtime-health
```

The older `/api/legacy/*` paths remain as compatibility aliases during migration; new documentation and UI work should prefer `/api/jueying/mainline/*`.

## Directory Layout

```text
jueying-mainline/
├── apps/       # JueYing operating console
├── docs/       # Product docs, graphs, routing, scenario coverage
├── fixtures/   # P1 simulation data
├── legacy/     # Historical JueYing v1 runtime compatibility layer
├── reports/    # Generated validation and live bridge reports
├── rust/       # Independent Rust mainline core refactor
├── schemas/    # Generated JSON Schema files
├── scripts/    # Validation, smoke, bridge, and report scripts
├── src/        # Contracts and JueYing mainline adapters
└── tests/      # Contract and storyline tests
```

If the v1 runtime needs to run directly, enter:

```text
legacy/jueying-v1/agent-harness/
```

The historical root documents may contain old relative links. They are preserved for reference; this restructure does not attempt to repair every archived cross-link. Backup and archive material should stay outside the active docs index unless a task explicitly needs historical comparison.
