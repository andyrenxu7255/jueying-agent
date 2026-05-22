# JueYing v1.6.2 综合审计报告

日期：2026-05-22

## 审计范围

- 文档：`README.md`、`RELEASE_NOTES.md`、`agent-harness/README.md`、`agent-harness/PRODUCT.md`、`agent-harness/OPS.md`、`development/HANDOFF-2026-05-22-i18n.md`
- 图谱：`development/context-graph.json`、`development/context-routing.json`
- 架构：Web Portal i18n、后端 i18n、workflow_definition review、Dream attribution、发布配置
- 代码：Web Portal 前端渲染、Web Portal API、依赖锁文件、敏感文件入库规则
- 安全：npm audit、密钥模式扫描、敏感文件跟踪检查、XSS/路径拼接检查、CORS/SSL/SQL/命令调用抽样

## 发现与修复

| 编号 | 严重级别 | 类型 | 发现 | 修复 |
|---|---|---|---|---|
| AUD-01 | 中 | 依赖安全 | `brace-expansion` 与 `ws` 存在 moderate 传递依赖 advisories | 执行 `npm audit fix`，升级到 `brace-expansion@5.0.6`、`ws@8.20.1`，审计清零 |
| AUD-02 | 中 | 前端安全 | Web Portal 多处动态值进入 HTML 属性，依赖通用文本转义和隐含可信前提 | 新增 `escapeAttr()`，统一属性输出；`escapeHtml()` 增补单引号转义 |
| AUD-03 | 中 | 路径健壮性 | 多处动态 REST path 直接拼接 id | 改为 `encodeURIComponent()` 后再拼接 |
| AUD-04 | 中 | 敏感文件防护 | 根目录 `.gitignore` 未覆盖 `.env`、私钥、证书、凭据 JSON | 补齐敏感文件规则，保留 `.env.example` |
| AUD-05 | 中 | 文档一致性 | 对外发布入口仍显示 v1.6.0/1.5.0 | 更新到 v1.6.2，并新增本轮审计入口 |
| AUD-06 | 中 | 运维安全 | OPS 中暴露本地开发密码示例为当前值 | 改为占位符与环境变量注入说明 |
| AUD-07 | 中 | 图谱完整性 | i18n 新增文件未进入 source authority mapping | `context-graph.json` 升到 v2.10，纳入 `localization.js` 与 `i18n.ts` |

## 验证结果

已执行：

```bash
node --check apps/web-portal/static/app.js
node --check apps/web-portal/static/localization.js
node -e "JSON.parse(...)"
npm run lint
npx tsc --noEmit -p tsconfig.json
npm run build
npm test
npm run context:audit
npm audit --audit-level=moderate
git diff --check
```

结果：

- JavaScript 语法检查通过。
- JSON 图谱与路由解析通过。
- Lint、TypeScript、Build 全部通过。
- Jest 通过：8 个测试套件 / 82 个用例。
- Context graph audit 通过：M1 / M2 / M3 三个 profile。
- npm audit：0 vulnerabilities。
- `git diff --check`：通过。

## 保留限制

- 后端语言偏好仍未与用户 profile 自动绑定，当前由请求 `Accept-Language` 或调用方显式语言决定。
- Web Portal 仍采用单文件静态前端，已加固转义边界，但后续若持续扩展页面，建议迁移到组件化渲染或模板安全 API。
- 历史开发/审计文档中的旧版本号和旧默认密码示例保留为历史记录；对外入口和当前运维手册已更新。
