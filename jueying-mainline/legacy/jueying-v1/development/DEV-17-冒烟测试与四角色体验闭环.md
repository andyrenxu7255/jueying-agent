# DEV-17 冒烟测试与四角色体验闭环

> 日期：2026-05-17  
> 范围：`agent-harness` 主工程、Compose 开发栈、渠道冒烟、梦境模式、依赖安全、文档图谱  
> 分支：`main`  
> 远端：`https://github.com/andyrenxu7255/jueying-agent.git`

## 一、目标

本轮工作的目标不是单点修补，而是把 JueYing 的可运行性、可接管性和真实用户体验打通：先完成基础冒烟测试，修复所有直接阻断项；再从开发、运维、Admin、普通用户四个视角建立可复用的故事线；最后沿着故事线同步代码、脚本、依赖和文档，使下一次接手的人可以按同一套路径复现验证。

## 二、开发视角故事线

开发者从 `main` 分支进入项目后，先阅读 `README.md`、`ARCHITECTURE.md`、`OPS.md`、`HANDOFF-SESSION.md` 和 `用户故事线.md`，理解服务拆分、端口映射、数据库迁移和上下文图谱。随后他运行 `validate:m0`、`lint`、`type-check`、`test`、`context:audit`，用这些检查确认代码、契约和文档仍然一致。本轮发现的开发体验问题包括：M0 校验脚本仍引用旧的 Jest 配置名；Lint 中存在未使用导入和过宽类型；PDF 解析依赖命中已知漏洞；`package.json` 与锁文件曾不一致。修复后，开发者可以用同一套命令得到稳定反馈，不需要猜测脚本隐含的历史路径。

开发视角还覆盖调试效率。数据库迁移脚本现在会读取 `.env`，并能从 `POSTGRES_*` 变量拼出连接串，避免开发者明明已配置 Compose 密码却仍连接旧默认密码。渠道冒烟脚本会读取本地 `.env`，并与 Compose 的开发默认签名密钥保持一致。`smoke:eval` 的 SigNoz 健康检查改为当前实际可访问入口，避免用失效路径制造误报。开发者完成修复后，不只看到“编译通过”，还可以看到渠道、梦境、评测和上下文审计均能独立验证。

## 三、运维视角故事线

运维接管时，先关心 Compose 栈是否能被可靠拉起。LiteLLM 原镜像标签不可用会直接阻断 LLM 代理启动，因此本轮改为当前可拉取的稳定主线标签；OpenTelemetry Collector 原配置使用当前镜像不支持的 ClickHouse exporter，导致可观测链路启动不完整，因此开发栈改用 logging exporter 保持 Collector 可用。运维在本地或测试环境可以先确认服务运行，再按生产要求替换为正式采集后端。

运维继续执行 `npm run db:migrate`、`npm run health:core` 和 `npm run smoke:eval`，验证数据库、核心服务、对象存储、工作流、可观测入口和 LLM 代理。飞书长连接若缺少真实凭据可能无法完成生产态连接，但这不应阻断 Webhook 签名与异步 ACK 冒烟；运维需要把“外部凭据未配置”和“核心服务不可用”区分记录。本轮文档和脚本调整后，运维能够清楚知道哪些默认值仅用于开发，哪些密钥必须在生产替换，哪些健康检查是当前真实入口。

## 四、Admin 视角故事线

Admin 登录 Web Portal 后，会检查组织、成员、身份绑定、策略、审计、知识审核和梦境模式。梦境模式的个人分析路径需要落库 `memory_analysis_run`，测试用户若没有对应组织和用户记录，会触发外键失败。本轮在 Hermes 中增加测试运行所需的组织和用户补齐逻辑，确保 Admin 手动触发个人梦境时得到完整结果，同时返回解析后的 `org_id` 方便追踪。

Admin 的组织级治理必须严格围绕 `org_id`。本轮将组织记忆汇总、组织技能注册表和批量技能审核都改为缺少 `org_id` 即拒绝请求，避免跨组织查询或全局误读。组织记忆分析返回 `merged_to_org`，技能批量审核返回 `promoted_to_org`，让 Admin 在页面或脚本里看到的是业务动作数量，而不是抽象的技术成功标记。

## 五、普通用户视角故事线

普通用户通过飞书或企微发消息时，系统需要先通过签名校验和身份解析，再走不同路径：快查进入 quick lookup，普通聊天进入 Hermes 记忆召回，知识提交进入待审核池，复杂任务进入 Workflow。此前 quick lookup 没有携带 `org_id`，会让后续检索缺少组织隔离上下文；本轮已补齐。飞书消息冒烟也兼容异步 ACK，符合真实平台事件处理节奏；重复事件允许被识别为重复或异步接收，避免开发烟测与生产行为相互冲突。

用户上传 PDF 时，系统不再依赖存在已知漏洞的 `pdf-parse`，改用 `pdfjs-dist` 提取文本内容。若解析失败，Gateway 会按既有降级逻辑记录警告并继续处理其他内容，不把单个附件问题扩大成整条消息失败。用户感受到的是消息被接住、任务被推进、结果有回应，而不是内部服务或依赖细节。

## 六、本轮修复清单

| 类别 | 修复 |
|------|------|
| 冒烟脚本 | `validate-m0` 指向真实 Jest 配置；渠道烟测读取 `.env` 并兼容异步 ACK；SigNoz 健康检查命中当前入口 |
| Docker/运维 | LiteLLM 镜像标签可拉取；OTel Collector 开发栈 exporter 与镜像能力一致；Gateway 开发签名默认值与烟测一致 |
| 数据库 | SQL 迁移脚本读取 `.env`，并从 `POSTGRES_*` 生成连接串 |
| 用户体验 | quick lookup 补齐 `org_id`；梦境分析补齐测试用户组织记录；Admin 结果字段更贴近业务语义 |
| 安全依赖 | `pdf-parse` 替换为 `pdfjs-dist`；OpenTelemetry 直接依赖升级到消除 high 审计项的版本 |
| 文档图谱 | 新增四角色体验闭环故事线；同步交接、架构、审计和上下文图谱 |

## 七、验收命令

本轮收口以以下命令为准：

```bash
npm run lint
npm run type-check
npm test
npm run validate:m0
npm run context:audit
npm run health:core
npm run smoke:eval
npm run smoke:channels
npm run test:dream-mode
npm audit --audit-level=high
```

## 八、剩余风险

`npm audit` 仍可能保留与 `drizzle-kit` 开发依赖链相关的 moderate 级 `esbuild` 提示。该风险来自本地开发服务器读取场景，不进入生产运行时；若后续需要清零 moderate，需要单独评估 Drizzle 迁移工具链版本兼容性。真实飞书长连接、正式 LLM Key、生产级 ClickHouse/SigNoz 存储后端仍依赖部署环境凭据与运维配置。
