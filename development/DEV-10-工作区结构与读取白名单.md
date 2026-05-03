# DEV-10 工作区结构与读取白名单

## 1. 目标

为 Agent 提供“先看哪里、绝不看哪里、按任务看哪里”的硬规则，避免一上来全量读取导致上下文膨胀。

---

## 2. 工作区结构分层（按可读优先级）

| 层级 | 路径 | 状态 | 用途 | 默认策略 |
|---|---|---|---|---|
| P0 | `development/` | Active | 开发执行入口、任务分解、上下文治理 | **优先读取** |
| P0 | `AH1-*.md` | Active | 架构与契约权威文档 | **按对象最小读取** |
| P1 | `agent-harness/` | Active | 代码实现主仓（apps/services/libs/tests） | 按任务定向读取 |
| P2 | `README.md` | Active | 项目入口说明 | 仅首次会话读取 |
| P3 | `archive/` | Deprecated | 历史材料与归档，不作为当前实现依据 | **默认不读** |
| P3 | `agent-harness/node_modules/` | Generated | 三方依赖与生成内容 | **禁止读取** |

说明：

1. `archive/` 明确标记为历史归档区，不作为实现契约来源。
2. `agent-harness/node_modules/` 明确标记为生成依赖区，禁止进入上下文。

---

## 3. 目录级读取规则（白名单/黑名单）

### 3.1 白名单（默认允许）

- `development/*.md`
- `AH1-*.md`
- `agent-harness/README.md`
- `agent-harness/apps/**`
- `agent-harness/services/**`
- `agent-harness/libs/**`
- `agent-harness/tests/**`
- `agent-harness/config/**`
- `agent-harness/db/**`
- `agent-harness/scripts/**`

### 3.2 黑名单（默认禁止）

- `archive/**`
- `agent-harness/node_modules/**`
- `.git/**`
- `**/*.tsbuildinfo`
- `**/package-lock.json`（仅在依赖问题排查时按需读取）

---

## 4. 任务到目录路由（避免全读）

| 任务类型 | 必读目录 | 可选目录 | 禁止目录 |
|---|---|---|---|
| 接入层 + Workflow | `development/`, `AH1-15/16/17/21`, `agent-harness/apps`, `agent-harness/services` | `agent-harness/libs`, `AH1-23` | `archive/`, `node_modules/` |
| 检索与事实写回 | `development/`, `AH1-14/15/16/20`, `agent-harness/services`, `agent-harness/db` | `AH1-23/26`, `agent-harness/libs` | `archive/`, `node_modules/` |
| Executor 集成 | `development/`, `AH1-17/18/19/22`, `agent-harness/services`, `agent-harness/apps` | `AH1-16/31`, `agent-harness/libs` | `archive/`, `node_modules/` |
| Provider/配置治理 | `development/`, `AH1-26/28/15`, `agent-harness/config`, `agent-harness/services` | `AH1-31/23` | `archive/`, `node_modules/` |
| 压测与验收 | `development/`, `AH1-23/24/27/29/30/31`, `agent-harness/tests`, `agent-harness/scripts` | `agent-harness/apps/services` | `archive/`, `node_modules/` |

---

## 5. Agent 启动读取顺序（固定）

1. `development/DEV-00-开发索引.md`
2. `development/DEV-08-文件内容与依赖对象图谱.md`
3. `development/DEV-09-上下文防腐执行标准.md`
4. `development/DEV-10-工作区结构与读取白名单.md`
5. 按任务画像读取对应权威文档与代码目录

---

## 6. 归档与废弃标记规则

当某目录或文档满足任一条件时，标记为 Deprecated：

1. 不再参与当前版本实现；
2. 仅作历史追溯；
3. 被新权威源替代。

标记方式：

- 目录级：在本文件第 2 节登记状态为 `Deprecated`；
- 文档级：在文档头部增加 `> Status: Deprecated`（后续逐步补齐）。

---

## 7. 机器可读策略

读取策略的机器可读版本见：

- `development/context-routing.json`
- `development/context-graph.json`
