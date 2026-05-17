# DEV-18 B2B 销售故事线与工作流可观测闭环

## 背景

上一版“故事线二十一”更像技术验收说明，缺少真实用户每天如何使用系统的场景细节。本轮以 B2B 销售管理为样板，重新定义产品验收基准：老板只做经营决策，销售经理盯过程，一线销售完成拜访和跟进，Admin 负责组织规则与 workflow 治理，运维和开发用同一条故事线检查系统是否可信。

## 目标故事线

用户提出一个任务后，系统必须先查是否存在既有 workflow。匹配顺序为个人私有 workflow、组织 workflow、公共技能。若没有命中，系统进入首跑模式，自主生成执行路径；执行过程中如果阶段失败且允许修复，先进行一次自主修复；完成后向用户说明过程、异常和结果。用户认可后回复“确认工作流 wf_xxx”，系统把这条路径激活为个人私有 workflow，下次类似任务优先使用。管理员可在审核后提升为组织 workflow。

## B2B 销售场景基准

老板周一早上只发一句“本周把华东区回款风险降下来，两个重点客户推进到 closing”。系统需要输出目标缺口、红色异常和需老板拍板事项，而不是把 CRM 明细原样堆给他。

销售经理每天 9:00 看晨会清单，20:30 看夕会异常。系统按每日八访、客户温度、阶段停留、承诺动作和证据缺口生成红黄绿状态，让经理只处理例外。

一线销售在客户沟通后用自然语言记录进展。系统自动更新客户阶段、下一步、承诺时间和风险提醒，并在卡单时给出诊断路径和下一步话术。

Admin 将折扣红线、回款证据、知识审核和 workflow 提升规则固化为组织治理。成功路径先由用户确认，再进入组织审核。

## 本轮代码落点

| 文件 | 变更 |
|------|------|
| `agent-harness/apps/gateway-adapter/src/index.ts` | 完成回执展示执行过程；支持“确认工作流 wf_xxx”；提取待确认 workflow 候选 |
| `agent-harness/services/workflow/src/planner/planner.ts` | private/org/public active skill 匹配，销售关键词增强 |
| `agent-harness/services/workflow/src/index.ts` | workflow observability summary |
| `agent-harness/services/executor-gateway/src/index.ts` | 失败阶段自主修复一次 |
| `agent-harness/scripts/workflow-observability-smoke.mjs` | workflow 可观测与沉淀路径烟测 |
| `agent-harness/scripts/channel-webhook-smoke.mjs` | 渠道烟测事件编号唯一化，支持重复运行 |
| `agent-harness/package.json` | override 安全版 esbuild，清零 npm audit 漏洞 |

## 验收脚本

```bash
npm run smoke:workflow-observability
npm run lint
npm run type-check
npm test
npm run validate:m0
npm run context:audit
npm audit --audit-level=moderate
```

## 文档同步

`用户故事线.md` 的故事线二十一已重写为 B2B 销售管理日常；`ARCHITECTURE.md`、`PRODUCT.md`、`README.md`、`HANDOFF-SESSION.md` 已同步“既有 workflow 优先、首跑自主规划、异常自主处理、过程可观测、确认后复用”的路径。
