/**
 * Edikit — Unit Tests: Environment Config Schema
 *
 * Tests Zod-based env validation, production safety checks,
 * and default value fallbacks.
 */

import { describe, it, expect } from 'vitest';
import { baseSchema, productionSchema } from '../../src/config/env.js';

// Helper: create a minimal valid env object
function validEnv(overrides = {}) {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    HOST: '0.0.0.0',
    SESSION_SECRET: 'abcdefghijklmnop', // 16 chars
    SESSION_MAX_AGE: '86400000',
    ADMIN_USER: 'testadmin',
    ADMIN_PASS: 'testpass',
    LOG_LEVEL: 'info',
    LOG_PRETTY: undefined,
    ...overrides,
  };
}

describe('baseSchema — default values', () => {
  it('should apply defaults for optional fields', () => {
    const result = baseSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.PORT).toBe(3000);
      expect(result.data.HOST).toBe('0.0.0.0');
      expect(result.data.LOG_LEVEL).toBe('info');
    }
  });

  it('should coerce PORT to number', () => {
    const result = baseSchema.safeParse(validEnv({ PORT: '8080' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
    }
  });

  it('should reject invalid PORT', () => {
    const result = baseSchema.safeParse(validEnv({ PORT: '0' }));
    expect(result.success).toBe(false);
  });

  it('should reject SESSION_SECRET shorter than 16 chars', () => {
    const result = baseSchema.safeParse(validEnv({ SESSION_SECRET: 'short' }));
    expect(result.success).toBe(false);
  });

  it('should reject invalid NODE_ENV', () => {
    const result = baseSchema.safeParse(validEnv({ NODE_ENV: 'staging' }));
    expect(result.success).toBe(false);
  });

  it('should parse LOG_PRETTY string as boolean', () => {
    const resultTrue = baseSchema.safeParse(validEnv({ LOG_PRETTY: 'true' }));
    expect(resultTrue.success).toBe(true);
    if (resultTrue.success) {
      expect(resultTrue.data.LOG_PRETTY).toBe(true);
    }

    const resultFalse = baseSchema.safeParse(validEnv({ LOG_PRETTY: 'false' }));
    expect(resultFalse.success).toBe(true);
    if (resultFalse.success) {
      expect(resultFalse.data.LOG_PRETTY).toBe(false);
    }
  });
});

describe('productionSchema — production safety checks', () => {
  it('should allow valid production config', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42',
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
      SITE_URL: 'https://edikit.uz',
    }));
    expect(result.success).toBe(true);
  });

  it('should warn about default admin credentials in production', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42',
      ADMIN_USER: 'admin', // default!
      ADMIN_PASS: 'admin', // default!
    }));
    // superRefine adds issues → safeParse returns success: false
    expect(result.success).toBe(false);
    // But the values should still be in the error context
    expect(result.error).toBeDefined();
    const messages = result.error.issues.map(i => i.message).join(' ');
    expect(messages).toContain('DEFAULT ADMIN');
  });

  it('should warn about default SESSION_SECRET in production', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'edikit-dev-secret', // default!
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
    }));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    const messages = result.error.issues.map(i => i.message).join(' ');
    expect(messages).toContain('SESSION_SECRET');
  });

  it('should allow development config without warnings', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'development',
      SESSION_SECRET: 'edikit-dev-secret',
      ADMIN_USER: 'admin',
      ADMIN_PASS: 'admin',
    }));
    expect(result.success).toBe(true);
  });
});

describe('test environment defaults', () => {
  it('should allow empty optional fields', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'test',
      FIREBASE_SERVICE_ACCOUNT_PATH: undefined,
      FIREBASE_DATABASE_URL: undefined,
      SITE_URL: undefined,
    }));
    expect(result.success).toBe(true);
  });
});
