# DEV-09 上下文防腐执行标准

## 1. 目的

本标准用于抑制开发过程中的“上下文腐烂”（Context Rot）：

- 旧结论覆盖新权威；
- 非权威文档被误当规范；
- 任务上下文无限膨胀导致决策漂移。

---

## 2. 强制原则

1. **单一权威源**：每个领域对象只能有一个权威文档。
2. **分层读取**：默认仅读 L0（权威）+ L1（执行），L2 仅用于验收和审计。
3. **最小上下文包**：每个任务最大 6 个文档、最多 2 轮扩展读取。
4. **变更即失效**：权威文档变更后，旧任务上下文必须重建。

---

## 3. 执行流程

### Step 1: 选任务画像

从 `development/context-graph.json` 的 `task_profiles` 选择任务。

### Step 2: 生成任务清单

生成 `task_context_manifest`，至少包含：

- `authority_docs`
- `direct_dependencies`
- `execution_doc`
- `invalidation_watch`

### Step 3: 受控加载

先加载权威文档，再加载执行文档，最后按冲突增量加载可选文档。

### Step 4: 回归校验

提交前做两项检查：

1. 与 `authority_docs` 的契约一致；
2. 未出现越层覆盖（L1/L2 覆盖 L0）。

---

## 4. 触发重建条件

出现任一情况，立即重建任务上下文：

1. `AH1-15-核心接口与事件契约.md` 变更；
2. `AH1-16-权限Scope-Policy-Snapshot.md` 变更；
3. 当前任务使用的权威文档变更；
4. 当前任务对应 `DEV-0x` 文档变更。

---

## 5. 最小审计清单

- 是否存在“多权威源”定义同一对象；
- 是否存在无权威来源的实现决策；
- 是否在任务中全量加载全部 AH1 文档；
- 是否将审计文档当成实现契约。

---

## 6. 关联文件

- `development/DEV-08-文件内容与依赖对象图谱.md`
- `development/context-graph.json`
- `development/context-routing.json`
- `development/context_guard.py`
- `development/DEV-00-开发索引.md`

---

## 7. 快速执行命令

```bash
# 基于任务画像检查（示例：M3 Executor）
python development/context_guard.py --task-profile M3_executor

# 带变更文件的失效检查
python development/context_guard.py --task-profile M3_executor --changed AH1-15-核心接口与事件契约.md

# 允许读取治理层文档（仅审计场景）
python development/context_guard.py --task-profile M3_executor --allow-l2
```
