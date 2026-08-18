/**
 * Edikit — Consent Log (AUTH D-24 §10, D-25 §07-§12)
 * ---------------------------------------------------------------------------
 * Purpose'li consent yozuvlari: `users/{key}/consents/{purpose}` =
 * `{ granted_at, version, ip_hash, revoked_at, lang }`.
 *
 * Purpose'lar (D-25 §07/§09):
 *   - privacy_policy_v1  — majburiy (register'da Roziman checkbox)
 *   - telegram           — ixtiyoriy (B-22 bildirishnoma)
 *   - email_marketing    — kelajak (ixtiyoriy)
 *   - mfa / camera       — kelajak (sensitive funksiyalar)
 *
 * Qoidalar:
 *   - Revoke: `revoked_at` yoziladi — fail-closed (amalda funksiya ishlamaydi).
 *   - Re-consent (§12): versiya o'zgarsa eski yozuv revoke EMAS — yangi so'rov
 *     (hasActiveConsent(version) false qaytaradi).
 *   - PII minimal: faqat ip_hash (raw IP emas).
 *   - Audit: consent:granted / consent:revoked / consent:version_bumped (§17).
 */

import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { LEGAL_VERSION } from './legal-docs.js';

export const CONSENT_VERSION = LEGAL_VERSION;

/** Qonuniy rozilik maqsadlari (D-25 §07). */
export const CONSENT_PURPOSES = {
  PRIVACY_POLICY: 'privacy_policy_v1',
  TELEGRAM: 'telegram',
  EMAIL_MARKETING: 'email_marketing',
  MFA: 'mfa',
  CAMERA: 'camera',
};

/** Register'da consent berilganmi? (checkbox 'on'/'true'/true — majburiy) */
export function isConsentGiven(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

/** Yozuv path'i — legacy `users/{key}/consent` (D-24) backfill'da o'qiladi. */
function consentPath(key, purpose) {
  return `users/${key}/consents/${purpose}`;
}

/**
 * Consent yozadi (idempotent — qayta rozilik versiyani yangilaydi).
 * @param {string} userKey
 * @param {string} purpose CONSENT_PURPOSES kaliti qiymati
 * @param {object} [opts] { version, ipHash, lang }
 * @returns {Promise<{ok: boolean, purpose: string, version: string}>}
 */
export async function recordConsent(userKey, purpose = CONSENT_PURPOSES.PRIVACY_POLICY, opts = {}) {
  const key = safeKey(userKey);
  const version = opts.version || CONSENT_VERSION;
  const path = consentPath(key, purpose);
  const grantedAt = Date.now();

  // Re-consent detektori: versiya o'zgarsa audit consent:version_bumped (§17)
  let bumped = false;
  try {
    const prev = await fb.get(path);
    if (prev.exists() && prev.val()?.version && prev.val().version !== version && !prev.val().revoked_at) {
      bumped = true;
    }
  } catch (_) { /* fail-soft */ }

  await fb.set(path, {
    granted_at: grantedAt,
    version,
    ip_hash: typeof opts.ipHash === 'string' && opts.ipHash ? opts.ipHash : null,
    revoked_at: null,
    lang: String(opts.lang || 'uz').slice(0, 10),
  });

  await audit({
    action: bumped
      ? (AUDIT_ACTIONS.CONSENT_VERSION_BUMPED || 'consent:version_bumped')
      : (AUDIT_ACTIONS.CONSENT_GRANTED || 'consent:granted'),
    resourceType: 'user',
    userId: key,
    details: { purpose, version, bumped },
  }).catch(() => {});

  return { ok: true, purpose, version };
}

/**
 * Consent'ni bekor qiladi (D-25 §11) — fail-closed: amalda funksiya to'xtaydi.
 * @returns {Promise<{ok: boolean, purpose: string, revoked: boolean}>}
 */
export async function revokeConsent(userKey, purpose, opts = {}) {
  const key = safeKey(userKey);
  const path = consentPath(key, purpose);
  const snap = await fb.get(path);
  if (!snap.exists()) return { ok: false, purpose, error: 'consent_not_found' };
  const cur = snap.val();
  if (cur.revoked_at) return { ok: true, purpose, revoked: false }; // allaqachon bekor

  await fb.set(path, {
    ...cur,
    revoked_at: Date.now(),
    revoked_ip_hash: typeof opts.ipHash === 'string' && opts.ipHash ? opts.ipHash : cur.ip_hash || null,
  });

  await audit({
    action: AUDIT_ACTIONS.CONSENT_REVOKED || 'consent:revoked',
    resourceType: 'user',
    userId: key,
    details: { purpose, version: cur.version || null },
  }).catch(() => {});

  return { ok: true, purpose, revoked: true };
}

/**
 * Consent holati.
 * @returns {Promise<{granted: boolean, version: string|null, grantedAt: number|null, revokedAt: number|null}>}
 */
export async function getConsent(userKey, purpose) {
  const key = safeKey(userKey);
  const path = consentPath(key, purpose);
  const snap = await fb.get(path);
  if (!snap.exists() || !snap.val()) {
    // Legacy (D-24): users/{key}/consent — privacy_policy uchun backfill o'qish
    if (purpose === CONSENT_PURPOSES.PRIVACY_POLICY) {
      const legacy = await fb.get(`users/${key}/consent`);
      if (legacy.exists() && legacy.val()) {
        const c = legacy.val();
        return {
          granted: true,
          version: typeof c.version === 'string' ? c.version : null,
          grantedAt: typeof c.acceptedAt === 'number' ? c.acceptedAt : null,
          revokedAt: null,
          legacy: true,
        };
      }
    }
    return { granted: false, version: null, grantedAt: null, revokedAt: null };
  }
  const c = snap.val();
  return {
    granted: true,
    version: typeof c.version === 'string' ? c.version : null,
    grantedAt: typeof c.granted_at === 'number' ? c.granted_at : null,
    revokedAt: typeof c.revoked_at === 'number' ? c.revoked_at : null,
  };
}

/**
 * Faol consent? (D-25 §08/§12) — revoke qilinmagan va (berilsa) versiya mos.
 * @param {string|null} version — berilsa, joriy versiya bilan moslik ham tekshiriladi
 */
export async function hasActiveConsent(userKey, purpose, version = null) {
  const c = await getConsent(userKey, purpose);
  if (!c.granted || c.revokedAt) return false;
  if (version && c.version && c.version !== version) return false;
  return true;
}

/**
 * D-24 API compat: privacy_policy_v1 uchun joriy versiya roziligi.
 * (policy versiyasi o'zgarsa false — re-consent so'raladi)
 * @returns {Promise<boolean>}
 */
export async function hasCurrentConsent(userKey) {
  return hasActiveConsent(userKey, CONSENT_PURPOSES.PRIVACY_POLICY, CONSENT_VERSION);
}

/** Barcha purpose'lar holati (settings/DSAR ko'rinishi uchun — D-25 §10). */
export async function listConsents(userKey) {
  const key = safeKey(userKey);
  const out = {};
  const purposes = Object.values(CONSENT_PURPOSES);
  for (const purpose of purposes) {
    out[purpose] = await getConsent(key, purpose);
  }
  return out;
}
