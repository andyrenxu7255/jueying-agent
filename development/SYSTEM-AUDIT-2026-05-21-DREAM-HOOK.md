# Agent Harness V1 - 梦境 Hook 与业务归因专项审计

> **审计日期**: 2026-05-21
> **审计范围**: 梦境调度、Hook 事件、知识/Skill 归因、Workflow outcome、文档图谱同步

---

## 一、执行摘要

| 维度 | 结论 | 说明 |
|------|------|------|
| 闭环完整性 | 通过 | 已补 `hook_event_log`、召回账本、outcome 评分与归因表 |
| 调度可用性 | 通过 | 修复 `owner_user_id` 字段、组织梦境触发窗口与重复触发 |
| 业务可观测性 | 通过 | 管理端可看 skill / 知识召回、注入、成功率和业务均分 |
| 结果完整性 | 通过 | Workflow 成功、失败、取消均写入 outcome，避免只统计成功样本 |
| 风险 | 低 | 迁移、lint、类型检查、单元测试和梦境集成测试均已通过；依赖审计剩余 2 个中危传递依赖提示 |

---

## 二、关键修复

1. `apps/web-portal/src/index.ts`
   - 个人梦境调用改为 `owner_user_id`
   - 组织梦境改为可运行窗口
   - 增加梦境归因管理 API
   - 梦境配置读取改为数据库直查
2. `services/hermes-adapter/src/index.ts`
   - 记忆/技能召回写入归因事件
   - 梦境完成写入 hook 事件
3. `services/fact-retrieval/src/index.ts`
   - Retrieval Trace 写入知识召回归因
4. `services/workflow/src/persistence/db.ts`
   - 写入 workflow outcome 评分与归因
5. `services/workflow/src/index.ts`
   - 成功、失败、取消终态均触发 outcome 写入
6. `services/skill-library/src/index.ts`
   - 技能审核/提升写入 hook 事件

---

## 三、验证结果

1. `npm run db:migrate`：通过，已应用 `026_recall_outcome_attribution.sql`。
2. `npm run lint`：通过。
3. `npm run type-check`：通过。
4. `npm test`：通过，8 个测试套件、81 个用例通过；Jest 报告存在测试进程优雅退出提示，未导致失败。
5. `npm run test:dream-mode`：通过，14 个梦境集成用例全部通过。
6. `npm audit --audit-level=high`：发现 `brace-expansion` 与 `ws` 两个 moderate 级别传递依赖提示，无 high/critical。

## 四、外部资料对齐

1. Claude Managed Agents Dream：Dream 是异步记忆整理，完成后保存并替换旧记忆，不与任务同时运行。
2. Claude Code Hooks：Hook 覆盖 session、tool、subagent、notification、stop、compact 等生命周期点，支持 JSON 决策、HTTP endpoint 和 agent hook。
3. Claude outcomes：outcome 是定义和评估 agent 是否达成目标的核心口径。
4. Hermes Agent：memory 在会话启动时注入，受容量限制并需要合并压缩；hooks 分 global/project/agent 三层。
