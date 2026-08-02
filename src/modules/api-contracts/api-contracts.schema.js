/**
 * Edikit — API, Socket, Job, Webhook & Outbox Contract Audit (PURE logic)
 *
 * Prompt 67 — barcha module boundarylarini versionlangan Zod/OpenAPI/event
 * contractlar bilan birlashtirish (research.md §18 service boundaries va
 * API draft, §19 provider adapter contract). This module is PURE (no I/O,
 * no globals except crypto):
 *
 *   - zodToOpenApiSchema: zod schema → OpenAPI 3.1 JSON Schema object
 *     (zod v4 toJSONSchema({ target: 'openApi3' })) + safe fallback.
 *   - Route inventory: assertRouteEntry, buildRouteKey, assertAuthLevel.
 *   - Cursor / idempotency / ETag conventions: encodeCursor/decodeCursor,
 *     assertCursor, buildIdempotencyKey, assertIdempotencyHeader,
 *     buildEtag/matchEtag (If-None-Match / If-Match).
 *   - Socket event allowlist: assertSocketEventAllowed (fail-closed),
 *     SOCKET_EVENT_CONTRACTS (documented event registry).
 *   - Job contract: assertJobPayload, buildJobTrace, assertJobTrace.
 *   - Webhook audit: verifyWebhookRawSignature (HMAC-SHA256 timing-safe),
 *     assertWebhookReplay (timestamp tolerance), assertWebhookDedup
 *     (event_id unique), processWebhookOutOfOrder (seq).
 *   - Outbox: assertOutboxTransition (FSM), assertConsumerIdempotency,
 *     buildConsumerKey, computeBackoff, assertRetryAllowed.
 *   - Security/data guard: assertNoSensitiveInGenericSchema — private
 *     scoring/sensitive case generic API schema'ga qo'shilmaydi (§15).
 *
 * SECURITY (§15-17): fail-closed — undocumented privileged endpoint yoki
 * unversioned event qolmasligi shart; har write path idempotent + audited.
 */

import crypto from 'crypto';
import { z } from 'zod';

// ── Version & enum constants ──
export const API_VERSION = 'v1';
export const AUTH_LEVELS = ['public', 'user', 'admin'];
export const CONTRACT_KINDS = ['request', 'response', 'event', 'job'];
export const CONTRACT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  DEPRECATED: 'deprecated',
};
export const WEBHOOK_STATUS = {
  RECEIVED: 'received',
  PROCESSED: 'processed',
  REJECTED: 'rejected',
  OUT_OF_ORDER: 'out_of_order',
};
export const OUTBOX_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter',
};
export const OUTBOX_TRANSITIONS = {
  pending: ['processing'],
  processing: ['delivered', 'failed'],
  failed: ['processing', 'dead_letter'],
  dead_letter: ['processing'],
  delivered: [],
};
export const MAX_ATTEMPTS = 5;
export const BASE_BACKOFF_MS = 500;
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 min

/**
 * Generic enum validator (fail-closed). Mirrors project convention.
 * @param {{ value: any, allowed: string[], name?: string }} params
 */
export function assertValidEnum({ value, allowed = [], name = 'value' }) {
  if (value === undefined || value === null) return { ok: false, reason: `${name} is required` };
  if (!Array.isArray(allowed) || !allowed.includes(value)) {
    return { ok: false, reason: `invalid ${name}: ${value}` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 1. ZOD → OPENAPI 3.1 CONVERTER
// ═══════════════════════════════════════════════════════════════════

/**
 * zod schema → OpenAPI 3.1 schema object. zod v4 built-in
 * `toJSONSchema({ target: 'openApi3' })` ishlatiladi; agar bo'lmasa
 * (eski zod / non-zod) minimal fallback beriladi.
 * @param {import('zod').ZodType | object} schema
 */
export function zodToOpenApiSchema(schema = null) {
  if (!schema) return { ok: false, reason: 'schema is required' };
  if (typeof schema.toJSONSchema === 'function') {
    try {
      const spec = schema.toJSONSchema({ target: 'openApi3' });
      return { ok: true, spec };
    } catch (e) {
      // fallback below
    }
  }
  if (schema && typeof schema === 'object' && schema._def) {
    return { ok: false, reason: 'zod schema conversion failed (openApi3 target unsupported)' };
  }
  return { ok: false, reason: 'unsupported schema (expected a zod schema)' };
}

/** Deterministic hash of a spec object (contract identity). */
export function computeSchemaHash(spec = null) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(spec ?? {}))
    .digest('hex')
    .slice(0, 64);
}

/**
 * Assemble a minimal OpenAPI 3.1 document from registered routes + contracts.
 * @param {{ routes?: object[], contracts?: object[] }} params
 */
export function buildOpenApiDocument({ routes = [], contracts = [] } = {}) {
  const paths = {};
  for (const r of routes) {
    if (!r.documented) continue;
    const opId = r.contract_name || `${r.module}_${r.method.toLowerCase()}_${r.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
    paths[r.path] = paths[r.path] || {};
    paths[r.path][r.method.toLowerCase()] = {
      operationId: opId,
      summary: `[${r.module}] ${r.method} ${r.path}`,
      security: r.auth_level === 'public' ? [] : [{ session: [] }],
      responses: { '200': { description: 'OK' } },
    };
  }
  const schemas = {};
  for (const c of contracts) {
    if (c.status !== 'published') continue;
    schemas[c.contract_name] = c.spec;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Edikit API', version: API_VERSION },
    paths,
    components: { schemas },
  };
}

/** Validate OpenAPI 3.1 document structure (fail-closed). */
export function assertOpenApiDocument(doc = null) {
  if (!doc) return { ok: false, reason: 'OpenAPI document is required' };
  if (doc.openapi !== '3.1.0') return { ok: false, reason: 'openapi must be 3.1.0' };
  if (!doc.info || !doc.info.title) return { ok: false, reason: 'info.title is required' };
  if (!doc.paths || typeof doc.paths !== 'object') return { ok: false, reason: 'paths is required' };
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 2. ROUTE INVENTORY
// ═══════════════════════════════════════════════════════════════════

/** Route identity key (tenant-scoped uniqueness). */
export function buildRouteKey({ method = '', path = '', version = API_VERSION } = {}) {
  return `${method.toUpperCase()} ${version}${path}`.trim();
}

/** Route entry validation (fail-closed). */
export function assertRouteEntry({ method = '', path = '', authLevel = 'public', documented = false } = {}) {
  const m = assertValidEnum({ value: method.toUpperCase(), allowed: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], name: 'method' });
  if (!m.ok) return m;
  if (!path || !path.startsWith('/')) return { ok: false, reason: 'path must start with /' };
  const a = assertValidEnum({ value: authLevel, allowed: AUTH_LEVELS, name: 'authLevel' });
  if (!a.ok) return a;
  // Stop condition §24 — undocumented privileged endpoint qolmasligi shart.
  if (!documented && authLevel !== 'public') {
    return { ok: false, reason: 'privileged endpoint must be documented (stop condition §24)' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 3. CURSOR / IDEMPOTENCY / ETAG CONVENTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Cursor pagination convention: base64url(kind:key:value).
 * Cursor opaque — frontend decode qilmaydi, server qayta beradi.
 */
export function encodeCursor({ kind = 'id', key = 'id', value = '' } = {}) {
  if (value === undefined || value === null) return null;
  return Buffer.from(`${kind}:${key}:${String(value)}`, 'utf8').toString('base64url');
}

/** Decode cursor (fail-closed). */
export function decodeCursor(cursor = '') {
  if (!cursor) return { ok: false, reason: 'cursor is required' };
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parts = raw.split(':');
    if (parts.length < 3) return { ok: false, reason: 'malformed cursor' };
    return { ok: true, kind: parts[0], key: parts[1], value: parts.slice(2).join(':') };
  } catch {
    return { ok: false, reason: 'malformed cursor' };
  }
}

/** Cursor guard — cursor kind va key mos kelishi shart. */
export function assertCursor({ cursor = '', kind = 'id', key = 'id' } = {}) {
  if (!cursor) return { ok: false, reason: 'cursor is required' };
  const d = decodeCursor(cursor);
  if (!d.ok) return d;
  if (d.kind !== kind || d.key !== key) {
    return { ok: false, reason: 'cursor kind/key mismatch (cursor reuse guard)' };
  }
  return { ok: true };
}

/**
 * Idempotency key convention — POST write path'lar uchun majburiy.
 * Format: `edikit:{tenantId}:{operation}:{sha256-hash}` (64+ chars).
 */
export function buildIdempotencyKey({ tenantId = '', operation = '', payload = null } = {}) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex');
  return `edikit:${tenantId}:${operation}:${hash}`;
}

/** Idempotency-Key header validation (fail-closed). */
export function assertIdempotencyHeader(header = '') {
  if (!header) return { ok: false, reason: 'Idempotency-Key header is required for this write path' };
  const parts = String(header).split(':');
  if (parts.length !== 4 || parts[0] !== 'edikit') {
    return { ok: false, reason: 'invalid Idempotency-Key format (expected edikit:tenant:operation:hash)' };
  }
  if (!/^[0-9a-f]{64}$/.test(parts[3])) return { ok: false, reason: 'invalid idempotency hash segment' };
  return { ok: true };
}

/**
 * ETag convention: `"sha256-{hash}"` — resource representation hash.
 * @param {object} payload
 */
export function buildEtag(payload = null) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex').slice(0, 32);
  return `"sha256-${hash}"`;
}

/**
 * If-Match / If-None-Match guard (fail-closed).
 * - ifMatch: If-Match header berilgan bo'lsa, resource etag ga teng bo'lishi
 *   shart (stale write → 412).
 * - ifNoneMatch: If-None-Match'da etag bo'lsa → 304 (cache revalidate).
 * @param {{ currentEtag?: string, ifMatch?: string, ifNoneMatch?: string }} params
 */
export function matchEtag({ currentEtag = '', ifMatch = '', ifNoneMatch = '' } = {}) {
  if (ifMatch && ifMatch !== '*' && ifMatch !== currentEtag) {
    return { ok: false, status: 412, reason: 'If-Match mismatch — resource changed (ETag conflict)' };
  }
  if (ifNoneMatch && ifNoneMatch === currentEtag) {
    return { ok: false, status: 304, reason: 'Not modified (If-None-Match match)' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 4. SOCKET EVENT ALLOWLIST
// ═══════════════════════════════════════════════════════════════════

/**
 * Documented socket event registry (allowlist). Allowlistdan tashqari
 * event fail-closed rad etiladi. Version + auth + rate-limit group.
 */
export const SOCKET_EVENT_CONTRACTS = {
  'host:create': { version: 'v1', auth: 'host', rateLimitGroup: 'host' },
  'host:start': { version: 'v1', auth: 'host', rateLimitGroup: 'host' },
  'host:next': { version: 'v1', auth: 'host', rateLimitGroup: 'host' },
  'host:forceNext': { version: 'v1', auth: 'host', rateLimitGroup: 'host' },
  'host:end': { version: 'v1', auth: 'host', rateLimitGroup: 'host' },
  'player:join': { version: 'v1', auth: 'player', rateLimitGroup: 'player' },
  'player:answer': { version: 'v1', auth: 'player', rateLimitGroup: 'answer' },
  'player:leave': { version: 'v1', auth: 'player', rateLimitGroup: 'player' },
  'arena:botAnswer': { version: 'v1', auth: 'host', rateLimitGroup: 'bot' },
  'arena:subscribe': { version: 'v1', auth: 'player', rateLimitGroup: 'default' },
};

/**
 * Socket event allowlist guard (fail-closed §11).
 * @param {{ event?: string, version?: string }} params
 */
export function assertSocketEventAllowed({ event = '', version = API_VERSION } = {}) {
  if (!event) return { ok: false, reason: 'event name is required' };
  const c = SOCKET_EVENT_CONTRACTS[event];
  if (!c) return { ok: false, reason: `socket event not in allowlist (unversioned/undocumented): ${event}` };
  if (c.version !== version) return { ok: false, reason: `socket event version mismatch (expected ${c.version}, got ${version})` };
  return { ok: true, contract: c };
}

// ═══════════════════════════════════════════════════════════════════
// 5. JOB PAYLOAD / VERSION / TRACE CONTRACT
// ═══════════════════════════════════════════════════════════════════

/** Job payload schema (versioned) — minimal contract registry. */
export const JOB_CONTRACTS = {
  scoring: { version: 'v1', traceRequired: true },
  publish: { version: 'v1', traceRequired: true },
  export: { version: 'v1', traceRequired: true },
  notification: { version: 'v1', traceRequired: false },
  sourcePack: { version: 'v1', traceRequired: true },
  gradeRelease: { version: 'v1', traceRequired: true },
};

/**
 * Job payload/version contract guard (fail-closed §12).
 * @param {{ jobType?: string, version?: string }} params
 */
export function assertJobContract({ jobType = '', version = API_VERSION } = {}) {
  if (!jobType) return { ok: false, reason: 'jobType is required' };
  const c = JOB_CONTRACTS[jobType];
  if (!c) return { ok: false, reason: `job type not contracted: ${jobType}` };
  if (c.version !== version) return { ok: false, reason: `job version mismatch (expected ${c.version}, got ${version})` };
  return { ok: true, contract: c };
}

/** Job trace id — W3C traceparent-style short trace. */
export function buildJobTrace({ tenantId = '', jobType = '' } = {}) {
  return crypto.createHash('sha256').update(`${tenantId}|${jobType}|${Date.now()}|${Math.random()}`).digest('hex').slice(0, 32);
}

/** Job trace validation (fail-closed). */
export function assertJobTrace(traceId = '') {
  if (!traceId) return { ok: false, reason: 'job traceId is required' };
  if (!/^[0-9a-f]{32}$/.test(traceId)) return { ok: false, reason: 'invalid traceId format' };
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 6. WEBHOOK RAW-SIGNATURE / REPLAY / OUT-OF-ORDER AUDIT
// ═══════════════════════════════════════════════════════════════════

/** Timing-safe HMAC-SHA256 raw-signature verification. */
export function verifyWebhookRawSignature({ secret = '', rawBody = '', signature = '' } = {}) {
  if (!secret || !rawBody || !signature) return { ok: false, reason: 'secret, rawBody and signature are required' };
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'webhook signature mismatch (length)' };
  return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'webhook signature mismatch' };
}

/**
 * Replay guard — timestamp tolerance (research §19: webhook signature +
 * timestamp tolerance + replay prevention).
 * @param {{ eventTime?: number, now?: number, toleranceMs?: number }} params
 */
export function assertWebhookReplay({ eventTime = 0, now = Date.now(), toleranceMs = WEBHOOK_TIMESTAMP_TOLERANCE_MS } = {}) {
  if (!eventTime) return { ok: false, reason: 'webhook timestamp is required' };
  const diff = Math.abs(now - eventTime);
  if (diff > toleranceMs) return { ok: false, reason: 'webhook timestamp outside tolerance (possible replay)' };
  return { ok: true };
}

/**
 * Dedup guard — provider event_id UNIQUE (replay → duplicate rejected).
 * @param {{ eventId?: string, existing?: boolean }} params
 */
export function assertWebhookDedup({ eventId = '', existing = false } = {}) {
  if (!eventId) return { ok: false, reason: 'webhook event_id is required' };
  if (existing) return { ok: false, reason: 'duplicate webhook event_id (replay rejected)', duplicate: true };
  return { ok: true };
}

/**
 * Out-of-order detection — seq keyin kelgan eski event → out_of_order.
 * @param {{ seq?: number, lastSeen?: number }} params
 */
export function processWebhookOutOfOrder({ seq = null, lastSeen = 0 } = {}) {
  if (seq === null || seq === undefined) return { ok: true, status: WEBHOOK_STATUS.RECEIVED };
  if (lastSeen && seq <= lastSeen) {
    return { ok: true, status: WEBHOOK_STATUS.OUT_OF_ORDER, outOfOrder: true };
  }
  return { ok: true, status: WEBHOOK_STATUS.RECEIVED, outOfOrder: false };
}

// ═══════════════════════════════════════════════════════════════════
// 7. TRANSACTIONAL OUTBOX + CONSUMER IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

/** Outbox status FSM transition guard (fail-closed). */
export function assertOutboxTransition({ from, to } = {}) {
  const allowed = OUTBOX_TRANSITIONS[from];
  if (!allowed) return { ok: false, reason: `invalid outbox from status: ${from}` };
  if (!allowed.includes(to)) return { ok: false, reason: `invalid outbox transition ${from} → ${to}` };
  return { ok: true };
}

/**
 * Consumer idempotency — consumer_key UNIQUE; allaqachon delivered bo'lsa
 * consumer qayta ishlamaydi (at-least-once → idempotent consumer).
 * @param {{ status?: string, consumerKey?: string }} params
 */
export function assertConsumerIdempotency({ status = '', consumerKey = '' } = {}) {
  if (!consumerKey) return { ok: false, reason: 'consumerKey is required' };
  if (status === OUTBOX_STATUS.DELIVERED) {
    return { ok: false, reason: 'already delivered (consumer idempotency)', duplicate: true };
  }
  return { ok: true };
}

/** Deterministic consumer key — bitta payload bitta key (idempotency). */
export function buildConsumerKey({ tenantId = '', outboxType = '', payload = null } = {}) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex').slice(0, 48);
  return `${tenantId}:${outboxType}:${hash}`;
}

/** Retry guard — attempts < max va backoff o'tgan bo'lsa retry mumkin. */
export function assertRetryAllowed({ attempts = 0, maxAttempts = MAX_ATTEMPTS, nextRetryAt = null, now = Date.now() } = {}) {
  if (attempts >= maxAttempts) return { ok: false, reason: 'max attempts reached', deadLetter: true };
  if (nextRetryAt && now < nextRetryAt) return { ok: false, reason: 'retry backoff not elapsed' };
  return { ok: true };
}

/** Exponential backoff (capped 5 min). */
export function computeBackoff({ attempt = 0, baseMs = BASE_BACKOFF_MS, maxMs = 5 * 60 * 1000 } = {}) {
  return Math.min(baseMs * 2 ** Math.max(0, attempt), maxMs);
}

// ═══════════════════════════════════════════════════════════════════
// 8. SECURITY / DATA GUARD — SENSITIVE CASE GENERIC SCHEMA'DA YO'Q
// ═══════════════════════════════════════════════════════════════════

/** Private/sensitive field nomlari — generic API schema'da bo'lmasligi shart. */
// Barchasi lowercase — assertNoSensitiveInGenericSchema field nomlarini
// lowercase qilib solishtiradi (case-sensitivity xatosi bo'lmasligi uchun).
export const SENSITIVE_FIELD_PATTERNS = [
  'pinfl', 'passport', 'password', 'secret', 'token', 'ciphertext',
  'privatescore', 'scoringdetail', 'rawresponse', 'biometric', 'cameraframe',
];

/**
 * §15 — private scoring / sensitive case generic API schema'ga qo'shilmaydi.
 * Generic (public/user) schema'da sensitive field bo'lsa → fail-closed.
 * @param {{ spec?: object, scope?: string }} params
 */
export function assertNoSensitiveInGenericSchema({ spec = null, scope = 'user' } = {}) {
  if (!spec) return { ok: false, reason: 'spec is required' };
  if (scope === 'admin') return { ok: true }; // admin schema'da ruxsat
  const props = spec.properties || {};
  const names = Object.keys(props).map((k) => k.toLowerCase());
  for (const pat of SENSITIVE_FIELD_PATTERNS) {
    if (names.some((n) => n.includes(pat))) {
      return { ok: false, reason: `sensitive field "${pat}" must not appear in generic API schema (scope=${scope})` };
    }
  }
  return { ok: true };
}

/** Socket event auth levels — AUTH_LEVELS (HTTP) dan farqli: host/player. */
export const SOCKET_AUTH_LEVELS = ['public', 'host', 'player', 'admin'];

/** Constant-time string comparison (webhook signatures, tokens). */
export function constantTimeEqual(a = '', b = '') {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Re-export zod for callers
export { z };
