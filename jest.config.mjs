export default {
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json'],
  testMatch: [
    '**/tests/**/*.js',
    // limit to tests directory to avoid legacy script-style files under /test
  ],
  testPathIgnorePatterns: ['/node_modules/', '/test/'],
  transform: {},
  verbose: false,
};
