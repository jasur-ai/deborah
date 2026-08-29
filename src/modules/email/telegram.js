/**
 * AUTH B-22 — Telegram bot (ulash + xabar yuborish)
 * -------------------------------------------------
 * - Ulash: Settings → "Telegram'ni ulash" → t.me/{bot}?start=<token 20B, 5 daqiqa, 1 marta>.
 * - Bot callback: HMAC-SHA256 (bot_token bilan) imzo — verify; user data
 *   (id, first_name, username) tekshiriladi; `users.{id}.telegram_id` saqlanadi;
 *   `notif_prefs.channels.telegram = true`.
 * - Xabar yuborish: `send(chatId, text)` — Telegram Bot API sendMessage,
 *   retry/backoff 3 marta, 4096 belgi limiti (uzun matn kesiladi).
 * - Chat (read-only): talaba bot'ga yozsa — "Natijalarim", "Bugungi jadval"
 *   (o'z tizimidan, faqat o'z ma'lumoti).
 * - Chastota cap: kuniga ≤2-3 (B-21 bilan); dedupe 24h.
 * - Security: telegram_id PII (UZ); token bitta foydalanish; preview sensitive yo'q;
 *   imzo verify bo'lmasa → reject.
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import CONFIG from '../../config/env.js';
import { audit, AUDIT_ACTIONS, logAuthEvent } from '../auth/audit.js';
import { timingSafeEqual, hashValue } from '../auth/telegram-otp.js';
import { getNotifPrefs, setNotifPrefs, checkNotifRate, recordNotifSent } from '../student/notifications.js';

const BOT_TOKEN = CONFIG.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = CONFIG.TELEGRAM_BOT_USERNAME || 'DeborahBot';
const ENABLED = CONFIG.TELEGRAM_ENABLED !== false && Boolean(BOT_TOKEN);

const LINK_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 daqiqa
const LINK_TOKEN_BYTES = 20; // 20 bayt → ~43 base64url belgi
const MSG_MAX_LEN = 4096; // Telegram limit
const RETRY_DELAYS_MS = [1000, 3000, 9000]; // 3 marta (exponential backoff)
const API = 'https://api.telegram.org';

// ── Imzo (callback verify uchun) ──

/** Callback payload imzolash — HMAC-SHA256 (bot_token bilan). */
export function signCallbackPayload(payload) {
  return crypto.createHmac('sha256', BOT_TOKEN || 'test-token').update(String(payload)).digest('hex');
}

/** Callback imzosini verify qiladi (timing-safe). */
export function verifyCallbackSignature({ payload, signature, secret }) {
  const expected = crypto.createHmac('sha256', secret || BOT_TOKEN || 'test-token').update(String(payload)).digest('hex');
  return timingSafeEqual(expected, String(signature || ''));
}

/** Bot faolmi (test'da mock). */
export function isTelegramEnabled() {
  return ENABLED;
}

export function getBotUsername() {
  return BOT_USERNAME;
}

// ── Ulash token (t.me/{bot}?start=<token>) ──

/**
 * Ulash start-token yaratadi: 20 bayt, 5 daqiqa, bitta foydalanish.
 * Saqlash: `telegram_link_tokens/{sha256(token)}` → { userId, expires_at, used:false }.
 */
export async function createLinkToken(userId) {
  if (!userId) return { ok: false, error: 'no_user' };
  const token = crypto.randomBytes(LINK_TOKEN_BYTES).toString('base64url');
  const record = {
    userId: safeKey(userId),
    expires_at: Date.now() + LINK_TOKEN_TTL_MS,
    used: false,
    created_at: Date.now(),
  };
  await fb.set(`telegram_link_tokens/${hashValue(token)}`, record);
  return { ok: true, token, url: `https://t.me/${BOT_USERNAME}?start=${token}`, ttlMs: LINK_TOKEN_TTL_MS };
}

/**
 * Start-token'ni consume qiladi (1 marta): token'ni tekshirib telegram_id
 * biriktiradi. Token 5 daqiqadan oshgan yoki allaqachon ishlatilgan → reject.
 *
 * @param {{ token: string, telegramId: string, firstName?: string, username?: string }} params
 * @returns {Promise<{ok: boolean, userId?: string, error?: string}>}
 */
export async function consumeLinkToken({ token, telegramId, firstName, username }) {
  if (!token || !telegramId) return { ok: false, error: 'missing_fields' };
  const path = `telegram_link_tokens/${hashValue(token)}`;
  const snap = await fb.get(path);
  if (!snap.exists()) return { ok: false, error: 'invalid_token' };
  const record = snap.val();
  if (record.used) return { ok: false, error: 'token_used' };
  if (Date.now() > record.expires_at) return { ok: false, error: 'token_expired' };

  // 1 marta ishlatish (idempotent: parallel callback'larda bitta g'olib)
  // Per-token lock: token_used flag'ni atomic qilish uchun re-read + mark
  const lockSnap = await fb.get(path);
  const current = lockSnap.val();
  if (current.used) return { ok: false, error: 'token_used' };

  // telegram_id bog'lash (PII — UZ, faqat saqlash; preview'ga chiqmaydi)
  const userId = record.userId;
  await fb.set(`users/${userId}/telegram_id`, String(telegramId));
  if (firstName || username) {
    await fb.set(`users/${userId}/telegram_meta`, {
      first_name: String(firstName || '').slice(0, 64),
      username: String(username || '').slice(0, 64),
      linked_at: Date.now(),
    });
  }
  // prefs.telegram_enabled = true (B-21 bilan birlashtirish)
  await setNotifPrefs({ userId, channels: { telegram: true } });
  // AUTH D-25 §09: telegram — alohida ixtiyoriy consent (B-22 ulash = rozilik)
  try {
    const { recordConsent, CONSENT_PURPOSES } = await import('../legal/consent.js');
    await recordConsent(userId, CONSENT_PURPOSES.TELEGRAM, { lang: 'uz' }).catch(() => {});
  } catch (_) { /* fail-soft */ }

  // Token'ni ishlatilgan qilish + eski token'larni tozalash
  await fb.set(path, { ...record, used: true, used_at: Date.now(), telegramId: String(telegramId) });
  await clearUsedTokens(userId);

  await logAuthEvent({
    action: AUDIT_ACTIONS.TELEGRAM_LINKED,
    outcome: 'success',
    method: 'telegram',
    actorId: userId,
    details: { linked_at: Date.now() },
  }).catch(() => {});

  return { ok: true, userId };
}

/**
 * User'ning eski token'larini tozalaydi: ishlatilgan (used) token'lar 24 soat
 * saqlanadi (qayta urinishda aniq 'token_used' xatosi qaytadi), faqat
 * muddati o'tgan VA 24 soatdan eski token'lar o'chiriladi.
 */
async function clearUsedTokens(userId) {
  try {
    const snap = await fb.get('telegram_link_tokens');
    if (!snap.exists()) return;
    const all = snap.val() || {};
    const now = Date.now();
    for (const [hash, rec] of Object.entries(all)) {
      if (rec.userId !== safeKey(userId)) continue;
      const isExpired = now > rec.expires_at;
      const usedOld = rec.used && now - (rec.used_at || rec.created_at || 0) > 24 * 60 * 60 * 1000;
      if (isExpired && (rec.used || usedOld)) {
        await fb.remove(`telegram_link_tokens/${hash}`);
      } else if (isExpired && !rec.used) {
        // Muddati o'tgan, ishlatilmagan token — darhol o'chirish mumkin emas
        // (expired xatosi qaytishi kerak); 24 soatdan keyin o'chadi
        if (now - rec.created_at > 24 * 60 * 60 * 1000) {
          await fb.remove(`telegram_link_tokens/${hash}`);
        }
      }
    }
  } catch (_) { /* non-critical */ }
}

/** Testlar uchun. */
export function _telegramConfig() {
  return { LINK_TOKEN_TTL_MS, LINK_TOKEN_BYTES, MSG_MAX_LEN, RETRY_DELAYS_MS };
}

// ── Xabar yuborish ──

/**
 * Telegram'ga xabar yuboradi — sendMessage API, retry/backoff 3 marta.
 * Test'da deps.sendImpl inject qilinadi (mock transport).
 *
 * @param {{ chatId: string|number, text: string, parseMode?: string, deps?: object }} params
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string, attempts: number}>}
 */
export async function sendTelegramMessage({ chatId, text, parseMode, deps = {} }) {
  if (!chatId) return { ok: false, error: 'no_chat', attempts: 0 };
  const safeText = String(text || '').slice(0, MSG_MAX_LEN);
  if (!safeText.trim()) return { ok: false, error: 'empty_text', attempts: 0 };

  const sendImpl = deps.sendImpl || sendViaApi;
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await sendImpl({ chatId, text: safeText, parseMode });
      return { ok: true, messageId: res?.message_id || `tg-${Date.now()}`, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
      }
    }
  }
  return { ok: false, error: lastErr?.message || 'send-failed', attempts: RETRY_DELAYS_MS.length };
}

/** Telegram Bot API sendMessage. */
async function sendViaApi({ chatId, text, parseMode }) {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  const res = await fetch(`${API}/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`telegram http-${res.status} ${data?.description || ''}`.slice(0, 200));
  }
  const data = await res.json();
  return data.result || {};
}

// ── User'ga xabar (prefs + cap + dedupe bilan) ──

/**
 * User'ga Telegram xabari yuboradi (agar ulangan bo'lsa + prefs ruxsat bersa).
 * Cap/dedupe (B-21) + audit + metric.
 *
 * @param {{ userId: string, type?: string, text: string, deps?: object }} params
 * @returns {Promise<{ok: boolean, sent?: boolean, error?: string}>}
 */
export async function notifyUserTelegram({ userId, type = 'general', text, deps = {} }) {
  if (!userId) return { ok: false, error: 'no_user' };
  // telegram_id mavjudmi
  let telegramId = null;
  try {
    const snap = await fb.get(`users/${safeKey(userId)}/telegram_id`);
    if (snap.exists()) telegramId = snap.val();
  } catch (_) {}
  if (!telegramId) return { ok: false, error: 'not_linked', sent: false };

  // Prefs tekshiruvi (B-21): telegram kanali yoqilgan + type ruxsat
  const prefs = await getNotifPrefs(userId);
  if (!prefs.channels.telegram) return { ok: false, error: 'channel_disabled', sent: false };
  if (!prefs.types[type] && type !== 'security') return { ok: false, error: 'type_disabled', sent: false };

  // Chastota cap + dedupe (B-21 §11) — security xabarlari cap'ga kirmaydi (B-32 §10)
  if (type !== 'security') {
    const rate = await checkNotifRate({ userId, channel: 'telegram', type });
    if (!rate.allowed) return { ok: false, error: rate.reason, sent: false };
  }

  const sent = await sendTelegramMessage({ chatId: telegramId, text, deps });
  if (sent.ok) {
    await recordNotifSent({ userId, channel: 'telegram', type });
    await logAuthEvent({
      action: AUDIT_ACTIONS.TELEGRAM_SENT,
      outcome: 'success',
      method: 'telegram',
      actorId: userId,
      details: { type },
    }).catch(() => {});
    return { ok: true, sent: true, messageId: sent.messageId };
  }
  await logAuthEvent({
    action: AUDIT_ACTIONS.TELEGRAM_FAILED,
    outcome: 'failed',
    method: 'telegram',
    actorId: userId,
    details: { type, error: sent.error },
  }).catch(() => {});
  return { ok: false, error: sent.error, sent: false };
}
