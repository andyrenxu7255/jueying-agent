/** @type {import('jest').Config} */
module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.cjs',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'Node',
        esModuleInterop: true,
        target: 'ES2022',
        strict: true,
        skipLibCheck: true
      },
      diagnostics: { ignoreCodes: [151002, 2307, 2339, 2540] }
    }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  collectCoverageFrom: [
    'apps/gateway-adapter/src/services/file-validator.ts',
    'apps/gateway-adapter/src/services/gateway-state.ts',
    'apps/gateway-adapter/src/services/session-mapper.ts',
    'libs/contracts/errors/codes.ts',
    'libs/contracts/events/types.ts',
    'libs/contracts/schemas/envelope.ts',
    'libs/contracts/schemas/evidence.ts',
    'libs/contracts/schemas/workflow.ts',
    'libs/contracts/src/stage-defaults.ts',
    'libs/shared/src/ai/embedding.ts',
    'libs/shared/src/ai/rerank.ts',
    'libs/shared/src/http/index.ts',
    'libs/shared/src/rate-limit/limiter.ts',
    'libs/shared/src/retry/strategy.ts',
    'services/proactive-orchestrator/src/domain.ts',
    'services/fact-retrieval/src/support.ts',
    'services/workflow/src/engine/workflow-machine.ts',
    'services/workflow/src/planner/plan-validator.ts'
  ],
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95
    }
  }
};
