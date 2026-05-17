import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const checks = [
  {
    name: 'planner matches private, org, then public active workflow skills',
    file: 'services/workflow/src/planner/planner.ts',
    patterns: [
      "s.scope_type = 'public'",
      "s.scope_type = 'private' AND s.owner_user_id",
      "s.scope_type = 'org' AND s.org_id",
      'extractSkillKeywords',
      'skill_scope_type'
    ]
  },
  {
    name: 'gateway extracts completed workflows as user-confirmed draft candidates',
    file: 'apps/gateway-adapter/src/index.ts',
    patterns: [
      'skill_name',
      'definition_json',
      "confirmation_status: 'pending_user'",
      'requires_user_confirmation',
      '确认工作流'
    ]
  },
  {
    name: 'workflow API exposes an observability summary for process review',
    file: 'services/workflow/src/index.ts',
    patterns: [
      'buildWorkflowObservabilitySummary',
      'observability_summary',
      'process_summary'
    ]
  },
  {
    name: 'executor attempts autonomous repair before failing a stage',
    file: 'services/executor-gateway/src/index.ts',
    patterns: [
      'auto.execute.autonomous_repair_start',
      '[autonomous-repair]',
      'repairExecutor.execute'
    ]
  }
];

const failures = [];

for (const check of checks) {
  const content = read(check.file);
  const missing = check.patterns.filter(pattern => !content.includes(pattern));
  if (missing.length > 0) {
    failures.push({ name: check.name, file: check.file, missing });
  }
}

if (failures.length > 0) {
  console.error('workflow observability smoke failed');
  for (const failure of failures) {
    console.error(`- ${failure.name} (${failure.file}) missing: ${failure.missing.join(', ')}`);
  }
  process.exit(1);
}

console.log('workflow observability smoke passed');
for (const check of checks) {
  console.log(`- ${check.name}`);
}
