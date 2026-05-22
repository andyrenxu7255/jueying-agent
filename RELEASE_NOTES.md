# JueYing v1.6.2 - Bilingual UX and Audit Hardening

发布日期：2026-05-22

## 摘要

v1.6.2 是 v1.6 发布线的发布前硬化版本。它保留 v1.6.0 的 Dream Hooks、Outcome Attribution、Workflow Reviews 主能力，承接 v1.6.1 的中英文双语适配，并完成一轮文档、图谱、架构、代码和安全审计后的修复收口。

## 本次修复

- 前端 Web Portal 的动态属性输出增加统一转义，降低配置 meta、组织/任务/技能等动态值进入 HTML 属性时的 XSS 风险。
- 多处动态 REST 路径参数改为 `encodeURIComponent()`，避免特殊字符导致错误路由或路径拼接异常。
- npm 传递依赖安全补丁已应用：`brace-expansion` 升级到 `5.0.6`，`ws` 升级到 `8.20.1`。
- `.gitignore` 补齐 `.env`、私钥、证书、凭据 JSON 等敏感本地文件规则，保留 `.env.example` 可入库。
- 发布入口文档同步到 v1.6.2，并明确 v1.6.1 双语化交接与本轮综合审计记录。
- 上下文图谱同步到 v2.10，纳入前端 `localization.js` 和后端 `i18n.ts` 关键文件映射。

## v1.6 发布线核心能力

- 增加 hook-style 生命周期事件账本，覆盖 `memory.recalled`、`fact.recalled`、`skill.recalled`、`skill.injected`、`workflow.confirmed`、`outcome.evaluated`、`dream.completed`。
- 增加知识和 skill 召回账本，让检索和技能使用可以在事后被度量。
- 增加 workflow outcome 评估，成功、失败、取消三类终态都会写入结果。
- 增加召回到 outcome 的归因表，以及知识/skill 的日级业务效果视图。
- 增加 `workflow_definition_review` 审批桥：高召回、高业务分、高审核分的 workflow 型 skill 会进入管理员候审，批准后固化为 `workflow_definition`。
- Web Portal 和关键后端用户消息完成中英文双语化，前端语言偏好持久化到本地浏览器。

## 验证结果

2026-05-22 已验证：

```bash
npm run lint
npx tsc --noEmit -p tsconfig.json
npm run build
npm test
npm run context:audit
npm audit --audit-level=moderate
```

结果：

- Lint 通过。
- TypeScript 类型检查通过。
- Build 通过。
- Jest 通过：8 个测试套件 / 82 个用例。
- Context graph audit 通过：M1 / M2 / M3 三个 task profile。
- 依赖审计：0 个漏洞。

## 升级说明

从 v1.6.1 升级到 v1.6.2 不需要新增数据库迁移。部署前请重新安装依赖或使用更新后的 lockfile 构建镜像：

```bash
cd agent-harness
npm install
npm run build
```

生产环境仍需使用 `docker-compose.prod.yml`，并通过环境变量提供所有密钥，禁止使用本地开发默认密码。
