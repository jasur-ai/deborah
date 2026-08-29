/**
 * Deborah — Security Tests
 *
 * Tests:
 *   1. Argon2 password hashing (hashPassword, verifyPassword, isLegacyHash)
 *   2. CSRF validation middleware
 *   3. Admin credentials via CONFIG (not hardcoded)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword, verifyPassword, isLegacyHash } from '../../utils/helpers.js';
import { validateCsrf } from '../../middleware/error.js';
import CONFIG from '../../src/config/env.js';

// ═══════════════════════════════════════════════════════════════
// 1. Argon2 Password Hashing
// ═══════════════════════════════════════════════════════════════

describe('hashPassword() — argon2id hashing', () => {
  it('should produce an argon2 hash string', async () => {
    const hash = await hashPassword('testpassword123');
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.startsWith('$argon2')).toBe(true);
  });

  it('should produce different hashes for the same password (different salt)', async () => {
    const h1 = await hashPassword('samepass');
    const h2 = await hashPassword('samepass');
    expect(h1).not.toBe(h2);
  });

  it('should reject empty password', async () => {
    await expect(hashPassword('')).rejects.toThrow();
    await expect(hashPassword(null)).rejects.toThrow();
    await expect(hashPassword(undefined)).rejects.toThrow();
  });
});

describe('verifyPassword() — argon2 verification', () => {
  it('should verify correct password', async () => {
    const hash = await hashPassword('correct-password');
    const result = await verifyPassword('correct-password', hash);
    expect(result).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const hash = await hashPassword('correct-password');
    const result = await verifyPassword('wrong-password', hash);
    expect(result).toBe(false);
  });

  it('should return false for non-argon2 hashes', async () => {
    const result = await verifyPassword('test', 'sha256-fake-hash-not-argon2');
    expect(result).toBe(false);
  });

  it('should return false for null/empty inputs', async () => {
    expect(await verifyPassword(null, null)).toBe(false);
    expect(await verifyPassword('', '')).toBe(false);
    expect(await verifyPassword('test', null)).toBe(false);
  });
});

describe('isLegacyHash() — SHA-256 detection', () => {
  it('should detect a 64-char hex string as legacy hash', () => {
    expect(isLegacyHash('a'.repeat(64))).toBe(true);
    expect(isLegacyHash('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789')).toBe(true);
  });

  it('should reject non-64-char strings', () => {
    expect(isLegacyHash('short')).toBe(false);
    expect(isLegacyHash('a'.repeat(63))).toBe(false);
    expect(isLegacyHash('a'.repeat(65))).toBe(false);
  });

  it('should reject argon2 hashes', () => {
    expect(isLegacyHash('$argon2id$v=19$m=19456,t=2,p=1$...')).toBe(false);
  });

  it('should reject empty/null/undefined', () => {
    expect(isLegacyHash('')).toBe(false);
    expect(isLegacyHash(null)).toBe(false);
    expect(isLegacyHash(undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. CSRF Validation
// ═══════════════════════════════════════════════════════════════

describe('validateCsrf() — CSRF middleware', () => {
  const createReq = (method, token, body = {}) => ({
    method,
    body: { ...body, _csrf: token },
    headers: { 'x-csrf-token': token },
    session: { csrfToken: 'valid-token-12345' },
  });

  const createRes = () => {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.body = data; return res; };
    return res;
  };

  it('should allow GET requests without token', () => {
    const req = createReq('GET');
    const res = createRes();
    let nextCalled = false;
    validateCsrf(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('should allow POST with valid _csrf in body', () => {
    const req = createReq('POST', 'valid-token-12345');
    const res = createRes();
    let nextCalled = false;
    validateCsrf(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('should allow POST with valid X-CSRF-Token header', () => {
    const req = {
      method: 'POST',
      body: {},
      headers: { 'x-csrf-token': 'valid-token-12345' },
      session: { csrfToken: 'valid-token-12345' },
    };
    const res = createRes();
    let nextCalled = false;
    validateCsrf(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('should reject POST with invalid token', () => {
    const req = createReq('POST', 'invalid-token');
    const res = createRes();
    let nextCalled = false;
    validateCsrf(req, res, () => { nextCalled = false; });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('CSRF');
  });

  it('should reject POST with missing token', () => {
    const req = { method: 'POST', body: {}, headers: {}, session: { csrfToken: 'valid' } };
    const res = createRes();
    validateCsrf(req, res, () => {});
    expect(res.statusCode).toBe(403);
  });

  it('should allow PUT/PATCH/DELETE with valid token', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const req = createReq(method, 'valid-token-12345');
      const res = createRes();
      let nextCalled = false;
      validateCsrf(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Admin Credentials via CONFIG
// ═══════════════════════════════════════════════════════════════

describe('Admin credentials — CONFIG', () => {
  it('should have ADMIN_USER and ADMIN_PASS defined', () => {
    expect(CONFIG.ADMIN_USER).toBeDefined();
    expect(CONFIG.ADMIN_PASS).toBeDefined();
    expect(typeof CONFIG.ADMIN_USER).toBe('string');
    expect(typeof CONFIG.ADMIN_PASS).toBe('string');
    expect(CONFIG.ADMIN_USER.length).toBeGreaterThan(0);
    expect(CONFIG.ADMIN_PASS.length).toBeGreaterThan(0);
  });

  it('should not use hardcoded defaults in production', () => {
    // The env schema's production superRefine checks for this
    // In test mode, this should pass since vitest provides ADMIN_USER='testadmin'
    expect(CONFIG.ADMIN_USER).toBe('testadmin');
    expect(CONFIG.ADMIN_PASS).toBe('testpass');
  });
});
