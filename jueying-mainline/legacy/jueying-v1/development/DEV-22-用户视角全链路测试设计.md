# DEV-22 用户视角全链路测试设计

> 日期：2026-05-24  
> 主版本：v1.7.0  
> 范围：`agent-harness` 主工程、Web Portal、渠道入口、工作流、知识/图谱、梦境归因、主动运营、运维与开发验收  
> 依据：`agent-harness/用户故事线.md`、`development/context-graph.json` v2.13、`AH1-30-验收标准与测试用例.md`

## 1. 目标

本设计从用户视角定义主版本的端到端验收基准。覆盖所有真实角色、所有主要入口、所有关键终态，并把每条体验映射到自动化脚本或人工 UAT 检查，避免只验证接口可用而遗漏用户完整体验。

验收结论只以“已定义用例 100% 执行且通过”为准；外部飞书、企微、正式 LLM Key、生产可观测后端等依赖环境凭据的项目，必须明确标记为环境型 UAT，不得伪装为本地自动化通过。

## 2. 角色与入口

| 角色 | 入口 | 主要体验 | 不可接受问题 |
|---|---|---|---|
| Admin | Web Portal | 初始化、组织/用户、配置、知识审核、技能治理、主动运营审核 | 无法登录、配置保存误导、跨组织数据可见、绕过审核派单 |
| 老板/负责人 | IM / Web Portal | 经营目标输入、风险摘要、决策事项、主动运营报告 | 输出堆原始明细、没有证据、无法追踪后续执行 |
| 销售经理 | IM / Web Portal | 晨会/夕会异常、卡单救援、任务分发、团队进度 | 红黄绿状态缺失、承诺动作不可追踪、重复派单 |
| 一线销售 | IM / 我的任务 | 客户跟进记录、下一步提醒、卡单建议、反馈提交 | 身份错绑、任务看不到、提交后状态不更新 |
| 运维 | 命令行 / Web Portal | 服务健康、资源监控、数据库维护、渠道冒烟 | 外部凭据问题和核心故障混淆、健康检查误报 |
| 开发 | 命令行 / 文档图谱 | 构建、类型、单测、上下文审计、回归脚本 | 文档和图谱不同步、测试命令失效、覆盖门禁被绕过 |
| 系统自动 | 调度器 / 服务内部 | 梦境、归因、主动扫描、workflow 修复与沉淀 | 自动动作无审计、失败阻断主链路、重复洞察泛滥 |

## 3. 全链路用例矩阵

| ID | 用户旅程 | 角色 | 前置条件 | 用户步骤 | 期望结果 | 自动化覆盖 |
|---|---|---|---|---|---|---|
| UJ-01 | 首次接管与登录 | Admin | Web Portal 可访问 | 使用管理员账号登录，查看系统概览 | 登录成功，无强制默认密码弹窗，服务摘要可见 | `test:portal-admin`、`test:portal-static` |
| UJ-02 | 组织与用户治理 | Admin | 已登录 | 创建/查看组织成员、邀请、策略 | 组织边界清晰，成员和策略操作有审计 | `test`、`test:portal-admin` |
| UJ-03 | 模型与 Provider 配置 | Admin / 运维 | 已登录 | 配置 Feishu、LLM、Embedding、Rerank 并测试 | 必填项提示清楚，热加载/重启目标明确，模型目录可见 | `test:portal-admin` |
| UJ-04 | 知识导入与审核 | Admin / 普通用户 | 数据库和 fact-retrieval 可用 | 手动导入、TXT/DOCX 上传、审核知识 | 文档分块入库，审核事实生成，个人与共享入口分离 | `test:portal-admin`、`test` |
| UJ-05 | 渠道消息与身份绑定 | 一线销售 / 运维 | Gateway 可用 | 飞书/企微 challenge、正常消息、重复消息 | 签名校验、异步 ACK、重复事件幂等、session_ref 返回 | `smoke:channels` |
| UJ-06 | 日常聊天和快查分流 | 普通用户 | Hermes / retrieval 可用 | 发送闲聊、快查、知识提交类消息 | 正确分类到 chat / lookup / knowledge_submit，带组织上下文 | `test`、`smoke:eval` |
| UJ-07 | 长任务工作流首跑 | 老板 / 销售经理 | Workflow / Executor 可用 | 输入 B2B 销售分析目标 | 先匹配 workflow_definition，再匹配 workflow skill，未命中时规划并执行 | `smoke:workflow-observability`、`smoke:eval` |
| UJ-08 | 过程可观测与异常修复 | 老板 / 销售经理 / 开发 | 存在运行中 workflow | 查看阶段、过程摘要、异常说明 | 阶段状态可读，失败先尝试自主修复，最终回执说明过程和假设 | `smoke:workflow-observability`、`test` |
| UJ-09 | 确认后复用与技能治理 | 用户 / Admin | 有成功 workflow | 用户确认工作流，Admin 审核技能/候审 workflow_definition | 私有 skill 激活，组织提升需审核，高质量路径候审固化 | `smoke:workflow-observability`、`test:dream-mode` |
| UJ-10 | 任务分发与用户反馈 | 销售经理 / 一线销售 | Gateway 和任务表可用 | Admin 下发任务，用户查看并提交反馈 | 分配不重复，通知后可见，提交后状态 completed | `test:task-dispatch` |
| UJ-11 | 梦境归因与业务效果 | Admin / 系统自动 | Hermes、skill-library 可用 | 触发个人/组织梦境，查看归因区域 | 记忆分析、技能审核、召回与 outcome 指标可查 | `test:dream-mode` |
| UJ-12 | 主动运营闭环 | Admin / 老板 / 销售经理 | Proactive 服务可用 | 创建规则、手动扫描、审核洞察、派发 mission、发布报告 | 洞察有证据，默认先审后派，重复扫描不刷屏，报告可发布 | `test:proactive`、`test:portal-static` |
| UJ-13 | 运维健康与资源监控 | 运维 | Compose 或本地服务可用 | 查看健康、资源、数据库维护、容器状态 | 核心服务可区分，Docker 不可用时有 fallback，维护操作有结果 | `health:core`、`test:portal-admin` |
| UJ-14 | 开发交付门禁 | 开发 | Node 22+、依赖安装完成 | 运行 lint、type-check、build、test、context audit | 代码、契约、图谱、覆盖率门禁全部通过 | `lint`、`type-check`、`build`、`test`、`context:audit` |

## 4. 端到端执行顺序

1. 基础质量门禁：`npm run validate:m0`、`npm run lint`、`npm run type-check`、`npm test`。
2. 前端静态与路由：`npm run test:portal-static`。
3. 用户旅程覆盖审计：`npm run test:user-journey-coverage`。
4. 主版本构建：`npm run build`。
5. 图谱一致性：`npm run context:audit`。
6. 依赖安全：`npm audit --audit-level=moderate`。
7. 在线链路：`npm run health:core`、`npm run smoke:channels`、`npm run smoke:eval`、`npm run test:portal-admin`、`npm run test:task-dispatch`、`npm run test:dream-mode`、`npm run test:proactive`。
8. 人工 UAT：真实飞书/企微、正式 LLM、生产 SigNoz/ClickHouse、真实销售数据，仅在目标环境完成。

## 5. 准出规则

| 类别 | 准出标准 |
|---|---|
| 自动化 | 本文列出的可执行脚本 100% 通过；失败项必须修复后复验 |
| 角色覆盖 | 七类角色均至少有一条端到端旅程通过 |
| 入口覆盖 | Web Portal、IM/Webhook、服务内部调度、命令行门禁均覆盖 |
| 数据边界 | 跨组织越权为 0，未授权 Admin API 为 0 |
| 可解释性 | workflow、主动运营、梦境归因必须带过程、证据或审核记录 |
| 环境项 | 无法本地自动化的外部凭据项必须留下环境限制说明 |

## 6. 风险与人工复核

- 真实飞书长连接和企业微信回调需要正式应用凭据，本地只能覆盖签名、challenge、异步 ACK 和幂等。
- 正式 LLM 质量、模型目录、Embedding/Rerank 真实响应需在目标 Provider 环境复核。
- “老板/销售经理/一线销售”的业务质量需要用真实 CRM 或销售样本数据评估，本地 demo 只验证链路和证据结构。
- 100% 自动化通过不等于生产永远无缺陷；它代表当前主版本已定义体验用例全部执行并通过。
