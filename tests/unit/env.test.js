/**
 * Deborah — Unit Tests: Environment Config Schema
 *
 * Tests Zod-based env validation, production safety checks,
 * and default value fallbacks.
 */

import { describe, it, expect, vi } from 'vitest';
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
    // AUTH B-08: production'da Turnstile bot-guard majburiy (fail-open emas)
    TURNSTILE_SECRET_KEY: undefined,
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
      SITE_URL: 'https://deborah.uz',
      // AUTH B-08: production'da Turnstile majburiy
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
      // D-01: production cookie hardening + BASE_URL majburiy
      COOKIE_SECURE: 'true',
      BASE_URL: 'https://deborah.uz',
    }));
    expect(result.success).toBe(true);
  });

  it('should warn about default admin credentials in production', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42',
      ADMIN_USER: 'admin', // default!
      ADMIN_PASS: 'admin', // default!
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
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
      SESSION_SECRET: 'deborah-dev-secret', // default!
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
      SESSION_SECRET: 'deborah-dev-secret',
      ADMIN_USER: 'admin',
      ADMIN_PASS: 'admin',
    }));
    expect(result.success).toBe(true);
  });

  // ── D-01: yangi prod qoidalari ──

  it('should reject production without COOKIE_SECURE=true', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42',
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
      BASE_URL: 'https://deborah.uz',
      // COOKIE_SECURE yozilmagan → fail-fast
    }));
    expect(result.success).toBe(false);
    const messages = result.error.issues.map(i => i.message).join(' ');
    expect(messages).toContain('COOKIE_SECURE');
  });

  it('should allow production without BASE_URL (SITE_URL fallback — fail-soft)', () => {
    // 6dee705: Render env'siz ham boot qiladi — BASE_URL endi fail-fast emas;
    // origin-check/OIDC SITE_URL fallback ishlaydi, BASE_URL esa ogohlantirish.
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42',
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
      COOKIE_SECURE: 'true',
      SITE_URL: 'https://deborah.uz',
      // BASE_URL yozilmagan → deploy bloklanmaydi (SITE_URL fallback)
    }));
    expect(result.success).toBe(true);
  });

  it('should warn (not fail) when production lacks both BASE_URL and SITE_URL', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42',
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
      COOKIE_SECURE: 'true',
    }));
    const warnings = warnSpy.mock.calls.map(c => c.join(' ')).join(' ');
    warnSpy.mockRestore();
    expect(result.success).toBe(true);
    expect(warnings).toContain('BASE_URL');
  });

  it('should reject short SESSION_SECRET (<32) in production', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'sixteen-char-secret', // 20 char < 32
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
      COOKIE_SECURE: 'true',
      BASE_URL: 'https://deborah.uz',
    }));
    expect(result.success).toBe(false);
    const messages = result.error.issues.map(i => i.message).join(' ');
    expect(messages).toContain('SESSION_SECRET');
  });

  it('should reject postmark provider without token in production', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42',
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
      COOKIE_SECURE: 'true',
      BASE_URL: 'https://deborah.uz',
      EMAIL_PROVIDER: 'postmark', // token yo'q → fail-fast
    }));
    expect(result.success).toBe(false);
    const messages = result.error.issues.map(i => i.message).join(' ');
    expect(messages).toContain('POSTMARK_SERVER_TOKEN');
  });

  it('should reject smtp provider without host in production', () => {
    const result = productionSchema.safeParse(validEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-safe-42',
      ADMIN_USER: 'prodadmin',
      ADMIN_PASS: 'prodpass123!',
      TURNSTILE_SECRET_KEY: '0x00-valid-test-secret',
      COOKIE_SECURE: 'true',
      BASE_URL: 'https://deborah.uz',
      EMAIL_PROVIDER: 'smtp', // SMTP_HOST yo'q → fail-fast
    }));
    expect(result.success).toBe(false);
    const messages = result.error.issues.map(i => i.message).join(' ');
    expect(messages).toContain('SMTP_HOST');
  });
});

describe('D-01 — yangi env maydonlari', () => {
  it('baseSchema: EMAIL_PROVIDER default mock', () => {
    const result = baseSchema.safeParse(validEnv({}));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.EMAIL_PROVIDER).toBe('mock');
      expect(result.data.MFA_ISSUER).toBe('Deborah');
      expect(result.data.COOKIE_SAMESITE).toBe('lax');
      expect(result.data.HIBP_API_URL).toBe('https://api.pwnedpasswords.com/range/');
    }
  });

  it('baseSchema: EMAIL_PROVIDER invalid qiymatni reject qiladi', () => {
    const result = baseSchema.safeParse(validEnv({ EMAIL_PROVIDER: 'sendgrid' }));
    expect(result.success).toBe(false);
  });

  it('baseSchema: COOKIE_SAMESITE faqat strict|lax|none', () => {
    const result = baseSchema.safeParse(validEnv({ COOKIE_SAMESITE: 'nonsense' }));
    expect(result.success).toBe(false);
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
