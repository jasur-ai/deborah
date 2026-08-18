/**
 * Deborah — Cast Event Replay Service (C5-02)
 * ------------------------------------------
 * Camera/video yozuvsiz event timeline replay. Replay input = session
 * snapshot (config/meta) + ordered events. Har revision'da reducer bilan
 * safe state tiklanadi (deterministic).
 *
 * Projection'lar:
 * - Teacher Replay — config, aggregate distribution, action, network,
 *   misconception markerlari (private director scope).
 * - Student Replay — faqat own response + approved feedback (low rank yo'q).
 * - Institution Audit — PII-safe, faqat aggregate.
 *
 * Redaction: withdrawn/redacted content current moderation state bo'yicha
 * ko'rsatiladi; deleted raw data → placeholder / event-only marker.
 */

import { replayEvents, applyEvent, initialState } from './state-machine.js';
import { WALL_MODERATION_STATE } from './moderation-service.js';
import { getMisconception } from './misconception-service.js';

export const REPLAY_VERSION = 'replay_v1';
export const EVENT_SCHEMA_VERSION = 1;

// ── Event schema migration registry (item 8) ──
// Har bir migratsiya `{ from: n, to: n+1, migrate(events) => events }`.
// Event'larni o'qishda `migrateEvents(events)` chaqiriladi.
export const EVENT_SCHEMA_MIGRATIONS = Object.freeze([
  {
    from: 1,
    to: 2,
    // Rejada: keyingi schema'lar uchun o'rin — hozir hech qanday tarixiy
    // migratsiya kerak emas (barcha event'lar schema v1 da yozilgan).
    migrate: (events) => events,
  },
]);

export function latestEventSchemaVersion() {
  let v = EVENT_SCHEMA_VERSION;
  for (const m of EVENT_SCHEMA_MIGRATIONS) v = Math.max(v, m.to);
  return v;
}

// ── Golden replay fixtures (item 9) ──
// Golden fixture: { name, initialStateArgs, events, expected: {phase, finalRevision, questionId?} }
// `verifyAgainstGolden` replay natijasini kutilgan state bilan solishtiradi.
export const GOLDEN_FIXTURES = Object.freeze([
  {
    name: 'basic_start_open_end',
    initialStateArgs: { primaryDirectorId: 'd', questionIds: ['q1'], questionCount: 1 },
    events: [
      { type: 'cast:sessionStarted', revision: 1, serverAt: 1100, payload: { startedAt: 1100 } },
      { type: 'cast:questionOpened', revision: 2, serverAt: 1200, payload: { questionId: 'q1', closesAt: 2000 } },
      { type: 'cast:sessionEnded', revision: 3, serverAt: 3000, payload: { endedAt: 3000 } },
    ],
    expected: { phase: 'ENDED', finalRevision: 3, endedAt: 3000 },
  },
  {
    name: 'empty_events_lobby',
    initialStateArgs: { primaryDirectorId: 'd', questionIds: ['q1'], questionCount: 1 },
    events: [],
    expected: { phase: 'LOBBY_OPEN', finalRevision: 1 },
  },
]);

/**
 * Golden fixture bilan tekshirish (item 9).
 * @param {object} fixture — GOLDEN_FIXTURES'dan biri
 * @returns {{ok:boolean, actual:object, mismatch:string[]}}
 */
export function verifyAgainstGolden(fixture) {
  const { state, finalRevision } = replaySessionState({ initialStateArgs: fixture.initialStateArgs, events: fixture.events });
  const expected = fixture.expected || {};
  const mismatch = [];
  if (state.phase !== expected.phase) mismatch.push(`phase: ${state.phase} != ${expected.phase}`);
  if (finalRevision !== expected.finalRevision) mismatch.push(`finalRevision: ${finalRevision} != ${expected.finalRevision}`);
  if (expected.endedAt !== undefined && state.endedAt !== expected.endedAt) {
    mismatch.push(`endedAt: ${state.endedAt} != ${expected.endedAt}`);
  }
  return { ok: mismatch.length === 0, actual: { phase: state.phase, finalRevision, endedAt: state.endedAt }, mismatch };
}

/**
 * Event'larga schema migratsiyasini qo'llash (old → new).
 * @param {Array<Object>} events
 * @returns {Array<Object>} migrated events
 */
export function migrateEvents(events = []) {
  let current = [...events];
  const ordered = [...EVENT_SCHEMA_MIGRATIONS].sort((a, b) => a.from - b.from);
  for (const m of ordered) {
    current = m.migrate(current);
  }
  return current;
}

/**
 * Deleted raw data uchun marker (item 7). Replay projection'larida raw
 * ma'lumot o'rniga bu marker ko'rsatiladi.
 */
export const DELETED_CONTENT_MARKER = "⚠️ Ma'lumot saqlash muddati tugagan (deleted)";

/**
 * Replay state'ni qayta yaratish (item 1, 2) — deterministic.
 * Eventlar schema migratsiya + revision bo'yicha sort qilinadi.
 *
 * @param {object} input
 * @param {object} input.initialStateArgs — initialState({...}) argumentlari
 * @param {Array<Object>} input.events — committed events (revision field bilan)
 * @returns {{ state: object, events: Array<Object>, finalRevision: number }}
 */
export function replaySessionState({ initialStateArgs = {}, events = [] }) {
  const migrated = migrateEvents(events);
  const sorted = [...migrated].sort((a, b) => (a.revision || 0) - (b.revision || 0));
  const initial = initialState(initialStateArgs);
  const state = replayEvents(initial, sorted);
  const finalRevision = sorted.length ? Math.max(...sorted.map((e) => e.revision || 0)) : initial.revision || 1;
  return { state, events: sorted, finalRevision };
}

/**
 * Har revision'dagi state'lar ro'yxati (timeline uchun).
 * `intermediate` — har event keyin state'ni chiqaradi.
 */
export function replayTimeline({ initialStateArgs = {}, events = [] }) {
  const migrated = migrateEvents(events);
  const sorted = [...migrated].sort((a, b) => (a.revision || 0) - (b.revision || 0));
  let state = initialState(initialStateArgs);
  const frames = [{ revision: state.revision || 1, event: null, state: snapshotState(state) }];
  for (const ev of sorted) {
    state = applyEvent(state, ev);
    frames.push({ revision: ev.revision, event: sanitizeEventForLog(ev), state: snapshotState(state) });
  }
  return frames;
}

/**
 * Event'ni replay log'iga xavfsiz tushirish — raw payload filtrlanadi.
 * Review fix (C5-02): whitelist SCALAR-only — `poeFlow`/`contract` kabi
 * nested objectlar (answer-key'ga o'xshash ma'lumot bo'lishi mumkin) hech
 * qachon log'ga tushmaydi. Faqat metadata scalar'lar o'tadi.
 */
const ALLOWED_LOG_KEYS = new Set([
  'questionId', 'attemptNo', 'closesAt', 'openedAt', 'endedAt', 'startedAt',
  'remainingMs', 'pausedDurationMs', 'seconds', 'extensionCount', 'questionPosition',
  'nextQ', 'masteryFlowType', 'transferSourceQuestionId', 'predictionClosedAt',
  'explanationOpenedAt', 'revision', 'blockId', 'targetBlockId', 'by', 'decision',
  'misconceptionId', 'optionId', 'confirmed', 'teamId', 'redactedText', 'contentId',
  'priority', 'moderationState', 'goalType', 'target', 'enabled', 'level', 'teamId',
]);

export function sanitizeEventForLog(ev) {
  if (!ev) return ev;
  const { payload = {}, ...rest } = ev;
  const safePayload = {};
  for (const k of Object.keys(payload || {})) {
    if (!ALLOWED_LOG_KEYS.has(k)) continue;
    const v = payload[k];
    // Nested object/array YO'Q — faqat scalar (string/number/boolean/null)
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      safePayload[k] = v;
    }
  }
  return {
    ...rest,
    ...(Object.keys(safePayload).length ? { payload: safePayload } : {}),
  };
}

/** State'ning replay uchun xavfsiz snapshot'i. */
export function snapshotState(state = {}) {
  return {
    phase: state.phase,
    revision: state.revision,
    questionPosition: state.questionPosition,
    questionId: state.questionId,
    totalQuestions: state.totalQuestions,
    voteRound: state.voteRound,
    openedAt: state.openedAt,
    closesAt: state.closesAt,
    endedAt: state.endedAt,
    leaderboardVisible: state.leaderboardVisible,
    masteryFlowType: state.masteryFlowType,
    masteryFlowActive: state.masteryFlowActive,
  };
}

/**
 * Teacher Replay projection (item 4) — config, aggregate distribution,
 * action/network/misconception markerlar. Student identity'siz.
 *
 * @param {object} input
 * @param {Array<Object>} input.events — eventlar
 * @param {object} input.config — session config
 * @param {object} input.answersByQuestion — {qid: {pid: rec}} (ACCEPTED only)
 * @param {object} input.network — {pid: {bucket, latencyMs, ...}}
 * @param {object} input.misconceptions — {qid: {optionId: rec}}
 */
export function projectTeacherReplay({ events = [], config = {}, answersByQuestion = {}, network = {}, misconceptions = {} }) {
  const timeline = [];
  const actions = [];
  for (const ev of events) {
    const frame = { revision: ev.revision, type: ev.type, serverAt: ev.serverAt };
    timeline.push(frame);
    // Action markerlari (item 4) — faqat COMMIT qilinadigan state event'lari.
    // Review fix (C5-02): poeLaunch/orbLaunch socket broadcast'lar — commit
    // bo'lmaydi, shuning uchun filter'da yo'q.
    if (['cast:questionOpened', 'cast:questionClosed', 'cast:questionRevealed', 'cast:discussionStarted', 'cast:revoteOpened', 'cast:revoteClosed', 'cast:transferOpened', 'cast:transferCompleted', 'cast:sessionEnded', 'cast:questionPaused', 'cast:timeAdded', 'cast:goalComplete', 'cast:questionNext', 'cast:questionLocked', 'cast:quickPromptLive'].includes(ev.type)) {
      actions.push({ revision: ev.revision, type: ev.type, payload: sanitizeEventForLog(ev)?.payload || {} });
    }
  }

  // Aggregate distribution per question (identity'siz)
  const distributions = Object.entries(answersByQuestion || {}).map(([qid, byPid]) => {
    const counts = {};
    for (const rec of Object.values(byPid || {})) {
      for (const id of rec.selectedOptionIds || []) counts[id] = (counts[id] || 0) + 1;
    }
    const accepted = Object.keys(byPid || {}).length;
    const correct = Object.values(byPid || {}).filter((r) => r.isCorrect || r.status === 'CORRECT').length;
    return {
      questionId: qid,
      accepted,
      correct,
      accuracyPercent: accepted > 0 ? Math.round((correct / accepted) * 1000) / 10 : null,
      distribution: counts,
    };
  });

  // Network summary (aggregate)
  const networkBuckets = {};
  for (const sample of Object.values(network || {})) {
    if (sample && sample.bucket && sample.bucket !== 'unknown') {
      networkBuckets[sample.bucket] = (networkBuckets[sample.bucket] || 0) + 1;
    }
  }

  // Misconception markers
  const misconceptionMarkers = [];
  for (const [qid, byOption] of Object.entries(misconceptions || {})) {
    for (const [optionId, rec] of Object.entries(byOption || {})) {
      if (rec && rec.confirmed) {
        const meta = getMisconception(rec.misconceptionId);
        misconceptionMarkers.push({
          questionId: qid,
          optionId,
          misconceptionId: rec.misconceptionId || null,
          label: meta ? meta.label : rec.misconceptionId || 'noma lum',
          teacherExplanation: rec.teacherExplanation || null,
        });
      }
    }
  }

  return {
    version: REPLAY_VERSION,
    timeline,
    actions,
    distributions,
    networkBuckets,
    misconceptionMarkers,
    configFingerprint: null, // routes tomonda hashConfig bilan to'ldiriladi
    cameraPermissionRequested: false, // item 13: default replay camera/mic so'ramaydi
  };
}

/**
 * Wall content redaction projection (item 6) — replay payload'ga ulash.
 * `wallItems` — {contentId: item}; qaytarilgan ro'yxatda withdrawn/hidden
 * marker bilan, REDACTED redactedText bilan, RECEIVED yashirin.
 */
export function projectReplayWall(wallItems = {}) {
  const out = [];
  for (const item of Object.values(wallItems || {})) {
    const p = projectWallContent(item);
    out.push({
      contentId: item.contentId || null,
      priority: item.priority || null,
      submittedAt: item.submittedAt || null,
      ...p,
    });
  }
  return out;
}

/**
 * Student Replay projection (item 5) — faqat own response + approved feedback.
 * @param {object} input
 * @param {string} input.participantId
 * @param {object} input.answersByQuestion — {qid: {pid: rec}}
 * @param {object} input.misconceptions — {qid: {optionId: {confirmed, teacherExplanation}}}
 * @param {object} input.questions — {qid: {text}}
 */
export function projectStudentReplay({ participantId, answersByQuestion = {}, misconceptions = {}, questions = {} }) {
  const items = [];
  for (const [qid, byPid] of Object.entries(answersByQuestion || {})) {
    const rec = byPid?.[participantId];
    if (!rec) continue;
    const correct = rec.isCorrect || rec.status === 'CORRECT';
    let approvedExplanation = null;
    const byOption = misconceptions?.[qid] || {};
    for (const optionRec of Object.values(byOption || {})) {
      if (optionRec && optionRec.confirmed && optionRec.teacherExplanation) {
        approvedExplanation = optionRec.teacherExplanation;
      }
    }
    items.push({
      questionId: qid,
      text: questions?.[qid]?.text || qid,
      correct,
      selectedOptionIds: rec.selectedOptionIds || [],
      submittedAt: rec.submittedAt || null,
      approvedExplanation,
    });
  }
  return {
    participantId,
    version: REPLAY_VERSION,
    items,
    // Faqat o'z ma'lumoti — boshqa studentlar / leaderboard YO'Q
    privateScope: true,
  };
}

/**
 * Institution Audit projection (item 3) — PII-safe aggregate.
 * Faqat counts + action turi; student identity / raw javoblar YO'Q.
 */
export function projectAuditReplay({ events = [] }) {
  const typeCounts = {};
  let firstAt = null;
  let lastAt = null;
  for (const ev of events) {
    typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1;
    if (!firstAt || ev.serverAt < firstAt) firstAt = ev.serverAt;
    if (!lastAt || ev.serverAt > lastAt) lastAt = ev.serverAt;
  }
  return {
    version: REPLAY_VERSION,
    eventCount: events.length,
    typeCounts,
    firstAt,
    lastAt,
    durationMs: firstAt && lastAt ? lastAt - firstAt : null,
  };
}

/**
 * Withdrawn/redacted content — current redaction policy (item 6).
 * WITHDRAWN/HIDDEN → ko'rsatilmaydi; REDACTED → redactedText.
 * @param {object} item — wall item
 * @returns {{show:boolean, text:string|null, marker:string|null}}
 */
export function projectWallContent(item = {}) {
  switch (item.moderationState) {
    case WALL_MODERATION_STATE.APPROVED:
    case WALL_MODERATION_STATE.PROJECTED:
      return { show: true, text: item.text || null, marker: null };
    case WALL_MODERATION_STATE.REDACTED:
      return { show: true, text: item.redactedText || item.storedText || null, marker: null };
    case WALL_MODERATION_STATE.HIDDEN:
    case WALL_MODERATION_STATE.WITHDRAWN:
      return { show: false, text: null, marker: 'Olib tashlangan (withdrawn)' }; // eslint-disable-line quotes
    default:
      return { show: false, text: null, marker: null }; // RECEIVED/AUTO_FLAGGED — hali tasdiqlanmagan
  }
}

/**
 * Deleted raw data uchun event-only marker (item 7): savol/answer o'chirilgan
 * bo'lsa — raw o'rniga marker, lekin event timeline baribir ko'rsatiladi.
 * @param {object} answersByQuestion — {qid: byPid}
 * @param {object} existingQuestions — {qid: q}
 * @returns {Array<{questionId:string, deleted:boolean}>}
 */
export function markDeletedQuestions({ answersByQuestion = {}, existingQuestions = {} }) {
  const out = [];
  for (const [qid] of Object.entries(answersByQuestion || {})) {
    out.push({ questionId: qid, deleted: !existingQuestions?.[qid], marker: !existingQuestions?.[qid] ? DELETED_CONTENT_MARKER : null });
  }
  return out;
}

/** Camera/microphone permission — default replay'da so'ralmaydi (item 13). */
export const REPLAY_CAMERA_PERMISSION = Object.freeze({ requested: false, reason: 'Replay camera/video yozuvsiz ishlaydi' });

export default {
  REPLAY_VERSION,
  EVENT_SCHEMA_VERSION,
  EVENT_SCHEMA_MIGRATIONS,
  latestEventSchemaVersion,
  migrateEvents,
  GOLDEN_FIXTURES,
  verifyAgainstGolden,
  DELETED_CONTENT_MARKER,
  replaySessionState,
  replayTimeline,
  sanitizeEventForLog,
  snapshotState,
  projectTeacherReplay,
  projectReplayWall,
  projectStudentReplay,
  projectAuditReplay,
  projectWallContent,
  markDeletedQuestions,
  REPLAY_CAMERA_PERMISSION,
};
