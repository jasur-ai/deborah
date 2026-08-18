/**
 * AUTH A-23 — Bounce/complaint webhook qayta ishlash
 * -------------------------------------------------
 * Postmark (va SES) formatlarini qo'llab-quvvatlaydi:
 *
 *   Postmark bounce:  { MessageID, Type: 'HardBounce'|'SoftBounce'|'SpamComplaint'|..., Email }
 *   SES bounce:       { MessageId, notificationType: 'Bounce'|'Complaint', bounce: { bounceType: 'Permanent' }, ... }
 *
 * Qoidalar:
 *   - Hard bounce → users/{userKey}/email_status = 'bounced' (darhol suppress)
 *   - Complaint → audit + alert (log; threshold monitoring operator'da)
 *   - Idempotency: email_log/{messageId} — bir xil webhook qayta ishlanmaydi
 *   - Webhook HMAC: X-Postmark-Webhook-Token (environment'da) tekshiriladi
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
// AUTH B-02: email_log PII minimal — plaintext email o'rniga deterministik hash
import { hashEmail } from './log.js';

const EMAIL_LOG_PATH = 'email_log';
const BOUNCE_SUPPRESS_PATH = 'email_suppressed';

/**
 * AUTH D-32 §27: provider webhook IP allowlist — spoof qarshi.
 * `EMAIL_WEBHOOK_IP_ALLOWLIST` env'da vergul bilan IP'lar (mas. Postmark/SES
 * e'lon qilgan CIDR'lar). Allowlist bo'lmasa — eski holat (operator tekshiruvi
 * webhook token orqali).
 */
export function isWebhookIpAllowed(ip, env = process.env) {
  if (!ip) return false;
  const allow = String(env.EMAIL_WEBHOOK_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allow.length) return true; // allowlist o'rnatilmagan — token tekshiruvi yetarli
  return allow.includes(ip);
}

/** Audit action'lar (A-23 §19 + B-31 §11 delivery). */
export const EMAIL_EVENTS = {
  SENT: 'email:sent',
  DELIVERED: 'email:delivered',
  BOUNCED: 'email:bounced',
  COMPLAINT: 'email:complaint',
  SUPPRESSED: 'email:suppressed',
};

/**
 * Webhook'ni qayta ishlaydi (idempotent).
 * @returns {Promise<{ok: boolean, event?: string, duplicate?: boolean, error?: string}>}
 */
export async function processEmailWebhook(payload, deps = {}) {
  // AUTH D-32 §27: IP allowlist tekshiruvi (deps.ip — route req.ip'dan)
  if (deps.ip !== undefined && !isWebhookIpAllowed(deps.ip, deps.env || process.env)) {
    return { ok: false, error: 'ip-not-allowed' };
  }
  const messageId = extractMessageId(payload);
  if (!messageId) return { ok: false, error: 'no-message-id' };

  const event = classifyEvent(payload);
  if (!event) return { ok: true, event: 'ignored' }; // info/soft — suppress emas

  // Idempotency: bir xil messageId ikkinchi marta ishlanmaydi
  const seen = await fb.get(`${EMAIL_LOG_PATH}/${safeKey(messageId)}/event`);
  if (seen.exists() && seen.val() === event) {
    return { ok: true, event, duplicate: true };
  }

  // Hard bounce → suppress
  if (event === EMAIL_EVENTS.BOUNCED && isHardBounce(payload)) {
    const email = extractEmail(payload);
    if (email) {
      const userKey = await findUserByEmail(email);
      if (userKey) {
        await fb.set(`users/${userKey}/email_status`, 'bounced');
        await fb.set(`${BOUNCE_SUPPRESS_PATH}/${safeKey(email)}`, {
          at: Date.now(),
          reason: 'hard-bounce',
          messageId,
        });
      }
    }
  }

  // email_log record (delivery tracking A-23 §10 + B-02 PII fix)
  // B-02: plaintext email YO'Q — deterministik HMAC-SHA256 hash (guide §26).
  // B-02 review fix: MERGE (overwrite EMAS!) — provider'ning 'sent' record'ini
  // (template/status/providerMsgId) yo'qotmaymiz; status event'ga ko'ra
  // yangilanadi (guide §07: queued|sent|delivered|bounced|complained|failed).
  const status = event === EMAIL_EVENTS.BOUNCED ? 'bounced'
    : (event === EMAIL_EVENTS.DELIVERED ? 'delivered' : 'complained');
  const logUpdate = {
    status,
    event,
    emailHash: hashEmail(extractEmail(payload)),
    rawType: extractRawType(payload),
    updatedAt: Date.now(),
  };
  const logPath = `${EMAIL_LOG_PATH}/${safeKey(messageId)}`;
  const existing = await fb.get(logPath);
  if (existing.exists()) {
    await fb.update(logPath, logUpdate);
  } else {
    await fb.set(logPath, { ...logUpdate, createdAt: Date.now() });
  }

  return { ok: true, event };
}

/** messageId'ni provider formatidan ajratadi. */
export function extractMessageId(payload) {
  return payload?.MessageID || payload?.MessageId || payload?.messageId || null;
}

/** Email manzilni ajratadi. */
export function extractEmail(payload) {
  return payload?.Email || payload?.email || payload?.mail?.destination?.[0] || null;
}

/** Raw event type (log uchun). */
export function extractRawType(payload) {
  return payload?.Type || payload?.notificationType || payload?.eventType || 'unknown';
}

/** Hard bounce aniqlash (Postmark + SES). */
export function isHardBounce(payload) {
  const t = extractRawType(payload);
  if (/HardBounce/i.test(t)) return true;
  if (payload?.bounce?.bounceType === 'Permanent') return true;
  if (/Transient|SoftBounce/i.test(t)) return false;
  return false;
}

/** Webhook'ni EMAIL_EVENTS'ga tasniflaydi (ignored bo'lishi mumkin). */
export function classifyEvent(payload) {
  const t = extractRawType(payload);
  if (/HardBounce|Transient|SoftBounce|Permanent|Bounce/i.test(t)) {
    return EMAIL_EVENTS.BOUNCED;
  }
  if (/Complaint|SpamComplaint/i.test(t)) {
    return EMAIL_EVENTS.COMPLAINT;
  }
  // B-31 §11: delivery → email_log status 'delivered' (Postmark 'Delivery' / SES 'Delivery')
  if (/Delivery/i.test(t) && !/Open|Click/i.test(t)) {
    return EMAIL_EVENTS.DELIVERED;
  }
  return null; // Open/Click va boshqalar — log'ga yozilmaydi
}

/** Email'dan userKey topish (users_email_index orqali — A-18).
 *  indexEmail() qiymat sifatida userKey STRING'ini yozadi —
 *  `users_email_index/{safeKey(email)} → userKey`.
 */
async function findUserByEmail(email) {
  const normalized = String(email || '').toLowerCase().trim();
  const snap = await fb.get(`users_email_index/${safeKey(normalized)}`);
  if (snap.exists()) {
    const v = snap.val();
    return typeof v === 'string' ? v : v?.userKey || null;
  }
  return null;
}

/**
 * Webhook token tekshiruvi (Postmark: X-Postmark-Webhook-Token).
 * AUTH A-23 review fix: timing-safe taqqoslash (crypto.timingSafeEqual).
 * Token env'da yo'q bo'lsa: production → fail-closed (rad); dev/test → o'tadi.
 */
export function verifyWebhookToken(req) {
  const expected = process.env.EMAIL_WEBHOOK_TOKEN;
  if (!expected) return process.env.NODE_ENV === 'production' ? false : true;
  const provided = req.get('X-Postmark-Webhook-Token') || req.get('x-webhook-token') || '';
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
