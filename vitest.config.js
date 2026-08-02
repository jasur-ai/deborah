import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ESM support
    globals: true,
    environment: 'node',
    // Test file patterns
    include: ['tests/**/*.test.js'],
    // Timeout per test (10s)
    testTimeout: 10000,
    // Hook timeout
    hookTimeout: 15000,
    // No parallel tests (shared DB)
    fileParallelism: false,
    // Environment variables
    env: {
      NODE_ENV: 'test',
      PORT: '3459',
      SESSION_SECRET: 'test-secret-for-edikit-42',
      SESSION_MAX_AGE: '86400000',
      ADMIN_USER: 'testadmin',
      ADMIN_PASS: 'testpass',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
    },
    // Coverage config (optional)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['routes/**/*.js', 'middleware/**/*.js', 'utils/**/*.js', 'socket/**/*.js'],
    },
  },
});
