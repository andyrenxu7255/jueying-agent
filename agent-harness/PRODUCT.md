# JueYing (绝影) — 产品说明

> 版本: 1.6.3 | 更新日期: 2026-05-23
> 品牌名称: JueYing (绝影) | 内部代号: agent-harness

---

## 一、产品概述

JueYing (绝影) 是一个**企业级 AI Agent 编排与执行平台**。用户通过飞书、企业微信等 IM 渠道与系统交互，系统先识别是否已有已批准的 `workflow_definition`，再回退到可复用的 active skill 模板，随后使用大语言模型（LLM）将新任务自动规划为多阶段工作流；没有既有路径时，系统会先以自动任务首跑模式跑通，再把成熟路径沉淀为 workflow 型 skill 模板，调度多种专用执行器完成各阶段任务，并主动推送可解释的过程与结果。

### 1.1 产品定位

面向企业办公场景的 AI 工作助手，让员工通过日常使用的 IM 工具即可调用 AI Agent 完成复杂工作任务，无需切换系统或学习新工具。

### 1.2 核心价值

| 价值维度 | 说明 |
|----------|------|
| **零学习成本** | 通过飞书/企微直接对话，像和同事聊天一样使用 AI |
| **任务自动化** | 复杂任务自动拆解为可执行的阶段链，首跑成功后可沉淀为可复用 workflow 型 skill 模板 |
| **经营闭环** | 以 B2B 销售管理为代表，支持老板决策、经理盯过程、销售执行和异常升级 |
| **主动督促执行** | Admin 制定规则后，Agent 定期检查事实层与任务状态，发现风险或机会后先给管理员审核，再派单给用户执行并回报 |
| **多渠道统一** | 飞书、企业微信、Web Portal 统一接入，身份自动绑定 |
| **上下文记忆** | 支持多轮对话记忆，AI 能记住之前的交流内容 |
| **企业级安全** | 组织隔离、RBAC 权限、策略控制、审计日志 |
| **可扩展技能** | 支持从 ClawHub 技能市场安装预制技能，也能把用户确认过的成功路径沉淀为私有 workflow 型 skill 模板，再由管理员审核提升为组织模板 |

---

## 二、核心功能

### 2.1 智能对话 (Chat)

用户发送自然语言消息，系统通过 LLM 理解意图并生成回复。

**特性:**
- 上下文记忆：多轮对话中保持连贯性
- 历史压缩：超出上下文窗口时自动摘要压缩
- 匿名回退：未登录用户的记忆隔离处理
- 意图分类：自动识别闲聊 / 任务请求 / 知识提交 / 快速查询

### 2.2 长任务工作流 (Task)

当用户提出需要多步骤完成的任务时，系统自动进行任务规划。

**工作流四阶段:**
```
意图澄清 → 证据检索 → 决策推理 → 结果报告
  ↓           ↓          ↓          ↓
理解需求    查找资料    分析判断    生成输出
```

**特性:**
- 优先复用：先查已批准 active `workflow_definition`，再按个人私有、组织、公共 active workflow 型 skill 模板查找既有路径
- 自动任务分解：LLM 将复杂目标拆解为可执行阶段
- 多执行器调度：根据阶段类型自动匹配最佳执行器
- 过程可观测：实时监控阶段状态，并在最终回执中说明执行过程、异常和结果
- 故障恢复：暂停、恢复、失败阶段自主修复机制
- 结果推送：完成后自动推送至 IM 渠道
- 用户确认沉淀：成功首跑会生成私有 draft workflow 型 skill，用户回复“确认工作流 wf_xxx”后激活复用；管理员可通过技能审核提升为组织模板
- 契约固化：召回率高、注入效果好、业务 outcome 和审核分均良好的 workflow 型 skill 会进入 `workflow_definition_review`，管理员批准后固化为 `workflow_definition`

### 2.2.1 B2B 销售管理样板场景

JueYing 的日常管理样板以 B2B 销售团队为基准：老板只输入经营目标和约束，Agent 拆解为销售经理晨会动作、一线销售每日八访提醒、卡单救援、折扣审批、回款追踪和周复盘。系统会把红黄绿客户状态、阶段停留时间、承诺动作、证据缺口和需老板拍板的事项整理成简报，让管理者把时间用在异常和决策上，而不是翻 CRM 流水。

### 2.2.2 主动运营编排

主动运营让智能体从“被动响应任务”前进一步，成为可审计的执行督促层。管理员在 Web Portal 设置规则，例如“每天扫描 MEDDIC 销售资料、ClawHub 销售技能、组织记忆和待办派单，发现客户跟进缺口后生成洞察”。`proactive-orchestrator` 定期扫描事实层数据，生成带证据引用、置信度和去重哈希的洞察；默认不直接打扰普通用户，而是进入 Admin 审核队列。

管理员点击通过后，系统生成 `proactive_mission`，再复用已有 `org_task` / `org_task_assignment` 派给具体用户。普通用户在“我的任务”或 IM 通知中提交反馈，系统把反馈同步回 proactive mission，并生成可发布的管理员汇报。这样一条链路形成：Admin 设规则 → Agent 找事实 → Agent 产洞察 → Admin 审核 → Agent 派单 → 用户执行 → Agent 回报。

### 2.3 知识管理 (Knowledge)

用户通过日常对话即可积累组织知识。

| 功能 | 说明 |
|------|------|
| 知识提交 | 用户说"记录一下"即可将信息写入知识库（待审核） |
| 知识审核 | 管理员在 Web Portal 审核/批准/退回/拒绝用户提交的知识 |
| 知识提取 | 定时从对话记忆中自动提取结构化知识点 |
| 快速查询 | 使用 `/查` 或 `/find` 前缀快速检索已知信息（人名、联系方式等） |

### 2.4 记忆系统

| 功能 | 说明 |
|------|------|
| 会话记忆 | 记录每轮对话的用户/助手消息 |
| 上下文召回 | 根据当前消息检索相关历史 |
| 压缩摘要 | 会话过长时自动压缩为摘要 |
| 限额管理 | 可配置每会话最大记忆条数 |

### 2.4.1 梦境模式（Dream Mode）

每日自动运行的记忆分层管理、技能发现与业务归因系统。梦境不只解决“失忆”和上下文膨胀，也会沉淀哪些知识、记忆和 skill 在真实 workflow 中被召回、被注入，并最终带来了好结果。

**记忆分层管理：**
- 用户记忆隔离：每个用户专属记忆空间（owner_user_id 隔离）
- Admin Agent 分析：定时扫描所有用户记忆，LLM 压缩超长记忆 + 提取知识点
- 组织级整合：汇总用户知识 → 去重分类 → 整合为组织知识库
- 记忆检索优化：用户级/管理员级记忆路由，完整访问审计日志

**技能发现生态：**
- 高价值场景识别：分析用户交互模式，自动识别可复用场景
- 技能多维审核：功能/安全/性能/适配 四维评分，≥80分自动提升
- 组织级技能库：通过审核的用户技能 → 标准化改造 → 组织通用技能
- 技能使用统计：每日调用次数/成功率/活跃用户数实时追踪

**Hook 与业务归因：**
- Hook 事件账本：记录 `memory.recalled`、`fact.recalled`、`skill.recalled`、`skill.injected`、`outcome.evaluated`、`dream.completed`
- 知识召回账本：记录 memory / fact / document_chunk / org_memory / hermes_memory 是否进入 Evidence Pack 或模型上下文
- Skill 召回账本：记录 skill 版本、召回原因、是否注入上下文、后续 workflow 结果
- Outcome 评分：成功、失败、取消的 workflow 都写入终态评分，减少只看成功样本的偏差
- 归因看板：管理员查看近 30 天知识和 skill 的召回次数、成功率、业务均分和贡献分
- Workflow 定义候审：管理员可从梦境技能发现页生成候审、查看来源 skill 与业务分，批准后生成稳定 `workflow_definition`

### 2.5 技能系统

通过 ClawHub 技能市场安装预制技能，扩展 Agent 能力。管理员可在 Web Portal 统一配置 `CLAWHUB_ADMIN_TOKEN`，用于下载、上传和升级技能；Token 只保存在本地环境配置，不明文回显，也不进入 GitHub。

**已预制技能（14 项，全部免费无需 API Key）:**
- **Document Pro**: PDF/Word/PPT/Excel/CSV/Markdown 全格式读取解析
- **Document Generator**: AI 驱动的 Word/PPT/Excel 报告自动生成
- **PDF Converter**: PDF ↔ Word/Excel 格式互转、合并拆分压缩
- **Multi Search 聚合搜索**: DuckDuckGo + Bing + 百度 + 搜狗 多渠道聚合
- **Deep Search 深度搜索**: 多轮递进式研究搜索，自动拆解子问题
- **实时资讯**: RSS + 微博/知乎/36Kr 热点聚合推送
- **Summarize 内容总结**: 网页/PDF/图片智能内容提炼
- **WeCom File Bridge**: 企业微信文件收发、文档自动解析导入知识库
- **Weather 免费天气**: 公开气象数据实时查询，七天预报
- **Agent Browser 网页自动化**: 无头浏览器自动化、数据采集
- **Ontology 知识图谱**: 自动提取实体/关系，构建 AGE 图数据库图谱
- **Memory Compress 记忆归档**: 对话对象化存储，自动构建对象关系图谱
- **Skill Vetter 安全审查**: 技能安装前权限与风险审查
- **self-improving-agent**: 经验记录留存，自我持续优化
- **MEDDIC B2B Sales Review**: MEDDIC 销售复盘、Pipeline Review、拜访复盘和销售辅导，无 API Key
- **Customer Research**: 客户调研与竞品情报，生成调研报告和场景破冰 PPT；需要公共网络搜索但不需要 API Key

管理员技能维护页提供 ClawHub 入口、URL 导入、页面上传 `SKILL.md`、批量升级检查、单技能变更解读和逐个确认升级。升级检查会识别来源为 `clawhub.ai` 的技能，展示当前版本、上游最新版本、变更摘要、下载量和安全扫描状态。

### 2.6 组织与用户管理

| 功能 | 说明 |
|------|------|
| 组织隔离 | 用户、工作流、记忆按组织完全隔离 |
| 角色权限 | admin / user 角色，可配置细粒度策略 |
| 邀请管理 | 管理员可邀请成员并管理其权限 |
| 审计日志 | 记录所有关键操作（登录、创建、修改） |

### 2.5.1 文件存储与管理工作区

每个用户拥有完全隔离的个人文件工作区。

| 功能 | 说明 |
|------|------|
| 文件上传 | 通过飞书/企微/Web Portal 上传原始文档（PDF/DOCX/XLSX等） |
| 用户隔离 | 每个用户独立的存储空间 `users/{org}/{user}/` |
| 双后端存储 | localfs（开发）+ MinIO/S3（生产） |
| 暂存机制 | 入库前临时保存到 staging 区，入库后自动清理 |
| 文件共享 | 支持 private/shared/public 三级 scope |
| AI生成文件 | LLM/工作流生成的文件保存在同一用户空间 artifacts/ 子目录 |
| 版本追踪 | 原始文件 hashCode + user_file 元数据表 |

### 2.7 Web 管理门户

| 功能 | 说明 |
|------|------|
| 设置向导 | 首次使用时引导完成初始化配置 |
| 系统指南 | 架构总览、核心能力、场景故事、快速上手4个Tab帮助用户理解系统 |
| 工作流管理 | 查看、监控、管理所有工作流，空状态/异常区分提示 |
| 任务接入 | 创建任务、选择执行者、LUI对话模式（调研类任务） |
| 审批台 | 审批工作流和知识提交，空状态/异常区分提示 |
| 用户管理 | 创建/管理用户、分配组织、查看绑定状态 |
| 组织管理 | 创建/管理组织、成员邀请 |
| 技能管理 | 镜像站搜索安装、手动创建、版本管理、来源标识 |
| 技能维护 | ClawHub Admin Token 配置、URL/文件导入、升级检查、变更解读、确认升级 |
| 主动运营 | Admin 维护规则，触发扫描，审核洞察，派发任务，发布汇报 |
| 梦境技能发现 | 查看组织技能、审核记录、场景价值，以及 workflow_definition 候审/审批 |
| 知识导入 | 手动输入+文件上传（TXT/MD/PDF/DOCX等）、权限控制 |
| Demo 初始化 | 预置 MEDDIC 销售知识、共享文档、知识分块和基础销售图谱，方便新环境立即体验检索与图谱能力 |
| 知识审核 | 审核用户提交的知识条目（批准/共享/退回/拒绝） |
| 系统配置 | 渠道配置（飞书/企微）、LLM多模型管理（优先级+fallback）、Embedding/Rerank配置 |
| 资源监控 | Docker容器级指标（CPU/内存/网络/磁盘）、系统资源、配额管理、巡检报告 |
| 身份绑定 | 渠道身份与系统用户绑定管理 |
| 审计日志 | 记录所有关键操作（登录、创建、修改） |
| 密码管理 | 首次登录强制改密、密码强度验证（6分制） |

---

## 三、支持的渠道

### 3.1 飞书

- **接入方式**: 长连接 WebSocket
- **消息类型**: 文本消息、富文本卡片
- **特色功能**: 
  - 自动生成"响应中"状态提示
  - 身份自动绑定
  - 任务结果卡片推送

### 3.2 企业微信 (WeCom)

- **接入方式**: Webhook 回调
- **消息类型**: 文本消息
- **安全机制**: 
  - URL 签名验证 (SHA1)
  - AES-256-CBC 消息加密/解密
  - CorpID 校验

### 3.3 Web Portal

- **接入方式**: 浏览器 HTTP/HTTPS
- **安全机制**: 
  - Session Cookie + Redis 持久化
  - scrypt(N=16384) 密码哈希
  - CORS 白名单模式
  - 密码强度策略（6分制：长度+大小写+数字+特殊字符）
  - 首次登录强制修改默认密码
  - 多模型API Key安全存储

---

## 四、技术架构概览

```
┌────────────────────────────────────────────────────┐
│                    用户入口                          │
│  飞书 App  │  企业微信  │  Web Portal (浏览器)       │
└────────────┬────────────┬───────────────────────────┘
             │            │
     ┌───────┴────────────┴────────┐
     │      Gateway Adapter         │  多渠道适配
     │      (身份绑定·5路意图路由)   │
     └───┬──────┬──────┬──────┬─────┘
         │      │      │      │
    ┌────▼──┐ ┌▼────┐ ┌▼───┐ ┌▼───────┐
    │LiteLLM│ │WF Svc│ │Exec│ │Hermes  │
    │Proxy  │ │      │ │GW  │ │Adapter │
    └───────┘ └──┬───┘ └─┬──┘ └───┬────┘
                 │        │         │
    ┌────────────┴────────┴─────────┴──────────┐
    │  PostgreSQL+AGE  │  Redis  │  MinIO       │
    │  skill-library   │  resource-scheduler    │
    │  mobile-app      │  Web Portal (管理)     │
    └───────────────────────────────────────────┘
```

---

## 五、部署方式

系统支持以下部署方式：

| 方式 | 适用场景 | 说明 |
|------|----------|------|
| Docker Compose | 开发/测试/中小规模 | 一键启动全部 18 个容器 |
| 裸机部署 | 自定义环境 | 手动安装各服务依赖 |
| Kubernetes | 生产/大规模 | 配合 Helm Chart 部署 |

### 最低硬件要求

| 资源 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 4 核 | 8 核+ |
| 内存 | 8 GB | 16 GB+ |
| 磁盘 | 20 GB | 50 GB+ (SSD) |
| 网络 | 可访问互联网 (LLM API) | 低延迟稳定连接 |

---

## 六、许可证

JueYing (Agent Harness) 本体采用 **MIT** 开源许可证。

本项目使用了众多第三方开源组件，其许可证详见 [LICENSES.md](./LICENSES.md)。

---

## 七、相关文档

| 文档 | 内容 |
|------|------|
| [架构文档](./ARCHITECTURE.md) | 系统架构、数据流、API 端点速查 |
| [运维手册](./OPS.md) | 部署、监控、故障排查、备份恢复 |
| [开源协议](./LICENSES.md) | 第三方依赖许可证清单 |
| [交接文档](./HANDOFF-SESSION.md) | 开发历史与当前状态 |

---

## English Version / 英文版

# JueYing (绝影) — Product Description

> Version: 1.6.3 | Updated: 2026-05-23
> Brand Name: JueYing (绝影) | Internal Codename: agent-harness

---

## 1. Product Overview

JueYing (绝影) is an **enterprise-grade AI Agent orchestration and execution platform**. Users interact with the system through IM channels such as Feishu and WeCom. The system first checks for an approved `workflow_definition`, then falls back to reusable active skill templates, and uses Large Language Models (LLMs) to automatically plan new tasks as multi-stage workflows. When no existing path exists, the system first runs in auto-task first-run mode to establish the path, then solidifies mature paths as workflow-type skill templates. It dispatches specialized executors to complete each stage and proactively pushes explainable processes and results.

### 1.1 Product Positioning

An AI work assistant for enterprise office scenarios, enabling employees to invoke AI Agents to complete complex work tasks through the IM tools they use every day, without switching systems or learning new tools.

### 1.2 Core Value

| Value Dimension | Description |
|-----------------|-------------|
| **Zero Learning Cost** | Chat directly through Feishu/WeCom, using AI as naturally as talking to a colleague |
| **Task Automation** | Complex tasks are automatically decomposed into executable stage chains; after a successful first run, they can be solidified as reusable workflow-type skill templates |
| **Business Closed Loop** | Centered on B2B sales management, supporting boss decision-making, manager process tracking, salesperson execution, and exception escalation |
| **Unified Multi-Channel** | Feishu, WeCom, Web Portal unified access with automatic identity binding |
| **Contextual Memory** | Multi-turn conversation memory — the AI remembers previous exchanges |
| **Enterprise Security** | Organization isolation, RBAC permissions, policy control, audit logging |
| **Extensible Skills** | Install pre-built skills from the ClawHub skill marketplace; also solidify user-confirmed successful paths as private workflow-type skill templates, which admins can review and promote to org templates |

---

## 2. Core Features

### 2.1 Intelligent Chat

Users send natural language messages, and the system uses LLMs to understand intent and generate replies.

**Features:**
- Contextual memory: Maintains coherence across multi-turn conversations
- History compression: Auto-summarizes when exceeding context window
- Anonymous fallback: Memory isolation for unauthenticated users
- Intent classification: Auto-identifies chitchat / task request / knowledge submission / quick lookup

### 2.2 Long-Running Task Workflows

When a user raises a task requiring multiple steps, the system automatically performs task planning.

**Workflow Four Stages:**
```
Intent Clarification → Evidence Retrieval → Decision Reasoning → Result Reporting
        ↓                    ↓                    ↓                  ↓
   Understand needs     Find materials      Analyze & judge     Generate output
```

**Features:**
- Reuse-first: First checks approved active `workflow_definition`, then checks personal private, org, and public active workflow-type skill templates for existing paths
- Auto task decomposition: LLM breaks down complex goals into executable stages
- Multi-executor dispatch: Automatically matches the best executor based on stage type
- Process observability: Real-time stage status monitoring, with execution process, exceptions, and results explained in the final report
- Fault recovery: Pause, resume, and autonomous repair for failed stages
- Result push notification: Automatically pushes to IM channel upon completion
- User confirmation solidification: Successful first runs generate private draft workflow-type skills; user replies "confirm workflow wf_xxx" to activate and reuse; admins can promote to org templates via skill review
- Contract solidification: Workflow-type skills with high recall rate, good injection results, good business outcomes, and high audit scores enter `workflow_definition_review`; upon admin approval they are solidified as `workflow_definition`

### 2.2.1 B2B Sales Management Blueprint Scenario

JueYing's daily management blueprint is benchmarked on B2B sales teams: the boss only inputs business goals and constraints, and the Agent decomposes them into sales manager morning briefings, frontline salesperson daily eight-visit reminders, stuck-deal rescue, discount approvals, collection tracking, and weekly reviews. The system organizes red/yellow/green customer status, stage dwell time, promised actions, evidence gaps, and items requiring boss decisions into a briefing, so that management time is spent on exceptions and decisions rather than scrolling through CRM pipelines.

### 2.3 Knowledge Management

Users accumulate organizational knowledge through everyday conversations.

| Feature | Description |
|---------|-------------|
| Knowledge Submission | Users say "take a note" to write information into the knowledge base (pending review) |
| Knowledge Review | Admins review/approve/return/reject user-submitted knowledge in the Web Portal |
| Knowledge Extraction | Periodically auto-extracts structured knowledge points from conversation memory |
| Quick Lookup | Use `/find` prefix to quickly search known information (names, contact info, etc.) |

### 2.4 Memory System

| Feature | Description |
|---------|-------------|
| Session Memory | Records user/assistant messages for each conversation round |
| Context Recall | Retrieves relevant history based on the current message |
| Compression & Summary | Auto-compresses overly long conversations into summaries |
| Quota Management | Configurable max memory entries per session |

### 2.4.1 Dream Mode

A daily auto-running system for hierarchical memory management, skill discovery, and business attribution. Dream Mode not only addresses "amnesia" and context inflation, but also tracks which knowledge, memories, and skills were recalled, injected, and ultimately produced good results in real workflows.

**Hierarchical Memory Management:**
- User memory isolation: Dedicated memory space per user (owner_user_id isolation)
- Admin Agent analysis: Scheduled scanning of all user memories, LLM compression of overly long memories + knowledge point extraction
- Org-level integration: Aggregate user knowledge → deduplication & classification → integration into org knowledge base
- Memory retrieval optimization: User-level / admin-level memory routing, complete access audit logs

**Skill Discovery Ecosystem:**
- High-value scenario identification: Analyze user interaction patterns, auto-identify reusable scenarios
- Multi-dimensional skill auditing: Functionality / Security / Performance / Compatibility four-dimension scoring, ≥80 auto-promotion
- Org-level skill library: Reviewed user skills → standardization → org-wide skills
- Skill usage statistics: Daily call count / success rate / active users real-time tracking

**Hooks and Business Attribution:**
- Hook event ledger: Records `memory.recalled`, `fact.recalled`, `skill.recalled`, `skill.injected`, `outcome.evaluated`, `dream.completed`
- Knowledge recall ledger: Records whether memory / fact / document_chunk / org_memory / hermes_memory entered the Evidence Pack or model context
- Skill recall ledger: Records skill version, recall reason, whether injected into context, subsequent workflow results
- Outcome scoring: Successful, failed, and cancelled workflows all record terminal state scores, reducing sampling bias toward successes only
- Attribution dashboard: Admins view 30-day knowledge and skill recall count, success rate, average business score, and contribution score
- Workflow definition review: Admins can generate review candidates from the Dream skill discovery page, view source skill and business scores, and approve to generate stable `workflow_definition`

### 2.5 Skill System

Install pre-built skills via the ClawHub China mirror site (mirror-cn.clawhub.com) to extend Agent capabilities. All 14 skills require no API Key.

**Pre-built Skills (14 items, all free, no API Key required):**
- **Document Pro**: Full-format reading and parsing of PDF/Word/PPT/Excel/CSV/Markdown
- **Document Generator**: AI-driven auto-generation of Word/PPT/Excel reports
- **PDF Converter**: PDF ↔ Word/Excel format conversion, merge/split/compress
- **Multi Search**: DuckDuckGo + Bing + Baidu + Sogou multi-channel aggregation
- **Deep Search**: Multi-round progressive research search with automatic sub-question decomposition
- **Real-Time News**: RSS + Weibo/Zhihu/36Kr hot topic aggregation push
- **Summarize**: Intelligent content extraction from web pages/PDFs/images
- **WeCom File Bridge**: WeCom file send/receive, automatic document parsing and import into knowledge base
- **Weather**: Public weather data real-time query, 7-day forecast
- **Agent Browser**: Headless browser automation, data collection
- **Ontology**: Automatic entity/relationship extraction, AGE graph database knowledge graph construction
- **Memory Compress**: Conversational object-oriented memory storage, automatic object relationship graph construction
- **Skill Vetter**: Pre-install permission and risk review for skills
- **self-improving-agent**: Experience recording, continuous self-optimization

### 2.6 Organization & User Management

| Feature | Description |
|---------|-------------|
| Organization Isolation | Users, workflows, memories fully isolated by organization |
| Role Permissions | admin / user roles, configurable fine-grained policies |
| Invitation Management | Admins can invite members and manage their permissions |
| Audit Logging | Records all key operations (login, create, modify) |

### 2.5.1 File Storage & Management Workspace

Each user has a fully isolated personal file workspace.

| Feature | Description |
|---------|-------------|
| File Upload | Upload original documents (PDF/DOCX/XLSX etc.) via Feishu/WeCom/Web Portal |
| User Isolation | Independent storage space per user `users/{org}/{user}/` |
| Dual Backend Storage | localfs (dev) + MinIO/S3 (prod) |
| Staging Mechanism | Temporary storage in staging area before ingestion; auto-cleanup after ingestion |
| File Sharing | Three-level scope: private/shared/public |
| AI-Generated Files | LLM/workflow-generated files saved in the same user space under artifacts/ subdirectory |
| Version Tracking | Original file hashCode + user_file metadata table |

### 2.7 Web Admin Portal

| Feature | Description |
|---------|-------------|
| Setup Wizard | Guided initialization during first use |
| System Guide | Architecture overview, core capabilities, scenario stories, quick start — 4 tabs to help users understand the system |
| Workflow Management | View, monitor, manage all workflows, with empty/error state differentiated prompts |
| Task Intake | Create tasks, select executors, LUI dialogue mode (research-type tasks) |
| Approval Desk | Approve workflows and knowledge submissions, with empty/error state differentiated prompts |
| User Management | Create/manage users, assign organizations, view binding status |
| Organization Management | Create/manage organizations, member invitations |
| Skill Management | Mirror site search & install, manual creation, version management, source identification |
| Dream Skill Discovery | View org skills, audit records, scenario value, and workflow_definition review/approval |
| Knowledge Import | Manual input + file upload (TXT/MD/PDF/DOCX etc.), permission control |
| Knowledge Review | Review user-submitted knowledge items (approve/share/return/reject) |
| System Configuration | Channel configuration (Feishu/WeCom), LLM multi-model management (priority + fallback), Embedding/Rerank configuration |
| Resource Monitoring | Docker container-level metrics (CPU/Memory/Network/Disk), system resources, quota management, inspection reports |
| Identity Binding | Channel identity to system user binding management |
| Audit Logging | Records all key operations (login, create, modify) |
| Password Management | First-login forced password change, password strength validation (6-point scale) |

---

## 3. Supported Channels

### 3.1 Feishu

- **Access Method**: Long-connection WebSocket
- **Message Types**: Text messages, rich text cards
- **Notable Features**:
  - Auto-generate "responding" status indicator
  - Automatic identity binding
  - Task result card push

### 3.2 WeCom (企业微信)

- **Access Method**: Webhook callback
- **Message Types**: Text messages
- **Security Mechanisms**:
  - URL signature verification (SHA1)
  - AES-256-CBC message encryption/decryption
  - CorpID validation

### 3.3 Web Portal

- **Access Method**: Browser HTTP/HTTPS
- **Security Mechanisms**:
  - Session Cookie + Redis persistence
  - scrypt(N=16384) password hashing
  - CORS whitelist mode
  - Password strength policy (6-point scale: length + case + digits + special chars)
  - First-login forced default password change
  - Multi-model API Key secure storage

---

## 4. Technical Architecture Overview

```
┌────────────────────────────────────────────────────┐
│                  User Entry Points                   │
│  Feishu App  │  WeCom  │  Web Portal (Browser)      │
└────────────┬────────────┬───────────────────────────┘
             │            │
     ┌───────┴────────────┴────────┐
     │      Gateway Adapter         │  Multi-channel adaptation
     │  (Identity Binding · 5-way    │
     │   Intent Routing)            │
     └───┬──────┬──────┬──────┬─────┘
         │      │      │      │
    ┌────▼──┐ ┌▼────┐ ┌▼───┐ ┌▼───────┐
    │LiteLLM│ │WF Svc│ │Exec│ │Hermes  │
    │Proxy  │ │      │ │GW  │ │Adapter │
    └───────┘ └──┬───┘ └─┬──┘ └───┬────┘
                 │        │         │
    ┌────────────┴────────┴─────────┴──────────┐
    │  PostgreSQL+AGE  │  Redis  │  MinIO       │
    │  skill-library   │  resource-scheduler    │
    │  mobile-app      │  Web Portal (Admin)    │
    └───────────────────────────────────────────┘
```

---

## 5. Deployment Methods

The system supports the following deployment methods:

| Method | Suitable For | Description |
|--------|-------------|-------------|
| Docker Compose | Dev/Test/Small-to-Medium | One-click start all 18 containers |
| Bare Metal | Custom environments | Manual installation of each service dependency |
| Kubernetes | Production/Large-scale | Deploy with Helm Chart |

### Minimum Hardware Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| Memory | 8 GB | 16 GB+ |
| Disk | 20 GB | 50 GB+ (SSD) |
| Network | Internet access (LLM API) | Low-latency stable connection |

---

## 6. License

JueYing (Agent Harness) itself is open-sourced under the **MIT** license.

This project uses numerous third-party open-source components; their licenses are detailed in [LICENSES.md](./LICENSES.md).

---

## 7. Related Documents

| Document | Content |
|----------|---------|
| [Architecture Document](./ARCHITECTURE.md) | System architecture, data flows, API endpoint quick reference |
| [Operations Manual](./OPS.md) | Deployment, monitoring, troubleshooting, backup and recovery |
| [Open Source Licenses](./LICENSES.md) | Third-party dependency license list |
| [Handoff Document](./HANDOFF-SESSION.md) | Development history and current status |
