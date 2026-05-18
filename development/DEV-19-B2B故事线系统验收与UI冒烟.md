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
- `docker compose config --quiet`：通过。

### 界面体验

- 单独从 `apps/web-portal` 启动门户成功，验证了子目录启动路径。
- 无数据库时首屏进入初始化向导，并明确显示“数据库连接”步骤，符合首次部署/运维接管状态。
- 通过 Playwright 检查系统指南：
  - 桌面宽度：21 条故事线可见，新增 B2B 故事线可见，无横向溢出，无控制台错误。
  - 移动宽度：21 条故事线可见，新增 B2B 故事线可见，无横向溢出。
  - 快速上手页包含“分析本周华东区回款风险”和“确认工作流 wf_xxx”示例。

### 环境限制

- `npm run smoke:channels` 需要 gateway 等服务在线。本机 Docker Desktop/Linux engine 未运行，`localhost:3000` 与 `localhost:3003` 未监听，因此通道冒烟被环境阻断。
- `npm run test:dream-mode` 需要 Hermes 与 Skill Library 在线，当前环境全部请求失败于 `fetch failed`，未进入业务断言。
- `npm run test:task-dispatch` 需要 Gateway 与 Web Portal 在线，当前环境健康检查失败；其中 12 条静态意图分类用例通过，25 条在线服务用例被服务不可达阻断。
- `docker compose config --quiet` 已通过，说明 Compose 配置本身可解析。

## 结论

代码层面已覆盖 DEV-18 的工作流可观测与确认复用路径，门户内容也已把 B2B 销售管理故事线展示给 Admin/运维/业务用户。当前剩余限制不是代码失败，而是本地 Docker 服务未启动导致无法执行依赖全栈在线服务的通道冒烟。
