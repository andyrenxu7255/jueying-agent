# DEV-12 三小时自主执行计划与审计闸门

## 1. 执行目标

在 3 小时窗口内，以“每步可用、每步可审计”为原则推进开发准备与基础联通，避免先堆功能后返工。

---

## 2. 全局闸门（每一步都必须过）

### 2.1 代码闸门

1. `npm run lint` 通过
2. `npm run type-check` 通过
3. `npm test` 可执行并通过（当前允许 no-tests）

### 2.2 文档闸门

1. `python development/context_guard.py --task-profile M1_ingress_workflow`
2. `python development/context_guard.py --task-profile M2_retrieval_fact`
3. `python development/context_guard.py --task-profile M3_executor`

若任一闸门失败：立即停止进入下一步，先修复再继续。

---

## 3. 三小时分段计划

### Phase A (0:00-0:45) 基础设施稳定启动

- 执行 `npm run infra:bootstrap`
- 目标：postgres/redis/minio 全部 ready，迁移成功
- 闸门：代码闸门 + 文档闸门

### Phase B (0:45-1:30) 关键服务联通

- 执行 `npm run infra:bootstrap:llm`
- 验证 LiteLLM 健康与主链路依赖可达
- 闸门：代码闸门 + 文档闸门

### Phase C (1:30-2:15) 审计增强与风险收敛

- 执行 `npm run preflight:audit`
- 输出依赖漏洞与兼容性风险（仅记录，不做破坏性升级）
- 闸门：代码闸门 + 文档闸门

### Phase D (2:15-3:00) 开发入口收口

- 根据任务画像切入 DEV-02/DEV-03/DEV-04 中一个最小开发任务
- 提交前再次执行 `npm run preflight:audit`
- 产出阶段性可运行结果与审计记录

---

## 4. 执行准则

1. 不跳过审计：每次变更后必须过闸门。
2. 不并发堆任务：同一时刻只推进一个主任务。
3. 不引入破坏性依赖升级（如 `npm audit fix --force`）除非明确进入升级专项。
4. 出现网络/镜像波动时，优先保核心服务，再扩展可观测性组件。

---

## 5. 关联文件

- `development/DEV-09-上下文防腐执行标准.md`
- `development/DEV-10-工作区结构与读取白名单.md`
- `development/DEV-11-开发前自动就绪报告.md`
- `agent-harness/scripts/bootstrap-infra.ps1`
