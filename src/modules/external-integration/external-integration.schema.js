/**
 * Edikit — Official HEMIS & OneID Adapter Boundary (PURE logic)
 *
 * Prompt 66 — rasmiy contract mavjud bo'lganda roster/grade va identity
 * integration'ni xavfsiz ulash (research.md §12 identity assurance, §19
 * provider adapter contract, §27 data governance, §30 Google login ≠ shaxs).
 * This module is PURE (no I/O, no globals):
 *
 *   - Adapter interface contract: PresentationProvider-style contract
 *     (validateAdapterRequest, assertAdapterMode) — sandbox|live.
 *   - Source-of-truth field mapping: HEMIS_* field maps + validateFieldMap
 *     + mapHemistoEdikit / mapEdikitToHemis.
 *   - HEMIS pull→staging→diff: assertHemispullTransition (job FSM),
 *     buildIdempotencyKey, assertRetryAllowed, computeBackoff, dead-letter.
 *   - Ratified-only grade push (§15): assertRatifiedOnlyPush.
 *   - Pull-back reconciliation: computeReconciliationDiff.
 *   - OneID identity account provider: assertOneidAccountLink,
 *     assertAccountLinkTakeoverGuard (subject mismatch → reject).
 *   - Token vault: envelope encryption (buildTokenEnvelope/
 *     decryptTokenEnvelope, AES-256-GCM + per-token DEK + master wrap),
 *     assertTokenVaultState, assertNoTokenReuse.
 *   - Security/data guard: assertDocumentedEndpoint (no scraping,
 *     undocumented endpoint taqiqlanadi), assertValidEnum, constantTimeEqual.
 *
 * SECURITY (§15-17): fail-closed — hech qanday guard o'tmaguncha hech
 * qanday write path ishlamaydi; har write path idempotent + audited.
 */

import crypto from 'crypto';

// ── Adapter kinds ──
export const ADAPTER_KINDS = {
  HEMIS: 'hemis',
  ONEID: 'oneid',
};

export const ADAPTER_MODES = {
  SANDBOX: 'sandbox',
  LIVE: 'live',
};

export const SYNC_DIRECTIONS = {
  PULL: 'pull',
  PUSH: 'push',
};

export const SYNC_ENTITIES = {
  ROSTER: 'roster',
  GRADE: 'grade',
  IDENTITY: 'identity',
};

// Pull/push job FSM
export const SYNC_JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter',
};

export const SYNC_JOB_TRANSITIONS = {
  pending: ['running'],
  running: ['success', 'failed'],
  failed: ['running', 'dead_letter'],
  dead_letter: ['running'],
  success: [],
};

export const TOKEN_TYPES = {
  ACCESS: 'access',
  REFRESH: 'refresh',
  ID: 'id',
};

export const IDENTITY_STATUS = {
  PENDING: 'pending',
  LINKED: 'linked',
  REVOKED: 'revoked',
};

export const ASSURANCE_LEVELS = ['I0', 'I1', 'I2', 'I3', 'I4'];

export const MAX_ATTEMPTS = 5;
export const BASE_BACKOFF_MS = 1000; // 1s, 2s, 4s, 8s…

/**
 * Generic enum validator (fail-closed). Mirrors project convention.
 * @param {{ value: any, allowed: string[], name?: string }} params
 */
export function assertValidEnum({ value, allowed = [], name = 'value' }) {
  if (value === undefined || value === null) {
    return { ok: false, reason: `${name} is required` };
  }
  if (!Array.isArray(allowed) || !allowed.includes(value)) {
    return { ok: false, reason: `invalid ${name}: ${value}` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 1. ADAPTER INTERFACE CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * PresentationProvider-style adapter contract (research §19).
 * Har provider adapter quyidagi interface'ni implement qilishi shart:
 *
 *   createJob(input, credential) → { jobRef }
 *   getStatus(jobRef)            → { status }
 *   getArtifact(jobRef)          → { artifact }
 *   cancel?(jobRef)              → { ok }
 *
 * @param {{ provider: string, adapter?: object }} params
 */
export function assertAdapterContract({ provider, adapter = null } = {}) {
  const kind = assertValidEnum({ value: provider, allowed: Object.values(ADAPTER_KINDS), name: 'provider' });
  if (!kind.ok) return kind;
  if (!adapter || typeof adapter !== 'object') {
    return { ok: false, reason: 'adapter is required (adapter interface contract)' };
  }
  const missing = [];
  if (typeof adapter.createJob !== 'function') missing.push('createJob');
  if (typeof adapter.getStatus !== 'function') missing.push('getStatus');
  if (typeof adapter.getArtifact !== 'function') missing.push('getArtifact');
  if (missing.length > 0) {
    return { ok: false, reason: `adapter contract violated — missing: ${missing.join(', ')}` };
  }
  return { ok: true, provider };
}

/**
 * Adapter mode guard — live mode faqat rasmiy contract mavjud bo'lganda
 * ishlatilishi mumkin; aks holda sandbox (test/offline) rejim.
 * @param {{ mode?: string, allowLive?: boolean }} params
 */
export function assertAdapterMode({ mode = ADAPTER_MODES.SANDBOX, allowLive = false } = {}) {
  const m = assertValidEnum({ value: mode, allowed: Object.values(ADAPTER_MODES), name: 'mode' });
  if (!m.ok) return m;
  if (mode === ADAPTER_MODES.LIVE && !allowLive) {
    return { ok: false, reason: 'live mode requires an official HEMIS/OneID contract (sandbox only for now)' };
  }
  return { ok: true, mode };
}

// ═══════════════════════════════════════════════════════════════════
// 2. SOURCE-OF-TRUTH FIELD MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Source-of-truth field map: HEMIS (external) ↔ Edikit (canonical).
 * "source of truth" — Edikit internal canonical fieldga aylantiriladi;
 * push paytida canonictan HEMIS formatga qaytariladi (bir xil map).
 */
export const HEMIS_FIELD_MAP = {
  // HEMIS student → Edikit user
  studentId: { canonical: 'externalId', required: true },
  firstName: { canonical: 'firstName', required: true },
  lastName: { canonical: 'lastName', required: true },
  pinfl: { canonical: 'pinfl', required: true },
  email: { canonical: 'email', required: false },
  groupCode: { canonical: 'groupCode', required: false },
  courseCode: { canonical: 'courseCode', required: false },
};

// OneID identity claims → Edikit identity fields
export const ONEID_FIELD_MAP = {
  sub: { canonical: 'providerSubject', required: true },
  pinfl: { canonical: 'pinfl', required: true },
  email: { canonical: 'email', required: false },
  phone: { canonical: 'phone', required: false },
  assuranceLevel: { canonical: 'assuranceLevel', required: true },
};

/**
 * Validate a field map: canonical fieldlar yopiq ro'yxatdan bo'lishi kerak.
 * @param {{ kind?: string, map?: object }} params
 */
export function assertValidFieldMap({ kind = 'hemis', map = null } = {}) {
  const allowed = kind === 'oneid' ? ONEID_FIELD_MAP : HEMIS_FIELD_MAP;
  if (!map || typeof map !== 'object') {
    return { ok: false, reason: 'field map is required' };
  }
  // Canonical fieldlar yopiq ro'yxatdan bo'lishi kerak (fail-closed).
  const validCanonicals = new Set(Object.values(allowed).map((v) => v.canonical));
  const bad = Object.entries(map).filter(([, c]) => !validCanonicals.has(c.canonical));
  if (bad.length > 0) {
    return { ok: false, reason: `unknown canonical field(s): ${bad.map(([k]) => k).join(', ')}` };
  }
  return { ok: true };
}

/**
 * Map external → canonical. YO'Q maydonlar qoldiriladi (to'ldirish emas).
 * @param {{ kind?: string, source?: object }} params
 */
export function mapExternalToCanonical({ kind = 'hemis', source = {} } = {}) {
  const allowed = kind === 'oneid' ? ONEID_FIELD_MAP : HEMIS_FIELD_MAP;
  const out = {};
  const missingRequired = [];
  for (const [ext, { canonical, required }] of Object.entries(allowed)) {
    const val = source[ext];
    if (val !== undefined && val !== null && val !== '') {
      out[canonical] = val;
    } else if (required) {
      missingRequired.push(ext);
    }
  }
  return { mapped: out, missingRequired };
}

/**
 * Map canonical → external (push format).
 * @param {{ kind?: string, canonical?: object }} params
 */
export function mapCanonicalToExternal({ kind = 'hemis', canonical = {} } = {}) {
  const allowed = kind === 'oneid' ? ONEID_FIELD_MAP : HEMIS_FIELD_MAP;
  const out = {};
  for (const [ext, { canonical: canon }] of Object.entries(allowed)) {
    if (canonical[canon] !== undefined && canonical[canon] !== null) {
      out[ext] = canonical[canon];
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 3. HEMIS PULL → STAGING → DIFF (JOB FSM + IDEMPOTENCY + RETRY + DLQ)
// ═══════════════════════════════════════════════════════════════════

/** Sync job FSM transition guard (fail-closed). */
export function assertHemispullTransition({ from, to } = {}) {
  const allowed = SYNC_JOB_TRANSITIONS[from];
  if (!allowed) return { ok: false, reason: `invalid from status: ${from}` };
  if (!allowed.includes(to)) {
    return { ok: false, reason: `invalid transition ${from} → ${to}` };
  }
  return { ok: true };
}

/**
 * Deterministic idempotency key — bitta tenant + direction + entity +
 * payload hash kombinatsiyasi bitta job'ga to'g'ri keladi (UNIQUE).
 * @param {{ tenantId?: number|string, direction?: string, entity?: string, payloadHash?: string }} params
 */
export function buildIdempotencyKey({ tenantId = '', direction = 'pull', entity = 'roster', payloadHash = '' } = {}) {
  return crypto
    .createHash('sha256')
    .update(`${tenantId}|${direction}|${entity}|${payloadHash}`)
    .digest('hex')
    .slice(0, 64);
}

/** Payload hash — deterministik canonical JSON. */
export function computePayloadHash(payload = null) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex')
    .slice(0, 64);
}

/**
 * Retry guard: attempts max_attempts dan oshmasa va backoff muddati
 * o'tgan bo'lsa retry ruxsat etiladi.
 * @param {{ attempts?: number, maxAttempts?: number, nextRetryAt?: number|null, now?: number }} params
 */
export function assertRetryAllowed({ attempts = 0, maxAttempts = MAX_ATTEMPTS, nextRetryAt = null, now = Date.now() } = {}) {
  if (attempts >= maxAttempts) {
    return { ok: false, reason: 'max attempts reached', deadLetter: true };
  }
  if (nextRetryAt && now < nextRetryAt) {
    return { ok: false, reason: 'retry backoff not elapsed yet', retryAt: nextRetryAt };
  }
  return { ok: true };
}

/** Exponential backoff: base * 2^attempt (capped at 5 min). */
export function computeBackoff({ attempt = 0, baseMs = BASE_BACKOFF_MS, maxMs = 5 * 60 * 1000 } = {}) {
  return Math.min(baseMs * 2 ** Math.max(0, attempt), maxMs);
}

/**
 * Build dead-letter metadata for a failed job.
 * @param {{ jobId?: number|string, error?: string, attempts?: number, now?: number }} params
 */
export function buildDeadLetterEntry({ jobId = null, error = '', attempts = 0, now = Date.now() } = {}) {
  return {
    jobId,
    status: SYNC_JOB_STATUS.DEAD_LETTER,
    deadLetteredAt: new Date(now).toISOString(),
    error: String(error || 'unknown error'),
    attempts,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. RATIFIED-ONLY GRADE PUSH (§15)
// ═══════════════════════════════════════════════════════════════════

/**
 * Grade push faqat ratified bo'lgan qarorlar uchun — provisional/
 * rejected bo'lgan natija hech qachon tashqariga push qilinmaydi (§15).
 * @param {{ decision?: string, allowedDecisions?: string[] }} params
 */
export function assertRatifiedOnlyPush({ decision = '', allowedDecisions = ['ratified'] } = {}) {
  if (!decision) return { ok: false, reason: 'decision is required for grade push' };
  if (!allowedDecisions.includes(decision)) {
    return { ok: false, reason: `grade push requires a ratified decision (got: ${decision})` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 5. PULL-BACK RECONCILIATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Pull-back reconciliation diff: external (HEMIS) state vs local state.
 * Returns added/removed/changed by canonical key.
 * @param {{ external?: object[], local?: object[], keyField?: string }} params
 */
export function computeReconciliationDiff({ external = [], local = [], keyField = 'externalId' } = {}) {
  const ext = new Map(external.map((r) => [String(r[keyField]), r]));
  const loc = new Map(local.map((r) => [String(r[keyField]), r]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [k, row] of ext) {
    if (!loc.has(k)) added.push(row);
    else if (JSON.stringify(row) !== JSON.stringify(loc.get(k))) changed.push({ key: k, external: row, local: loc.get(k) });
  }
  for (const [k, row] of loc) {
    if (!ext.has(k)) removed.push(row);
  }
  return { added, removed, changed, addedCount: added.length, removedCount: removed.length, changedCount: changed.length };
}

// ═══════════════════════════════════════════════════════════════════
// 6. ONEID IDENTITY ACCOUNT PROVIDER + TAKEOVER GUARD
// ═══════════════════════════════════════════════════════════════════

/**
 * OneID account link guard — account takeover'ning oldini oladi:
 * OneID subject (PINFL) bilan bog'lanayotgan Edikit identity mos kelishi
 * shart; assurance darajasi I2+ talab qilinadi (research §30.1, §30.3).
 * @param {{ providerSubject?: string, localSubject?: string, assuranceLevel?: string, minAssurance?: string }} params
 */
export function assertOneidAccountLink({ providerSubject = '', localSubject = '', assuranceLevel = 'I0', minAssurance = 'I2' } = {}) {
  if (!providerSubject || !localSubject) {
    return { ok: false, reason: 'providerSubject and localSubject are required to link' };
  }
  if (providerSubject !== localSubject) {
    return { ok: false, reason: 'account takeover guard: OneID subject does not match local identity' };
  }
  const levels = ASSURANCE_LEVELS;
  const got = levels.indexOf(assuranceLevel);
  const need = levels.indexOf(minAssurance);
  if (got < 0 || got < need) {
    return { ok: false, reason: `insufficient assurance level (${assuranceLevel}), need at least ${minAssurance}` };
  }
  return { ok: true };
}

/**
 * Identity mismatch handling (research §30.3): mos kelmasa automatic
 * reject emas — pending link request (admin/student verification).
 * @param {{ providerSubject?: string, localSubject?: string }} params
 */
export function classifyOneidMismatch({ providerSubject = '', localSubject = '' } = {}) {
  if (!providerSubject || !localSubject) return { ok: false, reason: 'subjects required' };
  if (providerSubject === localSubject) return { ok: true, verdict: 'match' };
  return { ok: true, verdict: 'pending', reason: 'identity mismatch queued for verification' };
}

/** Identity status FSM guard. */
export function assertIdentityStatusTransition({ from, to } = {}) {
  const transitions = {
    pending: ['linked', 'revoked'],
    linked: ['revoked'],
    revoked: [],
  };
  const allowed = transitions[from];
  if (!allowed || !allowed.includes(to)) {
    return { ok: false, reason: `invalid identity status transition ${from} → ${to}` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 7. TOKEN VAULT — ENVELOPE ENCRYPTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Envelope encryption (research §12.3):
 *   1. random per-token DEK (AES-256-GCM) — token ciphertext;
 *   2. DEK master key bilan o'raladi (AES-256-GCM wrap);
 *   3. vault'da faqat { ciphertext, iv, keyRef } saqlanadi — plaintext
 *      hech qachon DB'ga tushmaydi.
 * @param {{ plaintext?: string, masterKey?: string, aad?: string }} params
 */
export function buildTokenEnvelope({ plaintext = '', masterKey = '', aad = 'edikit:token-vault' } = {}) {
  if (!plaintext) return { ok: false, reason: 'plaintext is required' };
  if (!masterKey || masterKey.length < 16) {
    return { ok: false, reason: 'masterKey must be at least 16 chars (envelope encryption)' };
  }
  const dek = crypto.randomBytes(32);
  const dataIv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, dataIv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const dataTag = cipher.getAuthTag();

  const wrapKey = crypto.createHash('sha256').update(masterKey).digest();
  const wrapIv = crypto.randomBytes(12);
  const wrapCipher = crypto.createCipheriv('aes-256-gcm', wrapKey, wrapIv);
  if (aad) wrapCipher.setAAD(Buffer.from('wrap:' + aad, 'utf8'));
  const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();

  return {
    ok: true,
    ciphertext: ct.toString('base64'),
    iv: dataIv.toString('base64'),
    keyRef: JSON.stringify({
      v: 1,
      wrapIv: wrapIv.toString('base64'),
      wrapTag: wrapTag.toString('base64'),
      wrappedDek: wrappedDek.toString('base64'),
      dataTag: dataTag.toString('base64'),
    }),
  };
}

/**
 * Envelope decrypt — buildTokenEnvelope bilan teskari. Xato → fail-closed.
 * @param {{ ciphertext?: string, iv?: string, keyRef?: string, masterKey?: string, aad?: string }} params
 */
export function decryptTokenEnvelope({ ciphertext = '', iv = '', keyRef = '', masterKey = '', aad = 'edikit:token-vault' } = {}) {
  try {
    const ref = JSON.parse(keyRef);
    if (ref.v !== 1) return { ok: false, reason: 'unsupported keyRef version' };
    const wrapKey = crypto.createHash('sha256').update(masterKey).digest();
    const wrapDecipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, Buffer.from(ref.wrapIv, 'base64'));
    if (aad) wrapDecipher.setAAD(Buffer.from('wrap:' + aad, 'utf8'));
    wrapDecipher.setAuthTag(Buffer.from(ref.wrapTag, 'base64'));
    const dek = Buffer.concat([wrapDecipher.update(Buffer.from(ref.wrappedDek, 'base64')), wrapDecipher.final()]);

    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(iv, 'base64'));
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(ref.dataTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
    return { ok: true, plaintext };
  } catch (e) {
    return { ok: false, reason: `token decrypt failed: ${e.message}` };
  }
}

/**
 * Token vault state guard — ciphertext/iv/keyRef mavjud bo'lishi shart,
 * plaintext saqlanmasligi shart (fail-closed).
 * @param {{ row?: object }} params
 */
export function assertTokenVaultState({ row = null } = {}) {
  if (!row) return { ok: false, reason: 'token vault row is required' };
  if (!row.ciphertext || !row.iv || !row.keyRef) {
    return { ok: false, reason: 'token vault row must store ciphertext, iv and keyRef' };
  }
  if (row.plaintext !== undefined && row.plaintext !== null) {
    return { ok: false, reason: 'plaintext must never be stored in the token vault' };
  }
  if (row.revokedAt) return { ok: false, reason: 'token is revoked' };
  if (row.expiresAt && Date.parse(row.expiresAt) < Date.now()) {
    return { ok: false, reason: 'token is expired' };
  }
  return { ok: true };
}

/**
 * Token reuse guard — har bir adapter call scope'ni aytishi shart; token
 * scope talab qilingan scope'ni qamrab olmasa ishlatilmaydi.
 * @param {{ tokenScopes?: string[], requiredScopes?: string[] }} params
 */
export function assertNoTokenReuse({ tokenScopes = [], requiredScopes = [] } = {}) {
  if (!Array.isArray(requiredScopes) || requiredScopes.length === 0) {
    return { ok: false, reason: 'requiredScopes must be specified for every token use' };
  }
  for (const rs of requiredScopes) {
    if (!tokenScopes.includes(rs)) {
      return { ok: false, reason: `token reuse guard: missing scope ${rs}` };
    }
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 8. SECURITY / DATA GUARD — SCRAPING VA UNDOCUMENTED ENDPOINT
// ═══════════════════════════════════════════════════════════════════

/**
 * Documented endpoint allowlist — scraping yoki undocumented endpoint
 * orqali ma'lumot olish/jo'natish taqiqlanadi (fail-closed).
 * HEMIS/OneID rasmiy contractdagi faqat shu endpointlar ruxsat etiladi.
 */
export const DOCUMENTED_ENDPOINTS = {
  hemis: [
    '/api/v1/students',      // roster pull
    '/api/v1/grades',        // grade push (ratified-only)
    '/api/v1/reconciliation',// pull-back reconciliation
    '/api/v1/health',
  ],
  oneid: [
    '/api/v1/identity/verify', // identity verify
    '/api/v1/account/link',    // account link
    '/api/v1/health',
  ],
};

/**
 * Endpoint guard — allowlistdan tashqari endpoint taqiqlanadi.
 * @param {{ provider?: string, endpoint?: string }} params
 */
export function assertDocumentedEndpoint({ provider = '', endpoint = '' } = {}) {
  const allowed = DOCUMENTED_ENDPOINTS[provider];
  if (!allowed) return { ok: false, reason: `unknown provider: ${provider}` };
  if (!endpoint) return { ok: false, reason: 'endpoint is required' };
  if (!allowed.includes(endpoint)) {
    return { ok: false, reason: `undocumented endpoint rejected (no scraping): ${endpoint}` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 9. UTILITY
// ═══════════════════════════════════════════════════════════════════

/** Constant-time string comparison (webhook signatures, tokens). */
export function constantTimeEqual(a = '', b = '') {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
