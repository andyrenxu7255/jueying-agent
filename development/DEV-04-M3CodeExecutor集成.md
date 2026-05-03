# M3：Code Executor集成

> **工期**: 4天 | **前置条件**: M2完成 | **阻塞条件**: M2验收通过

---

## M3.1 前置约束

- M2全部验收通过
- 文档18中执行会话模型、Adapter操作面、标准执行循环已冻结

---

## M3.2 任务清单

### M3.2.1 执行会话管理

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M3-01 | 实现Code Executor Session API | 在services/executor-gateway实现：POST /internal/code-executor/sessions（创建会话）、POST .../run（启动执行）、POST .../resume（从checkpoint恢复）、POST .../terminate（终止清理） | Code Executor Session API | 会话创建/启动/恢复/终止完整 | AH1-15 §15.4.6 |
| M3-02 | 实现Worktree隔离 | 基于git worktree实现隔离：每个execution_session创建独立worktree，路径 <executor_root>/worktrees/<workflow_id>/<stage_seq>/，分支策略 wf/<workflow_id>/st/<seq> | Worktree Manager | 多个执行会话不互相污染 | AH1-18 §18.5 |

### M3.2.2 执行能力

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M3-03 | 实现Code Executor Adapter（opencode-adapter） | 基于opencode的project/session/patch/tool设计模式，实现TypeScript薄适配层：接收阶段目标，创建隔离执行环境，调用LLM完成代码修改，产出patch artifact | Code Executor Adapter | 能完成代码修改并产出patch | AH1-18 §18.3.1 |
| M3-04 | 实现Patch Artifact | 实现patch生成与存储：基于unified diff格式生成patch，上传MinIO，写artifact_object元数据（artifact_type=patch） | Patch Artifact服务 | patch可生成、存储、读取 | AH1-22 §22.3 |
| M3-05 | 实现验证执行器 | 实现Verification Executor：运行测试命令，收集测试结果，输出PASS/FAIL/PARTIAL，失败时记录失败证据和auto_repair_allowed标志 | Verification Executor | 验证结果正确分类 | AH1-18 §18.9 |
| M3-06 | 实现修复执行器 | 实现Repair Executor：基于失败证据进行小步修复，修复次数受max_repairs限制，达到上限后交回Workflow | Repair Executor | 修复循环受控，达上限交回 | AH1-17 §17.16.5 |

### M3.2.3 调度与隔离

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|
| M3-07 | 实现Executor智能调度 | 使用BullMQ实现ExecutorScheduler：优先级队列（开发>分析>知识查询），非开发任务绕行到generic-executor，4并行槽位管理，排队超限处理（<30s正常排队，30s-2min进度通知，>2min告警，>5min进入blocked） | Executor Scheduler | 调度策略正确，排队超限处理正确 | AH1-18 §18.7.1 |
| M3-08 | 实现上下文隔离 | 实现Code Executor独立上下文窗口：只接收阶段契约中的inputs，不继承OpenClaw主上下文，上下文管理策略（保留任务描述+最近3轮、>60%压缩、>80%丢弃、>95%强制截断），代码上下文按需加载（max_files=20, max_lines_per_file=200） | 上下文隔离 | Code Executor上下文与OpenClaw完全隔离 | AH1-18 §18.13 |
| M3-09 | 实现Execution Checkpoint | 实现Code Executor专用checkpoint：记录execution_session_id、repo_ref、branch_ref、worktree_ref、base_commit_hash、最近patch ref、最近test result ref、后续恢复提示 | Execution Checkpoint | 执行中断后可从checkpoint恢复 | AH1-19 §19.3.3 |

### M3.2.4 LLM与Subagent

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M3-10 | 实现LLM Provider Adapter | 通过LiteLLM代理+Vercel AI SDK实现LLM调用：LiteLLM处理Provider路由/熔断/成本追踪，Vercel AI SDK处理streamText/tool-call，token统计从LiteLLM回调获取 | LLM Adapter | 主供应商失败自动切换，成本可追踪 | AH1-26 §26.6.1 |
| M3-11 | 实现Subagent执行循环 | 实现Subagent机制：code-subagent在阶段内自治执行（理解任务->选择工具->执行动作->观察结果->判断完成），独立上下文窗口，停止条件（acceptance满足/max_iterations/上下文>90%/hard_timeout/连续3次无效响应） | Subagent循环 | Subagent可自治执行并受停止条件约束 | AH1-17 §17.18 |
| M3-12 | P0-5 PoC：Code Executor Adapter | 创建开发任务Workflow，进入Code Executor阶段，执行代码修改，运行测试，制造失败触发修复，产出patch/日志/test result/checkpoint | PoC报告 | 实现-验证-修复闭环可跑通 | AH1-24 §24.9 |

---

## M3.3 验收门槛

- P0-5通过：开发任务可跑通计划-实现-验证-修复闭环
- patch、测试结果、checkpoint能回写
- 修复循环受max_repairs限制
- Code Executor上下文与OpenClaw完全隔离
- 未携带policy_snapshot_hash时执行被拒绝

---

## M3.4 执行会话状态机

created -> preparing -> ready -> running -> (verifying | repairing) -> (completed | failed | terminated)

---

## M3.5 上下文隔离层级

| 隔离层 | 手段 | 说明 |
|--------|------|------|
| 文件系统 | Git Worktree | 每个执行会话独立工作目录 |
| 上下文窗口 | Subagent独立上下文 | 不共享OpenClaw主上下文 |
| 进程 | 独立进程/容器 | 执行命令在隔离环境中运行 |

---

## M3.6 下一步

验收通过后，进入 M4：Hermes增强接入
