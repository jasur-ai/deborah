/**
 * AUTH D-29 §06/§26 — Client validation rules (single source, duplicate yo'q)
 * ---------------------------------------------------------------------------
 * contracts.js'dagi SHARED Zod schemas (`loginSchema`, `registerSchema`, ...)
 * dan client-side qoidalar `toJSONSchema()` orqali chiqariladi. Klient hech
 * qanday qoidani qo'lda takrorlamaydi — server yagona truth.
 *
 *   GET /api/auth/validation-rules → { ok, version, forms: { login, register, ... } }
 *
 * Har bir qoida: { required, minLength, maxLength, pattern, format } (JSON Schema).
 */

import { z } from 'zod';
import {
  loginSchema,
  registerSchema,
  verifySchema,
  resetSchema,
  resetConfirmSchema,
  mfaTotpSchema,
  reauthSchema,
  consentRevokeSchema,
} from './contracts.js';

export const RULES_VERSION = '1.0.0';

/** Bir zod schema'dan client qoidalarini chiqaradi (toJSONSchema — zod v4). */
export function schemaToRules(schema, extra = {}) {
  const json = schema.toJSONSchema();
  const props = json.properties || {};
  const required = new Set(json.required || []);
  const rules = {};
  for (const [key, p] of Object.entries(props)) {
    rules[key] = {
      required: required.has(key),
      type: p.type || null,
      minLength: typeof p.minLength === 'number' ? p.minLength : null,
      maxLength: typeof p.maxLength === 'number' ? p.maxLength : null,
      pattern: typeof p.pattern === 'string' ? p.pattern : null,
      format: typeof p.format === 'string' ? p.format : null,
      enum: Array.isArray(p.enum) ? p.enum : null,
    };
  }
  // Sessiya/fingerprint kabi client tekshiruvsiz maydonlar (server uchun)
  for (const [key, remove] of Object.entries(extra.remove || {})) {
    if (remove) delete rules[key];
  }
  return rules;
}

/** Client tekshiradigan formalar (D-29 §06). */
export const CLIENT_FORMS = {
  login: loginSchema,
  register: registerSchema,
  verify: verifySchema,
  reset: resetSchema,
  resetConfirm: resetConfirmSchema,
  mfa: mfaTotpSchema,
  reauth: reauthSchema,
  consentRevoke: consentRevokeSchema,
};

/** Barcha forma qoidalari (single source — contracts.js). */
export function buildClientRules() {
  const forms = {};
  for (const [name, schema] of Object.entries(CLIENT_FORMS)) {
    forms[name] = schemaToRules(schema);
  }
  return forms;
}

/**
 * Client qoidalarini ZOD bilan solishtiradi (parity test uchun).
 * Qoida bo'yicha qiymat qabul qilinishi kerakmi — haqiqiy schema bilan bir xilmi?
 */
export function validateWithRules(form, field, value) {
  const rules = buildClientRules()[form]?.[field];
  if (!rules) return { ok: true, error: null }; // noma'lum maydon — server hal qiladi
  if (rules.required && (value === undefined || value === null || value === '')) {
    return { ok: false, error: 'required' };
  }
  if (value === undefined || value === null || value === '') {
    return { ok: true, error: null }; // ixtiyoriy bo'sh
  }
  const s = String(value);
  if (rules.minLength && s.length < rules.minLength) return { ok: false, error: 'minLength' };
  if (rules.maxLength && s.length > rules.maxLength) return { ok: false, error: 'maxLength' };
  if (rules.pattern) {
    let re;
    try { re = new RegExp(rules.pattern); } catch (_) { return { ok: true, error: null }; }
    if (!re.test(s)) return { ok: false, error: 'pattern' };
  }
  if (rules.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    return { ok: false, error: 'email' };
  }
  return { ok: true, error: null };
}

/** Zod bilan bir xil natija beradimi (parity) — test uchun. */
export function zodAccepts(schema, value) {
  const r = schema.safeParse(value);
  return r.success;
}

export const rulesVersion = RULES_VERSION;

/** z import faqat parity uchun (buildClientRules toJSONSchema ishlatadi). */
void z;
