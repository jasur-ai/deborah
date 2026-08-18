/**
 * Edikit — Auth Data Retention + Purge Jobs (AUTH C-14)
 * -----------------------------------------------------
 * Scheduled, idempotent retention purge (UZ data law — minimal saqlash).
 *
 * Retention jadvali (config'da — src/config/env.js):
 *   - auth_audit            30 kun   (purgeAuthAudit — A-03)
 *   - email_log             30 kun   (email_log/)
 *   - verification_codes    24 soat  (email_verify/, email_verify_last/)
 *   - reset_tokens          24 soat  (resetTokens/, resetTokensByUser/)
 *   - risk_events           12 oy    (users.{id}.devices.{hash}.risk_events)
 *   - user_devices          12 oy    (users.{id}.devices.{hash} — harakatsiz)
 *   - invites (revoked)     90 kun   (invites/)
 *   - mfa_backup_codes      MFA o'chganda (disableMfa — A-26 tozalaydi)
 *   - users                 active   (DSAR o'chirishgacha — C-14 faqat derived)
 *
 * Legal hold (§08): users.{id}.legal_hold=true bo'lgan user'ning derived
 * datalari (devices/risk_events) purge'da O'TKAZIB YUBORILADI (fail-closed).
 * Purge soft (log+audit) — hard delete faqat DSAR bilan (D-faza).
 * Fail-open emas: legal hold tekshiruvi xatosida o'sha user o'tkazib yuboriladi.
 */

import { fb } from '../../../firebase/admin.js';
import { logAuthEvent, AUDIT_ACTIONS, purgeAuthAudit } from './audit.js';
import CONFIG from '../../config/env.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Retention (config'dan, default UZ data law) ──
export const RETENTION = {
  auditDays: CONFIG.AUDIT_RETENTION_DAYS ?? 30,
  emailLogMs: CONFIG.EMAIL_LOG_RETENTION_MS ?? 30 * DAY_MS,
  verifyCodeMs: CONFIG.VERIFY_CODE_RETENTION_MS ?? 1 * DAY_MS,
  resetTokenMs: CONFIG.RESET_TOKEN_RETENTION_MS ?? 1 * DAY_MS,
  deviceMs: CONFIG.DEVICE_RETENTION_MS ?? 12 * 30 * DAY_MS,
  inviteRevokedMs: CONFIG.INVITE_REVOKED_RETENTION_MS ?? 90 * DAY_MS,
};

/** User legal hold flag — derived data purge'dan o'tkazib yuboriladi. */
async function isLegalHold(userKey) {
  try {
    const snap = await fb.get(`users/${userKey}`);
    return !!snap.val()?.legal_hold;
  } catch (_) {
    return true; // fail-closed: tekshirib bo'lmadi → o'tkazib yuboramiz
  }
}

// ═══════════════════════════════════════════════════════════════════
// Per-jadval purgelar (har biri idempotent — qayta chaqirilsa no-op)
// ═══════════════════════════════════════════════════════════════════

/** email_log/{id} — createdAt < cutoff → remove. */
export async function purgeEmailLog(maxAgeMs = RETENTION.emailLogMs) {
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  const snap = await fb.get('email_log');
  if (!snap.exists()) return { removed };
  for (const [id, rec] of Object.entries(snap.val())) {
    if (!rec || typeof rec.createdAt !== 'number' || rec.createdAt < cutoff) {
      await fb.remove(`email_log/${id}`).catch(() => {});
      removed += 1;
    }
  }
  return { removed };
}

/** email_verify/ + email_verify_last/ — createdAt < cutoff → remove. */
export async function purgeVerifyCodes(maxAgeMs = RETENTION.verifyCodeMs) {
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  for (const prefix of ['email_verify', 'email_verify_last']) {
    const snap = await fb.get(prefix);
    if (!snap.exists()) continue;
    for (const [k, rec] of Object.entries(snap.val())) {
      const ts = rec && (rec.createdAt || rec.at || rec.expiresAt);
      if (typeof ts !== 'number' || ts < cutoff) {
        await fb.remove(`${prefix}/${k}`).catch(() => {});
        removed += 1;
      }
    }
  }
  return { removed };
}

/** resetTokens/ + resetTokensByUser/ — expiresAt < cutoff → remove. */
export async function purgeResetTokens(maxAgeMs = RETENTION.resetTokenMs) {
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  const snap = await fb.get('resetTokens');
  if (snap.exists()) {
    for (const [k, rec] of Object.entries(snap.val())) {
      const ts = rec && (rec.expiresAt || rec.createdAt);
      if (typeof ts !== 'number' || ts < cutoff) {
        await fb.remove(`resetTokens/${k}`).catch(() => {});
        removed += 1;
      }
    }
  }
  // resetTokensByUser — faol token qolmagan user indekslari ham tozalanadi
  const idxSnap = await fb.get('resetTokensByUser');
  if (idxSnap.exists()) {
    for (const [userKey, tokens] of Object.entries(idxSnap.val())) {
      if (!tokens || typeof tokens !== 'object' || Object.keys(tokens).length === 0) {
        await fb.remove(`resetTokensByUser/${userKey}`).catch(() => {});
        removed += 1;
      }
    }
  }
  return { removed };
}

/** users.{id}.devices.{hash} — harakatsiz (last_seen < cutoff) + risk_events tozalash. */
export async function purgeUserDevices(maxAgeMs = RETENTION.deviceMs) {
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  const usersSnap = await fb.get('users');
  if (!usersSnap.exists()) return { removed };
  for (const [userKey, u] of Object.entries(usersSnap.val())) {
    const devices = u?.devices;
    if (!devices || typeof devices !== 'object') continue;
    // Legal hold — derived data o'tkazib yuboriladi (§08, fail-closed)
    if (await isLegalHold(userKey)) continue;
    for (const [hash, dev] of Object.entries(devices)) {
      const lastSeen = dev && (dev.last_seen || dev.lastSeen || 0);
      if (lastSeen < cutoff) {
        await fb.remove(`users/${userKey}/devices/${hash}`).catch(() => {});
        removed += 1;
      } else if (Array.isArray(dev.risk_events) && dev.risk_events.length > 12) {
        // risk_events 12 oydan eskilari — slice (retention 12)
        await fb.update(`users/${userKey}/devices/${hash}`, {
          risk_events: dev.risk_events.slice(-12),
        }).catch(() => {});
        removed += 1;
      }
    }
  }
  return { removed };
}

/** invites/{tokenHash} — revoked va revokedAt < cutoff → remove. */
export async function purgeRevokedInvites(maxAgeMs = RETENTION.inviteRevokedMs) {
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  const snap = await fb.get('invites');
  if (!snap.exists()) return { removed };
  for (const [k, inv] of Object.entries(snap.val())) {
    if (inv?.status === 'revoked' && (inv.revokedAt || inv.updatedAt || inv.expiresAt || 0) < cutoff) {
      await fb.remove(`invites/${k}`).catch(() => {});
      removed += 1;
    }
  }
  return { removed };
}

// ═══════════════════════════════════════════════════════════════════
// Umumiy ishga tushirish (scheduled — server.js)
// ═══════════════════════════════════════════════════════════════════

/**
 * Barcha retention purgelarini ishga tushiradi (idempotent; fail-soft).
 * @returns {Promise<{ ok: boolean, counts: object, error?: string }>}
 */
export async function runRetentionPurge() {
  const counts = {};
  const startedAt = Date.now();
  try {
    counts.authAudit = (await purgeAuthAudit(RETENTION.auditDays)).removed;
    counts.emailLog = (await purgeEmailLog()).removed;
    counts.verifyCodes = (await purgeVerifyCodes()).removed;
    counts.resetTokens = (await purgeResetTokens()).removed;
    counts.devices = (await purgeUserDevices()).removed;
    counts.invites = (await purgeRevokedInvites()).removed;

    await logAuthEvent({
      action: AUDIT_ACTIONS.PURGE_RUN,
      outcome: 'success',
      method: 'scheduled',
      actorId: 'system',
      details: { ...counts, durationMs: Date.now() - startedAt },
      channel: 'retention',
    });
    return { ok: true, counts };
  } catch (err) {
    // Alert: purge fail → ops (fail-soft, server buzilmaydi)
    console.error('[retention:purge] FAILED:', err?.message || err);
    try {
      await logAuthEvent({
        action: AUDIT_ACTIONS.PURGE_RUN,
        outcome: 'failed',
        method: 'scheduled',
        actorId: 'system',
        details: { error: String(err?.message || err).slice(0, 300), counts },
        channel: 'retention',
      });
    } catch (_) { /* audit fail-soft */ }
    return { ok: false, counts, error: String(err?.message || err) };
  }
}
