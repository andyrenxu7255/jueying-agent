/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/../../'],
  testMatch: ['**/*.test.ts'],
  globalTeardown: './globalTeardown.cjs',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'ESNext',
        moduleResolution: 'Node',
        esModuleInterop: true,
        target: 'ES2022',
        strict: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true
      },
      diagnostics: { ignoreCodes: [151002, 2307, 2339, 2540] }
    }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  collectCoverageFrom: [
    'apps/**/*.ts',
    'services/**/*.ts',
    'libs/**/*.ts',
    '!**/*.test.ts',
    '!**/dist/**'
  ]
};
