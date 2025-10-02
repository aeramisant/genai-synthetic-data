/**
 * Jest configuration for ESM support.
 * We treat .js as ESM (package.json sets type=module) and rely on Node's native loader.
 * For simplicity we disable transforms and run tests with the node environment.
 */
export default {
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json'],
  testMatch: ['**/tests/**/*.js'],
  testPathIgnorePatterns: ['/node_modules/', '/test/'],
  transform: {},
  verbose: false,
  // Ensure AI calls are disabled during tests to avoid external network / API key issues
  setupFiles: ['<rootDir>/tests/jest.env.setup.cjs'],
};
