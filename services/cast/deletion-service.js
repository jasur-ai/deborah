/**
 * Edikit — Cast Deletion Service (C4-07)
 * ----------------------------------------
 * Deletion pipeline (item 6-11):
 *  - Expired active DB recordlarni delete/anonymize.
 *  - Cache/search/object storage cleanup hook'lar (item 7).
 *  - Backup tombstone (item 9) + restore re-apply (item 10).
 *  - Failed deletion retry (item: tekshiruv).
 *  - Completion auditga raw data YO'Q (item 11).
 *
 * Adapter: { dbGet, dbSet, dbRemove } — test'da in-memory, prod'da fb.
 */

import { DATA_CLASSES, EXPIRY_ACTIONS, isExpired, anonymizeRecord } from './data-policy.js';

const P = (id) => `cast_private/${id}`;

/**
 * Cleanup hook'lar (item 7) — cache/search/object storage.
 * Provider'lar o'z hook'larini ro'yxatdan o'tkazadi.
 * @type {Array<{id:string, kind:'cache'|'search'|'object', fn:Function}>}
 */
const cleanupHooks = [];
export function registerCleanupHook(hook) {
  if (hook && hook.id && typeof hook.fn === 'function') {
    cleanupHooks.push(hook);
  }
}
export function listCleanupHooks() {
  return cleanupHooks.map((h) => ({ id: h.id, kind: h.kind }));
}
export async function runCleanupHooks(paths, { now = Date.now() } = {}) {
  const results = [];
  for (const hook of cleanupHooks) {
    try {
      await hook.fn(paths, now);
      results.push({ id: hook.id, ok: true });
    } catch (_) {
      results.push({ id: hook.id, ok: false });
    }
  }
  return results;
}

/**
 * Tombstone yozish (item 9) — o'chirilgan path'larni belgilaydi.
 */
export async function writeTombstone({ dbGet, dbSet }, sessionId, { paths, reason = 'deletion', by = 'retention', now = Date.now() } = {}) {
  const tsPath = `${P(sessionId)}/governance/tombstones`;
  const snap = await dbGet(tsPath);
  const ts = snap.exists() ? snap.val() : {};
  for (const p of paths || []) {
    const rel = p.replace(`${P(sessionId)}/`, '');
    ts[rel] = { deletedAt: now, reason, by, restoreBlocked: true };
  }
  await dbSet(tsPath, ts);
  return { written: (paths || []).length };
}

/**
 * Restore'da tombstone qo'llash (item 10) — o'chirilgan data qayta
 * tiklanmaydi (restore shunchaki tombstone'ni sanaydi; qayta yozilish
 * bloklanadi).
 */
export async function restoreWithTombstones({ dbGet, dbSet }, sessionId, { restorePayload = null } = {}) {
  const tsSnap = await dbGet(`${P(sessionId)}/governance/tombstones`);
  const ts = tsSnap.exists() ? tsSnap.val() : {};
  const blocked = Object.keys(ts).filter((k) => ts[k]?.restoreBlocked);
  // restorePayload bo'lsa — tombstone path'larini chiqarib tashlab restore qilamiz
  let restored = restorePayload;
  if (restored && blocked.length > 0 && typeof restored === 'object') {
    for (const rel of blocked) {
      const parts = rel.split('/');
      let node = restored;
      let ok = true;
      for (const part of parts) {
        if (node && typeof node === 'object' && part in node) node = node[part];
        else { ok = false; break; }
      }
      if (ok && node && typeof node === 'object') {
        // parent node'dan o'chirilgan recordni olib tashlash
        const parentParts = parts.slice(0, -1);
        let parent = restored;
        for (const part of parentParts) {
          if (parent && typeof parent === 'object') parent = parent[part];
        }
        if (parent && typeof parent === 'object') delete parent[parts[parts.length - 1]];
      }
    }
  }
  return { blockedCount: blocked.length, blocked, restored };
}

/**
 * Bitta data class uchun deletion — primary + cleanup hook'lar.
 * @returns {Promise<{deleted:number, skipped:number}>}
 */
export async function deleteDataClass(adapter, sessionId, { cls, paths, policy, retentionClass = 'standard', now = Date.now() } = {}) {
  const { dbGet, dbRemove, dbSet } = adapter;
  const cp = policy?.classes?.[cls];
  if (!cp || cp.expiryAction === EXPIRY_ACTIONS.ROLLING) {
    return { deleted: 0, skipped: 1 }; // rolling — saqlanadi
  }
  let deleted = 0;
  const removedPaths = [];
  for (const path of paths) {
    const snap = await dbGet(path);
    if (!snap.exists()) continue;
    const value = snap.val();
    if (cp.expiryAction === EXPIRY_ACTIONS.ANONYMIZE) {
      await dbSet(path, anonymizeRecord(value));
    } else if (cp.expiryAction === EXPIRY_ACTIONS.DELETE) {
      await dbRemove(path);
      removedPaths.push(path);
    }
    // REVIEW_OR_DELETE — review kutadi, bu job'da o'chirilmaydi
    deleted += 1;
  }
  if (removedPaths.length > 0) {
    await writeTombstone({ dbGet, dbSet }, sessionId, { paths: removedPaths, reason: cls, by: 'deletion_service' });
    await runCleanupHooks(removedPaths, { now });
    // Completion audit — raw data yo'q (item 11)
    const auditId = 'aud_' + Math.random().toString(36).slice(2, 10);
    await dbSet(`${P(sessionId)}/audit/${auditId}`, {
      action: 'deletion:completed',
      auditId,
      at: now,
      cls,
      deletedCount: removedPaths.length,
      paths: removedPaths.map((p) => p.replace(`${P(sessionId)}/`, '')),
      safe: true,
    });
  }
  return { deleted, skipped: 0 };
}

/**
 * Failed deletion retry — failedIds bo'yicha qayta urinish.
 * @param {string[]} failedIds — oldingi job'da muvaffaqiyatsiz sessiyalar
 */
export async function retryFailedDeletions(adapter, failedIds, runFn, { now = Date.now() } = {}) {
  const retried = [];
  const stillFailing = [];
  for (const sid of failedIds || []) {
    try {
      await runFn(sid);
      retried.push(sid);
    } catch (_) {
      stillFailing.push(sid);
    }
  }
  return { retried, stillFailing };
}

export default {
  registerCleanupHook,
  listCleanupHooks,
  runCleanupHooks,
  writeTombstone,
  restoreWithTombstones,
  deleteDataClass,
  retryFailedDeletions,
  DATA_CLASSES,
};
