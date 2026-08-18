/**
 * Edikit — Cast Action Pack Service (C5-01)
 * -----------------------------------------
 * Session tugaganda teacherga aggregate evidence + bir bosishli follow-up
 * actionlar, studentga esa faqat own response / approved explanation / next
 * steps ko'rsatadigan private recap yaratadi.
 *
 * Data inventory (C4-07): barcha action-pack materiali `action_pack` data
 * class — retention 180 kun REVIEW_OR_DELETE. Report raw public leaderboard'ga
 * bog'liq emas (immutable snapshot).
 */

import { hashConfig } from './config-schema.js';
import { computeQuestionEvidence } from './evidence-service.js';
import { computeConfidenceMatrix, MIN_CELL_COUNT } from './confidence-service.js';
import { getMisconception, MISCONCEPTION_VERSION } from './misconception-service.js';
import { classifyStatus, splitCoverageByDelivery } from './resilience-service.js';
import { DATA_CLASSES, resolveRetentionPolicy } from './data-policy.js';

export const ACTION_PACK_VERSION = 'action_pack_v1';
export const HARDEST_QUESTION_MIN_SAMPLE = 6; // item 5: minimum sample
export const ITEM_FLAG_ACTIONS = Object.freeze({
  REVIEW: 'review',
  REVISE: 'revise',
  RETIRE: 'retire',
});
export const RECOMMENDED_ACTION_IDS = Object.freeze([
  'assign_practice',
  'create_intervention_group',
  'create_redemption_session',
  'duplicate_cast_config',
  'save_preset',
  'export',
]);
export const RECAP_ACTION_IDS = Object.freeze([
  'practice_link',
  'ask_teacher',
  'review_approved_explanation',
]);

/**
 * Participation + missing reason summary (item 3).
 * Har bir participant → classifyStatus (accepted / late_join / disconnected /
 * technical_failure / no_response). Coverage in-room vs remote split.
 */
export function summarizeParticipation({ participants = {}, answersByQuestion = {}, config = {} }) {
  const answeredByPid = new Set();
  for (const byPid of Object.values(answersByQuestion || {})) {
    for (const pid of Object.keys(byPid || {})) answeredByPid.add(pid);
  }
  const reasons = { accepted: 0, late_join: 0, disconnected: 0, technical_failure: 0, no_response: 0 };
  const rows = Object.entries(participants || {}).map(([pid, p]) => {
    const status = classifyStatus({ participant: p, hasAnswer: answeredByPid.has(pid) });
    reasons[status] = (reasons[status] || 0) + 1;
    return { participantId: pid, status };
  });
  const coverage = splitCoverageByDelivery(participants, Object.fromEntries(
    Object.entries(participants).map(([pid, p]) => [pid, answeredByPid.has(pid)])
  ));
  return { total: rows.length, reasons, rows, coverage };
}

/**
 * Class accuracy — accepted denominator (item 4). Faqat accept qilingan
 * javoblar hisobga olinadi (session-store listAnswersForQuestion allaqachon
 * ACCEPTED filtri bilan keladi).
 */
export function summarizeAccuracy({ answersByQuestion = {} }) {
  let accepted = 0;
  let correct = 0;
  for (const byPid of Object.values(answersByQuestion || {})) {
    for (const rec of Object.values(byPid || {})) {
      accepted++;
      if (rec.isCorrect || rec.status === 'CORRECT') correct++;
    }
  }
  return {
    accepted,
    correct,
    accuracyPercent: accepted > 0 ? Math.round((correct / accepted) * 1000) / 10 : null,
  };
}

/**
 * Hardest questions — minimum sample bilan (item 5). Sample yetmagan
 * savollar "insufficient_sample" sifatida belgilanadi (ko'rsatiladi lekin
 * flaglanmaydi).
 */
export function identifyHardestQuestions({ answersByQuestion = {}, questions = {} }) {
  const stats = Object.entries(answersByQuestion || {}).map(([qid, byPid]) => {
    const values = Object.values(byPid || {});
    const accepted = values.length;
    const correct = values.filter((r) => r.isCorrect || r.status === 'CORRECT').length;
    const accuracyPercent = accepted > 0 ? Math.round((correct / accepted) * 1000) / 10 : null;
    const insufficientSample = accepted < HARDEST_QUESTION_MIN_SAMPLE;
    return {
      questionId: qid,
      text: questions?.[qid]?.text || qid,
      accepted,
      accuracyPercent,
      insufficientSample,
    };
  });
  return stats.sort((a, b) => (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101));
}

/**
 * Confirmed misconception summary (item 6). Director tasdiqlagan (confirmed)
 * misconception'lar — teacher explanation bilan. `misconceptions` argumenti
 * `{qid: {optionId: {misconceptionId, confirmed, teacherExplanation}}}`.
 */
export function summarizeMisconceptions({ misconceptions = {}, questions = {} }) {
  const out = [];
  for (const [qid, byOption] of Object.entries(misconceptions || {})) {
    for (const [optionId, rec] of Object.entries(byOption || {})) {
      if (!rec || !rec.confirmed) continue;
      const meta = getMisconception(rec.misconceptionId);
      out.push({
        questionId: qid,
        optionId,
        misconceptionId: rec.misconceptionId || null,
        label: meta ? meta.label : (rec.misconceptionId || 'noma lum'),
        teacherExplanation: rec.teacherExplanation || null,
        questionText: questions?.[qid]?.text || qid,
      });
    }
  }
  return out;
}

/**
 * Confidence matrix summary (item 7). `answers` — {qid: {pid: rec}} faqat
 * confidence bor javoblar. MIN_CELL_COUNT dan kichik hujayralar suppress
 * (de-identification).
 */
export function summarizeConfidence({ answersByQuestion = {} }) {
  const out = [];
  for (const [qid, byPid] of Object.entries(answersByQuestion || {})) {
    const withConfidence = {};
    for (const [pid, rec] of Object.entries(byPid || {})) {
      if (rec && rec.confidence) withConfidence[pid] = rec;
    }
    if (Object.keys(withConfidence).length === 0) continue;
    const matrix = computeConfidenceMatrix(withConfidence, { minCellCount: MIN_CELL_COUNT });
    out.push({ questionId: qid, ...matrix });
  }
  return out;
}

/**
 * First → revote change summary (item 8). Har bir savol uchun
 * WRONG_TO_CORRECT / CORRECT_TO_WRONG / stable count.
 */
export function summarizeRevoteChanges({ firstAnswers = {}, revoteAnswers = {} }) {
  const out = [];
  const allQids = new Set([...Object.keys(firstAnswers || {}), ...Object.keys(revoteAnswers || {})]);
  for (const qid of allQids) {
    const first = firstAnswers?.[qid] || {};
    const revote = revoteAnswers?.[qid] || {};
    let wrongToCorrect = 0;
    let correctToWrong = 0;
    let stable = 0;
    const allPids = new Set([...Object.keys(first), ...Object.keys(revote)]);
    for (const pid of allPids) {
      const f = first[pid];
      const r = revote[pid];
      if (!f || !r) continue;
      const fOk = f.isCorrect || f.status === 'CORRECT';
      const rOk = r.isCorrect || r.status === 'CORRECT';
      if (fOk === rOk) stable++;
      else if (rOk) wrongToCorrect++;
      else correctToWrong++;
    }
    out.push({
      questionId: qid,
      wrongToCorrect,
      correctToWrong,
      stable,
      improvedPercent: allPids.size > 0 ? Math.round((wrongToCorrect / allPids.size) * 100) : null,
    });
  }
  return out;
}

/**
 * Transfer / redemption result (item 9) — alohida blok. `redemptions` —
 * {questionId: {participantId: {applied, points, reason}}}.
 */
export function summarizeTransfers({ redemptions = {} }) {
  let applied = 0;
  let totalPoints = 0;
  const byQuestion = {};
  for (const [qid, byPid] of Object.entries(redemptions || {})) {
    byQuestion[qid] = { count: 0, points: 0 };
    for (const rec of Object.values(byPid || {})) {
      if (rec && rec.applied) {
        applied++;
        totalPoints += rec.points || 0;
        byQuestion[qid].count++;
        byQuestion[qid].points += rec.points || 0;
      }
    }
  }
  return { applied, totalPoints, byQuestion };
}

/**
 * Timeout / network issue summary (item 10). `network` — {pid: {bucket,
 * latencyMs, lossPercent}}. Bucket bo'yicha taqsimot + technical_failure
 * count (classifyStatus'dan).
 */
export function summarizeNetwork({ network = {}, participants = {} }) {
  const buckets = {};
  let totalSamples = 0;
  for (const [pid, sample] of Object.entries(network || {})) {
    if (!sample || sample.bucket === 'unknown') continue;
    buckets[sample.bucket] = (buckets[sample.bucket] || 0) + 1;
    totalSamples++;
  }
  const technicalFailures = Object.entries(participants || {}).filter(([, p]) =>
    classifyStatus({ participant: p, hasAnswer: false }) === 'technical_failure'
  ).length;
  return { totalSamples, buckets, technicalFailures };
}

/**
 * Item-quality flags → review / revise / retire actionlar (item 11).
 * `findings` — quality-lab postflight findings (findings.actionId allaqachon
 * actionga bog'langan). Flag deterministik: BLOCKER → retire, WARNING →
 * revise/review, INFO → review.
 */
export function mapFindingsToItemActions({ findings = [] }) {
  const items = [];
  for (const f of findings || []) {
    let action = ITEM_FLAG_ACTIONS.REVIEW;
    if (f.severity === 'BLOCKER') action = ITEM_FLAG_ACTIONS.RETIRE;
    else if (f.severity === 'WARNING' && (f.code === 'DOMINANT_DISTRACTOR' || f.code === 'HIGH_CONFIDENCE_WRONG')) {
      action = ITEM_FLAG_ACTIONS.REVISE;
    }
    items.push({
      questionId: f.questionId || null,
      code: f.code,
      severity: f.severity,
      message: f.message,
      action,
      actionId: f.actionId || null,
    });
  }
  return items;
}

/**
 * Recommended teacher actions (item 12) — config bo'yicha. Har bir action
 * `id`, `label` va optional `params` bilan keladi; ijro (assign practice,
 * intervention group yaratish va h.k.) UI/route tomonda.
 */
const ACTION_LABELS = Object.freeze({
  assign_practice: { label: 'Practice tayinlash' },
  create_intervention_group: { label: 'Intervention guruh yaratish' },
  create_redemption_session: { label: 'Redemption sessiya yaratish' },
  duplicate_cast_config: { label: 'Cast config nusxalash' },
  save_preset: { label: 'Preset saqlash' },
  export: { label: 'Hisobotni eksport qilish' },
});

export function recommendActions({ accuracy = {}, participation = {}, network = {} }) {
  const actions = [];
  const add = (id, reason) => actions.push({ id, label: ACTION_LABELS[id]?.label || id, reason });
  if (accuracy.accuracyPercent !== null && accuracy.accuracyPercent < 60) {
    add('assign_practice', 'Sinf accuracy past (60% dan kam)');
  }
  if ((participation.technical_failure || 0) >= 2 || (network.technicalFailures || 0) >= 2) {
    add('create_redemption_session', 'Tarmoq muammosi tufayli javob bera olmaganlar bor');
  }
  if (accuracy.accuracyPercent !== null && accuracy.accuracyPercent >= 60) {
    add('create_intervention_group', 'Ochilgan bo shliqlar bilan ishlash');
  }
  add('duplicate_cast_config', 'Keyingi sessiyaga tayyorlash');
  add('save_preset', 'Bu konfiguratsiyani qayta ishlatish');
  add('export', 'PDF/CSV chiqarish');
  return actions;
}

/**
 * Student private recap projection (item 13–15). Studentga faqat:
 * - own responses (ownAnswer records)
 * - approved explanations (teacher approved / confirmed misconception)
 * - next steps (practice suggestion)
 * Public low rank / leaderboard'ga bog'liq hech narsa YO'Q.
 */
export function projectStudentRecap({ participantId, answersByQuestion = {}, misconceptions = {}, questions = {}, accuracy = {} }) {
  const items = [];
  for (const [qid, byPid] of Object.entries(answersByQuestion || {})) {
    const rec = byPid?.[participantId];
    if (!rec) continue;
    const correct = rec.isCorrect || rec.status === 'CORRECT';
    let approvedExplanation = null;
    // Confirmed misconception bo'lsa — teacher explanation approved hisoblanadi
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
      nextStep: correct ? null : 'Ushbu savol bo yicha tushuntirishni ko rib chiqing',
    });
  }
  return {
    participantId,
    generatedAt: Date.now(),
    version: ACTION_PACK_VERSION,
    accuracy: accuracy,
    items,
  };
}

/**
 * Retention policy (item 17) — action-pack data class 180 kun REVIEW_OR_DELETE.
 * @returns {object} retention info + expiry boundary
 */
export function actionPackRetentionInfo({ dataLifecycle = {}, sessionEndedAt = Date.now() }) {
  const policy = resolveRetentionPolicy(dataLifecycle?.policyId, dataLifecycle?.classOverrides);
  const cls = policy?.classes?.[DATA_CLASSES.ACTION_PACK] || { days: 180, expiryAction: 'REVIEW_OR_DELETE' };
  const expiryAt = cls.days ? sessionEndedAt + cls.days * 24 * 3600 * 1000 : null;
  return { dataClass: DATA_CLASSES.ACTION_PACK, days: cls.days, expiryAction: cls.expiryAction, expiryAt };
}

/**
 * Config fingerprint (item 2) — session config snapshot hash'i reportga
 * yoziladi (policy pin bilan birga).
 */
export function fingerprintConfig(config = {}) {
  return hashConfig(config);
}

/**
 * Build full action pack for a session via a store adapter.
 * `store` kerakli usullar: getSessionMeta, getConfig, listParticipants,
 * getScores, getPublicQuestions, listAnswersForQuestion, getCardScans,
 * getNetworkSamples, listAudit, listFindings (ba'zilari optional).
 *
 * Misconceptions audit'dan o'qiladi (C3-05 director confirmed decision'lar
 * audit'ga yoziladi — `action: 'cast:misconceptionDecision'` yoki type field).
 */
export async function buildActionPackForSession(sessionId, store) {
  const meta = store.getSessionMeta ? await store.getSessionMeta(sessionId) : null;
  const config = store.getConfig ? await store.getConfig(sessionId) : {};
  const participants = store.listParticipants ? await store.listParticipants(sessionId) : {};
  const questions = store.getPublicQuestions ? await store.getPublicQuestions(sessionId) : {};
  const scores = store.getScores ? await store.getScores(sessionId) : {};

  // Answers: attempt 1 (first) va attempt 2 (revote) alohida
  const firstAnswers = {};
  const revoteAnswers = {};
  const answersByQuestion = {};
  const allQids = Object.keys(questions || {});
  for (const qid of allQids) {
    const first = store.listAnswersForQuestion ? await store.listAnswersForQuestion(sessionId, qid, 1) : {};
    const revote = store.listAnswersForQuestion ? await store.listAnswersForQuestion(sessionId, qid, 2) : {};
    firstAnswers[qid] = first;
    revoteAnswers[qid] = revote;
    answersByQuestion[qid] = { ...first };
  }

  // Network samples (C4-02 telemetry) — optional
  let network = {};
  if (store.getNetworkSamples) {
    try { network = await store.getNetworkSamples(sessionId); } catch (_) { network = {}; }
  }

  // Misconceptions from audit (director confirmed decisions)
  const misconceptions = {};
  if (store.listAudit) {
    try {
      const audits = await store.listAudit(sessionId);
      for (const a of Object.values(audits || {})) {
        if (a && (a.type === 'cast:misconceptionDecision' || a.action === 'cast:misconceptionDecision')) {
          const key = `${a.questionId || ''}`;
          misconceptions[key] = misconceptions[key] || {};
          misconceptions[key][a.optionId] = {
            misconceptionId: a.misconceptionId || null,
            confirmed: !!a.confirmed,
            teacherExplanation: a.teacherExplanation || null,
            at: a.at || null,
          };
        }
      }
    } catch (_) { /* non-critical */ }
  }

  // Quality-lab findings (item 11) — optional
  let findings = [];
  if (store.listFindings) {
    try { findings = await store.listFindings(sessionId); } catch (_) { findings = []; }
  }

  const participation = summarizeParticipation({ participants, answersByQuestion, config });
  const accuracy = summarizeAccuracy({ answersByQuestion });
  const hardest = identifyHardestQuestions({ answersByQuestion, questions });
  const misconceptionSummary = summarizeMisconceptions({ misconceptions, questions });
  const confidenceSummary = summarizeConfidence({ answersByQuestion });
  const revoteChanges = summarizeRevoteChanges({ firstAnswers, revoteAnswers });
  const networkSummary = summarizeNetwork({ network, participants });
  const itemActions = mapFindingsToItemActions({ findings });
  const recommendedActions = recommendActions({ accuracy, participation: participation.reasons, network: networkSummary });
  const retention = actionPackRetentionInfo({ dataLifecycle: config.dataLifecycle, sessionEndedAt: meta?.ended_at || Date.now() });
  const fingerprint = fingerprintConfig(config);

  // Transfer/redemption: hozircha audit'dan `transfer:*` actionlar (agar bor bo'lsa)
  let redemptions = {};
  if (store.listAudit) {
    try {
      const audits = await store.listAudit(sessionId);
      for (const a of Object.values(audits || {})) {
        if (a && String(a.action || '').startsWith('transfer:')) {
          redemptions[a.questionId || 'all'] = redemptions[a.questionId || 'all'] || {};
          redemptions[a.questionId || 'all'][a.participantId || '?'] = {
            applied: true,
            points: a.points || 0,
            reason: a.reason || null,
          };
        }
      }
    } catch (_) { /* non-critical */ }
  }
  const transferSummary = summarizeTransfers({ redemptions });

  return {
    sessionId,
    version: ACTION_PACK_VERSION,
    fingerprint,
    generatedAt: Date.now(),
    // Review fix (C5-01): `participation.rows` (raw participantId'lar) snapshot'ga
    // KIRMAYDI — faqat counts + coverage saqlanadi (private scope). Rows faqat
    // student recap uchun alohida hisoblanadi.
    participation: { total: participation.total, reasons: participation.reasons, coverage: participation.coverage },
    accuracy,
    hardestQuestions: hardest,
    misconceptions: misconceptionSummary,
    confidenceMatrix: confidenceSummary,
    revoteChanges,
    transferResults: transferSummary,
    networkSummary,
    itemQuality: itemActions,
    recommendedActions,
    retention,
    policyVersion: 1,
  };
}

export default {
  ACTION_PACK_VERSION,
  HARDEST_QUESTION_MIN_SAMPLE,
  ITEM_FLAG_ACTIONS,
  RECOMMENDED_ACTION_IDS,
  RECAP_ACTION_IDS,
  summarizeParticipation,
  summarizeAccuracy,
  identifyHardestQuestions,
  summarizeMisconceptions,
  summarizeConfidence,
  summarizeRevoteChanges,
  summarizeTransfers,
  summarizeNetwork,
  mapFindingsToItemActions,
  recommendActions,
  projectStudentRecap,
  actionPackRetentionInfo,
  fingerprintConfig,
  buildActionPackForSession,
};
