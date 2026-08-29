/**
 * AUTH B-02 — Email log (email_log) — PII minimal, DSAR-ready
 * ----------------------------------------------------------------------------
 * - email_log status'lar: queued|sent|delivered|bounced|complained|failed
 * - to_email_hash: HMAC-SHA256 DETERMINISTIK (guide §26) — DSAR'da bir xil
 *   email bir xil hash beradi; lekin hash'dan email qaytarib bo'lmaydi.
 * - Email plaintext email_log'da HECH QACHON saqlanmaydi (guide §14).
 * - Retention: 30 kun (guide §13) — purge job C-fazada (guide §27).
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';

/** email_log.status enum (guide §07). */
export const EMAIL_LOG_STATUS = ['queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'];

const EMAIL_LOG_PATH = 'email_log';

/** Retention: 30 kun (guide §13) — C-fazadagi purge job qo'llaydi. */
export const EMAIL_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deterministik HMAC-SHA256 hash key.
 * B-02 review: EMAIL_HASH_KEY barqaror bo'lishi SHART — u rotatsiya qilinsa
 * eski emailHash qiymatlarni DSAR/suppression lookup'da email'ga moslab
 * bo'lmaydi. Production'da alohida EMAIL_HASH_KEY o'rnating va backup qiling
 * (SESSION_SECRET rotatsiyasi hash'ni buzmasligi uchun undan mustaqil).
 */
let _hashKey = null;
function hashKey() {
  if (_hashKey) return _hashKey;
  const raw = process.env.EMAIL_HASH_KEY || process.env.SESSION_SECRET || 'deborah-email-hash-dev';
  _hashKey = crypto.createHash('sha256').update(String(raw)).digest();
  return _hashKey;
}

/**
 * Email'ni HMAC-SHA256 bilan hash'laydi (deterministik — DSAR uchun).
 * @param {string} email
 * @returns {string} hex hash (bo'sh/null → null)
 */
export function hashEmail(email) {
  if (!email) return null;
  const normalized = String(email).toLowerCase().trim();
  if (!normalized) return null;
  return crypto.createHmac('sha256', hashKey()).update(normalized).digest('hex');
}

/**
 * email_log record yozadi (idempotent — id berilgan bo'lsa qayta yozadi).
 * PII: emailHash (HMAC-SHA256) — plaintext email YO'Q.
 *
 * @param {object} opts
 * @param {string} opts.email — hash'lanadi; plaintext saqlanmaydi
 * @param {string} [opts.emailHash] — tayyor hash berilsa ishlatiladi
 * @param {string} opts.template — 'welcome' | 'verify' | 'reset' | ...
 * @param {string} opts.status — EMAIL_LOG_STATUS'dan
 * @param {string} [opts.providerMsgId]
 * @param {string} [opts.error]
 * @param {string} [opts.id] — webhook messageId kabi (idempotency kaliti)
 * @returns {Promise<{ok: boolean, id: string}>}
 */
export async function logEmailRecord({
  email,
  emailHash,
  template = null,
  status = 'sent',
  providerMsgId = null,
  error = null,
  id = null,
}) {
  try {
    const recordId = id || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const emailHashValue = emailHash || hashEmail(email);
    const now = Date.now();
    const record = {
      emailHash: emailHashValue,
      template,
      status,
      providerMsgId: providerMsgId || null,
      error: error ? String(error).slice(0, 300) : null,
      createdAt: now,
      updatedAt: now,
    };
    await fb.set(`${EMAIL_LOG_PATH}/${safeKey(recordId)}`, record);
    return { ok: true, id: recordId };
  } catch (err) {
    // Email log xatosi email yuborishni buzmaydi (fail-soft)
    console.warn('[email:log] record write failed:', err?.message || err);
    return { ok: false, id: null };
  }
}

export { EMAIL_LOG_PATH };
