# DEV-19 B2B 故事线系统验收与 UI 冒烟

## 目标

本轮验收围绕 DEV-18 定义的 B2B 销售管理故事线，确认现有系统是否能支撑“先匹配既有 workflow、未命中则自主规划、异常自修复、完成后说明过程与结果、用户确认后沉淀为 workflow”的闭环。同时检查依赖、自动化测试、门户界面内容和本地启动路径。

## 修复项

1. `libs/shared/src/config/manager.ts`
   - 修复服务从 `apps/*` 或 `services/*` 子目录启动时找不到 `config/default.yaml` 的问题。
   - 配置管理器现在会从当前工作目录向上查找仓库配置根目录，也支持 `AGENT_HARNESS_CONFIG_ROOT` 显式指定。

2. `apps/web-portal/static/app.js`
   - 系统指南的场景故事线从 20 条更新为 21 条。
   - 新增“B2B 销售管理日常闭环”故事，覆盖老板、销售经理、一线销售、Admin 的日常使用场景。
   - 快速上手中补充“先匹配已确认 workflow，未命中时自动规划”和“确认工作流 wf_xxx”的复用路径。

3. `services/fact-retrieval/src/support.test.ts`
   - 测试用例改为使用规范化 `u_...` 用户引用。
   - 增加原始渠道身份引用 `feishu:user_abc123` 被拒绝的断言，匹配当前身份安全边界。

4. Docker 镜像与运行健康检查
   - 修复 Node 工作区镜像构建时缺少 `package-lock.json` 和跨 workspace 源码的问题，覆盖 Web Portal、Gateway、Mobile App 以及 7 个服务镜像。
   - 修复 SigNoz、ClickHouse、Feishu LongConn 健康检查在容器内使用 `localhost` 导致的不可用问题，统一改为明确的本机监听地址。
   - 为 OTel Collector 增加健康检查扩展，为 Feishu LongConn 增加常驻健康端口。
   - Web Portal 镜像安装 Docker CLI，并在 Compose 中挂载 `/var/run/docker.sock`、为非 root `appuser` 增加 socket 所属组访问权限，使“Docker 容器监控”区块可读取宿主容器状态。

5. `apps/web-portal/src/index.ts` 与 `apps/web-portal/static/app.js`
   - 恢复门户页签、按钮等既有页面交互，解决 CSP 拦截内联事件导致“场景故事”等内容无法点击的问题。
   - 补齐 Web Portal 到 Workflow Service 的列表、详情、创建和审批代理，用户可从任务接入创建 B2B 销售任务，并在 Workflow 控制台查看阶段计划。
   - 补齐组织管理本地数据库接口，修复 Admin 任务分发页面加载组织列表失败的问题。
   - 补齐资源配额与巡检代理，修复资源监控页面配额卡片、巡检表无法加载或服务名显示为空的问题。
   - 将 `app.js` 改为 no-cache，避免部署后浏览器继续使用旧门户脚本。

6. `scripts/smoke-eval.js`
   - SigNoz 查询健康检查改为 `/api/v1/health`。
   - 冒烟用户和策略 hash 每次运行唯一化，避免被已有活跃工作流并发限制误伤。
   - 工作流规划等待时间从 30 秒放宽到 60 秒，匹配真实模型调用波动。

## 验收结果

### 代码与依赖

- `npm audit --audit-level=moderate`：通过，0 个漏洞。
- `npm run lint`：通过。
- `npm run type-check`：通过。
- `npm test`：通过，8 个测试套件、81 条测试。
- `npm run validate:m0`：通过。
- `npm run build`：通过。
- `npm run context:audit`：通过。
- `npm run smoke:workflow-observability`：通过。
- `npm run smoke:channels`：通过，16/16。
- `npm run test:dream-mode`：通过，14/14。
- `npm run test:task-dispatch`：通过，37/37。
- `npm run smoke:eval`：通过，33/33。
- `docker compose config --quiet`：通过。
- `docker compose ps`：全服务 healthy。

### 界面体验

- 单独从 `apps/web-portal` 启动门户成功，验证了子目录启动路径。
- 无数据库时首屏进入初始化向导，并明确显示“数据库连接”步骤，符合首次部署/运维接管状态。
- 通过 Playwright 检查系统指南：
  - 桌面宽度：21 条故事线可见，新增 B2B 故事线可见，无横向溢出，无控制台错误。
  - 移动宽度：21 条故事线可见，新增 B2B 故事线可见，无横向溢出。
  - 快速上手页包含“分析本周华东区回款风险”和“确认工作流 wf_xxx”示例。
- 通过 Playwright 检查真实运行门户：
  - Admin 登录后可见共享、调度、梦境模式等专属导航。
  - 系统指南页签可点击，21 条故事线正常切换显示。
  - 任务接入页可提交“B2B 销售经理晨会”任务，Workflow 控制台显示运行中的工作流，详情页显示阶段计划。
  - 任务分发页可打开创建表单，组织下拉列表正常加载。
  - 资源监控页可加载配额卡片和服务巡检报告，控制台无错误，页面无横向溢出。
  - Web Portal API `/api/admin/container-stats` 返回 `docker_available=true`，可读取 26 个运行容器。

### 环境限制

- Docker 在线后，本轮已完成依赖全栈的渠道、梦境、任务分发和在线评测冒烟。
- Docker 容器监控需要 Web Portal 挂载宿主 `/var/run/docker.sock`。当前 Compose 已配置该挂载，并通过 `group_add: ["0"]` 让非 root `appuser` 访问 Docker Desktop 的 `root:root 660` socket。

## 结论

代码层面已覆盖 DEV-18 的工作流可观测与确认复用路径，门户内容也已把 B2B 销售管理故事线展示给 Admin、运维、开发和业务用户。Docker 全栈在线后，关键服务健康、自动化测试、在线冒烟和真实门户体验均已通过；本轮发现的镜像构建、健康检查、CSP 交互、工作流代理、组织接口、资源配额与巡检显示问题均已修复。
