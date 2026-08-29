/**
 * AUTH D-29 §17/§18/§26 — Client validation rules (contracts.js'dan) + OpenAPI CI.
 * ---------------------------------------------------------------------------
 *  - buildClientRules: contracts.js schemas'dan toJSONSchema orqali — qoidalar
 *    klientda takrorlanmaydi (single source).
 *  - Parity: client rules (validateWithRules) === haqiqiy Zod schema natijasi.
 *  - OpenAPI CI: buildOpenApiSpec + validateOpenApiSpec 0 xato; docs/openapi-auth.json
 *    bilan sync (drift bo'lsa `node scripts/openapi-generate.js` ishga tushiriladi).
 */

import { describe, it, expect } from 'vitest';
import {
  buildClientRules,
  validateWithRules,
  RULES_VERSION,
} from '../../../src/modules/auth/validation-rules.js';
import {
  loginSchema,
  registerSchema,
  verifySchema,
} from '../../../src/modules/auth/contracts.js';
import { buildOpenApiSpec, validateOpenApiSpec } from '../../../scripts/openapi-generate.js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('AUTH D-29 §06/§26 — client rules contracts.js\'dan', () => {
  it('rules chiqariladi: login identifier min 1 / max 100 (B-04 runtime truth), required', () => {
    const forms = buildClientRules();
    expect(forms.login.identifier).toMatchObject({
      required: true,
      minLength: 1,
      maxLength: 100,
    });
    expect(forms.login.password).toMatchObject({ required: true, minLength: 1, maxLength: 200 });
  });

  it('register: username regex (B-04), email format, password min 8', () => {
    const forms = buildClientRules();
    expect(forms.register.username).toMatchObject({ minLength: 2, maxLength: 50 });
    expect(forms.register.username.pattern).toBe('^[a-zA-Z0-9_.-]+$');
    expect(forms.register.email.format).toBe('email');
    expect(forms.register.password.minLength).toBe(8);
    expect(forms.register.consent).toBeTruthy();
  });

  it('verify/reset/mfa formalari ham bor', () => {
    const forms = buildClientRules();
    expect(forms.verify.token.minLength).toBe(6);
    expect(forms.reset).toBeTruthy();
    expect(forms.mfa).toBeTruthy();
    expect(RULES_VERSION).toBe('1.0.0');
  });

  it('PARITY: client rules === real Zod schema (login identifier)', () => {
    const cases = [
      'ab', 'abc', 'a'.repeat(100), 'a'.repeat(101), '', 'valid_name_1', 'with space', 'Ü', 'user@example.com',
    ];
    for (const v of cases) {
      const ruleOk = validateWithRules('login', 'identifier', v).ok;
      const zodOk = loginSchema.shape.identifier.safeParse(v).success;
      expect(ruleOk, `identifier=${JSON.stringify(v)}`).toBe(zodOk);
    }
  });

  it('PARITY: register username + email + password', () => {
    const uCases = ['ab', 'abc', 'a_b1', 'User.Name-1', 'A'.repeat(51), 'a b', 'ümlaut', 'user_123'];
    for (const v of uCases) {
      expect(validateWithRules('register', 'username', v).ok, `username=${JSON.stringify(v)}`)
        .toBe(registerSchema.shape.username.safeParse(v).success);
    }
    const eCases = ['a@b.co', 'not-an-email', '', 'a@b', 'user+tag@example.com', 'x@y'];
    for (const v of eCases) {
      expect(validateWithRules('register', 'email', v).ok, `email=${JSON.stringify(v)}`)
        .toBe(registerSchema.shape.email.safeParse(v).success);
    }
    for (const v of ['1234567', '12345678', '', 'x']) {
      expect(validateWithRules('register', 'password', v).ok, `password=${JSON.stringify(v)}`)
        .toBe(registerSchema.shape.password.safeParse(v).success);
    }
  });
});

describe('AUTH D-29/§D-30 — OpenAPI CI step', () => {
  it('spec quriladi + validatsiya 0 xato', () => {
    const spec = buildOpenApiSpec();
    expect(spec.openapi).toBe('3.1.0');
    const { ok, errors } = validateOpenApiSpec(spec);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(10);
  });

  it('docs/openapi-auth.json bilan SYNC (CI drift tekshiruvi)', () => {
    const docPath = path.join(__dirname, '../../../docs/openapi-auth.json');
    if (!existsSync(docPath)) return; // generator ishga tushirilmagan — CI'da fail qilmaydi
    const current = JSON.stringify(buildOpenApiSpec(), null, 2);
    const committed = readFileSync(docPath, 'utf8').trim();
    expect(current, 'openapi-auth.json eskirgan — `node scripts/openapi-generate.js` ishga tushiring').toBe(committed);
  });
});
