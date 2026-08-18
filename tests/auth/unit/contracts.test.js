/**
 * Edikit — Auth API Contract unit testlari (AUTH D-30 §15-§17)
 * ---------------------------------------------------------------------------
 * Zod schemas validatsiyasi + private field scan (response'da password/token/
 * otp/secret YO'Q) + OpenAPI spec valid + zod-to-openapi-ish generate (native
 * toJSONSchema).
 */

import { describe, it, expect } from 'vitest';
import {
  loginSchema, registerSchema, verifySchema, resetSchema, resetConfirmSchema,
  mfaTotpSchema, mfaVerifySchema, sessionRevokeSchema, reauthSchema,
  consentRevokeSchema, loginResponse, registerResponse, mfaStatusResponse,
  mfaEnrollResponse, consentStatusResponse, errorCodeEnum, ERROR_CODES,
  ENDPOINTS,
} from '../../../src/modules/auth/contracts.js';
import { buildOpenApiSpec, validateOpenApiSpec, scanPrivateFields } from '../../../scripts/openapi-generate.js';

describe('contracts: request schemas (D-30 §06/§15)', () => {
  it('1) loginSchema — valid pas', () => {
    expect(loginSchema.safeParse({ identifier: 'user@ex.com', password: 'secret123' }).success).toBe(true);
  });

  it("2) loginSchema — legacy qisqa identifier qabul, bosh identifier fail", () => {
    // runtime truth (validation.js B-04): login username min 1 (legacy),
    // max 100 — 'ab' qabul; bo'sh identifier esa required fail.
    expect(loginSchema.safeParse({ identifier: 'ab', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: '', password: 'x' }).success).toBe(false);
  });

  it('3) registerSchema — consent on qabul qilinadi', () => {
    const r = registerSchema.safeParse({ email: 'a@b.com', username: 'user_1', password: 'Passw0rd!x', consent: 'on' });
    expect(r.success).toBe(true);
  });

  it('4) registerSchema — yomon username fail', () => {
    expect(registerSchema.safeParse({ email: 'a@b.com', username: 'Us Er!', password: 'x'.repeat(12) }).success).toBe(false);
  });

  it('5) mfaTotpSchema — 6 raqam talab', () => {
    expect(mfaTotpSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(mfaTotpSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(mfaTotpSchema.safeParse({ code: 'abcdef' }).success).toBe(false);
  });

  it('6) verify/reset/reauth/revoke — valid', () => {
    expect(verifySchema.safeParse({ token: 'abc123', email: 'a@b.com' }).success).toBe(true);
    expect(resetSchema.safeParse({ identifier: 'user_1' }).success).toBe(true);
    expect(resetConfirmSchema.safeParse({ token: 'tok123', password: 'Passw0rd!x' }).success).toBe(true);
    expect(reauthSchema.safeParse({ password: 'pw' }).success).toBe(true);
    expect(sessionRevokeSchema.safeParse({ sessionId: 's-123' }).success).toBe(true);
    expect(consentRevokeSchema.safeParse({ purpose: 'telegram' }).success).toBe(true);
    expect(consentRevokeSchema.safeParse({ purpose: 'bogus' }).success).toBe(false);
  });

  it('7) errorCodeEnum — A-04 kodlar enum', () => {
    expect(ERROR_CODES).toContain('AUTH_FAILED');
    expect(ERROR_CODES).toContain('RATE_LIMITED');
    expect(ERROR_CODES).toContain('LOCKED');
    expect(errorCodeEnum.safeParse('RATE_LIMITED').success).toBe(true);
    expect(errorCodeEnum.safeParse('NOPE').success).toBe(false);
  });
});

describe('contracts: response private field scan (D-30 §11/§17)', () => {
  it('8) loginResponse — password/token yoq', () => {
    expect(loginResponse.safeParse({ ok: true, redirect: '/user/panel' }).success).toBe(true);
    // private field'lar schema'da yo'q
    expect(JSON.stringify(loginResponse.toJSONSchema())).not.toMatch(/\b(password|token|otp|secret)\b/i);
  });

  it('9) mfaStatusResponse — secret yoq', () => {
    expect(JSON.stringify(mfaStatusResponse.toJSONSchema())).not.toMatch(/\b(password|token|otp|secret)\b/i);
  });

  it('10) registerResponse/consentStatus — clean', () => {
    expect(JSON.stringify(registerResponse.toJSONSchema())).not.toMatch(/\b(password|token|otp|secret)\b/i);
    expect(JSON.stringify(consentStatusResponse.toJSONSchema())).not.toMatch(/\b(password|token|otp|secret)\b/i);
  });

  it('11) mfaEnrollResponse — yagona istisno (enroll bir martalik secret)', () => {
    expect(JSON.stringify(mfaEnrollResponse.toJSONSchema())).toMatch(/secret/);
    // lekin skan faqat enroll endpoint'ini istisno qiladi
    const endpointKey = 'POST /api/v1/mfa/enroll';
    expect(scanPrivateFields(ENDPOINTS[endpointKey], endpointKey)).toEqual([]);
  });

  it('12) barcha endpoint response\'lari skan — faqat enroll istisno', () => {
    const spec = buildOpenApiSpec();
    expect(spec._meta.privateFieldViolations).toBe(0);
  });
});

describe('OpenAPI spec (D-30 §07/§16)', () => {
  it('13) spec yaratiladi + endpoint count', () => {
    const spec = buildOpenApiSpec();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(10);
    expect(spec.components.securitySchemes.sessionCookie).toBeTruthy();
  });

  it('14) validateOpenApiSpec — valid', () => {
    const spec = buildOpenApiSpec();
    const { ok, errors } = validateOpenApiSpec(spec);
    expect(ok, errors.join('; ')).toBe(true);
  });

  it('15) security scheme — auth endpoint\'larda', () => {
    const spec = buildOpenApiSpec();
    expect(spec.paths['/api/v1/session/list'].get.security.length).toBe(2);
    expect(spec.paths['/api/v1/auth/login'].post.security).toEqual([]);
  });
});
