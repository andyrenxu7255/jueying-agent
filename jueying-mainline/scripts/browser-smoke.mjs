import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  await waitForServer();
  const codePath = join(outputDir, "browser-smoke-code.js");
  writeFileSync(codePath, browserCheckCode(), "utf8");
  runCli(["open", baseUrl]);
  runCli(["run-code", "--filename", codePath]);
  runCli(["close"]);
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
    await page.getByRole('button', { name: /销售 Agent/ }).click();
    await page.getByText('销售 Agent可查看管理看板').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '生成指挥预览' }).waitFor({ state: 'disabled', timeout: 3000 });
    await page.getByText('没有下发管理指令权限').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: /林总 \/ 经营负责人/ }).click();
    await page.getByText('林总 / 经营负责人').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '故事线验收' }).click();
    await page.getByText('角色故事线验收').waitFor({ timeout: 3000 });
    await page.getByText('销售负责人').waitFor({ timeout: 3000 });
    await page.getByText('项目经理').waitFor({ timeout: 3000 });
    await page.getByText('46/46').waitFor({ timeout: 3000 });
    await page.getByText('Operation Paths').waitFor({ timeout: 3000 });
    await page.getByText('Assertions').waitFor({ timeout: 3000 });
    await page.getByText('478/478').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '主版本能力' }).click();
    await page.getByText('JueYing 主版本能力').waitFor({ timeout: 3000 });
    await page.getByText('在线运行态').waitFor({ timeout: 3000 });
    await page.getByText('JueYing Runtime').waitFor({ timeout: 5000 });
    await page.getByText('Workflow 编排主干').waitFor({ timeout: 3000 });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: 'output/playwright/ops-console-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '管理指挥' }).click();
    await page.getByText('项目泳道').waitFor({ timeout: 3000 });
    await page.screenshot({ path: 'output/playwright/ops-console-mobile.png', fullPage: true });
    if (errors.length > 0) throw new Error(errors.join('\\n'));
    return 'ok';
  }`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
