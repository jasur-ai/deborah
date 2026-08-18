/**
 * Edikit — Cast Self-Paced Race Service (C3-16)
 * ----------------------------------------------
 * Self-paced mode'da har participant o'z sur'atida yuguradi:
 * - Per-participant cursor: personalized question order + position
 * - Har cursor uchun alohida per-question timer
 * - Director global pause/resume (barcha cursor'lar to'xtaydi)
 * - Private rank (faqat o'z rankini ko'radi) — publicLiveRank OFF
 * - Fairness health: progress distribution + participation rate
 *
 * Privacy:
 * - Cursor ma'lumotlari cast_private/{sessionId}/self_paced/ ostida
 * - Public projection faqat o'z cursor'ini ko'rsatadi (questionIds EMAS,
 *   faqat current question + progress). Boshqa participant cursor'lari
 *   hech qachon public'ga chiqmaydi.
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
import { seededShuffle, hashToUint32, SEED_VERSION } from './randomization.js';

const SP = (sessionId) => `cast_private/${sessionId}/self_paced`;
const SP_META = (sessionId) => `cast_private/${sessionId}/self_paced_meta`;

/** Is self-paced mode enabled for this config? */
export function isSelfPaced(config) {
  return !!(config?.pace === 'self_paced' && config?.selfPaced?.enabled);
}

/** Personal cursor order — deterministic per (session, participant). */
export function buildPersonalOrder({ questionIds, sessionSeed, participantId, randomize }) {
  if (!randomize || questionIds.length <= 1) return [...questionIds];
  const seed = hashToUint32(`${SEED_VERSION}:sp:${sessionSeed}:${participantId}`);
  return seededShuffle([...questionIds], seed);
}

/**
 * Init cursor for a participant (join yoki rejoin).
 * Idempotent: mavjud cursor o'zgartirilmaydi (faqat qolgan bo'lsa).
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.participantId
 * @param {string[]} input.questionIds — session public question ids
 * @param {object} input.config — resolved config
 * @param {number} [input.sessionSeed]
 * @param {object} [input.meta] — session meta (lateJoinStart position uchun)
 * @returns {Promise<object>} cursor projection
 */
export async function initCursor({ sessionId, participantId, questionIds, config, sessionSeed = 0, meta = null }) {
  if (!isSelfPaced(config)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Self-paced rejim yoqilmagan');
  }
  if (!questionIds || questionIds.length === 0) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Savollar topilmadi');
  }

  const existing = await getCursor(sessionId, participantId);
  if (existing) return projectCursor(existing);

  const sp = config.selfPaced;
  const order = buildPersonalOrder({
    questionIds,
    sessionSeed,
    participantId,
    randomize: sp.randomizeOrder !== false,
  });
  // Late-join position: 'first' → 0; 'position' → konfiguratsiyadan (faqat sessiya boshlangan bo'lsa)
  const sessionStarted = meta?.status && meta.status !== 'lobby';
  let startPosition = 0;
  if (sessionStarted && sp.lateJoinStart === 'position') {
    startPosition = Math.min(sp.lateJoinPosition || 0, Math.max(0, order.length - 1));
  }

  const cursor = {
    participantId,
    order,
    position: startPosition,
    status: 'pending', // pending → activated bo'lganda 'active'
    startedAt: null,
    questionOpenedAt: null,
    questionExpiresAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    finishedAt: null,
    answeredCount: 0,
    updatedAt: Date.now(),
  };
  await fb.set(`${SP(sessionId)}/${participantId}`, cursor);
  return projectCursor(cursor);
}

/** Get raw cursor (private — server side). */
export async function getCursor(sessionId, participantId) {
  const snap = await fb.get(`${SP(sessionId)}/${participantId}`);
  return snap.exists() ? snap.val() : null;
}

/** Set raw cursor (server side). */
export async function setCursor(sessionId, participantId, cursor) {
  const merged = { ...cursor, updatedAt: Date.now() };
  await fb.set(`${SP(sessionId)}/${participantId}`, merged);
  return merged;
}

/** List all cursors (director aggregate uchun; private room). */
export async function listCursors(sessionId) {
  const snap = await fb.get(SP(sessionId));
  return snap.exists() ? snap.val() : {};
}

/** Delete a cursor (participant removed). */
export async function removeCursor(sessionId, participantId) {
  await fb.remove(`${SP(sessionId)}/${participantId}`);
}

/**
 * Activate self-paced mode: hamma pending cursor'lar 'active' bo'ladi,
 * birinchi savol ochiladi.
 * @returns {Promise<{count:number}>}
 */
export async function activateSelfPaced({ sessionId, questionIds, config, sessionSeed = 0 }) {
  if (!isSelfPaced(config)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Self-paced rejim yoqilmagan');
  }
  const cursors = await listCursors(sessionId);
  const ids = Object.keys(cursors);
  const now = Date.now();
  let activated = 0;
  for (const pid of ids) {
    const c = cursors[pid];
    if (c.status === 'pending') {
      c.status = 'active';
      c.startedAt = c.startedAt || now;
      c.position = Math.min(c.position, c.order.length - 1);
      c.questionOpenedAt = now;
      c.questionExpiresAt = c.order.length > 0 ? now + (config.selfPaced.perQuestionSeconds || 60) * 1000 : null;
      await setCursor(sessionId, pid, c);
      activated++;
    }
  }
  await fb.set(SP_META(sessionId), {
    activatedAt: now,
    paused: false,
    pausedAt: null,
    totalPausedMs: 0,
    sessionSeed,
    questionCount: questionIds.length,
  });
  return { count: activated };
}

/** Session-level meta (director private). */
export async function getSpMeta(sessionId) {
  const snap = await fb.get(SP_META(sessionId));
  return snap.exists() ? snap.val() : null;
}

/**
 * Director global pause — barcha active cursor'lar to'xtaydi.
 * Qolgan vaqt saqlanadi (resume'da qaytariladi).
 */
export async function pauseAll(sessionId) {
  const meta = await getSpMeta(sessionId);
  if (!meta) return { count: 0 };
  if (meta.paused) return { count: await countActive(sessionId) };
  const now = Date.now();
  await fb.update(SP_META(sessionId), { paused: true, pausedAt: now });

  const cursors = await listCursors(sessionId);
  let count = 0;
  for (const [pid, c] of Object.entries(cursors)) {
    if (c.status === 'active' && !c.finishedAt) {
      c.pausedAt = now;
      // Qolgan vaqtni muzlatish (resume'da +totalPausedMs qaytariladi)
      c.totalPausedMs = c.totalPausedMs || 0;
      await setCursor(sessionId, pid, c);
      count++;
    }
  }
  return { count };
}

/** Director global resume — barcha paused cursor'lar davom etadi. */
export async function resumeAll(sessionId, config) {
  const meta = await getSpMeta(sessionId);
  if (!meta) return { count: 0 };
  if (!meta.paused) return { count: await countActive(sessionId) };
  const now = Date.now();
  const pausedDurationMs = meta.pausedAt ? now - meta.pausedAt : 0;
  await fb.update(SP_META(sessionId), {
    paused: false,
    pausedAt: null,
    totalPausedMs: (meta.totalPausedMs || 0) + pausedDurationMs,
  });

  const cursors = await listCursors(sessionId);
  const perQuestionMs = (config?.selfPaced?.perQuestionSeconds || 60) * 1000;
  let count = 0;
  for (const [pid, c] of Object.entries(cursors)) {
    if (c.status === 'active' && c.pausedAt && !c.finishedAt) {
      c.totalPausedMs = (c.totalPausedMs || 0) + pausedDurationMs;
      c.pausedAt = null;
      // Expiry'ni pause davriga surish
      if (c.questionExpiresAt) {
        c.questionExpiresAt += pausedDurationMs;
      }
      await setCursor(sessionId, pid, c);
      count++;
    } else if (c.status === 'active' && !c.finishedAt && c.questionOpenedAt) {
      // Pause qilinmagan bo'lsa ham meta-level pause ta'sirini qo'llash
      if (c.questionExpiresAt) c.questionExpiresAt += pausedDurationMs;
      c.totalPausedMs = (c.totalPausedMs || 0) + pausedDurationMs;
      await setCursor(sessionId, pid, c);
      count++;
    }
  }
  return { count };
}

async function countActive(sessionId) {
  const cursors = await listCursors(sessionId);
  return Object.values(cursors).filter((c) => c.status === 'active' && !c.finishedAt).length;
}

/**
 * Advance a participant cursor to the next question.
 * Javob qabul qilingandan so'ng chaqiriladi.
 * @returns {Promise<{cursor:object, finished:boolean}>}
 */
export async function advanceCursor({ sessionId, participantId, config }) {
  const cursor = await getCursor(sessionId, participantId);
  if (!cursor) throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Cursor topilmadi');
  if (cursor.finishedAt) return { cursor: projectCursor(cursor), finished: true };
  if (cursor.status !== 'active') {
    // Hali aktivlashmagan cursor — aktivlab yuboramiz
    cursor.status = 'active';
    cursor.startedAt = cursor.startedAt || Date.now();
  }
  const meta = await getSpMeta(sessionId);
  const pausedShiftMs = cursor.pausedAt ? Date.now() - cursor.pausedAt : 0;

  const nextPos = cursor.position + 1;
  const now = Date.now();
  if (nextPos >= cursor.order.length) {
    // Race finished
    cursor.status = 'finished';
    cursor.finishedAt = now;
    cursor.position = cursor.order.length;
    cursor.questionOpenedAt = null;
    cursor.questionExpiresAt = null;
    cursor.totalPausedMs = (cursor.totalPausedMs || 0) + pausedShiftMs;
    await setCursor(sessionId, participantId, cursor);
    await bumpMetaFinished(sessionId);
    return { cursor: projectCursor(cursor), finished: true };
  }

  const perQuestionMs = (config?.selfPaced?.perQuestionSeconds || 60) * 1000;
  cursor.position = nextPos;
  cursor.questionOpenedAt = now;
  cursor.questionExpiresAt = now + perQuestionMs + pausedShiftMs;
  cursor.pausedAt = null;
  await setCursor(sessionId, participantId, cursor);
  return { cursor: projectCursor(cursor), finished: false };
}

async function bumpMetaFinished(sessionId) {
  const meta = await getSpMeta(sessionId);
  if (meta) {
    await fb.update(SP_META(sessionId), { finishedCount: (meta.finishedCount || 0) + 1 });
  }
}

/**
 * Per-question expiry check: cursor'ning joriy savoli tugaganmi?
 * Global pause paytida expiry tekshirilmaydi — resume'da expiry shift qilinadi
 * (review fix: pause davomida cursor savolni o'tkazib yubormasligi kerak).
 * @returns {Promise<{expired:boolean, cursor:object|null}>}
 */
export async function checkCursorExpiry({ sessionId, participantId, now = Date.now() }) {
  const cursor = await getCursor(sessionId, participantId);
  if (!cursor || cursor.status !== 'active' || cursor.finishedAt) {
    return { expired: false, cursor: cursor ? projectCursor(cursor) : null };
  }
  // Global pause — expiry muzlatilgan (resumeAll shift qiladi)
  const meta = await getSpMeta(sessionId);
  if (meta && meta.paused) {
    return { expired: false, cursor: projectCursor(cursor) };
  }
  if (cursor.questionExpiresAt && now > cursor.questionExpiresAt) {
    // Expired — advance (javobsiz o'tkazish)
    const config = await getConfigSafe(sessionId);
    const res = await advanceCursor({ sessionId, participantId, config });
    return { expired: true, ...res };
  }
  return { expired: false, cursor: projectCursor(cursor) };
}

async function getConfigSafe(sessionId) {
  const { getConfig } = await import('./session-store.js');
  return getConfig(sessionId);
}

/**
 * Own rank (private policy): faqat o'z ranki.
 * Rank = answeredCount bo'yicha, teng bo'lsa time-based.
 * publicLiveRank=false → rank o'ziga xos (private).
 */
export async function computeOwnRank({ sessionId, participantId }) {
  const cursors = await listCursors(sessionId);
  const entries = Object.entries(cursors)
    .filter(([, c]) => c.status === 'active' || c.status === 'finished')
    .map(([pid, c]) => ({
      pid,
      answeredCount: c.answeredCount || 0,
      totalMs: (c.startedAt ? Date.now() - c.startedAt : 0) - (c.totalPausedMs || 0),
    }));
  entries.sort((a, b) => b.answeredCount - a.answeredCount || a.totalMs - b.totalMs);
  const rank = entries.findIndex((e) => e.pid === participantId) + 1;
  return {
    rank: rank > 0 ? rank : null,
    total: entries.length,
    answeredCount: (await getCursor(sessionId, participantId))?.answeredCount || 0,
  };
}

/**
 * Safe cursor projection — faqat o'z cursor'i uchun.
 * Boshqa ishtirokchilarning order/position'larini o'z ichiga olmaydi.
 * Order faqat current position va jami sonni ko'rsatadi — kelasi savol
 * texti/keyi emas (faqat id — public question id, xavfsiz).
 */
export function projectCursor(cursor) {
  if (!cursor) return null;
  return {
    position: cursor.position,
    totalQuestions: cursor.order.length,
    currentQuestionId: cursor.order[cursor.position] || null,
    status: cursor.status,
    questionOpenedAt: cursor.questionOpenedAt,
    questionExpiresAt: cursor.questionExpiresAt,
    finishedAt: cursor.finishedAt,
    answeredCount: cursor.answeredCount || 0,
    progress: cursor.order.length > 0 ? Math.min(1, (cursor.position) / cursor.order.length) : 0,
  };
}

/**
 * Director aggregate — progress distribution (faqat count'lar, identity yo'q).
 * Privacy: shaxs identifikatorlari YO'Q — faqat pozitsiya histogrammasi.
 */
export async function directorDistribution(sessionId) {
  const cursors = await listCursors(sessionId);
  const entries = Object.values(cursors).filter((c) => c.status === 'active' || c.status === 'finished');
  const total = entries.length;
  const histogram = {};
  for (const c of entries) {
    const pos = Math.min(c.position, c.order.length);
    histogram[String(pos)] = (histogram[String(pos)] || 0) + 1;
  }
  return {
    total,
    histogram,
    finished: entries.filter((c) => c.finishedAt).length,
    active: entries.filter((c) => c.status === 'active' && !c.finishedAt).length,
    pending: Object.values(cursors).filter((c) => c.status === 'pending').length,
  };
}

/**
 * Fairness health (C3-16 item): participation rate + spread.
 * @returns {Promise<{ok:boolean, participationRate:number, spreadScore:number, issues:string[]}>}
 */
export async function fairnessHealth({ sessionId, config }) {
  const cursors = await listCursors(sessionId);
  const entries = Object.values(cursors).filter((c) => c.status === 'active' || c.status === 'finished');
  if (entries.length === 0) {
    return { ok: true, participationRate: 0, spreadScore: 1, issues: [] };
  }
  const totalQuestions = entries[0].order.length || 1;
  const rates = entries.map((c) => (c.answeredCount || 0) / totalQuestions);
  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const minRate = Math.min(...rates);
  const spread = maxGap(rates);
  const issues = [];
  if (minRate < 0.4) issues.push('Bir qism ishtirokchilar orqada qolmoqda');
  if (spread > 0.5) issues.push('Progress farqi katta — pause/resume yordam berishi mumkin');
  const ok = issues.length === 0;
  return { ok, participationRate: Number(avgRate.toFixed(3)), spreadScore: Number((1 - spread).toFixed(3)), issues };
}

function maxGap(values) {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < sorted.length; i++) {
    gap = Math.max(gap, sorted[i] - sorted[i - 1]);
  }
  return gap;
}

/** Race yakuni: session end → barcha cursor'lar finished. */
export async function finalizeRace(sessionId) {
  const cursors = await listCursors(sessionId);
  const now = Date.now();
  for (const [pid, c] of Object.entries(cursors)) {
    if (!c.finishedAt) {
      c.status = 'finished';
      c.finishedAt = now;
      await setCursor(sessionId, pid, c);
    }
  }
  const meta = await getSpMeta(sessionId);
  if (meta) await fb.update(SP_META(sessionId), { endedAt: now, finishedCount: Object.keys(cursors).length });
  return { count: Object.keys(cursors).length };
}
