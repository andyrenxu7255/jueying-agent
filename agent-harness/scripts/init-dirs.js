const fs = require('fs');
const path = require('path');

const dirs = [
  // apps
  'apps/gateway-adapter/src/channels',
  'apps/gateway-adapter/src/auth',
  'apps/gateway-adapter/src/middleware',
  'apps/gateway-adapter/src/routes',
  'apps/gateway-adapter/src/services',
  'apps/gateway-adapter/src/utils',
  'apps/gateway-adapter/tests',
  'apps/web-portal/src',
  
  // services
  'services/workflow/src/engine',
  'services/workflow/src/planner',
  'services/workflow/src/retrieval',
  'services/workflow/src/stages',
  'services/workflow/src/checkpoint',
  'services/workflow/src/events',
  'services/workflow/tests',
  
  'services/fact-retrieval/src/structured',
  'services/fact-retrieval/src/fulltext',
  'services/fact-retrieval/src/vector',
  'services/fact-retrieval/src/graph',
  'services/fact-retrieval/src/rerank',
  'services/fact-retrieval/src/evidence',
  'services/fact-retrieval/tests',
  
  'services/executor-gateway/src/session',
  'services/executor-gateway/src/sandbox',
  'services/executor-gateway/src/adapter',
  'services/executor-gateway/src/collector',
  'services/executor-gateway/src/security',
  'services/executor-gateway/tests',
  
  'services/hermes-adapter/src',
  'services/hermes-adapter/tests',
  
  // libs
  'libs/contracts/schemas',
  'libs/contracts/events',
  'libs/contracts/errors',
  'libs/contracts/types',
  
  'libs/policy/src',
  'libs/policy/tests',
  
  'libs/audit/src',
  'libs/audit/tests',
  
  'libs/shared/src/config',
  'libs/shared/src/logging',
  'libs/shared/src/metrics',
  'libs/shared/src/retry',
  'libs/shared/src/rate-limit',
  'libs/shared/tests',
  
  // db
  'db/migrations',
  'db/queries/structured',
  'db/queries/fulltext',
  'db/queries/vector',
  'db/age/projections',
  
  // config
  'config/schemas',
  
  // docker
  'docker',
  
  // tests
  'tests/fixtures',
  'tests/helpers',
  'tests/setup',
  
  // scripts
  'scripts/backup'
];

const root = 'D:/teamclaw/agent-harness';

dirs.forEach(dir => {
  const fullPath = path.join(root, dir);
  fs.mkdirSync(fullPath, { recursive: true });
  console.log(`Created: ${dir}`);
});

console.log('\nAll directories created successfully!');
