/**
 * AUTH B-24 — Email change flow (reauth + double opt-in)
 * ------------------------------------------------------
 * OWASP: email = recovery kanali — o'g'irlangan sessiya email'ni o'zgartirib
 * lockout qilolmasligi uchun:
 *   1. Reauth: current password YOKI MFA step-up (mfaAt ≤ 30 daqiqa).
 *   2. IKKALA address verify:
 *      - Yangi email'ga 6-xonali code (5 daqiqa, single-use).
 *      - Eski email'ga confirm-token (15 daqiqa, single-use) — [Tasdiqlash]/[Bekor].
 *   3. Commit: users.email = new, email_verified=true, index yangilanadi,
 *      eski email'ga "o'zgartirildi" xabari.
 *
 * State: `email_change/{userKey}` — { newEmail, newCodeHash, newCodeSalt,
 *   oldTokenHash, expiresAt, createdAt } (ikkalasi shart, commit'da o'chiriladi).
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from './audit.js';
import { validateEmail } from '../email/validation.js';
import { findUserKeyByEmail, indexEmail } from './email-verify.js';
import { recordAccountEvent } from './account-events.js';
import { renderEmailChange, renderEmailChanged } from '../email/templates.js';
import { sendEmail } from '../email/provider.js';

const NEW_CODE_TTL_MS = 5 * 60 * 1000;   // yangi email kodi — 5 daqiqa
const OLD_TOKEN_TTL_MS = 15 * 60 * 1000; // eski email tokeni — 15 daqiqa (§27)

function hashCode(v, salt = '') {
  return crypto.createHash('sha256').update(String(v) + salt).digest('hex');
}

/** Rate limit: 3/soat per user (in-memory, restart'da tozalanadi). */
const requestAttempts = new Map(); // key: `${userKey}` → { count, resetAt }
const REQUEST_MAX_PER_HOUR = 3;

function requestLimited(userKey) {
  const now = Date.now();
  const entry = requestAttempts.get(userKey);
  if (!entry || now >= entry.resetAt) {
    requestAttempts.set(userKey, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  entry.count += 1;
  if (entry.count > REQUEST_MAX_PER_HOUR) return true;
  return false;
}

/** Testlar uchun — rate state tozalash. */
export function _resetEmailChangeRate() {
  requestAttempts.clear();
}

function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Email change so'rovi: reauth + newEmail validatsiya + ikkala address verify.
 * @returns {Promise<{ok:boolean, error?:string, httpStatus?:number, maskedNew?:string}>}
 */
export async function requestEmailChange({ userKey, newEmail, lang = 'uz' }) {
  if (!userKey || !newEmail) return { ok: false, error: 'required', httpStatus: 400 };
  const uKey = safeKey(userKey);

  // Rate limit 3/soat (§06)
  if (requestLimited(uKey)) {
    return { ok: false, error: 'too_many_requests', httpStatus: 429 };
  }

  // newEmail validatsiya (B-05 syntax/MX/disposable)
  const v = await validateEmail(newEmail);
  if (!v.ok) {
    return { ok: false, error: v.reason === 'syntax' ? 'emailInvalid' : (v.reason === 'disposable' ? 'emailDisposable' : 'emailNoMx'), httpStatus: 400 };
  }

  const normalized = String(newEmail).toLowerCase().trim();

  // Email bandligi — boshqa user'ga tegishli bo'lmasin
  const owner = await findUserKeyByEmail(normalized);
  if (owner && owner !== uKey) {
    return { ok: false, error: 'emailTaken', httpStatus: 409 };
  }

  // Joriy user va email
  const userSnap = await fb.get(`users/${uKey}`);
  if (!userSnap.exists()) return { ok: false, error: 'not_found', httpStatus: 404 };
  const userData = userSnap.val() || {};
  const oldEmail = userData.email;
  if (!oldEmail) return { ok: false, error: 'no_email', httpStatus: 400 };
  if (String(oldEmail).toLowerCase().trim() === normalized) {
    return { ok: false, error: 'same_email', httpStatus: 400 };
  }

  // ── Ikkala address'ga verify (§07) ──
  const newCode = String(Math.floor(100000 + Math.random() * 900000));
  const newSalt = crypto.randomBytes(8).toString('hex');
  const oldToken = crypto.randomBytes(32).toString('hex');
  const oldSalt = crypto.randomBytes(8).toString('hex');
  const now = Date.now();

  await fb.set(`email_change/${uKey}`, {
    userKey: uKey,
    newEmail: normalized,
    newCodeHash: hashCode(newCode, newSalt),
    newCodeSalt: newSalt,
    newEmailMasked: maskEmail(normalized),
    oldTokenHash: hashCode(oldToken, oldSalt),
    oldTokenSalt: oldSalt,
    createdAt: now,
    expiresAt: now + OLD_TOKEN_TTL_MS,
    oldEmail: String(oldEmail).toLowerCase().trim(),
    lang: lang || 'uz',
  });

  // 1) Yangi email'ga code (B-06 template — verify qayta ishlatiladi)
  const tplNew = renderEmailChange({ code: newCode, kind: 'new', lang });
  await sendEmail({
    to: normalized,
    subject: tplNew.subject,
    html: tplNew.html,
    text: tplNew.text,
    tag: 'email-change-new',
  }).catch((err) => {
    console.warn('[email:change] new send failed:', err?.message || err);
    return { ok: false };
  });

  // 2) Eski email'ga confirm-token (Tasdiqlash/Bekor — §07, §27)
  const tplOld = renderEmailChange({
    code: oldToken,
    kind: 'old',
    lang,
    newEmailMasked: maskEmail(normalized),
  });
  await sendEmail({
    to: oldEmail,
    subject: tplOld.subject,
    html: tplOld.html,
    text: tplOld.text,
    tag: 'email-change-old',
  }).catch((err) => {
    console.warn('[email:change] old send failed:', err?.message || err);
    return { ok: false };
  });

  // Account event (§10) + audit (§06) — event yozilishi confirm'dan oldin
  // tugashiga ishonch hosil qilish uchun await qilinadi (test + UI holati).
  await recordAccountEvent({
    userId: uKey,
    type: 'email_change_requested',
    details: { newEmailMasked: maskEmail(normalized) },
  }).catch(() => {});
  // B-24 review fix: audit write'ni await qilamiz — local-db RMW (readDB →
  // writeDB) butun snapshot'ni yozadi; fire-and-forget bo'lsa, keyingi
  // operatsiya (masalan index remove) bilan race qilib eski holatni
  // tiriltirishi mumkin edi (users_email_index qaytadan paydo bo'lar edi).
  await logAuthEvent({
    action: AUDIT_ACTIONS.EMAIL_CHANGE_REQUESTED,
    outcome: 'success',
    actorId: uKey,
    ipAddress: null,
    userAgent: null,
    details: { newEmailMasked: maskEmail(normalized) },
  }).catch(() => {});

  return {
    ok: true,
    maskedNew: maskEmail(normalized),
    codePreview: process.env.NODE_ENV !== 'production' ? newCode : null,
    oldTokenPreview: process.env.NODE_ENV !== 'production' ? oldToken : null,
  };
}

/**
 * Ikkala verify + commit (§08, §09).
 * @returns {Promise<{ok:boolean, error?:string, httpStatus?:number}>}
 */
export async function confirmEmailChange({ userKey, newCode, oldToken }) {
  if (!userKey || !newCode || !oldToken) return { ok: false, error: 'required', httpStatus: 400 };
  const uKey = safeKey(userKey);

  const snap = await fb.get(`email_change/${uKey}`);
  if (!snap.exists()) return { ok: false, error: 'no_pending_change', httpStatus: 400 };
  const rec = snap.val();
  if (!rec) return { ok: false, error: 'no_pending_change', httpStatus: 400 };
  if (rec.expiresAt && rec.expiresAt < Date.now()) {
    return { ok: false, error: 'change_expired', httpStatus: 422 };
  }

  // 1) Yangi email kodi (single-use)
  const codeOk =
    hashCode(String(newCode), rec.newCodeSalt) === rec.newCodeHash &&
    String(newCode).length === 6;
  if (!codeOk) return { ok: false, error: 'invalid_code', httpStatus: 422 };

  // 2) Eski email tokeni (single-use)
  const tokenOk = hashCode(String(oldToken), rec.oldTokenSalt) === rec.oldTokenHash;
  if (!tokenOk) return { ok: false, error: 'invalid_token', httpStatus: 422 };

  // ── Commit (§08): users.email = new, verified=true, index yangilanadi ──
  const newEmail = rec.newEmail;
  const oldEmail = rec.oldEmail;

  // Email hali band emasligini qayta tekshirish (race)
  const owner = await findUserKeyByEmail(newEmail);
  if (owner && owner !== uKey) {
    await fb.remove(`email_change/${uKey}`);
    return { ok: false, error: 'emailTaken', httpStatus: 409 };
  }

  await fb.update(`users/${uKey}`, {
    email: newEmail,
    email_verified: true,
    email_status: 'verified',
  });
  // Eski index o'chiriladi, yangisi yoziladi
  if (oldEmail) {
    const oldKey = safeKey(oldEmail);
    const oldSnap = await fb.get(`users_email_index/${oldKey}`);
    if (oldSnap.exists() && oldSnap.val() === uKey) {
      await fb.remove(`users_email_index/${oldKey}`);
    }
  }
  await indexEmail(newEmail, uKey);

  // Pending state tozalanadi
  await fb.remove(`email_change/${uKey}`);

  // Eski email'ga "o'zgartirildi" xabari (§08)
  const tplDone = renderEmailChanged({ lang: rec.lang || 'uz' });
  await sendEmail({
    to: oldEmail,
    subject: tplDone.subject,
    html: tplDone.html,
    text: tplDone.text,
    tag: 'email-change-done',
  }).catch(() => {});

  // Account event + audit (§10)
  await recordAccountEvent({
    userId: uKey,
    type: 'email_changed',
    details: { newEmailMasked: maskEmail(newEmail) },
  }).catch(() => {});
  // B-24 review fix: await (yuqoridagi izoh — index race yopildi).
  await logAuthEvent({
    action: AUDIT_ACTIONS.EMAIL_CHANGED,
    outcome: 'success',
    actorId: uKey,
    ipAddress: null,
    userAgent: null,
    details: { newEmailMasked: maskEmail(newEmail) },
  }).catch(() => {});

  return { ok: true, email: newEmail };
}

/**
 * Bekor qilish — eski email tokeni bilan (§07 [Bekor qilish]).
 * @returns {Promise<{ok:boolean, error?:string, httpStatus?:number}>}
 */
export async function cancelEmailChange({ userKey, oldToken }) {
  if (!userKey || !oldToken) return { ok: false, error: 'required', httpStatus: 400 };
  const uKey = safeKey(userKey);
  const snap = await fb.get(`email_change/${uKey}`);
  if (!snap.exists()) return { ok: false, error: 'no_pending_change', httpStatus: 400 };
  const rec = snap.val();
  const tokenOk = hashCode(String(oldToken), rec.oldTokenSalt) === rec.oldTokenHash;
  if (!tokenOk) return { ok: false, error: 'invalid_token', httpStatus: 422 };
  await fb.remove(`email_change/${uKey}`);
  // B-24 review fix: await (yuqoridagi izoh — index race yopildi).
  await logAuthEvent({
    action: AUDIT_ACTIONS.EMAIL_CHANGE_CANCELLED,
    outcome: 'success',
    actorId: uKey,
    ipAddress: null,
    userAgent: null,
  }).catch(() => {});
  return { ok: true };
}

/** Email change'ning joriy holatini qaytaradi (UI uchun). */
export async function getEmailChangeStatus(userKey) {
  if (!userKey) return null;
  const snap = await fb.get(`email_change/${safeKey(userKey)}`);
  if (!snap.exists()) return null;
  const rec = snap.val();
  const expiresAt = rec.expiresAt || 0;
  return {
    pending: true,
    newEmailMasked: rec.newEmailMasked || null,
    expired: expiresAt < Date.now(),
    ttlMs: Math.max(0, expiresAt - Date.now()),
  };
}

/** Testlar uchun. */
export function _emailChangeConfig() {
  return { NEW_CODE_TTL_MS, OLD_TOKEN_TTL_MS, REQUEST_MAX_PER_HOUR };
}
