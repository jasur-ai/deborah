/**
 * Deborah — E-01a: Canonical OneID (identity.js)
 * ---------------------------------------------------------------------------
 * Barcha provider identifikatorlari (google_sub, hemis_id, telegram_id) bir
 * canonical `oneid_sub` ga bog'lanadi. Bitta user = bitta OneID; provider'lar
 * ko'p-1 (bir user'da bir nechta provider bo'lishi mumkin).
 *
 *   users/{key}.oneid_sub        — user record'idagi canonical ID
 *   identity/{oneid_sub}         — mapping: { userKey, providers: {...} }
 *
 * OneID hech qachon client DTO'ga chiqmaydi (SECRET_KEYS da — user-schema).
 *
 * @module identity
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';

const IDENTITY_PATH = 'identity';
const ONEID_PREFIX = 'oid_';

/** Yangi canonical OneID generatsiya qiladi (crypto random, prefix bilan). */
export function generateOneId() {
  return ONEID_PREFIX + crypto.randomBytes(16).toString('hex');
}

/** Mapping path: identity/{safeKey(oneid)}. */
function identityPath(oneId) {
  return `${IDENTITY_PATH}/${safeKey(oneId)}`;
}

/**
 * User record'ga OneID beradi (mavjud bo'lsa qaytaradi — idempotent).
 * Birinchi marta chaqirilganda yangi OneID generatsiya + user record'ga yozadi.
 *
 * @param {string} userKey — user safeKey
 * @param {Object} [opts] — test uchun: { fbSet, fbGet }
 * @returns {Promise<{ ok: boolean, oneId: string|null, created: boolean, error?: string }>}
 */
export async function ensureOneId(userKey, opts = {}) {
  const set = opts.fbSet || ((p, v) => fb.set(p, v));
  const get = opts.fbGet || ((p) => fb.get(p));
  if (!userKey) return { ok: false, oneId: null, error: 'missing-user-key' };

  const uKey = safeKey(userKey);
  const userSnap = await get(`users/${uKey}`);
  const user = userSnap.exists() ? userSnap.val() : null;
  if (!user) return { ok: false, oneId: null, error: 'user-not-found' };

  // Mavjud OneID — qaytarish (idempotent)
  if (user.oneid_sub) return { ok: true, oneId: user.oneid_sub, created: false };

  // Yangi OneID + mapping yozish
  const oneId = generateOneId();
  const idPath = identityPath(oneId);
  const existing = (await get(idPath)).exists ? (await get(idPath)).val() : null;
  if (existing) {
    // Mapping kolliziyasi (juda kam) — qayta generatsiya
    return ensureOneId(userKey, opts);
  }
  await set(idPath, { userKey: uKey, providers: {}, createdAt: Date.now() });
  await set(`users/${uKey}/oneid_sub`, oneId);
  return { ok: true, oneId, created: true };
}

/**
 * Provider'ni OneID'ga bog'laydi (identity/{oneid}/providers/{provider}).
 * Idempotent — takroriy bog'lash yangilaydi (ustiga yozadi).
 *
 * @param {string} oneId
 * @param {string} provider — 'google' | 'hemis' | 'telegram'
 * @param {string} providerSubject — provider'dagi unique sub/id
 * @param {Object} [opts]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function linkProviderToOneId(oneId, provider, providerSubject, opts = {}) {
  const set = opts.fbSet || ((p, v) => fb.set(p, v));
  const get = opts.fbGet || ((p) => fb.get(p));
  if (!oneId || !provider || !providerSubject) {
    return { ok: false, error: 'missing-args' };
  }
  const idPath = identityPath(oneId);
  const snap = await get(idPath);
  if (!snap.exists()) return { ok: false, error: 'oneid-not-found' };
  const map = snap.val() || {};
  map.providers = map.providers || {};
  map.providers[provider] = {
    subject: String(providerSubject),
    linkedAt: Date.now(),
  };
  map.updatedAt = Date.now();
  await set(idPath, map);
  return { ok: true };
}

/**
 * OneID orqali userKey topadi (provider subject orqali kirish uchun).
 *
 * @param {string} oneId
 * @param {Object} [opts]
 * @returns {Promise<{ ok: boolean, userKey: string|null, providers?: Object }>}
 */
export async function resolveOneId(oneId, opts = {}) {
  const get = opts.fbGet || ((p) => fb.get(p));
  if (!oneId) return { ok: false, userKey: null };
  const snap = await get(identityPath(oneId));
  if (!snap.exists()) return { ok: false, userKey: null };
  const map = snap.val() || {};
  return { ok: true, userKey: map.userKey || null, providers: map.providers || {} };
}

/** OneID mapping'ni olib tashlaydi (user o'chirilganda — DSAR C-23). */
export async function removeOneIdMapping(oneId, opts = {}) {
  const remove = opts.fbRemove || ((p) => fb.remove(p));
  if (!oneId) return { ok: false };
  await remove(identityPath(oneId));
  return { ok: true };
}

/**
 * Link tasdiqlanganda ikkala user'ga bitta canonical OneID beradi (E-01a).
 * Bitta shaxs = bitta OneID: linked account'lar bir xil canonical ID'ga
 * bog'lanadi. Idempotent — ikkala user'da bir xil OneID bo'lsa o'zgartirmaydi.
 * Fail-soft — xato bo'lsa link oqimi buzilmaydi (error qaytaradi, throw qilmaydi).
 *
 * @param {string} userKeyA — safeKey'li user key
 * @param {string} userKeyB — safeKey'li user key
 * @param {Object} [opts] — test uchun: { fbSet, fbGet, fbRemove }
 * @returns {Promise<{ ok: boolean, oneId: string|null, error?: string }>}
 */
export async function syncLinkedOneIds(userKeyA, userKeyB, opts = {}) {
  const set = opts.fbSet || ((p, v) => fb.set(p, v));
  const get = opts.fbGet || ((p) => fb.get(p));
  if (!userKeyA || !userKeyB) return { ok: false, oneId: null, error: 'missing-keys' };

  const aKey = safeKey(userKeyA);
  const bKey = safeKey(userKeyB);
  if (aKey === bKey) return { ok: false, oneId: null, error: 'same-user' };

  try {
    const [aSnap, bSnap] = await Promise.all([
      get(`users/${aKey}`),
      get(`users/${bKey}`),
    ]);
    const aUser = aSnap.exists() ? aSnap.val() : null;
    const bUser = bSnap.exists() ? bSnap.val() : null;
    if (!aUser || !bUser) return { ok: false, oneId: null, error: 'user-not-found' };

    const aId = aUser.oneid_sub || null;
    const bId = bUser.oneid_sub || null;

    // Ikkalasi ham bor va bir xil — allaqachon sinxron
    if (aId && bId && aId === bId) {
      return { ok: true, oneId: aId };
    }

    // Canonical OneID: ustuvorlik A (birinchisi) — ikkalasida ham bor va farqli
    // bo'lsa, B'ning mapping'ini A'ga ko'chiramiz va B'ni yangilaymiz.
    let canonicalId = aId;
    let targetKey = bKey;
    let sourceKey = aKey;

    if (!canonicalId && bId) {
      // A'da yo'q, B'da bor — B canonical bo'ladi
      canonicalId = bId;
      targetKey = aKey;
      sourceKey = bKey;
    }

    if (!canonicalId) {
      // Ikkalasida ham yo'q — yangi OneID (A asosiy)
      const r = await ensureOneId(aKey, { fbSet: set, fbGet: get });
      if (!r.ok) return { ok: false, oneId: null, error: r.error || 'oneid-create-failed' };
      canonicalId = r.oneId;
      targetKey = bKey;
      sourceKey = aKey;
    }

    // B (target) user'ga canonical OneID yozish
    const targetSnap = await get(`users/${targetKey}`);
    const targetUser = targetSnap.exists() ? targetSnap.val() : null;
    if (targetUser && targetUser.oneid_sub && targetUser.oneid_sub !== canonicalId) {
      // Eski OneID mapping'ini tozalash + provider'larni ko'chirish
      const oldId = targetUser.oneid_sub;
      const oldMapSnap = await get(identityPath(oldId));
      if (oldMapSnap.exists()) {
        const oldMap = oldMapSnap.val() || {};
        const canonSnap = await get(identityPath(canonicalId));
        const canonMap = canonSnap.exists() ? canonSnap.val() : { providers: {}, userKey: sourceKey };
        canonMap.providers = { ...(oldMap.providers || {}), ...(canonMap.providers || {}) };
        canonMap.updatedAt = Date.now();
        await set(identityPath(canonicalId), canonMap);
      }
      await set(`users/${targetKey}/oneid_sub`, canonicalId);
      // Eski mapping'ni o'chirish (DSAR qoidalari: bitta canonical)
      await removeOneIdMapping(oldId, { fbRemove: opts.fbRemove });
    } else {
      await set(`users/${targetKey}/oneid_sub`, canonicalId);
    }

    return { ok: true, oneId: canonicalId };
  } catch (e) {
    return { ok: false, oneId: null, error: 'sync-failed' };
  }
}

/**
 * E-01b — OneID backfill: oneid_sub bo'lmagan barcha user'larga canonical
 * OneID beradi (idempotent — ikkinchi yugurish yangi OneID yaratmaydi).
 *
 * Faqat Firebase RDB `users/{key}` ustida ishlaydi (mock'lanadigan fb.get/set).
 * Har bir user uchun ensureOneId chaqiriladi — mavjud mapping'lar teksiz.
 *
 * @param {Object} [opts] — test uchun: { fbGet, fbSet }
 * @returns {Promise<{ ok: boolean, processed: number, created: number, skipped: number, error?: string }>}
 */
export async function backfillOneIds(opts = {}) {
  const get = opts.fbGet || ((p) => fb.get(p));
  const set = opts.fbSet || ((p, v) => fb.set(p, v));
  try {
    const usersSnap = await get('users');
    if (!usersSnap.exists()) return { ok: true, processed: 0, created: 0, skipped: 0 };

    const users = usersSnap.val() || {};
    const keys = Object.keys(users);
    let created = 0;
    let skipped = 0;

    for (const rawKey of keys) {
      const user = users[rawKey];
      if (!user || typeof user !== 'object') continue;
      if (user.oneid_sub) { skipped += 1; continue; }
      const r = await ensureOneId(rawKey, { fbSet: set, fbGet: get });
      if (r.ok && r.created) created += 1;
    }

    return { ok: true, processed: keys.length, created, skipped };
  } catch (e) {
    return { ok: false, processed: 0, created: 0, skipped: 0, error: 'backfill-failed' };
  }
}
