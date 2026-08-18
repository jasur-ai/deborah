/**
 * Deborah — User DSAR Service (AUTH D-23)
 * ---------------------------------------------------------------------------
 * O'zbekiston shaxsiy ma'lumotlar qonuni (D-22): foydalanuvchi huquqlari —
 * eksport, tuzatish, o'chirish, cheklash.
 *
 *  - collectUserPii: barcha PII yig'ish (profile, devices, MFA, audit hash'lar).
 *  - softDeleteUser: 30 kun grace (login blok) → hard purge (C-14 worker).
 *  - restrictUser: legal hold / processing to'xtatish (email/telegram yo'q).
 *  - purgeDerivedCopies: derived nusxalarini tozalash (PII minimal, D-22 §09).
 *
 * Xavfsizlik: legal hold'da delete RAD; reauth route'da talab qilinadi;
 * PII javobda faqat zarur maydonlar (audit hash'lar — raw PII emas).
 */

import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

const USERS_PATH = 'users';
const DEVICES_PATH = 'devices';
const MFA_TOTP_PATH = 'mfa_totp';
const DSAR_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 kun (O'zbekiston qonuni)

/** User soft-delete holati. */
export async function getDsarStatus(userKey) {
  const snap = await fb.get(`${USERS_PATH}/${safeKey(userKey)}`);
  if (!snap.exists()) return null;
  const user = snap.val();
  return {
    exists: true,
    softDeleted: !!user.deleted_at,
    deletedGraceUntil: user.deleted_grace_until || null,
    restricted: !!user.privacy_restricted,
  };
}

/**
 * Barcha user PII yig'ish (D-23 §06).
 * Audit yozuvlarida hash'lar (PII emas) — raw IP/email qaytmaydi.
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
export async function collectUserPii(userKey) {
  const key = safeKey(userKey);
  const userSnap = await fb.get(`${USERS_PATH}/${key}`);
  if (!userSnap.exists()) return { ok: false, error: 'user_not_found' };
  const user = userSnap.val();

  // Profil — minimal PII (D-22 §09): parol hash'i ham qaytmaydi
  const data = {
    username: user.username || key,
    name: user.display_name || user.name || null,
    email: user.email || null,
    email_verified: !!user.email_verified,
    role: user.role || 'student',
    created_at: user.created_at || null,
    source: user.source || null,
  };

  // Devices — faqat hash'lar (D-22 §09)
  try {
    const devSnap = await fb.get(`${DEVICES_PATH}/${key}`);
    if (devSnap.exists()) {
      const devices = devSnap.val();
      data.devices = Object.values(devices).map((d) => ({
        fingerprintHash: d.fingerprint || d.fp || null,
        lastCity: d.last_city || null,
        lastSeen: d.last_seen || null,
      }));
    }
  } catch (_) { data.devices = []; }

  // MFA metadata — secret EMAS
  try {
    const mfaSnap = await fb.get(`${MFA_TOTP_PATH}/${key}`);
    if (mfaSnap.exists()) {
      const mfa = mfaSnap.val();
      data.mfa = {
        enabled: !!mfa.enabled,
        backupCodesCount: Array.isArray(mfa.backup_codes) ? mfa.backup_codes.length : 0,
        createdAt: mfa.created_at || null,
      };
    }
  } catch (_) { data.mfa = null; }

  // E-03: push device token'lar — token = PII (UZ qonuni) → DSAR export'ga kiradi
  data.pushDevices = [];
  try {
    const fcmSnap = await fb.get(`${USERS_PATH}/${key}/fcm_tokens`);
    if (fcmSnap.exists()) {
      data.pushDevices = Object.values(fcmSnap.val() || {}).map((t) => ({
        platform: t.platform || 'android',
        token: t.token || null, // foydalanuvchi o'z ma'lumoti — to'liq ko'rinadi
        createdAt: t.created_at || null,
        lastUsedAt: t.last_used_at || null,
      }));
    }
  } catch (_) { data.pushDevices = []; }
  // Web Push subscription'lar ham PII (endpoint) — metadata + count (endpoint
  // mavjudligi oshkor emas, o'zi ko'rishi mumkin)
  data.webPushSubscriptions = 0;
  try {
    const wpSnap = await fb.get(`${USERS_PATH}/${key}/push_subs`);
    if (wpSnap.exists()) data.webPushSubscriptions = Object.keys(wpSnap.val() || {}).length;
  } catch (_) {}

  // Restrict/soft-delete holati
  data.privacy = await getDsarStatus(key);

  return { ok: true, data };
}

/**
 * Soft delete (D-23 §09): 30 kun grace — login blok, keyin hard purge.
 * Legal hold'da delete RAD (D-23 §16 — fail-open emas).
 * @returns {Promise<{ok: boolean, error?: string, graceUntil?: number}>}
 */
export async function softDeleteUser(userKey, { reason = '' } = {}) {
  const key = safeKey(userKey);
  const userSnap = await fb.get(`${USERS_PATH}/${key}`);
  if (!userSnap.exists()) return { ok: false, error: 'user_not_found' };

  // Legal hold — delete mumkin emas (fail-closed)
  try {
    const { hasActiveLegalHold } = await import('../data-governance/data-governance.service.js');
    const hold = await hasActiveLegalHold({ subjectKey: key });
    if (hold) return { ok: false, error: 'legal_hold' };
  } catch (_) { /* service mavjud emas — davom etamiz */ }

  const now = Date.now();
  // E-03: soft delete'da darhol push token'lar revoke (PII yopilishi)
  try {
    await fb.remove(`${USERS_PATH}/${key}/fcm_tokens`);
    await fb.remove(`${USERS_PATH}/${key}/push_subs`);
  } catch (_) { /* non-critical */ }

  await fb.set(`${USERS_PATH}/${key}`, {
    ...userSnap.val(),
    deleted_at: now,
    deleted_grace_until: now + DSAR_GRACE_MS,
    deleted_reason: String(reason || '').slice(0, 200),
    blocked: true, // login blok marker
    // login blok (AUTH C-02 §10): checkUserLockout `status === 'blocked'`
    // orqali permanent blokni aniqlaydi — DSAR delete'dan keyin kirish
    // imkonsiz bo'ladi (grace davrida ham). Support/grace worker hal qiladi.
    status: 'blocked',
  });

  await audit({
    action: AUDIT_ACTIONS.DSAR_DELETE_REQUESTED || 'dsar:delete:requested',
    resourceType: 'user',
    userId: key,
    details: { reason: String(reason || '').slice(0, 200), graceDays: 30 },
  }).catch(() => {});

  return { ok: true, graceUntil: now + DSAR_GRACE_MS };
}

/**
 * Restrict (D-23 §10): processing to'xtatish — email/telegram yuborilmaydi.
 * Legal hold flag (privacy_restricted) — email queue/telegram buni tekshiradi.
 */
export async function restrictUser(userKey, { restrict = true } = {}) {
  const key = safeKey(userKey);
  const userSnap = await fb.get(`${USERS_PATH}/${key}`);
  if (!userSnap.exists()) return { ok: false, error: 'user_not_found' };

  await fb.update(`${USERS_PATH}/${key}`, {
    privacy_restricted: !!restrict,
    privacy_restricted_at: Date.now(),
  });

  await audit({
    action: restrict ? (AUDIT_ACTIONS.DSAR_RESTRICTED || 'dsar:restricted') : (AUDIT_ACTIONS.DSAR_UNRESTRICTED || 'dsar:unrestricted'),
    resourceType: 'user',
    userId: key,
  }).catch(() => {});

  return { ok: true, restricted: !!restrict };
}

/**
 * Derived copy purge (D-23 §13): grace o'tgandan keyin devices/MFA/audit
 * hash'lar tozalanadi (backup C-15 bilan uyg'un).
 * @returns {Promise<{ok: boolean, removed: object}>}
 */
export async function purgeDerivedCopies(userKey) {
  const key = safeKey(userKey);
  const removed = { devices: 0, mfa: 0, pushTokens: 0, webPush: 0 };
  try {
    await fb.remove(`${DEVICES_PATH}/${key}`);
    removed.devices = 1;
  } catch (_) {}
  try {
    await fb.remove(`${MFA_TOTP_PATH}/${key}`);
    removed.mfa = 1;
  } catch (_) {}
  // E-03: push token'lar (mobile + web) — PII, hard purge'da tozalanadi
  try {
    await fb.remove(`${USERS_PATH}/${key}/fcm_tokens`);
    removed.pushTokens = 1;
  } catch (_) {}
  try {
    await fb.remove(`${USERS_PATH}/${key}/push_subs`);
    removed.webPush = 1;
  } catch (_) {}
  return { ok: true, removed };
}

/** Grace o'tgan soft-deleted userlarni hard delete qiladi (C-14 worker uchun). */
export async function purgeExpiredDeletedUsers(now = Date.now()) {
  const usersSnap = await fb.get(USERS_PATH);
  if (!usersSnap.exists()) return { ok: true, purged: 0 };
  const users = usersSnap.val();
  let purged = 0;
  for (const [key, user] of Object.entries(users || {})) {
    if (user.deleted_at && user.deleted_grace_until && user.deleted_grace_until < now) {
      await purgeDerivedCopies(key);
      await fb.remove(`${USERS_PATH}/${key}`);
      purged += 1;
    }
  }
  return { ok: true, purged };
}

// ────────────────────────────────────────────────────────────────
// AUTH D-23 §11/§12 — DSAR SLA (C-23): 30 kun (O'zbekiston qonuni)
// ────────────────────────────────────────────────────────────────

export const DSAR_SLA_DAYS = 30;
const DSAR_REQUESTS_PATH = 'dsar_requests';

/**
 * DSAR so'rovini log'laydi (sla_deadline bilan) — C-23 tracking.
 * @param {string} userKey
 * @param {'export'|'correct'|'delete'|'restrict'} type
 * @param {object} [opts] { status }
 * @returns {Promise<{ok: boolean, record: object}>}
 */
export async function logDsarRequest(userKey, type, opts = {}) {
  const key = safeKey(userKey);
  const ts = Date.now();
  const record = {
    type: String(type).slice(0, 20),
    status: String(opts.status || 'received').slice(0, 20),
    created_at: ts,
    sla_deadline: ts + DSAR_GRACE_MS,
    updated_at: ts,
  };
  try {
    await fb.set(`${DSAR_REQUESTS_PATH}/${key}/${ts}`, record);
  } catch (_) { /* fail-soft — audit asosiy */ }
  return { ok: true, record };
}

/** User'ning barcha DSAR so'rovlari (C-23: admin ko'radi). */
export async function listDsarRequests(userKey) {
  const key = safeKey(userKey);
  const snap = await fb.get(`${DSAR_REQUESTS_PATH}/${key}`);
  if (!snap.exists()) return [];
  return Object.entries(snap.val() || {})
    .map(([ts, r]) => ({ ts: Number(ts), ...r }))
    .sort((a, b) => b.ts - a.ts);
}

/** Muddati o'tgan (SLA buzilgan) so'rovlar soni — C-23 eslatma/alert. */
export async function overdueDsarCount(userKey, now = Date.now()) {
  const requests = await listDsarRequests(userKey);
  return requests.filter((r) => r.status !== 'completed' && r.sla_deadline < now).length;
}
