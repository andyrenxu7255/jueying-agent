import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const root = resolve(".");
const outputDir = join(root, "output", "playwright");
mkdirSync(outputDir, { recursive: true });

const port = 4184;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["apps/ops-console/server.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
child.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  const startedAt = Date.now();
  await waitForServer();
  const codePath = join(outputDir, "browser-smoke-code.js");
  writeFileSync(codePath, browserCheckCode(), "utf8");
  runCli(["open", baseUrl]);
  runCli(["run-code", "--filename", codePath]);
  runCli(["resize", "1440", "960"]);
  runCli(["screenshot", "--filename", join(outputDir, "ops-console-desktop.png"), "--full-page"]);
  runCli(["resize", "390", "844"]);
  runCli(["goto", `${baseUrl}/?view=management`]);
  runCli(["run-code", "async page => { await page.waitForLoadState('networkidle'); await page.getByText('项目泳道').waitFor({ timeout: 3000 }); const width = await page.evaluate(() => window.innerWidth); if (width > 430) throw new Error(`mobile viewport did not apply: ${width}`); }"]);
  runCli(["screenshot", "--filename", join(outputDir, "ops-console-mobile.png"), "--full-page"]);
  runCli(["close"]);
  assertFreshScreenshot(join(outputDir, "ops-console-desktop.png"), startedAt);
  assertFreshScreenshot(join(outputDir, "ops-console-mobile.png"), startedAt);
  console.log("Browser smoke OK");
} finally {
  child.kill();
  rmSync(join(outputDir, "browser-smoke-code.js"), { force: true });
  rmSync(join(root, ".playwright-cli"), { recursive: true, force: true });
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await delay(150);
    }
  }
  throw new Error(`server did not start. Output:\n${serverOutput}`);
}

function runCli(args) {
  const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  const result = spawnSync(
    process.execPath,
    [npxCli, "--yes", "--package", "@playwright/cli", "playwright-cli", ...args],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout: 120000
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(`playwright-cli ${args.join(" ")} failed\nERROR:\n${result.error?.message ?? ""}\nSTDOUT:\n${result.stdout ?? ""}\nSTDERR:\n${result.stderr ?? ""}`);
  }
}

function browserCheckCode() {
  return `async page => {
    const errors = [];
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.waitForLoadState('networkidle');
    await page.getByText('JueYing').waitFor({ timeout: 3000 });
    await page.getByText('Agent Harness').waitFor({ timeout: 3000 });
    await page.getByText('Contracts OK').waitFor({ timeout: 3000 });
    await page.getByText('角色行动队列').waitFor({ timeout: 3000 });
    await page.getByText('销售 Agent 巡检 ACME Gate 缺口').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '打开管理指挥' }).first().click();
    await page.getByText('管理指挥中心').waitFor({ timeout: 3000 });
    let currentUrl = new URL(page.url());
    if (currentUrl.searchParams.get('view') !== 'management') throw new Error('action shortcut did not persist management view in URL');
    if (currentUrl.searchParams.get('user_id') !== 'user_exec_lina') throw new Error('initial role was not persisted in URL');
    await page.getByRole('button', { name: '总览' }).click();
    await page.getByText('Role Actions').waitFor({ timeout: 3000 });
    currentUrl = new URL(page.url());
    if (currentUrl.searchParams.get('view') !== 'overview') throw new Error('overview nav did not persist in URL');
    for (const name of ['管理指挥', '销售 Gate', 'TaskGraph', '信息缺口', '外部同步', '故事线验收', '主版本能力', '契约健康', '总览']) {
      await page.getByRole('button', { name }).click();
      await page.waitForTimeout(80);
    }
    await page.getByRole('button', { name: '管理指挥' }).click();
    await page.getByText('管理指挥中心').waitFor({ timeout: 3000 });
    await page.getByText('当前登录视角').waitFor({ timeout: 3000 });
    await page.getByText('林总 / 经营负责人').waitFor({ timeout: 3000 });
    await page.getByText('登录身份').waitFor({ timeout: 3000 });
    await page.getByText('下发任务').waitFor({ timeout: 3000 });
    await page.getByText('定时任务').waitFor({ timeout: 3000 });
    await page.getByText('条件触发').waitFor({ timeout: 3000 });
    await page.getByText('项目泳道').waitFor({ timeout: 3000 });
    await page.getByText('缺信息').waitFor({ timeout: 3000 });
    await page.getByText('执行闭环').waitFor({ timeout: 3000 });
    await page.getByText('自动拆解').waitFor({ timeout: 3000 });
    await page.getByText('销售补齐竞品与客户事实').waitFor({ timeout: 3000 });
    await page.getByText('进展：已定位需要补充的客户原话和竞品功能点').waitFor({ timeout: 3000 });
    await page.getByText('结果：草稿已生成，等待销售确认客户事实和最终口径。').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '生成指挥预览' }).click();
    await page.getByText('老板要求运营 PM Agent').waitFor({ timeout: 3000 });
    await page.getByText('PM Agent 拆解：让销售 Agent 本周补齐 ACME 冠军证据').waitFor({ timeout: 3000 });
    await page.getByText('泳道：in_progress').waitFor({ timeout: 3000 });
    await page.getByText('已派给责任人补齐执行证据').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '提交指令' }).click();
    await page.getByText('cmd_live_').waitFor({ timeout: 3000 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByText('PM Agent 拆解：让销售 Agent 本周补齐 ACME 冠军证据').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: /销售 Agent/ }).click();
    await page.getByText('销售 Agent可查看管理看板').waitFor({ timeout: 3000 });
    currentUrl = new URL(page.url());
    if (currentUrl.searchParams.get('view') !== 'management') throw new Error('role switch should keep management view in URL');
    if (currentUrl.searchParams.get('user_id') !== 'sales_agent_001') throw new Error('role switch did not persist user_id in URL');
    await page.getByRole('button', { name: '生成指挥预览' }).waitFor({ state: 'disabled', timeout: 3000 });
    await page.getByText('没有下发管理指令权限').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: /林总 \/ 经营负责人/ }).click();
    await page.getByText('林总 / 经营负责人').waitFor({ timeout: 3000 });
    currentUrl = new URL(page.url());
    if (currentUrl.searchParams.get('user_id') !== 'user_exec_lina') throw new Error('executive role did not persist user_id in URL');
    await page.getByRole('button', { name: '销售 Gate' }).click();
    await page.getByText('销售六阶段 Gate').waitFor({ timeout: 3000 });
    for (const stage of ['Discover', 'Scope', 'Go / No-Go', 'Validate Solution', 'Business Case', 'Negotiate Close']) {
      await page.getByText(stage).waitFor({ timeout: 3000 });
    }
    await page.getByRole('button', { name: '提交 Evidence' }).click();
    await page.getByText(/ev_user_/).first().waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '信息缺口' }).click();
    await page.getByRole('button', { name: '提交回复' }).click();
    await page.getByText('collecting').first().waitFor({ timeout: 3000 });
    await page.locator('select[name="decision"]').selectOption('rebut');
    await page.locator('input[name="reply"]').fill('Browser smoke rebuts this gap.');
    await page.getByRole('button', { name: '提交回复' }).click();
    await page.getByText('waived').first().waitFor({ timeout: 3000 });
    await page.getByText('Browser smoke rebuts this gap.').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '外部同步' }).click();
    await page.getByRole('button', { name: '拒绝' }).first().click();
    await page.getByText('reject').first().waitFor({ timeout: 3000 });
    const rejectedWritebackText = await page.locator('#writeback-list .compact-item').filter({ hasText: 'wbi_crm_note_acme_001' }).innerText();
    if (rejectedWritebackText.includes('auto_execute')) throw new Error('rejected writeback still renders auto_execute');
    await page.getByRole('button', { name: '保存草案' }).click();
    await page.getByText('hubspot · crm').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '故事线验收' }).click();
    await page.getByText('角色故事线验收').waitFor({ timeout: 3000 });
    currentUrl = new URL(page.url());
    if (currentUrl.searchParams.get('view') !== 'storylines') throw new Error('storylines nav did not persist in URL');
    await page.getByText('销售负责人').waitFor({ timeout: 3000 });
    await page.getByText('项目经理').waitFor({ timeout: 3000 });
    await page.getByText('46/46').waitFor({ timeout: 3000 });
    await page.getByText('Operation Paths').waitFor({ timeout: 3000 });
    await page.getByText('Assertions').waitFor({ timeout: 3000 });
    await page.getByText(/\\d+\\/\\d+/).waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '主版本能力' }).click();
    await page.getByText('JueYing 主版本能力').waitFor({ timeout: 3000 });
    await page.getByText('在线运行态').waitFor({ timeout: 3000 });
    await page.getByText('JueYing Runtime').waitFor({ timeout: 5000 });
    await page.getByText('Workflow 编排主干').waitFor({ timeout: 3000 });
    for (const bar of await page.locator('.progress-bar span').evaluateAll(nodes => nodes.map(node => Number.parseFloat(node.style.width)))) {
      if (!Number.isFinite(bar) || bar < 0 || bar > 100) throw new Error('progress bar width out of bounds');
    }
    if (errors.length > 0) throw new Error(errors.join('\\n'));
    return 'ok';
  }`;
}

function assertFreshScreenshot(path, startedAt) {
  const info = statSync(path);
  if (info.size < 1000 || info.mtimeMs < startedAt) {
    throw new Error(`stale or empty browser screenshot: ${path}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
