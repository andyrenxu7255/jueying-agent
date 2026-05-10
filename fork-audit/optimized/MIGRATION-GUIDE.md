# Migration Guide: Original → Optimized v2.0

> **版本**: v2.0 | **日期**: 2026-05-10

---

## 一、迁移概览

本指南描述如何从原版 `agent-harness` 迁移到优化版 `fork-audit/optimized`。

### 变更范围

| 变更类型 | 影响范围 | 风险 |
|----------|----------|------|
| 新增 shared 模块 | libs/shared 新增6个文件 | 低 |
| 重构 gateway-adapter | 模块化拆分，API兼容 | 中 |
| 新增 unified-executor | services/executor-gateway | 低 |
| 基础设施统一 | DB pool / LLM client / TTLMap | 低 |

---

## 二、逐步迁移

### Step 1: 部署新的 shared 模块

```bash
# 复制新增文件到原版
cp fork-audit/optimized/libs/shared/src/utils/ttl-map.ts     agent-harness/libs/shared/src/utils/
cp fork-audit/optimized/libs/shared/src/llm/client.ts        agent-harness/libs/shared/src/llm/
cp fork-audit/optimized/libs/shared/src/db/pool-manager.ts   agent-harness/libs/shared/src/db/
cp fork-audit/optimized/libs/shared/src/channel/*            agent-harness/libs/shared/src/channel/
cp fork-audit/optimized/libs/shared/src/server/bootstrap.ts  agent-harness/libs/shared/src/server/
cp fork-audit/optimized/libs/shared/src/intent/classifier.ts agent-harness/libs/shared/src/intent/
```

更新 `libs/shared/src/index.ts` 导出新模块（参考 optimized 版本）。

### Step 2: 替换各服务的 DB 连接池

每个服务中删除独立的 `getDbPool()` 函数，改用 `getPool()`:

```diff
// Before
- import { Pool } from 'pg'
- let pool: Pool | null = null
- async function getDbPool(): Promise<Pool | null> { ... }

// After
+ import { getPool } from '@agent-harness/shared'
+ const pool = await getPool('service-name')
```

### Step 3: 替换 gateway-adapter（分阶段）

**Phase 3a**: 先替换内存管理器

```bash
cp fork-audit/optimized/apps/gateway-adapter/src/services/memory-manager.ts agent-harness/apps/gateway-adapter/src/services/
```

原 `rememberContext()` / `recallContext()` → `memoryManager.remember()` / `memoryManager.recall()`

**Phase 3b**: 替换意图分类

```bash
cp fork-audit/optimized/apps/gateway-adapter/src/services/request-pipeline.ts agent-harness/apps/gateway-adapter/src/services/
```

原 5 个分类函数 → `intentClassifier.classify(text)`

**Phase 3c**: 替换渠道适配器

原 `getFeishuTenantAccessToken()` → `feishu.getAccessToken()`
原 `sendFeishuTextReply()` → `feishu.sendTextMessage()`
原 `downloadFeishuFile()` → `feishu.downloadFile()`
原 `pollAndReplyWorkflowResult()` → `pollWorkflowResult(workflowRef, feishu, userId)`

### Step 4: 使用 unified-executor

```bash
cp fork-audit/optimized/services/executor-gateway/src/executor/unified-executor.ts agent-harness/services/executor-gateway/src/executor/
```

原 `executeImplementation()` / `executeVerification()` / `executeRepair()` → `execute(input, 'execute' | 'verify' | 'repair')`

---

## 三、API 兼容性

所有对外 API 端点保持兼容：

| 端点 | 兼容性 |
|------|--------|
| POST /webhook/feishu | ✅ 签名验证逻辑一致 |
| POST /webhook/feishu/event | ✅ 事件处理逻辑一致 |
| POST /webhook/wecom | ✅ 解密/签名逻辑一致 |
| POST /webhook/wecom/callback | ✅ 回调处理逻辑一致 |
| internal API 端点 | ✅ 请求格式兼容 |

---

## 四、回滚计划

如果迁移出现问题：

1. **gateway-adapter 回滚**: 恢复原 `index.ts`（保留原文件备份）
2. **shared 模块回滚**: 删除新增文件，恢复原 `index.ts` 导出
3. **executor 回滚**: 恢复原 `generic-executor.ts` / `verification-executor.ts` / `repair-executor.ts`

---

## 五、验证清单

- [ ] shared 模块编译通过
- [ ] gateway-adapter 启动正常
- [ ] feishu webhook 收发消息正常
- [ ] wecom webhook 收发消息正常
- [ ] 意图分类功能正常
- [ ] 任务下发功能正常
- [ ] 文件导入功能正常
- [ ] executor 3种模式正常