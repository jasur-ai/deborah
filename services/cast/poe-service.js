/**
 * Deborah — Cast POE Service (C3-11)
 * -----------------------------------
 * Prediction → Observation → Explanation flow.
 * Uchta alohida phase va record; prediction/explanation bitta participant ID bilan bog'lanadi.
 *
 * Key principles:
 * - Prediction confidence optional; grade/score'ga ta'sir qilmaydi.
 * - Prediction/explanation recordlar bitta participant path'da (overwrite yo'q).
 * - Change matrix teacher-private; aggregate pattern public (identity yo'q).
 * - Public exemplar faqat moderationdan keyin (moderation-service lifecycle qayta ishlatiladi).
 * - Observation media readiness aggregate qilinadi; strict timer gate'i host'ga.
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
import { normalizeConfidence } from './confidence-service.js';
import { applyWallAction, projectPublicWall, flagSensitive, WALL_MODERATION_STATE } from './moderation-service.js';

// ── Constants ──
export const POE_MEDIA_TYPES = ['image', 'animation', 'video', 'experiment', 'live_note'];
export const POE_MEDIA_READY_THRESHOLD = 0.8;
export const POE_EXPLANATION_CHAR_LIMIT = 280;
export const POE_EXPLANATION_MODES = ['short_answer', 'mcq'];

const POE_ROOT = (sessionId, flowId) => `cast_private/${sessionId}/poe/${flowId}`;
const EXEMPLAR_ROOT = (sessionId, flowId) => `${POE_ROOT(sessionId, flowId)}/exemplars`;

// ── Contract / media validation ──

/** Soniyalarni chegara (5..600), null qoldiriladi. */
function clampSeconds(v, allowNull = false) {
  if (v === null || v === undefined || v === '') return allowNull ? null : 30;
  const n = Number(v);
  if (!Number.isFinite(n)) return allowNull ? null : 30;
  return Math.min(600, Math.max(5, Math.round(n)));
}

/**
 * Observation media'ni tekshirish.
 * @returns {{ok:boolean, media?:object, error?:string}}
 */
export function validatePoeMedia(media = {}) {
  const type = media.type;
  if (!POE_MEDIA_TYPES.includes(type)) return { ok: false, error: 'INVALID_MEDIA_TYPE' };
  const caption = String(media.caption || '').trim().slice(0, 200) || null;
  if (['image', 'animation', 'video'].includes(type)) {
    const url = String(media.url || '').trim();
    if (!url) return { ok: false, error: 'MEDIA_URL_REQUIRED' };
    if (!/^https?:\/\//.test(url)) return { ok: false, error: 'MEDIA_URL_INVALID' };
    return { ok: true, media: { type, url, caption } };
  }
  if (['experiment', 'live_note'].includes(type)) {
    const text = String(media.text || '').trim().slice(0, 500);
    if (!text) return { ok: false, error: 'MEDIA_TEXT_REQUIRED' };
    return { ok: true, media: { type, text, caption } };
  }
  return { ok: false, error: 'INVALID_MEDIA_TYPE' };
}

/**
 * POE contract'ni tekshirish (plan'dagi contract shakli).
 * @returns {{ok:boolean, contract?:object, errors?:string[]}}
 */
export function validatePoeContract(raw = {}) {
  const flowId = String(raw.flowId || '').trim().slice(0, 60);
  const predictionQuestionId = String(raw.predictionQuestionId || '').trim();
  const observationId = String(raw.observationId || '').trim().slice(0, 60);
  const explanationQuestionId = String(raw.explanationQuestionId || '').trim();
  const errors = [];
  if (!flowId) errors.push('flowId kerak');
  if (!predictionQuestionId) errors.push('predictionQuestionId kerak');
  if (!observationId) errors.push('observationId kerak');
  if (!explanationQuestionId) errors.push('explanationQuestionId kerak');

  const mediaCheck = validatePoeMedia(raw.media);
  if (!mediaCheck.ok) errors.push(mediaCheck.error);

  const timerPolicy = {
    predictionSeconds: clampSeconds(raw.timerPolicy?.predictionSeconds),
    observationSeconds: clampSeconds(raw.timerPolicy?.observationSeconds, true),
    explanationSeconds: clampSeconds(raw.timerPolicy?.explanationSeconds),
  };

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    contract: {
      flowId,
      predictionQuestionId,
      observationId,
      explanationQuestionId,
      timerPolicy,
      media: mediaCheck.media,
      mediaReadyThreshold: Number.isFinite(Number(raw.mediaReadyThreshold))
        ? Math.min(1, Math.max(0.5, Number(raw.mediaReadyThreshold)))
        : POE_MEDIA_READY_THRESHOLD,
    },
  };
}

// ── Records ──

/**
 * Prediction'ni yozish (normal answer flow'ga tegmaydi, score yozilmaydi).
 * @returns {Promise<{ok:boolean, record?:object, error?:string}>}
 */
export async function recordPrediction({ sessionId, flowId, participantId, questionId, selectedOptionIds, confidence, commandId }) {
  const ids = Array.isArray(selectedOptionIds) ? [...new Set(selectedOptionIds.map(String))] : [];
  if (!ids.length) return { error: 'EMPTY' };
  const record = {
    flowId,
    participantId,
    questionId,
    type: 'prediction',
    selectedOptionIds: ids,
    confidence: normalizeConfidence(confidence) || null, // optional field
    commandId,
    at: Date.now(),
  };
  await fb.set(`${POE_ROOT(sessionId, flowId)}/${participantId}/prediction`, record);
  return { ok: true, record };
}

/**
 * Explanation'ni yozish (short_answer | mcq). Short answer exemplar queue'ga ham boradi.
 * @returns {Promise<{ok:boolean, record?:object, error?:string}>}
 */
export async function recordExplanation({ sessionId, flowId, participantId, questionId, mode, text, selectedOptionIds, commandId }) {
  if (!POE_EXPLANATION_MODES.includes(mode)) return { error: 'INVALID_MODE' };
  let record;
  if (mode === 'short_answer') {
    const clean = String(text || '').trim().slice(0, POE_EXPLANATION_CHAR_LIMIT);
    if (!clean) return { error: 'EMPTY' };
    record = {
      flowId, participantId, questionId, type: 'explanation', mode: 'short_answer', text: clean, commandId, at: Date.now(),
    };
  } else {
    const ids = Array.isArray(selectedOptionIds) ? [...new Set(selectedOptionIds.map(String))] : [];
    if (!ids.length) return { error: 'EMPTY' };
    record = {
      flowId, participantId, questionId, type: 'explanation', mode: 'mcq', selectedOptionIds: ids, commandId, at: Date.now(),
    };
  }
  await fb.set(`${POE_ROOT(sessionId, flowId)}/${participantId}/explanation`, record);
  return { ok: true, record };
}

/**
 * Barcha POE recordlarni yuklash: participantId → {prediction, explanation}.
 * @returns {Promise<Object>}
 */
export async function getPoeRecords(sessionId, flowId) {
  const snap = await fb.get(POE_ROOT(sessionId, flowId));
  if (!snap.exists()) return {};
  const all = snap.val();
  const out = {};
  for (const [pid, recs] of Object.entries(all)) {
    if (pid === 'exemplars' || pid === 'readiness') continue;
    out[pid] = {
      participantId: pid,
      prediction: recs.prediction || null,
      explanation: recs.explanation || null,
    };
  }
  return out;
}

// ── Analysis (pure) ──

/** Prediction distribution — teacher-private. */
export function computePredictionDistribution(records) {
  const dist = {};
  let total = 0;
  for (const r of Object.values(records)) {
    const pred = r?.prediction;
    if (!pred) continue;
    for (const oid of pred.selectedOptionIds || []) dist[oid] = (dist[oid] || 0) + 1;
    total += 1;
  }
  return { dist, total };
}

/** Prediction→Explanation change matrix (mcq only) — teacher-private. */
export function computeChangeMatrix(records) {
  const rows = [];
  for (const r of Object.values(records)) {
    const pred = r?.prediction;
    const exp = r?.explanation;
    if (!pred || !exp || exp.mode !== 'mcq') continue;
    const predictedOptionId = (pred.selectedOptionIds || [])[0] || null;
    const explainedOptionId = (exp.selectedOptionIds || [])[0] || null;
    rows.push({ participantId: r.participantId, predictedOptionId, explainedOptionId, changed: predictedOptionId !== explainedOptionId });
  }
  const changed = rows.filter((r) => r.changed).length;
  return {
    rows,
    changed,
    total: rows.length,
    changeRate: rows.length ? Math.round((changed / rows.length) * 100) : 0,
  };
}

/** Aggregate pattern — public-safe (identity yo'q). */
export function computeAggregatePattern(records) {
  const matrix = computeChangeMatrix(records);
  const transitions = {};
  for (const row of matrix.rows) {
    const key = `${row.predictedOptionId} → ${row.explainedOptionId}`;
    transitions[key] = (transitions[key] || 0) + 1;
  }
  return {
    participants: matrix.total,
    changed: matrix.changed,
    changeRate: matrix.changeRate,
    topTransitions: Object.entries(transitions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([transition, count]) => ({ transition, count })),
  };
}

/** Action Pack POE summary (item 13). */
export function buildPoeSummary(records, { flowId }) {
  const matrix = computeChangeMatrix(records);
  return {
    flowId,
    predicted: Object.values(records).filter((r) => r?.prediction).length,
    explained: Object.values(records).filter((r) => r?.explanation).length,
    changed: matrix.changed,
    changeRate: matrix.changeRate,
    completedAt: Date.now(),
  };
}

// ── Media readiness (pure) ──

export function mediaReadyState(readyCount, activeCount, threshold = POE_MEDIA_READY_THRESHOLD) {
  const required = Math.max(1, Math.ceil(activeCount * threshold));
  return {
    readyCount,
    activeCount,
    required,
    ready: activeCount > 0 && readyCount >= required,
  };
}

export async function getMediaReadiness(sessionId, flowId, threshold) {
  const [readySnap, participants] = await Promise.all([
    fb.get(`${POE_ROOT(sessionId, flowId)}/readiness`),
    // active participants via store callback — injected to avoid circular import
    listActiveParticipants(sessionId),
  ]);
  const readyCount = readySnap.exists() ? Object.keys(readySnap.val()).length : 0;
  return mediaReadyState(readyCount, participants.length, threshold);
}

// active participants'ni sessiyadan o'qiydi (socket handler tomonidan inject qilinadi)
let listActiveParticipants = async () => [];
export function setParticipantLister(fn) {
  listActiveParticipants = fn;
}

// ── Exemplar moderation (moderation-service lifecycle qayta ishlatiladi) ──

export async function submitExemplar({ sessionId, flowId, participantId, text, commandId }) {
  const clean = String(text || '').trim().slice(0, POE_EXPLANATION_CHAR_LIMIT);
  if (!clean) return { error: 'EMPTY' };
  const exemplarId = 'exm_' + crypto.randomBytes(6).toString('hex');
  const { flags, priority } = flagSensitive(clean);
  const item = {
    contentId: exemplarId,
    type: 'poe_exemplar',
    flowId,
    participantId,
    commandId,
    text: clean,
    charCount: clean.length,
    flags,
    priority,
    moderationState: WALL_MODERATION_STATE.RECEIVED,
    submittedAt: Date.now(),
    moderatedAt: null,
    moderatedBy: null,
    redactedText: null,
    projectedAt: null,
  };
  await fb.set(`${EXEMPLAR_ROOT(sessionId, flowId)}/${exemplarId}`, item);
  return { ok: true, exemplarId, priority };
}

export async function listExemplarQueue(sessionId, flowId) {
  const snap = await fb.get(EXEMPLAR_ROOT(sessionId, flowId));
  return snap.exists() ? snap.val() : {};
}

export async function moderateExemplar({ sessionId, flowId, exemplarId, action, moderatorId, redactedText }) {
  const path = `${EXEMPLAR_ROOT(sessionId, flowId)}/${exemplarId}`;
  const snap = await fb.get(path);
  if (!snap.exists()) {
    throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Exemplar topilmadi');
  }
  const current = snap.val();
  const { ok, next, error } = applyWallAction(current, action, { redactedText, moderatorId });
  if (!ok) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, `Moderatsiya rad etildi: ${error}`);
  }
  await fb.set(path, next);
  return next;
}

/** Public exemplarlar — faqat tasdiqlangan, identity yo'q. */
export function projectPublicExemplars(items) {
  return projectPublicWall(items).map((it) => ({ exemplarId: it.contentId, text: it.text }));
}

export default {
  POE_MEDIA_TYPES,
  POE_MEDIA_READY_THRESHOLD,
  POE_EXPLANATION_CHAR_LIMIT,
  POE_EXPLANATION_MODES,
  validatePoeMedia,
  validatePoeContract,
  recordPrediction,
  recordExplanation,
  getPoeRecords,
  computePredictionDistribution,
  computeChangeMatrix,
  computeAggregatePattern,
  buildPoeSummary,
  mediaReadyState,
  getMediaReadiness,
  setParticipantLister,
  submitExemplar,
  listExemplarQueue,
  moderateExemplar,
  projectPublicExemplars,
};
