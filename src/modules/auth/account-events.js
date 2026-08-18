/**
 * Deborah — Account security events feed (AUTH A-29)
 * -------------------------------------------------------------------
 * A-29 (guide §04, §07-§08, §18):
 *   - `users.{id}.security_events.{id}` — password/email change, login,
 *     breach, risk holatlari haqida qisqa feed (user ko'radi).
 *   - Privacy: ip_hash saqlanadi lekin GET feed'da FAQAT agregatlar
 *     (type, ts, device/browser, city) qaytadi — raw IP/UA hech qachon.
 *   - Retention: oxirgi 50 event (slice) — qisqa, DSAR user bilan.
 *   - Breach flag: `users.{id}.breach_flagged` — login'da HIBP async check
 *     (A-29 §08 P1) → panel'da "parolni o'zgartiring" banneri.
 */

import { fb } from '../../../firebase/admin.js';
import { parseDevice } from './new-device.js';
import { cityFromIp } from './geo-lite.js';

const EVENTS_MAX = 50; // retention — oxirgi 50 event
const EVENTS_PATH = (userId) => `users/${userId}/security_events`;
const BREACH_PATH = (userId) => `users/${userId}/breach_flagged`;

// ── Event turlari (A-29 §18: password_changed, email_changed, breach_detected) ──
export const ACCOUNT_EVENT_TYPES = {
  PASSWORD_CHANGED: 'password_changed',
  EMAIL_CHANGE_REQUESTED: 'email_change_requested',
  EMAIL_CHANGED: 'email_changed',
  EMAIL_CHANGE_FAILED: 'email_change_failed',
  BREACH_DETECTED: 'breach_detected',
  NEW_DEVICE_LOGIN: 'login_new_device',
  SUSPICIOUS_LOGIN: 'login_suspicious',
  RISK_BLOCKED: 'risk_blocked',
  MFA_DISABLED: 'mfa_disabled',
};

/**
 * Security event yozadi. Faqat hash'lar/agregatlar — raw IP/parol/email YO'Q.
 * @param {{ userId: string, type: string, ipAddress?: string, userAgent?: string, details?: object, ts?: number }} params
 */
export async function recordAccountEvent({ userId, type, ipAddress, userAgent, details = {}, ts }) {
  if (!userId || !type) return { ok: false, error: 'missing_fields' };
  const now = ts || Date.now();
  const id = `${now}_${Math.random().toString(36).slice(2, 8)}`;
  const { device, browser } = parseDevice(userAgent);
  const event = {
    type: String(type),
    ts: now,
    device,
    browser,
    city: cityFromIp(ipAddress), // agregat
    method: details.method || null,
    detail: sanitizeDetails(details),
  };
  try {
    await fb.set(`${EVENTS_PATH(userId)}/${id}`, event);
    // Retention: EVENTS_MAX dan oshsa eng eskisini o'chirish
    await trimEvents(userId);
  } catch (_) { /* non-critical */ }
  return { ok: true, id };
}

/** Retention trim — oxirgi EVENTS_MAX tadan ko'p bo'lsa eskisini o'chiradi. */
async function trimEvents(userId) {
  try {
    const snap = await fb.get(EVENTS_PATH(userId));
    if (!snap.exists()) return;
    const all = snap.val() || {};
    const keys = Object.keys(all);
    if (keys.length <= EVENTS_MAX) return;
    const sorted = keys.sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0));
    const excess = sorted.slice(0, keys.length - EVENTS_MAX);
    for (const k of excess) {
      await fb.remove(`${EVENTS_PATH(userId)}/${k}`);
    }
  } catch (_) {}
}

/** PII-minimal: faqat UI uchun kerakli agregatlar (ip_hash/raw UA YO'Q). */
function sanitizeDetails(details = {}) {
  const out = {};
  // Whitelist — yangi maydon qo'shilsa shu yerda ruxsat beriladi
  if (details.method) out.method = String(details.method).slice(0, 30);
  if (details.reason) out.reason = String(details.reason).slice(0, 80);
  if (typeof details.breached === 'boolean') out.breached = details.breached;
  return out;
}

/**
 * Security events ro'yxati (UI feed) — PII-minimal ko'rinish.
 * ip_hash/raw UA/email hech qachon qaytmaydi (sanitizeDetails + whitelist).
 * @returns {Promise<Array<{ id, type, ts, device, browser, city, method }>>}
 */
export async function getAccountEvents(userId, limit = 20) {
  if (!userId) return [];
  try {
    const snap = await fb.get(EVENTS_PATH(userId));
    if (!snap.exists()) return [];
    const all = snap.val() || {};
    return Object.entries(all)
      .map(([id, e]) => ({
        id,
        type: e.type || 'unknown',
        ts: e.ts || 0,
        device: e.device || null,
        browser: e.browser || null,
        city: e.city || null,
        method: e.method || null,
        detail: sanitizeDetails(e.detail),
      }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, limit);
  } catch (_) {
    return [];
  }
}

// ── Breach flag (A-29 §08 P1) ──

/** Breach flag o'rnatadi (login'da HIBP async check topilgan). */
export async function setBreachFlag(userId) {
  if (!userId) return;
  try {
    await fb.set(BREACH_PATH(userId), Date.now());
  } catch (_) {}
}

/** Breach flag'ni tozalaydi (parol o'zgartirilganda — A-29 §08). */
export async function clearBreachFlag(userId) {
  if (!userId) return;
  try {
    await fb.remove(BREACH_PATH(userId));
  } catch (_) {}
}

/** Breach flag holati — panel banneri uchun. */
export async function getBreachFlag(userId) {
  if (!userId) return null;
  try {
    const snap = await fb.get(BREACH_PATH(userId));
    return snap.exists() ? snap.val() : null;
  } catch (_) {
    return null;
  }
}

/** Testlar uchun. */
export function _accountEventsConfig() {
  return { EVENTS_MAX };
}
