# JueYing v1.5.0 - Dream Hooks and Outcome Attribution

发布日期：2026-05-21

## 摘要

这个版本把梦境模式从“记忆压缩能力”升级为“可衡量的学习闭环”。JueYing 现在会记录哪些知识、记忆、文档片段和 skill 被召回或注入，评估 workflow 的终态结果，并把好的业务结果归因回真正起作用的上下文。

## 核心亮点

- 增加 hook-style 生命周期事件账本，覆盖 `memory.recalled`、`fact.recalled`、`skill.recalled`、`skill.injected`、`workflow.confirmed`、`outcome.evaluated`、`dream.completed`。
- 增加知识和 skill 召回账本，让检索和技能使用可以在事后被度量。
- 增加 workflow outcome 评估，成功、失败、取消三类终态都会写入结果。
- 增加召回到 outcome 的归因表，以及知识/skill 的日级业务效果视图。
- 修复梦境调度里的个人梦境字段、组织梦境窗口、重复触发和配置读取问题。
- Web Portal 增加近 30 天 skill 与知识业务效果 API 和展示入口。
- 文档、开发图谱和专项审计同步更新，dream、hook、outcome attribution 成为一等架构域。

## Skill 与 Workflow 的边界

JueYing 中 skill 和 workflow 可以并行存在，但它们属于不同治理层级：

| 对象 | 定位 | 典型用途 | 稳定性来源 |
|---|---|---|---|
| Skill | 可召回、可注入的能力资产 | 方法片段、工具封装、提示模板、经验模式、某类任务的局部做法 | 召回质量、版本、示例、审核评分和 outcome 归因 |
| Workflow | 经确认或审批的执行契约 | 多阶段任务、跨服务执行、需要验收/恢复/审计的业务流程 | DSL、阶段链、状态机、权限快照、验收条件、checkpoint、审计 |

v1.5 当前落地路径：

1. 用户任务先尝试匹配 active skill 模板；其中 `skill_type=workflow` 会被 Planner 当作 workflow 阶段链模板使用。
2. 首跑或日常执行中可以召回多个 skill，作为阶段内的能力和上下文补充。
3. 工作流成功后，gateway 会把阶段链提取为 `skill_type=workflow` 的 private draft skill。
4. 用户回复“确认工作流 wf_xxx”后，该 draft skill 变为 private active 模板，下次相似任务会优先匹配。
5. Skill-library 的审核/提升会把高评分模板提升为 org skill，并写入 `org_skill_registry`；当前版本不会自动创建或审批 `workflow_definition`。

下一步契约层演进是：当某个 skill 多次命中、贡献稳定、风险可控时，再提交给 admin 审核阶段链、适用边界、权限、验收标准和风险说明，审核通过后固化为 `workflow_definition`。这种 workflow 契约通常会比普通 skill 在“指令遵从”和“流程稳定性”上更强，因为它拥有显式阶段、状态转移、退出条件、失败处理、checkpoint 和审计；普通 skill 更适合承载可复用经验与局部能力。

## 数据库变更

新增迁移：

- `agent-harness/db/migrations/026_recall_outcome_attribution.sql`

新增表：

- `hook_event_log`
- `knowledge_recall_event`
- `skill_recall_event`
- `workflow_outcome_eval`
- `recall_outcome_attribution`

新增视图：

- `skill_business_outcome_daily`
- `knowledge_business_outcome_daily`

## 文档更新

- 重建 GitHub 默认首页：`README.md`
- 新增发布说明：`RELEASE_NOTES.md`
- 更新应用文档：`agent-harness/README.md`
- 更新产品说明：`agent-harness/PRODUCT.md`
- 更新用户故事线：`agent-harness/用户故事线.md`
- 新增专题实现说明：`development/DEV-21-梦境Hook与业务归因闭环.md`
- 新增专项审计：`development/SYSTEM-AUDIT-2026-05-21-DREAM-HOOK.md`
- 更新上下文图谱：`development/context-graph.json` 到 v2.8

## 验证结果

2026-05-21 已验证：

```bash
npm run db:migrate
npm run lint
npm run type-check
npm run build
npm test
npm run test:dream-mode
npm run context:audit
npm audit --audit-level=high
```

结果：

- 数据库迁移通过。
- Lint 通过。
- Type check 通过。
- Build 通过。
- Jest 通过：8 个测试套件 / 81 个用例。
- Dream-mode 集成测试通过：14 个用例。
- Context graph audit 通过：M1 / M2 / M3 三个 task profile。
- 依赖审计：无 high 或 critical；剩余 2 个 moderate 传递依赖提示已记录。

## 升级说明

启动服务前先执行迁移：

```bash
cd agent-harness
npm run db:migrate
```

归因写入是旁路账本：如果归因写入失败，用户请求、检索、workflow 执行或梦境任务应继续运行，只记录 warning，不阻断主流程。
