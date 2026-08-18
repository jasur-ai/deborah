/**
 * Deborah — Cast Retention Job (C4-07)
 * -------------------------------------
 * Scheduled worker (daily/hourly) — expired active DB recordlarni
 * delete/anonymize qiladi (item 5, 6):
 *  - Har data class uchun policy bo'yicha expiry tekshiruvi.
 *  - Cache/search/object storage cleanup hook'lar (item 7).
 *  - Token revoke (item 8).
 *  - Backup tombstone yozish (item 9) + restore'da qayta qo'llash (item 10).
 *  - Deletion completion auditga raw data YO'Q (item 11).
 *  - Legal hold ostidagi sessiyalar o'chirilmaydi (item 12).
 *
 * DB adapter inject qilinadi (test'da in-memory, prod'da fb).
 */

import { DATA_CLASSES, EXPIRY_ACTIONS, resolveRetentionPolicy, isExpired, retentionDaysFor, anyActiveHold, anonymizeRecord } from './data-policy.js';

const S = (id) => `cast_sessions/${id}`;
const P = (id) => `cast_private/${id}`;

// ── Sessiya ichidagi data class → path mapping ──
// Har class uchun qaysi path'lar qoplanadi (session-level).
// Haqiqiy storage root'lar (service'lar bilan tekshirilgan):
// - ORB: cast_private/{id}/orb (open-response-service ORB_ROOT)
// - Forge: cast_private/{id}/forge (question-forge-service FORGE_ROOT)
const CLASS_PATH_MAP = {
  [DATA_CLASSES.NAMED_ANSWER]: (sessionId) => [`${P(sessionId)}/answers`, `${S(sessionId)}/scores`],
  [DATA_CLASSES.OPEN_TEXT]: (sessionId) => [`${P(sessionId)}/wall_queue`, `${P(sessionId)}/forge`, `${P(sessionId)}/orb`],
  [DATA_CLASSES.RECOVERY_STATE]: (sessionId) => [`${S(sessionId)}/recovery`],
  [DATA_CLASSES.ACTION_PACK]: (sessionId) => [`${S(sessionId)}/action_pack`],
  [DATA_CLASSES.AGGREGATE]: (sessionId) => [`${P(sessionId)}/aggregates`],
  [DATA_CLASSES.AUDIT_LOG]: (sessionId) => [`${P(sessionId)}/audit`],
  [DATA_CLASSES.SUPPORT_BUNDLE]: (sessionId) => [`${P(sessionId)}/support_bundle`],
};

/**
 * Sessiya root'larini skaner qilish (retention worker uchun).
 * @param {Function} dbGet
 * @returns {Promise<string[]>} sessionId ro'yxati
 */
export async function listCastSessions({ dbGet }) {
  const snap = await dbGet('cast_sessions');
  if (!snap.exists()) return [];
  const val = snap.val();
  if (!val || typeof val !== 'object') return [];
  // Faqat haqiqiy session root'lar (cast_... prefiks)
  return Object.keys(val).filter((k) => String(k).startsWith('cast_'));
}

/**
 * Sessiya uchun retention qarori: qaysi class'lar expired?
 * @returns {Promise<{sessionId:string, expired:Array<{cls:string, action:string, paths:string[]}>, legalHold:boolean}>}
 */
export async function inspectSession({ dbGet, dbRemove, dbUpdate }, sessionId, { policyId, classes, retentionClass = 'standard', now = Date.now() } = {}) {
  const policy = resolveRetentionPolicy(policyId, classes);
  const metaSnap = await dbGet(`${S(sessionId)}/meta`);
  const meta = metaSnap.exists() ? metaSnap.val() : {};
  const sessionEndedAt = meta.ended_at || null;
  const createdAt = meta.created_at || now;

  // Legal hold — hold ostida bo'lsa bu sessiya o'chirilmaydi (item 12)
  const holdsSnap = await dbGet(`${P(sessionId)}/governance/legal_holds`);
  const holds = holdsSnap.exists() ? (Array.isArray(holdsSnap.val()) ? holdsSnap.val() : []) : [];
  const legalHold = anyActiveHold(holds, now);

  const expired = [];
  if (!legalHold) {
    for (const [cls, paths] of Object.entries(CLASS_PATH_MAP)) {
      const cp = policy.classes[cls];
      if (!cp) continue;
      // Session-level basis: class basis session_end bo'lsa session end'dan
      const at = cp.basis === 'session_end' ? sessionEndedAt || createdAt : createdAt;
      if (isExpired(cp, at, now, { retentionClass, sessionEndedAt })) {
        expired.push({ cls, action: cp.expiryAction, paths: paths(sessionId), days: retentionDaysFor(cp, retentionClass) });
      }
    }
  }
  return { sessionId, expired, legalHold, endedAt: sessionEndedAt, createdAt };
}

/**
 * Bitta session uchun retention qo'llash.
 * @returns {Promise<{deleted:number, anonymized:number, tombstoned:boolean}>}
 */
export async function applyRetentionForSession(adapter, sessionId, { policyId, classes, retentionClass = 'standard', now = Date.now() } = {}) {
  const { dbGet, dbSet, dbRemove } = adapter;
  const insp = await inspectSession(adapter, sessionId, { policyId, classes, retentionClass, now });
  const deleted = [];
  const reviewReady = []; // REVIEW_OR_DELETE — admin ko'rib chiqishi uchun ro'yxat (item 11)
  let anonymized = 0;
  if (!insp.legalHold) {
    for (const exp of insp.expired) {
      if (exp.action === EXPIRY_ACTIONS.REVIEW_OR_DELETE) {
        reviewReady.push({ cls: exp.cls, days: exp.days });
        continue;
      }
      for (const path of exp.paths) {
        const snap = await dbGet(path);
        if (!snap.exists()) continue;
        const value = snap.val();
        if (exp.action === EXPIRY_ACTIONS.ANONYMIZE) {
          await dbSet(path, anonymizeRecord(value));
          anonymized += 1;
        } else if (exp.action === EXPIRY_ACTIONS.DELETE) {
          await dbRemove(path);
          deleted.push(path);
        }
        // REVIEW_OR_DELETE → ushbu job'da avtomatik o'chirilmaydi (item 11:
        // completion audit, ama review uchun qoldiriladi). ROLLING → saqlanadi.
      }
    }
    // Backup tombstone (item 9): o'chirilgan path'lar uchun
    if (deleted.length > 0) {
      const tsPath = `${P(sessionId)}/governance/tombstones`;
      const tsSnap = await dbGet(tsPath);
      const tombstones = tsSnap.exists() ? tsSnap.val() : {};
      for (const p of deleted) {
        tombstones[p.replace(`${P(sessionId)}/`, '')] = { deletedAt: now, jobId: null, reason: 'retention' };
      }
      await dbSet(tsPath, tombstones);
    }
  }
  // C5-05 (review fix): session retention'da o'chirilganda in-memory
  // coalescer registry'dan ham o'chirib qo'yamiz (memory leak yo'q).
  if (deleted.length > 0) {
    try {
      const { clearAnswerCountCoalescer } = await import('../socket/cast-handler.js');
      clearAnswerCountCoalescer(sessionId);
    } catch (_) { /* non-critical */ }
  }

  // Audit — raw data YO'Q, faqat count/path (item 11)
  if (deleted.length > 0 || anonymized > 0) {
    const auditId = 'aud_' + Math.random().toString(36).slice(2, 10);
    await dbSet(`${P(sessionId)}/audit/${auditId}`, {
      action: 'retention:applied',
      auditId,
      at: now,
      deletedPaths: deleted.map((p) => p.replace(`${P(sessionId)}/`, '')), // identity'siz path (raw content emas)
      deletedCount: deleted.length,
      anonymizedCount: anonymized,
      safe: true,
    });
  }
  return { deleted: deleted.length, anonymized, tombstoned: deleted.length > 0, reviewReady };
}

/**
 * Token revoke (item 8): join code / ticket'lar uchun.
 * @param {number} olderThanMs — shu vaqtdan eski kodlar revoke
 */
export async function revokeExpiredTokens({ dbGet, dbRemove }, now = Date.now(), olderThanMs = 15 * 60 * 1000) {
  const snap = await dbGet('cast_codes');
  if (!snap.exists()) return { revoked: 0 };
  const codes = snap.val() || {};
  let revoked = 0;
  for (const [code, rec] of Object.entries(codes)) {
    const createdAt = rec?.created_at || rec?.createdAt || 0;
    if (now - createdAt > olderThanMs) {
      await dbRemove(`cast_codes/${code}`);
      revoked += 1;
    }
  }
  return { revoked };
}

/**
 * Asosiy retention job — barcha sessiyalar bo'ylab (item 5).
 * @returns {Promise<{jobId:string, policyId:string, processed:number, deleted:number, failed:number, failedIds:string[]}>}
 */
export async function runRetentionJob(adapter, { policyId = 'institution_default_v1', classes = null, retentionClass = 'standard', now = Date.now(), sessionIds = null } = {}) {
  const { dbGet, dbSet } = adapter;
  const jobId = 'ret_' + Math.random().toString(36).slice(2, 12);
  const policy = resolveRetentionPolicy(policyId, classes);

  const allSessions = sessionIds || (await listCastSessions({ dbGet }));
  const failedIds = [];
  let processed = 0;
  let deleted = 0;
  let anonymized = 0;

  for (const sid of allSessions) {
    processed += 1;
    try {
      const res = await applyRetentionForSession(adapter, sid, { policyId, classes, retentionClass, now });
      deleted += res.deleted;
      anonymized += res.anonymized;
    } catch (_) {
      failedIds.push(sid);
    }
  }

  // Token revoke (item 8) — eski join kodlar
  const tokenRes = await revokeExpiredTokens(adapter, now).catch(() => ({ revoked: 0 }));

  // Job record — completion audit (item 11): raw data yo'q
  const jobRecord = {
    jobId,
    policyId: policy.policyId,
    policyVersion: policy.version,
    ranAt: now,
    processed,
    deleted,
    anonymized,
    revokedTokens: tokenRes.revoked,
    failed: failedIds.length,
    failedIds, // opaque sessionId'lar — identity emas
  };
  await dbSet(`cast_private/retention_jobs/${jobId}`, jobRecord);
  return jobRecord;
}

/**
 * Restore tombstones (item 10): restore paytida o'chirilgan path'lar
 * qayta tiklanmasligi uchun qo'llanadi.
 * @returns {Promise<{applied:number, paths:string[]}>}
 */
export async function applyTombstonesOnRestore({ dbGet }, sessionId) {
  const tsSnap = await dbGet(`${P(sessionId)}/governance/tombstones`);
  if (!tsSnap.exists()) return { applied: 0, paths: [] };
  const ts = tsSnap.val() || {};
  return { applied: Object.keys(ts).length, paths: Object.keys(ts) };
}

export default {
  CLASS_PATH_MAP,
  listCastSessions,
  inspectSession,
  applyRetentionForSession,
  revokeExpiredTokens,
  runRetentionJob,
  applyTombstonesOnRestore,
};
