import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function assertContains(label, content, needles) {
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length > 0) {
    throw new Error(`${label} missing: ${missing.join(', ')}`);
  }
}

function assertMentionsScripts(label, content, scripts) {
  const missing = scripts.filter((script) => {
    return !content.includes(`\`${script}\``) && !content.includes(`\`npm run ${script}\``);
  });
  if (missing.length > 0) {
    throw new Error(`${label} missing scripts: ${missing.join(', ')}`);
  }
}

const dev22 = read('../development/DEV-22-用户视角全链路测试设计.md');
const userStories = read('用户故事线.md');
const graph = JSON.parse(read('../development/context-graph.json'));
const pkg = JSON.parse(read('package.json'));

const requiredRoles = ['Admin', '老板/负责人', '销售经理', '一线销售', '运维', '开发', '系统自动'];
const requiredJourneys = Array.from({ length: 14 }, (_, index) => `UJ-${String(index + 1).padStart(2, '0')}`);
const requiredScripts = [
  'validate:m0',
  'lint',
  'type-check',
  'test',
  'test:portal-static',
  'test:portal-admin',
  'test:task-dispatch',
  'test:dream-mode',
  'test:proactive',
  'smoke:channels',
  'smoke:eval',
  'smoke:workflow-observability',
  'build',
  'context:audit'
];

assertContains('DEV-22 roles', dev22, requiredRoles);
assertContains('DEV-22 journeys', dev22, requiredJourneys);
assertMentionsScripts('DEV-22 automation commands', dev22, requiredScripts);
assertContains('User stories baseline', userStories, ['故事线二十一', '主动运营', 'B2B 销售管理']);

for (const script of requiredScripts) {
  if (typeof pkg.scripts?.[script] !== 'string') {
    throw new Error(`package.json missing script: ${script}`);
  }
}

const l1Docs = new Set(graph.layers?.L1_execution || []);
if (!l1Docs.has('development/DEV-22-用户视角全链路测试设计.md')) {
  throw new Error('context-graph missing DEV-22 in L1_execution');
}

if (!graph.task_profiles?.user_journey_uat) {
  throw new Error('context-graph missing user_journey_uat profile');
}

const profile = graph.task_profiles.user_journey_uat;
assertContains('user_journey_uat authority', JSON.stringify(profile.authority || []), [
  'AH1-15-核心接口与事件契约.md',
  'AH1-16-权限Scope-Policy-Snapshot.md',
  'AH1-17-Workflow-DSL与Planner契约.md',
  'AH1-21-渠道接入与Session映射.md'
]);
assertContains('user_journey_uat execution', JSON.stringify(profile.execution || []), [
  'development/DEV-22-用户视角全链路测试设计.md'
]);

console.log(JSON.stringify({
  pass: true,
  roles: requiredRoles.length,
  journeys: requiredJourneys.length,
  scripts: requiredScripts.length,
  graph_profile: 'user_journey_uat'
}, null, 2));
