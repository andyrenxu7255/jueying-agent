# JueYing Mainline Docs

This directory is the active product and R&D workspace for JueYing mainline.

JueYing is an enterprise-grade Agent Harness for centralized management in small and mid-sized teams. The AI-native operating console and object model are now part of JueYing mainline, not a separate application beside it.

## Current Documents

| Document | Purpose |
|---|---|
| [DEV-23-AI原生运营系统总纲.md](./DEV-23-AI原生运营系统总纲.md) | JueYing mainline philosophy, object model, agent roles, autonomy levels, and MVP operating loop. |
| [DEV-24-JueYing应用差距复盘与整合界面路线.md](./DEV-24-JueYing应用差距复盘与整合界面路线.md) | Gap review and integration/UI roadmap for making the operating console part of JueYing mainline. |
| [DEV-25-用户故事线与验收旅程.md](./DEV-25-用户故事线与验收旅程.md) | End-to-end user journeys and acceptance baselines before implementation. |
| [DEV-26-对象依赖与系统图谱.md](./DEV-26-对象依赖与系统图谱.md) | Object dependencies, system layers, state machines, and mainline integration graph. |
| [DEV-27-研发前决策清单与风险边界.md](./DEV-27-研发前决策清单与风险边界.md) | Pre-development decisions, risk boundaries, non-goals, and test gates. |
| [DEV-28-场景故事库-销售与项目交付.md](./DEV-28-场景故事库-销售与项目交付.md) | Detailed sales and delivery scenario story library, including information gaps, evidence, UI actions, and acceptance gates. |
| [DEV-29-能力覆盖矩阵与研发补洞清单.md](./DEV-29-能力覆盖矩阵与研发补洞清单.md) | Capability coverage matrix that maps scenarios to system objects, Agent contracts, UI surfaces, and implementation gaps. |
| [DEV-30-销售六步法Gate驱动运营设计.md](./DEV-30-销售六步法Gate驱动运营设计.md) | Authoritative sales six-step gate model for Discover, Scope, Go/No-Go, Validate Solution, Business Case, and Negotiate Close. |
| [DEV-31-TaskGraph与信息缺口最小契约.md](./DEV-31-TaskGraph与信息缺口最小契约.md) | Minimal contracts for TaskGraph, Information Gap, Evidence, SalesGateCheck, External Fact Mirror, Writeback Intent, Management Command Center, and Agent outputs before implementation. |
| [DEV-32-CRM事实层对接与双向同步机制.md](./DEV-32-CRM事实层对接与双向同步机制.md) | Generic CRM integration, record mirror, writeback intent, conflict handling, and CRM/Agent fact consistency. |
| [DEV-33-项目管理事实层对接与双向同步机制.md](./DEV-33-项目管理事实层对接与双向同步机制.md) | Generic project management integration, record mirror, writeback intent, conflict handling, and PM/Agent fact consistency for Jira, 禅道, TAPD, 飞书项目, and self-built systems. |
| [DEV-34-文档图谱一致性审计与修复记录.md](./DEV-34-文档图谱一致性审计与修复记录.md) | Audit record for story-line, dependency, graph, schema, and recall consistency before implementation. |
| [DEV-35-核心代码实施路线与自检计划.md](./DEV-35-核心代码实施路线与自检计划.md) | Executable contract implementation roadmap, delivered assets, validation commands, and next coding priorities. |
| [DEV-36-JueYing主版本能力整合实施记录.md](./DEV-36-JueYing主版本能力整合实施记录.md) | Implemented bridge between the JueYing mainline operating console and v1 runtime capabilities. |
| [DEV-37-角色故事线逐步验收回归记录.md](./DEV-37-角色故事线逐步验收回归记录.md) | Role-by-role, storyline-by-storyline, step-by-step executable acceptance regression record. |
| [DEV-38-JueYing在线联调与模拟数据打通记录.md](./DEV-38-JueYing在线联调与模拟数据打通记录.md) | Live Docker-based bridge smoke record proving JueYing mainline can create workflow, org task, and fact records with simulated data. |
| [DEV-39-Rust主线重构规划与实施记录.md](./DEV-39-Rust主线重构规划与实施记录.md) | Rust mainline refactor plan, module split, executable core implementation, and verification boundary. |
| [context-graph.json](./context-graph.json) | Machine-readable context graph for future agent recall. |
| [context-routing.json](./context-routing.json) | Machine-readable routing rules for future planning and implementation tasks. |
| [scenario-coverage.json](./scenario-coverage.json) | Machine-readable scenario and capability coverage index for sales and delivery implementation. |
| [role-storyline-acceptance.json](./role-storyline-acceptance.json) | Machine-readable role storyline acceptance matrix consumed by tests, reports, APIs, and the JueYing console. |
| [sales-six-step-gates.json](./sales-six-step-gates.json) | Machine-readable sales six-step gates, recommended activities, evidence types, and P1 exit gates. |
| [../fixtures/p1-demo/management-command-center.json](../fixtures/p1-demo/management-command-center.json) | P1 management command center fixture for executive command, automatic task decomposition, execution updates/results, scheduled tasks, condition triggers, Agent delegation, and project swimlanes. |
| [../rust/README.md](../rust/README.md) | Independent Rust workspace entry point for the typed mainline core. |
| [../rust/docs/architecture.md](../rust/docs/architecture.md) | Rust module architecture and migration graph. |
| [../rust/graphs/rust-context-graph.json](../rust/graphs/rust-context-graph.json) | Machine-readable Rust refactor graph. |

Generated operation-path evidence lives in `reports/role-operation-path-tests.json`. It is built by `npm run operation-paths:check` from `role-storyline-acceptance.json`; the latest report covers 46/46 operation paths and 671/671 assertions, so every role/storyline step becomes an executable UI/API/contract/fixture/external-sync/legacy-bridge test case. The management command center fixture lives at `fixtures/p1-demo/management-command-center.json` and proves the boss-to-Agent-to-agent-to-subordinate command chain, scheduled commands, condition triggers, automatic task decomposition, execution progress/results, and swimlane projection.

## Recommended Reading Order

1. DEV-23 for philosophy and core vocabulary.
2. DEV-25 for user journeys.
3. DEV-30 for the authoritative sales six-step gate model.
4. DEV-28 for detailed sales and delivery scenario stories.
5. DEV-29 for capability coverage and implementation gap checks.
6. DEV-31 for minimum data and Agent output contracts.
7. DEV-32 for CRM fact synchronization and writeback design.
8. DEV-33 for project management fact synchronization and writeback design.
9. DEV-34 for the latest documentation, graph, dependency, and recall audit record.
10. DEV-35 for executable contract assets and coding priorities.
11. DEV-36 for the current JueYing mainline integration implementation.
12. DEV-37 for role storyline acceptance regression.
13. DEV-38 for live Docker-based JueYing runtime integration validation.
14. DEV-39 for the Rust typed-core refactor and migration boundary.
15. DEV-26 for object graph and system dependencies.
16. DEV-27 for decision gates and risk boundaries.
17. DEV-24 for how the historical JueYing v1 substrate maps into the mainline.

## Executable Checks

From `jueying-mainline/`:

```bash
npm run verify
```

This validates docs, graph references, sales Gate vocabulary, P1 fixtures, contract semantics, management command center behavior, JueYing mainline integration, and core business red-line tests.

## Development Rule

Future product or implementation work should cite at least one `SS-*`, `PD-*`, or `XS-*` story ID from DEV-28, then verify the required capability domain in DEV-29. Sales work must also cite the relevant six-step stage or Gate ID from DEV-30, such as `D-G1`, `S-G5`, or `N-G4`. Any work reading or writing CRM data must follow DEV-32. Any work reading or writing external project management systems must follow DEV-33.

## Historical Reference

The previous JueYing v1 system has been moved under:

```text
legacy/jueying-v1/
```

Use `legacy/jueying-v1/agent-harness/` as runtime compatibility and implementation reference. Content under `legacy/jueying-v1/archive/` is backup material for historical comparison and should not be part of default planning or graph recall. New product decisions should start from the documents in this directory.
