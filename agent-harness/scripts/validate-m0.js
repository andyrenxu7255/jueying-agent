const fs = require('fs')
const path = require('path')

const root = 'D:/teamclaw/agent-harness'

const requiredPaths = [
  'package.json',
  'tsconfig.json',
  '.env.example',
  '.gitignore',
  '.dockerignore',
  'docker-compose.yml',
  'drizzle.config.ts',
  'README.md',
  'config/default.yaml',
  'config/development.yaml',
  'config/production.yaml',
  'config/litellm_config.yaml',
  'scripts/health-check.sh',
  'scripts/health-check.ps1',
  'tests/setup/jest.config.ts',
  '.eslintrc.cjs',
  'db/init/001_init_extensions.sql',
  'libs/contracts/index.ts',
  'libs/shared/index.ts',
  'libs/policy/index.ts',
  'libs/audit/index.ts',
  'apps/gateway-adapter/src/index.ts',
  'services/workflow/src/index.ts',
  'services/executor-gateway/src/index.ts'
]

let failed = false

for (const rel of requiredPaths) {
  const full = path.join(root, rel)
  const ok = fs.existsSync(full)
  console.log(`${ok ? 'OK  ' : 'MISS'} ${rel}`)
  if (!ok) failed = true
}

if (failed) {
  console.error('\nM0 validation failed')
  process.exit(1)
}

console.log('\nM0 file validation passed')
