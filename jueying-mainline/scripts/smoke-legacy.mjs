import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(".");
const legacyRoot = join(root, "legacy", "jueying-v1", "agent-harness");
const checks = [
  {
    label: "legacy validate:m0",
    command: process.execPath,
    args: ["scripts/validate-m0.js"],
    cwd: legacyRoot
  },
  {
    label: "legacy portal localization syntax",
    command: process.execPath,
    args: ["--check", "apps/web-portal/static/localization.js"],
    cwd: legacyRoot
  },
  {
    label: "legacy portal app syntax",
    command: process.execPath,
    args: ["--check", "apps/web-portal/static/app.js"],
    cwd: legacyRoot
  }
];

const failures = [];

for (const check of checks) {
  const result = spawnSync(check.command, check.args, {
    cwd: check.cwd,
    encoding: "utf8",
    shell: false,
    timeout: 60000
  });
  if (result.error || result.status !== 0) {
    failures.push({
      label: check.label,
      error: result.error?.message ?? "",
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    });
  }
}

if (failures.length > 0) {
  console.error("Legacy smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure.label}`);
    if (failure.error) console.error(`  error: ${failure.error}`);
    if (failure.stdout.trim()) console.error(`  stdout: ${failure.stdout.trim().slice(0, 1200)}`);
    if (failure.stderr.trim()) console.error(`  stderr: ${failure.stderr.trim().slice(0, 1200)}`);
  }
  process.exit(1);
}

console.log(`Legacy smoke OK: ${checks.length} checks`);
