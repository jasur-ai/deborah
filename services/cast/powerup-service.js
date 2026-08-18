/**
 * Edikit — Pedagogically Safe Power-ups (C3-17)
 * ----------------------------------------------
 * Power-up faqat teacher-enabled presetda ishlaydi va correctness recordni
 * O'ZGARTIRMAYDI (item 9 — raw evidence immutable).
 *
 * Allowed types (item 2):
 *   hint                — to'g'ri variantga yaqinlashtiruvchi maslahat
 *   extra_time          — personal timer uzaytirish (faqat personal timer)
 *   team_consult        — jamoadosh bilan maslahat (team session, item 11)
 *   private_redemption  — shaxsiy qayta urinish/redemption
 *
 * Random answer elimination va opponent sabotage registry'ga KIRITILMAYDI (item 3).
 *
 * Privacy (item 12, 13):
 * - Power-up usage public shame yoki misconduct signali EMAS — faqat shaxsiy
 *   inventory va individual activation log.
 * - Accessibility: UI reduced-motion'da animation'siz same info beradi.
 */

import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
import { POWERUP_TYPES, POWERUP_TYPE_LIST, POWERUP_DEFAULT_INVENTORY } from '../../utils/cast-constants.js';

const INV_PATH = (sessionId, participantId) => `cast_private/${sessionId}/powerups/${participantId}`;
const USED_PATH = (sessionId, participantId) => `cast_private/${sessionId}/powerups_used/${participantId}`;

/** Is power-ups enabled for this config? */
export function isPowerUpsEnabled(config) {
  return !!(config?.powerUps?.enabled && config?.powerUps?.allowedTypes?.length > 0);
}

/** Allowed types from config (validated against registry). */
export function allowedTypes(config) {
  const cfg = config?.powerUps?.allowedTypes || [];
  return cfg.filter((t) => POWERUP_TYPE_LIST.includes(t));
}

/** Is a given type allowed? (server-authoritative; item 4) */
export function isTypeAllowed(config, type) {
  return POWERUP_TYPE_LIST.includes(type) && allowedTypes(config).includes(type);
}

/**
 * Init participant inventory (join/join ack).
 * Idempotent: mavjud inventory o'zgartirilmaydi.
 * startingInventory config'dan; aks holda POWERUP_DEFAULT_INVENTORY (item 5).
 */
export async function initInventory({ sessionId, participantId, config }) {
  const existing = await getInventory(sessionId, participantId);
  if (existing) return projectInventory(existing, config);
  const start = config?.powerUps?.startingInventory || {};
  const inv = {};
  for (const t of POWERUP_TYPE_LIST) {
    const n = start[t];
    inv[t] = typeof n === 'number' && n >= 0 ? Math.floor(n) : POWERUP_DEFAULT_INVENTORY[t] ?? 0;
  }
  // allowedTypes'da bo'lmagan power-up'lar inventory'da qoladi lekin aktivlashib bo'lmaydi
  await fb.set(INV_PATH(sessionId, participantId), { ...inv, participantId, updatedAt: Date.now() });
  return projectInventory({ ...inv, participantId }, config);
}

export async function getInventory(sessionId, participantId) {
  const snap = await fb.get(INV_PATH(sessionId, participantId));
  return snap.exists() ? snap.val() : null;
}

export async function getUsed(sessionId, participantId) {
  const snap = await fb.get(USED_PATH(sessionId, participantId));
  return snap.exists() ? snap.val() : {};
}

/**
 * Activate a power-up (item 6 — idempotent; item 8 — hint metadata saqlanadi).
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.participantId
 * @param {string} input.type — POWERUP_TYPES.*
 * @param {object} input.config — resolved session config
 * @param {string} [input.questionId] — hint qaysi savol uchun
 * @param {number} [input.teamMemberId] — team_consult uchun maslahat beruvchi
 * @returns {Promise<{ok:boolean, activated:boolean, type:string, inventory:object, effect:object}>}
 */
export async function activatePowerUp({ sessionId, participantId, type, config, questionId = null, teamMemberId = null }) {
  if (!POWERUP_TYPE_LIST.includes(type)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Noma’lum power-up turi', { type });
  }
  if (!isPowerUpsEnabled(config)) {
    throw new CastError(CAST_ERROR_CODES.CAPABILITY_UNSUPPORTED, 'Power-up yoqilmagan');
  }
  if (!isTypeAllowed(config, type)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Bu power-up turi sessiyada ruxsat etilmagan', { type });
  }

  const inv = await getInventory(sessionId, participantId);
  if (!inv) {
    throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Inventory topilmadi — avval qo‘shiling');
  }
  const available = inv[type] || 0;
  if (available <= 0) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Bu power-up qolmadi', { type });
  }

  // Idempotency: per-question same-type duplicate → replays previous effect (item 6)
  const used = await getUsed(sessionId, participantId);
  const dedupeKey = `${type}:${questionId || 'session'}`;
  if (used[dedupeKey]) {
    return { ok: true, activated: false, replay: true, type, inventory: projectInventory(inv, config), effect: used[dedupeKey].effect };
  }

  // Effect build (item 7: extra_time faqat personal timer uchun — global timer mavjud
  // bo'lsa silent apply qilmaymiz, o'rniga no-effect + flag).
  const effect = buildEffect({ type, config, questionId, teamMemberId });

  // Decrement inventory (atomic-ish: read-modify-write; local DB transaction emas,
  // lekin activation idempotent — double-spend oldini oladi)
  inv[type] = Math.max(0, available - 1);
  inv.updatedAt = Date.now();
  await fb.set(INV_PATH(sessionId, participantId), inv);

  // Log usage (private — public shame/misconduct signali EMAS, item 13)
  used[dedupeKey] = { type, questionId, teamMemberId, activatedAt: Date.now(), effect };
  await fb.set(USED_PATH(sessionId, participantId), used);

  return { ok: true, activated: true, type, inventory: projectInventory(inv, config), effect };
}

/**
 * Build power-up effect. Correctness/score'ga ta'sir qilmaydi (item 9) —
 * effect faqat metadata / timer / team signal.
 */
function buildEffect({ type, config, questionId, teamMemberId }) {
  const base = { type, questionId };
  switch (type) {
    case POWERUP_TYPES.HINT:
      // Hint ko'rsatilgani answer record metadata'da saqlanadi (item 8);
      // bu yerda faqat effect markeri — to'g'ri javob id'lari YO'Q.
      return { ...base, kind: 'hint_shown' };
    case POWERUP_TYPES.EXTRA_TIME: {
      // Item 7: personal timer capability bo'lmasa global timerga silent apply
      // qilmaymiz. Personal timer = self-paced perQuestionSeconds mavjud.
      const hasPersonalTimer = !!(config?.selfPaced?.enabled && config?.selfPaced?.perQuestionSeconds);
      if (!hasPersonalTimer) {
        return { ...base, kind: 'no_personal_timer', seconds: 0, applied: false };
      }
      return { ...base, kind: 'extra_time', seconds: config?.powerUps?.extraTimeSeconds || 15, applied: true };
    }
    case POWERUP_TYPES.TEAM_CONSULT:
      // Team session bo'lmasa effect faqat "maslahat signali" (identity yo'q).
      return { ...base, kind: 'team_consult', teamMemberId, consistent: config?.powerUps?.teamConsistent !== false };
    case POWERUP_TYPES.PRIVATE_REDEMPTION:
      // Shaxsiy qayta urinish — attempt markeri; score policy alohida.
      return { ...base, kind: 'private_redemption' };
    default:
      return base;
  }
}

/**
 * Safe inventory projection (participant-private — faqat o'z sonlari).
 */
export function projectInventory(inv, config) {
  const out = { enabled: isPowerUpsEnabled(config), allowed: allowedTypes(config) };
  const counts = {};
  for (const t of POWERUP_TYPE_LIST) {
    const n = inv ? inv[t] : 0;
    if (typeof n === 'number') counts[t] = n;
  }
  out.counts = counts;
  return out;
}

/** Director aggregate — faqat count'lar, identity yo'q (privacy). */
export async function directorPowerupSummary(sessionId) {
  const snap = await fb.get(`cast_private/${sessionId}/powerups`);
  if (!snap.exists()) return { total: 0, usedCount: 0 };
  const all = snap.val();
  const ids = Object.keys(all).filter((k) => !k.startsWith('_'));
  let usedCount = 0;
  const usedSnap = await fb.get(`cast_private/${sessionId}/powerups_used`);
  if (usedSnap.exists()) {
    for (const rec of Object.values(usedSnap.val())) usedCount += Object.keys(rec || {}).length;
  }
  return { total: ids.length, usedCount };
}

/**
 * Grant a power-up (director; item 4 — teacher allowed types belgilaydi).
 */
export async function grantPowerUp({ sessionId, participantId, type, config, count = 1 }) {
  if (!POWERUP_TYPE_LIST.includes(type)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Noma’lum power-up turi', { type });
  }
  const inv = await getInventory(sessionId, participantId);
  if (!inv) {
    throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Inventory topilmadi — avval qo‘shiling');
  }
  inv[type] = (inv[type] || 0) + Math.max(1, Math.floor(count));
  inv.updatedAt = Date.now();
  await fb.set(INV_PATH(sessionId, participantId), inv);
  return { ok: true, inventory: projectInventory(inv, config) };
}
