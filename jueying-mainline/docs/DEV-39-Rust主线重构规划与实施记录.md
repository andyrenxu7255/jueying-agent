# DEV-39 Rust 主线重构规划与实施记录

> 状态：Rust 首版重构落地记录
> 日期：2026-06-01
> 依赖：DEV-23 至 DEV-38、`src/contracts/*`、`src/integrations/jueying-v1/*`

## 1. 结论

Rust 重构的对象不是历史 v1 monorepo，也不是把 Ops Console 前端整体改写。首版 Rust 版本独立放在 `rust/`，目标是把主线中最稳定、最容易漂移、最需要强类型保护的可执行内核先迁出：

- Contract model and validation。
- TaskGraph DAG semantics。
- Sales six-step Gate engine。
- External writeback policy。
- Management Command Center validation and view-model projection。
- JueYing v1 legacy bridge payload projection。
- P1 fixture verification CLI。

`legacy/jueying-v1/agent-harness/` 继续作为 runtime compatibility target。Rust 域模型不能被 legacy workflow 的线性 stage_chain 反向塑形。

## 2. 读完 main 后确认的边界

主线权威目录是 `jueying-mainline/`。仓库根只是 thin shell，历史 v1 在 `legacy/jueying-v1/` 下面作为 substrate 和兼容层。

当前 JS/MJS 的业务内核集中在：

| 资产 | 职责 |
|---|---|
| `src/contracts/schema.mjs` | 最小契约 schema。 |
| `src/contracts/validator.mjs` | 结构和业务红线校验。 |
| `src/contracts/view-models.mjs` | Operating Console、TaskGraph、Gap、External Sync、Management Command Center 投影。 |
| `src/contracts/sales-gate-engine.mjs` | 销售六步法 Gate 巡检和缺口生成。 |
| `src/contracts/writeback-policy.mjs` | 外部系统反写策略。 |
| `src/integrations/jueying-v1/adapter.mjs` | 新主线对象投影到旧 runtime payload。 |
| `apps/ops-console/server.mjs` | fixture state、view model、模拟写接口和 legacy health API 聚合。 |

Rust 首版覆盖这些内核职责，不接手浏览器 UI。

## 3. 发现的优化内容

### 3.1 TaskGraph 不能被 workflow 线性化

JS adapter 当前为了调用 legacy workflow，会把 `TaskGraph.tasks` 按数组顺序转成 `stage_chain`。这是必要的兼容投影，但不是主域模型。Rust 新增 `plan_task_graph`，保留拓扑顺序、并行层和 `blocked_by` 关系，明确区分：

- Domain TaskGraph：DAG、依赖、并行、验收和缺口事实中心。
- Legacy workflow plan：为了旧服务调用产生的线性 projection。

### 3.2 当前可执行枚举和未来状态机需分层

DEV-26 的 Task 状态机包含 `pending_approval/submitted/verifying/completed/failed/overdue/escalated` 等未来态；当前可执行契约枚举是 `pending/ready/assigned/in_progress/needs_info/needs_supplement/blocked/accepted/rejected/waived/cancelled`。

Rust 首版锁定当前可执行枚举，避免把未来态误写入 P1 合同。未来扩展应走 schema version 和 migration，而不是直接改现有 enum。

### 3.3 JS server 职责过宽

`apps/ops-console/server.mjs` 同时负责 fixture 状态、读写 API、view model 构建、契约校验和 legacy inspection。Rust 目录按模块拆开：

| Rust 模块 | 职责 |
|---|---|
| `contract` | 强类型合同、枚举、基础校验。 |
| `graph` | TaskGraph DAG 语义。 |
| `sales` | Gate model、Gate index、stage audit。 |
| `writeback` | 反写策略。 |
| `management` | 管理指挥中心合同和语义校验。 |
| `view_models` | P1 控制台投影。 |
| `adapter` | legacy bridge payload。 |
| `fixtures` | P1 fixture 加载和批量校验。 |

### 3.4 Management Command Center 投影要保留经营视角

JS 主线的管理指挥视图不是简单计数器，而是老板角色能直接消费的指挥台：权限、命令模板、可见命令、项目、泳道、执行更新都要一起返回。Rust 首版因此把 `build_management_command_center_view_model` 从摘要扩成接近 JS surface 的结构：

- `permissions`：当前角色的可操作能力。
- `command_templates`：即时下发、定时任务、条件触发三个入口。
- `commands/projects/swimlanes/execution_updates`：按角色可见性过滤后的经营指挥对象。

后续 JS/Rust golden parity 应继续比较字段级 JSON，而不是只比较总数。

## 4. 已建立的 Rust 目录

```text
rust/
├── Cargo.toml
├── README.md
├── crates/
│   ├── jueying-core/
│   │   └── src/
│   │       ├── adapter.rs
│   │       ├── contract.rs
│   │       ├── fixtures.rs
│   │       ├── graph.rs
│   │       ├── lib.rs
│   │       ├── management.rs
│   │       ├── sales.rs
│   │       ├── validation.rs
│   │       ├── view_models.rs
│   │       └── writeback.rs
│   └── jueying-cli/
│       └── src/main.rs
├── docs/
│   └── architecture.md
└── graphs/
    └── rust-context-graph.json
```

## 5. 验证命令

前置条件：本机需要安装 Rust toolchain，确保 `cargo` 和 `rustc` 可用，并满足 `rust/Cargo.toml` 中的 `rust-version`。

```bash
cd rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p jueying-cli -- verify --root ..
```

主线发布门禁已经把 Rust 纳入默认 `npm run verify`：根目录脚本 `verify:rust` 会顺序执行格式检查、Clippy、workspace 测试和 Rust CLI fixture verification。这样 JS 主线报告全绿但 Rust 未验收的情况会直接被发布命令拦住。仓库根 `.github/workflows/verify.yml` 也以 `jueying-mainline/` 为工作目录运行同一条门禁，确保 GitHub push/PR 不会绕过 Rust。

CLI 会读取现有 `fixtures/p1-demo` 和 `docs/sales-six-step-gates.json`，输出：

- P1 fixtures 的 Rust contract validation。
- TaskGraph topological order、parallel layers、blocked_by。
- Discover Gate audit。
- Writeback policy decisions。
- Operating Console、TaskGraph、External Sync、Management Command Center view models。
- Legacy bridge preview。

首版测试还锁定了三条 parity 防线：

- Contract/management struct 使用 `deny_unknown_fields`，但保留 `payload`、`required_schema`、`field_snapshot` 等开放扩展点。
- Legacy bridge 的 `subject_ref`、`policy_decision`、`result` 与 JS adapter 语义一致。
- Management Command Center 创建者权限和 view-model surface 与 JS 主线保持同向。

本轮架构硬化继续补上三条非复刻式防线：

- TaskGraph planner 自身拒绝重复依赖、未知依赖和重复 Task ID；即使调用方绕过单独合同校验，也不会生成错误 DAG。
- TaskGraph 合同拒绝“可执行或已验收任务越过未 accepted/waived 依赖”的状态矛盾，P1 fixture 已从错误的 `accepted` 调整为 `blocked`。
- Fixture 批量校验增加跨对象引用检查，确保 Task、Gap、Evidence、Gate、Writeback Intent 的 ID 链路不会悬空。
- Management Command Center 禁止未知 `active_user_id` 回退到首个角色，并校验 command/generated task 的双向归属链。
- SalesGateCheck 在 fixture/CLI 校验中接入权威 Gate 表，拒绝未知 Gate 和 stage 错配。
- Legacy bridge preview 和 JS runtime client 都改用 checked projection，先验证 TaskGraph 合同并按依赖拓扑排序，再生成有损线性 workflow payload；纯 projection 函数只保留为低层兼容工具。
- External Writeback Intent 在 Rust 和 JS validator 中都会重新计算策略，拒绝比计算结果更宽松的 `policy_decision`，防止 payload 中的金额、状态、负责人、截止日期等高风险字段绕过确认。
- `InformationGap.expected_evidence_types` 对齐 JS schema：字段缺失保持兼容，字段显式出现时不能为空。Rust 用 `Option<Vec<_>>` 表达缺失和空数组的区别，并用单测锁定。

`reports/live-legacy-bridge-smoke.json` 仍然属于可选在线联调证据，只有在历史 v1 runtime 实际启动后运行 `npm run legacy:live-smoke` 才刷新；默认发布门禁使用 `legacy:smoke` 和 Rust checked legacy projection 覆盖离线兼容性。

## 6. 当前边界

Rust 首版仍不做：

- 真实数据库 schema 和迁移。
- 真实 CRM/Jira/飞书项目 connector SDK。
- Ops Console 前端替换。
- legacy workflow dispatch 结果回流。
- Human Twin 真渠道通知。

这些继续沿用 DEV-36/DEV-38 的 runtime integration 路线推进。

## 7. 后续优先级

1. 增加更完整的 JS/Rust golden parity tests，继续锁定 P1 fixture、view model 和 bridge payload 字段级差异。
2. 引入 `schemars` 或等价 schema export，生成 Rust JSON Schema 并与 `schemas/*.json` 做自动对比。
3. 将 `AgentOutput.payload` 从开放 `serde_json::Value` 演进为 tagged payload enum，同时保留 unknown extension。
4. 为 TaskGraph 加 property tests：随机 DAG、并行层、replan version 和依赖状态迁移。
5. 在 `jueying-ops-api` crate 中落 Axum API，但继续复用 `jueying-core`，不把业务规则写进 handler。
