import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Har vitest invocation o'ziga xos vaqtinchalik DB fayl bilan ishlaydi
// (LOCAL_DB_FILE — local-db.js tomonidan qo'llab-quvvatlanadi).
// Bu testlarni parallel/ketma-ket run'larda bir-biridan izolyatsiya qiladi
// va real data/db.json hech qachon buzilmaydi/dirty bo'lmaydi.
const TEST_DB_FILE = join(tmpdir(), `deborah-test-db-${process.pid}.json`);

export default defineConfig({
  test: {
    // ESM support
    globals: true,
    environment: 'node',
    // Test file patterns
    include: ['tests/**/*.test.js'],
    // Timeout per test (20s) — B-26 checkpoint: og'ir integration testlar
    // (createApp import + batch CPU yuklanishi) 10s dan oshib flaky bo'lardi.
    testTimeout: 20000,
    // Hook timeout
    hookTimeout: 15000,
    // No parallel tests (shared DB)
    fileParallelism: false,
    // Environment variables
    env: {
      NODE_ENV: 'test',
      LOCAL_DB_FILE: TEST_DB_FILE,
      PORT: '3459',
      SESSION_SECRET: 'test-secret-for-deborah-42',
      SESSION_MAX_AGE: '86400000',
      ADMIN_USER: 'testadmin',
      ADMIN_PASS: 'testpass',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      // AUTH B-22: Telegram bot — test'da mock token (haqiqiy API'ga chiqmaydi)
      TELEGRAM_BOT_TOKEN: 'test-bot-token-for-deborah-42',
      TELEGRAM_BOT_USERNAME: 'DeborahTestBot',
      TELEGRAM_ENABLED: 'true',
    },
    // Coverage config (optional)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'routes/**/*.js',
        'middleware/**/*.js',
        'utils/**/*.js',
        'socket/**/*.js',
        // T-01 item 8: core Cast (G0/C1) pure services — coverage threshold
        'services/cast/permissions.js',
        'services/cast/timer-service.js',
        'services/cast/state-machine.js',
        'services/cast/scoring.js',
        'services/cast/presets.js',
        'services/cast/config-schema.js',
      ],
      // T-01 item 8: core Cast services uchun coverage threshold
      // (cast-*.test.js run'da o'lchanadi; threshold'lar regression guard)
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 90,
        lines: 75,
      },
    },
  },
});
