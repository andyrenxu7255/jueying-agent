/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../../'],
  testMatch: ['**/*.test.ts'],
  globalTeardown: './globalTeardown.cjs',
  collectCoverageFrom: [
    'apps/**/*.ts',
    'services/**/*.ts',
    'libs/**/*.ts',
    '!**/*.test.ts',
    '!**/dist/**'
  ]
};
