# Agent Harness V1 开发计划总索引

> **版本**: v1.0 | **状态**: 已就绪 | **前置审计**: AH1-00~38全部通过

---

## 一、开发计划文档体系

| 编号 | 文档 | 关键内容 | 依赖来源 |
|------|------|----------|----------|
| DEV-00 | [本文档] | 索引、里程碑总览、验收门槛 | - |
| DEV-01 | [M0开发准备](./DEV-01-M0开发准备.md) | 仓库骨架、环境配置、核心依赖、契约冻结 | AH1-02 §D.0 |
| DEV-02 | [M1接入层+Workflow主链路](./DEV-02-M1接入层Workflow主链路.md) | 渠道接入、身份绑定、Workflow状态机、Checkpoint | AH1-02 §D.1 |
| DEV-03 | [M2事实层+检索主链路](./DEV-03-M2事实层检索主链路.md) | PostgreSQL主表、混合检索、Evidence Pack、Fact Write | AH1-02 §D.2 |
| DEV-04 | [M3-CodeExecutor集成](./DEV-04-M3CodeExecutor集成.md) | 执行会话、Worktree隔离、Subagent、上下文隔离 | AH1-02 §D.3 |
| DEV-05 | [M4-Hermes增强接入](./DEV-05-M4Hermes增强接入.md) | Hermes Adapter、Memory映射、Skill封装、Dream处理 | AH1-02 §D.4 |
| DEV-06 | [M5-容量验证+收口](./DEV-06-M5容量验证收口.md) | AGE图增强、指标埋点、告警、限流、压测 | AH1-02 §D.5 |
| DEV-07 | [主仓库骨架结构](./DEV-07-主仓库骨架结构.md) | 目录结构、模块划分、导入关系 | AH1-13 §13.3 |
| DEV-08 | [文件内容与依赖对象图谱](./DEV-08-文件内容与依赖对象图谱.md) | 文件->对象->依赖图谱、最小上下文加载包 | AH1-33 §2.1 |
| DEV-09 | [上下文防腐执行标准](./DEV-09-上下文防腐执行标准.md) | 分层依赖、失效重建、任务上下文管控 | DEV-08 §9 |
| DEV-10 | [工作区结构与读取白名单](./DEV-10-工作区结构与读取白名单.md) | 文件夹分层、废弃标记、读取白名单/黑名单 | DEV-09 §2 |
| DEV-11 | [开发前自动就绪报告](./DEV-11-开发前自动就绪报告.md) | 环境、工具链、上下文治理、准入结论 | DEV-09 §3 |
| DEV-12 | [三小时自主执行计划与审计闸门](./DEV-12-三小时自主执行计划与审计闸门.md) | 分阶段计划、每步代码/文档审计闸门 | DEV-11 §6 |
| DEV-13 | [联调与测评报告](./DEV-13-联调与测评报告.md) | 端到端联调、稳定性回归、测评结论与缺口 | DEV-11 §4 |
| DEV-18 | [B2B销售故事线与工作流可观测闭环](./DEV-18-B2B销售故事线与工作流可观测闭环.md) | 销售管理故事线、workflow 可观测、确认后复用 | 用户故事线 §21 |

---

## 二、里程碑总览

| 里程碑 | 工期 | 核心交付 | 关键验收 | 阻塞条件 |
|--------|------|----------|----------|----------|
| M0 | 1天 | 仓库骨架+开发环境+核心依赖+契约冻结 | docker-compose up 健康 | 无 |
| M1 | 4天 | 接入层+Workflow主链路 | P0-1、P0-2通过 | M0完成 |
| M2 | 4天 | 事实层+检索主链路 | P0-3通过 | M1完成 |
| M3 | 4天 | Code Executor集成 | P0-5通过 | M2完成 |
| M4 | 3天 | Hermes增强接入 | P0-6通过 | M3完成 |
| M5 | 2天 | 容量验证+治理收口 | 全部PoC通过+压测通过 | M4完成 |
| **总计** | **18天** | | | |

---

## 三、验收门槛清单

### M0验收门槛

- [ ] 仓库结构完整（DEV-07定义的所有目录）
- [ ] `docker-compose up` 所有基础设施健康（含LiteLLM、SigNoz）
- [ ] contracts/policy/audit/shared包可编译导入
- [ ] XState状态图可运行，非法迁移被拒绝
- [ ] LiteLLM代理可转发LLM请求
- [ ] SigNoz可查看测试trace
- [ ] node-casbin权限判定正确
- [ ] 配置缺失时启动失败
- [ ] 6类核心schema冻结

### M1验收门槛

- [ ] P0-1通过：10次连续请求成功创建Workflow
- [ ] P0-2通过：waiting_user/blocked/paused可区分且可恢复
- [ ] 未绑定身份不会错误创建Workflow
- [ ] checkpoint可恢复
- [ ] 非法状态迁移被拒绝
- [ ] 所有状态迁移有审计事件

### M2验收门槛

- [ ] P0-3通过：零越权读取
- [ ] 检索trace完整
- [ ] Evidence Pack中每个item可追溯到源记录
- [ ] 冲突事实不直接覆盖旧事实
- [ ] Artifact大对象不进数据库

### M3验收门槛

- [ ] P0-5通过：开发任务可跑通计划-实现-验证-修复闭环
- [ ] patch、测试结果、checkpoint能回写
- [ ] 修复循环受max_repairs限制
- [ ] Code Executor上下文与OpenClaw完全隔离
- [ ] 未携带policy_snapshot_hash时执行被拒绝

### M4验收门槛

- [ ] P0-6通过
- [ ] Hermes不能直接写主事实
- [ ] Memory检索受场景约束
- [ ] Skill封装受质量标准约束
- [ ] 公共skill发布需admin审批
- [ ] 每次写回都有审计

### M5验收门槛

- [ ] 全部6个P0 PoC通过
- [ ] 压测结果有数据支撑
- [ ] 权限与审计验收通过（零越权、审计100%）
- [ ] 恢复与回放能力验收通过（恢复率≥95%）
- [ ] 运维Runbook、告警与Dashboard齐备
- [ ] 限流和熔断器正确工作
- [ ] 降级策略正确执行

---

## 四、关键通过阈值（来源：AH1-24 §24.12）

| 指标 | 目标值 |
|------|--------|
| 跨用户越权读取次数 | **0** |
| 审计事件完整率 | **100%** |
| Checkpoint恢复成功率 | **≥95%** |
| 未绑定身份误创建Workflow次数 | **0** |
| replay写入主事实次数 | **0** |
| public:workflow被错误解析次数 | **0** |

---

## 五、核心依赖索引

| 依赖 | 版本 | 来源仓库 | 用途 |
|------|------|----------|------|
| XState | 5.x | npm | Workflow状态机引擎 |
| Vercel AI SDK | 4.x | npm | LLM流式调用 |
| LiteLLM | 1.x | Docker | LLM Gateway代理 |
| Drizzle ORM | 1.0.0+ | npm | PostgreSQL ORM |
| BullMQ | 5.x | npm | 任务队列 |
| node-casbin | 5.x | npm | 权限引擎 |
| Zod | 4.x | npm | Schema校验 |
| SigNoz | latest | Docker | 可观测性平台 |
| pgvector | latest | PostgreSQL扩展 | 向量召回 |
| Apache AGE | latest | PostgreSQL扩展 | 图增强 |

---

## 六、安全修复索引（来源：架构审计报告AH1-37）

| 漏洞编号 | 文件 | 修复状态 | 验证方法 |
|----------|------|----------|----------|
| C1 | tui_gateway/server.py:2132 | ✅ 已修复 | shell=False+shlex.split |
| C2 | tui_gateway/server.py:2926 | ✅ 已修复 | shell=False+shlex.split |
| C3 | tools/transcription_tools.py:376 | ✅ 已修复 | shell=False |
| C4 | tools/terminal_tool.py:488 | ✅ 已修复 | 移除全局缓存密码 |
| C5 | run_agent.py:1004 | ✅ 已修复 | 掩码输出 |
| C6 | hermes_cli/webhook.py:169 | ✅ 已修复 | 掩码显示 |

---

## 七、文档冻结清单（来源：AH1-25 §25.13）

进入开发执行前必须冻结：

- [ ] 文档13：仓库复用与改造边界
- [ ] 文档14：表与索引
- [ ] 文档15：接口与事件契约
- [ ] 文档16：权限与policy snapshot
- [ ] 文档17：Workflow DSL
- [ ] 文档18：Code Executor契约
- [ ] 文档19：Checkpoint/Resume/Replay
- [ ] 文档20：检索与Fact Write
- [ ] 文档21：渠道接入、身份绑定与Session映射
- [ ] 文档22：Artifact/Object Storage
- [ ] 文档23：审计、日志、指标与告警
- [ ] 文档24：PoC/压测执行方案
- [ ] 文档31：错误处理与降级策略

---

**下一步**：查看 [DEV-01-M0开发准备](./DEV-01-M0开发准备.md) 开始M0阶段

---
