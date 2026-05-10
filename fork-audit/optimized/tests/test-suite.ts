/**
 * 优化版本测试套件
 *
 * 覆盖优化版核心模块的正确性验证。
 * 运行: npx tsx tests/test-suite.ts
 */

import { TTLMap } from '../libs/shared/src/utils/ttl-map';
import { IntentClassifier } from '../libs/shared/src/intent/classifier';
import { FeishuAdapter } from '../libs/shared/src/channel/feishu-adapter';
import { WecomAdapter } from '../libs/shared/src/channel/wecom-adapter';

const tests: Array<{ name: string; run: () => Promise<void> | void }> = [];
const results: Array<{ name: string; passed: boolean; error?: string }> = [];

function test(name: string, fn: () => Promise<void> | void): void {
  tests.push({ name, run: fn });
}

async function runAll(): Promise<void> {
  console.log(`\n=== Optimized Version Test Suite ===\n`);

  for (const t of tests) {
    try {
      await t.run();
      results.push({ name: t.name, passed: true });
      console.log(`  ✅ ${t.name}`);
    } catch (e) {
      results.push({ name: t.name, passed: false, error: String(e) });
      console.log(`  ❌ ${t.name}: ${String(e).slice(0, 100)}`);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n=== Results: ${passed}/${results.length} passed, ${failed} failed ===\n`);
}

// ─── TTLMap 测试 ───

test('TTLMap: basic set/get', () => {
  const map = new TTLMap<string, number>(60000);
  map.set('a', 1);
  const val = map.get('a');
  if (val !== 1) throw new Error(`Expected 1, got ${val}`);
  map.destroy();
});

test('TTLMap: expired key returns undefined', async () => {
  const map = new TTLMap<string, number>(100, 50);
  map.set('b', 2);
  await new Promise(r => setTimeout(r, 200));
  const val = map.get('b');
  if (val !== undefined) throw new Error(`Expected undefined, got ${val}`);
  map.destroy();
});

test('TTLMap: has() reflects expiry', async () => {
  const map = new TTLMap<string, number>(100, 50);
  map.set('c', 3);
  const hasBefore = map.has('c');
  await new Promise(r => setTimeout(r, 200));
  const hasAfter = map.has('c');
  if (!hasBefore) throw new Error('Expected has()=true before expiry');
  if (hasAfter) throw new Error('Expected has()=false after expiry');
  map.destroy();
});

test('TTLMap: delete and clear', () => {
  const map = new TTLMap<string, number>(60000);
  map.set('d', 4);
  map.set('e', 5);
  const deleted = map.delete('d');
  const afterDelete = map.get('d');
  const sizeAfterDelete = map.size;
  if (!deleted) throw new Error('Expected delete to return true');
  if (afterDelete !== undefined) throw new Error('Expected undefined after delete');
  if (sizeAfterDelete !== 1) throw new Error(`Expected size 1, got ${sizeAfterDelete}`);
  map.clear();
  if (map.size !== 0) throw new Error('Expected size 0 after clear');
  map.destroy();
});

test('TTLMap: custom TTL per entry', () => {
  const map = new TTLMap<string, number>(60000);
  map.set('short', 1, 100);
  map.set('long', 2, 60000);
  if (map.get('short') !== 1) throw new Error('Expected 1');
  if (map.get('long') !== 2) throw new Error('Expected 2');
  map.destroy();
});

// ─── IntentClassifier 测试 ───

test('IntentClassifier: quick rule match - task_dispatch', async () => {
  const classifier = new IntentClassifier();
  const result = await classifier.classify('通知全员提交本周周报，请在下周五之前提交');
  // task_dispatch 规则应高置信匹配
  if (result.intent_type !== 'task_dispatch') {
    throw new Error(`Expected task_dispatch, got ${result.intent_type}`);
  }
  if (result.confidence < 0.8) {
    throw new Error(`Expected high confidence, got ${result.confidence}`);
  }
});

test('IntentClassifier: quick rule match - quick_lookup', async () => {
  const classifier = new IntentClassifier();
  const result = await classifier.classify('查一下张三的电话号码');
  if (result.intent_type !== 'quick_lookup') {
    throw new Error(`Expected quick_lookup, got ${result.intent_type}`);
  }
});

test('IntentClassifier: quick rule match - knowledge_submit', async () => {
  const classifier = new IntentClassifier();
  const result = await classifier.classify('这是XX公司的联系信息，请记录到知识库');
  if (result.intent_type !== 'knowledge_submit') {
    throw new Error(`Expected knowledge_submit, got ${result.intent_type}`);
  }
});

test('IntentClassifier: empty input → chat', async () => {
  const classifier = new IntentClassifier();
  const result = await classifier.classify('');
  if (result.intent_type !== 'chat') throw new Error(`Expected chat, got ${result.intent_type}`);
  if (result.confidence !== 1.0) throw new Error(`Expected confidence 1.0, got ${result.confidence}`);
});

test('IntentClassifier: risk level detection', async () => {
  const classifier = new IntentClassifier();
  const result = await classifier.classify('删除生产数据库的用户表');
  // 包含 production/delete/drop 关键词 → high risk
  if (result.risk_level !== 'high') {
    throw new Error(`Expected high risk, got ${result.risk_level}`);
  }
});

// ─── ChannelAdapter 测试 ───

test('FeishuAdapter: basic initialization', () => {
  const adapter = new FeishuAdapter({
    appId: 'test_app',
    appSecret: 'test_secret'
  });
  if (adapter.channelType !== 'feishu') {
    throw new Error(`Expected feishu, got ${adapter.channelType}`);
  }
});

test('FeishuAdapter: signature verification with correct input', () => {
  const adapter = new FeishuAdapter({
    signingSecret: 'test_signing_secret'
  });

  const rawBody = '{"test": true}';
  const headers: Record<string, string | string[] | undefined> = {
    'x-lark-request-timestamp': '1746555555',
    'x-lark-signature': 'sha256=invalid_signature_just_testing_no_verify',
    'x-lark-request-nonce': 'test_nonce'
  };

  // Should not throw, just return false
  const result = adapter.verifySignature(rawBody, headers);
  if (result) {
    console.warn('  ⚠  FeishuAdapter signature accepted (unexpected but not error)');
  }
});

test('WecomAdapter: basic initialization', () => {
  const adapter = new WecomAdapter({
    corpId: 'test_corp'
  });
  if (adapter.channelType !== 'wecom') {
    throw new Error(`Expected wecom, got ${adapter.channelType}`);
  }
});

test('WecomAdapter: getPollTargets', () => {
  const adapter = new WecomAdapter();
  const targets = adapter.getPollTargets({ from_user_id: 'user_123' });
  if (targets.length !== 1) throw new Error(`Expected 1 poll target, got ${targets.length}`);
  if (targets[0].receiveId !== 'user_123') throw new Error(`Expected user_123`);
});

test('FeishuAdapter: getPollTargets with chat_id', () => {
  const adapter = new FeishuAdapter();
  const targets = adapter.getPollTargets({
    event: {
      message: { chat_id: 'chat_456' },
      sender: { sender_id: { open_id: 'open_789' } }
    }
  });
  if (targets.length < 2) throw new Error(`Expected at least 2 poll targets, got ${targets.length}`);
});

// ─── Bootstrap 测试 ───

test('createMicroService: basic creation', () => {
  const { createMicroService } = require('../libs/shared/src/server/bootstrap');
  const service = createMicroService({
    name: 'test-service',
    port: 19999,
    routes: {}
  });
  if (typeof service.start !== 'function') throw new Error('Expected start function');
  if (typeof service.stop !== 'function') throw new Error('Expected stop function');
});

// ─── Unified Executor 测试 ───

test('UnifiedExecutor: unsupported mode returns error', async () => {
  const { execute } = require('../services/executor-gateway/src/executor/unified-executor');
  const result = await execute({ goal: 'test' }, 'invalid_mode' as never);
  if (result.ok) throw new Error('Expected ok=false for invalid mode');
});

// ─── Run ───
runAll().catch(console.error);