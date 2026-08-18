/**
 * Edikit — E-02: HEMIS push webhook (talabalar/ballar o'zgarishi)
 * ---------------------------------------------------------------------------
 * HEMIS → Edikit push: HEMIS o'z bazasida talaba/ballar o'zgarganda Edikit'ga
 * xabar yuboradi. Bu qadam pull (mavjud REST) → push (yangi) o'tishning bir
 * qismi.
 *
 * Xavfsizlik (email webhook naqshida — AUTH A-23):
 *   - HMAC-SHA256 signature: `X-Hemis-Signature` — HEMIS_WEBHOOK_SECRET bilan
 *     tekshiriladi (timing-safe)
 *   - IP allowlist: HEMIS_WEBHOOK_IP_ALLOWLIST (vergul bilan); bo'lmasa token
 *     tekshiruvi yetarli (eski holat)
 *   - Idempotency: `event_id` — hemis_webhook_log/{eventId} — takroriy push
 *     qayta ishlanmaydi
 *   - Payload cheklovi: event turi allowlist (students.updated, scores.updated,
 *     session.updated), o'lcham limiti 32 KB
 *
 * @module hemis-webhook
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

const WEBHOOK_LOG_PATH = 'hemis_webhook_log';
const MAX_PAYLOAD_BYTES = 32 * 1024;

/** Retry backoff — 1m / 5m / 15m (email-infra naqshida, B-31 §08). */
export const HEMIS_RETRY_BACKOFFS_MS = [60_000, 300_000, 900_000];
export const HEMIS_MAX_ATTEMPTS = 3;

/** Ruxsat etilgan HEMIS push event turlari. */
export const HEMIS_PUSH_EVENTS = {
  STUDENTS_UPDATED: 'students.updated',
  SCORES_UPDATED: 'scores.updated',
  SESSION_UPDATED: 'session.updated',
};
export const ALLOWED_EVENTS = new Set(Object.values(HEMIS_PUSH_EVENTS));

/**
 * IP allowlist (email webhook naqshida — D-32 §27).
 * `HEMIS_WEBHOOK_IP_ALLOWLIST` env'da vergul bilan IP'lar; bo'lmasa true.
 */
export function isWebhookIpAllowed(ip, env = process.env) {
  if (!ip) return false;
  const allow = String(env.HEMIS_WEBHOOK_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allow.length) return true;
  return allow.includes(ip);
}

/**
 * HMAC-SHA256 signature hisoblaydi (raw body ustida — naqsh bo'yicha).
 * @param {string} rawBody
 * @param {string} secret
 * @returns {string} hex digest
 */
export function computeHmac(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Signature tekshiruvi — timing-safe.
 * @param {string} rawBody
 * @param {string} providedSig — `X-Hemis-Signature` qiymati
 * @param {string} secret
 * @returns {boolean}
 */
export function verifyHmac(rawBody, providedSig, secret) {
  if (!providedSig || !secret) return false;
  const expected = computeHmac(rawBody, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(providedSig).trim(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Webhook payload'ni tekshiradi (struktura + event allowlist).
 * @param {Object} payload
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateWebhookPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid-payload' };
  if (!payload.event_id || typeof payload.event_id !== 'string') {
    return { ok: false, error: 'missing-event-id' };
  }
  if (!payload.event || !ALLOWED_EVENTS.has(payload.event)) {
    return { ok: false, error: 'event-not-allowed' };
  }
  if (!payload.data || typeof payload.data !== 'object') {
    return { ok: false, error: 'missing-data' };
  }
  return { ok: true };
}

/**
 * Idempotency tekshiruvi — bu event allaqachon qayta ishlanganmi.
 * @param {string} eventId
 * @param {Object} [deps] — { fbGet }
 */
export async function isEventProcessed(eventId, deps = {}) {
  const get = deps.fbGet || ((p) => fb.get(p));
  const snap = await get(`${WEBHOOK_LOG_PATH}/${safeKey(eventId)}`);
  return snap.exists();
}

/**
 * HEMIS push webhook'ni qayta ishlaydi (idempotent, audit bilan).
 *
 * @param {string} rawBody — HMAC uchun xom body
 * @param {Object} [deps] — { ip, env, fbGet, fbSet, secret, skipVerify }
 * @returns {Promise<{ ok: boolean, duplicate?: boolean, event?: string, error?: string }>}
 */
export async function processHemisWebhook(rawBody, deps = {}) {
  const env = deps.env || process.env;
  const secret = deps.secret || env.HEMIS_WEBHOOK_SECRET;

  // 1. IP allowlist
  if (deps.ip !== undefined && !isWebhookIpAllowed(deps.ip, env)) {
    return { ok: false, error: 'ip-not-allowed' };
  }

  // 2. Signature tekshiruvi
  if (!deps.skipVerify) {
    if (!verifyHmac(rawBody, deps.signature, secret)) {
      return { ok: false, error: 'invalid-signature' };
    }
  }

  // 3. Payload parse + struktur tekshiruv
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (rawBody && Buffer.byteLength(rawBody, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: 'payload-too-large' };
  }
  const v = validateWebhookPayload(payload);
  if (!v.ok) return { ok: false, error: v.error };

  // 4. Idempotency
  const get = deps.fbGet || ((p) => fb.get(p));
  if (await isEventProcessed(payload.event_id, { fbGet: get })) {
    return { ok: true, duplicate: true, event: payload.event };
  }

  // 5. Saqlash + audit
  const set = deps.fbSet || ((p, val) => fb.set(p, val));
  const logPath = `${WEBHOOK_LOG_PATH}/${safeKey(payload.event_id)}`;
  await set(logPath, {
    event: payload.event,
    receivedAt: Date.now(),
    data: payload.data,
    processed: true,
  });

  await audit({
    action: AUDIT_ACTIONS.HEMIS_WEBHOOK,
    userId: deps.userId || null,
    resourceType: 'hemis_webhook',
    resourceId: payload.event_id,
    details: { event: payload.event, duplicate: false },
  });

  return { ok: true, event: payload.event };
}

/**
 * Muvaffaqiyatsiz push uchun retry rejalaydi (exponential backoff).
 * Email-infra naqshida (B-31): transient xatolar uchun HEMIS_MAX_ATTEMPTS
 * urinish; status='retry' + nextRetryAt. Worker `getDueWebhookRetries` orqali
 * muddati yetganlarini oladi. Permanent xatolar qayta rejalashmaydi.
 *
 * @param {Object} p — { eventId, event, data }
 * @param {number} p.attempts — nechanchi urinish (1..HEMIS_MAX_ATTEMPTS)
 * @param {Object} [deps] — { fbSet }
 * @returns {Promise<{ ok: boolean, nextRetryAt?: number, attempts?: number, error?: string }>}
 */
export async function scheduleWebhookRetry({ eventId, event, data, attempts = 1 }, deps = {}) {
  const set = deps.fbSet || ((p, v) => fb.set(p, v));
  if (!eventId) return { ok: false, error: 'missing-event-id' };
  if (attempts > HEMIS_MAX_ATTEMPTS) {
    // Chegara — deadletter holati (ops review uchun)
    await set(`${WEBHOOK_LOG_PATH}/${safeKey(eventId)}`, {
      event,
      data,
      status: 'deadletter',
      attempts,
      updatedAt: Date.now(),
    });
    return { ok: false, error: 'max-attempts', status: 'deadletter' };
  }
  const delay = HEMIS_RETRY_BACKOFFS_MS[attempts - 1] ?? HEMIS_RETRY_BACKOFFS_MS[HEMIS_RETRY_BACKOFFS_MS.length - 1];
  const nextRetryAt = Date.now() + delay;
  await set(`${WEBHOOK_LOG_PATH}/${safeKey(eventId)}`, {
    event,
    data,
    status: 'retry',
    attempts,
    nextRetryAt,
    updatedAt: Date.now(),
  });
  return { ok: true, nextRetryAt, attempts };
}

/**
 * Muddati yetgan retry job'larini qaytaradi (worker sikl uchun).
 * @param {number} [now]
 * @param {Object} [deps] — { fbGet }
 * @returns {Promise<Array<{ eventId: string, event: string, data: Object, attempts: number }>>}
 */
export async function getDueWebhookRetries(now = Date.now(), deps = {}) {
  const get = deps.fbGet || ((p) => fb.get(p));
  const snap = await get(WEBHOOK_LOG_PATH);
  if (!snap.exists()) return [];
  const log = snap.val() || {};
  const due = [];
  for (const [rawKey, entry] of Object.entries(log)) {
    if (entry && entry.status === 'retry' && entry.nextRetryAt && entry.nextRetryAt <= now) {
      due.push({
        eventId: rawKey,
        event: entry.event,
        data: entry.data,
        attempts: entry.attempts || 1,
      });
    }
  }
  return due;
}
