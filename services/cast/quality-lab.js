/**
 * Edikit — Cast Quality Lab (C3-15)
 * ----------------------------------
 * Preflight (test/session boshlanishidan oldin) va postflight (sessionʻdan
 * keyin) quality report. Findinglar severity + field path + question ID +
 * action ID bilan beriladi (item 11). Teacher accept/dismiss/resolve statusini
 * saqlaydi (item 12). Rehearsal report production natijadan alohida (item 13).
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CastError, CAST_ERROR_CODES } from './errors.js';
import { getConfig, getSessionMeta, getPublicQuestions, listAnswersForQuestion, listParticipants, getScores, getState } from './session-store.js';
import { QUALITY_ROOT } from './rehearsal-service.js';

// ── Finding contract (item 11) ──
export const FINDING_SEVERITIES = ['BLOCKER', 'WARNING', 'INFO'];
export const FINDING_STATUS = { OPEN: 'OPEN', ACCEPTED: 'ACCEPTED', DISMISSED: 'DISMISSED', RESOLVED: 'RESOLVED' };

export function buildFinding({ severity, code, fieldPath = null, questionId = null, message, actionId = null }) {
  return {
    findingId: 'find_' + crypto.randomBytes(6).toString('hex'),
    severity,
    code,
    fieldPath,
    questionId,
    actionId,
    message,
    status: FINDING_STATUS.OPEN,
    createdAt: Date.now(),
  };
}

// ── Supported question types (preflight) ──
const SUPPORTED_TYPES = new Set([
  'single_choice', 'true_false', 'multiple_select', 'short_answer', 'exit_ticket',
  'confidence', 'prediction', 'rating',
]);

// ── PREFLIGHT rules (item 9) ──
export function runPreflight({ publicQuestions = [], privateQuestions = [], config = {} }) {
  const findings = [];
  const pubById = new Map(publicQuestions.map((q) => [q.id, q]));
  const privById = new Map(privateQuestions.map((q) => [q.id, q]));

  // 1. ANSWER_KEY_PUBLIC — answer key public payloadʻda (BLOCKER)
  for (const [id, q] of pubById) {
    if (q.correctOptionIds || q.correctAnswer) {
      findings.push(buildFinding({
        severity: 'BLOCKER', code: 'ANSWER_KEY_PUBLIC', fieldPath: `questions.public.${id}`, questionId: id,
        message: `Public savol "${id}" answer keyʻni oshkor qilmoqda`, actionId: 'strip_key',
      }));
    }
  }

  // 2. MISSING_ANSWER — scored savolda toʻg'ri javob yoʻq (WARNING)
  for (const [id, q] of privById) {
    if (['single_choice', 'true_false', 'multiple_select'].includes(q.type)) {
      const has = Array.isArray(q.correctOptionIds) && q.correctOptionIds.length > 0;
      if (!has) {
        findings.push(buildFinding({
          severity: 'WARNING', code: 'MISSING_ANSWER', fieldPath: `questions.private.${id}.correctOptionIds`, questionId: id,
          message: `Savol "${id}" uchun toʻg'ri javob belgilanmagan`, actionId: 'set_answer',
        }));
      }
    }
  }

  // 3. UNSUPPORTED_TYPE (WARNING)
  for (const [id, q] of pubById) {
    if (!SUPPORTED_TYPES.has(q.type)) {
      findings.push(buildFinding({
        severity: 'WARNING', code: 'UNSUPPORTED_TYPE', fieldPath: `questions.public.${id}.type`, questionId: id,
        message: `Savol "${id}" turi qoʻllab-quvvatlanmaydi: ${q.type}`, actionId: 'change_type',
      }));
    }
  }

  // 4. NO_TIMER_FULLY_AUTO (BLOCKER)
  if (config?.choreography?.mode === 'fully_auto' || config?.mode === 'fully_auto') {
    const timer = config?.timer;
    if (!timer || !timer.defaultSeconds) {
      findings.push(buildFinding({
        severity: 'BLOCKER', code: 'NO_TIMER_FULLY_AUTO', fieldPath: 'config.timer',
        message: 'Fully-auto rejimda timer talab qilinadi', actionId: 'set_timer',
      }));
    }
  }

  // 5. SHORT_TIMER_LONG_STEM (WARNING)
  const defaultSeconds = config?.timer?.defaultSeconds || 30;
  for (const [id, q] of pubById) {
    const stem = String(q.text || '').length;
    if (defaultSeconds < 20 && stem > 200) {
      findings.push(buildFinding({
        severity: 'WARNING', code: 'SHORT_TIMER_LONG_STEM', fieldPath: `questions.public.${id}.text`, questionId: id,
        message: `Savol "${id}" uzoq matn (${stem} belgi) lekin timer juda qisqa (${defaultSeconds}s)`, actionId: 'lengthen_timer',
      }));
    }
  }

  // 6. PUBLIC_FULL_LEADERBOARD (WARNING)
  if (config?.leaderboard?.mode === 'full' && config?.leaderboard?.visibility === 'public') {
    findings.push(buildFinding({
      severity: 'WARNING', code: 'PUBLIC_FULL_LEADERBOARD', fieldPath: 'config.leaderboard.visibility',
      message: 'To\u02bblik leaderboard public — o\u02bbquvchilar reytingni ko\u02bbradi', actionId: 'restrict_leaderboard',
    }));
  }

  // 7. MUSIC_READING_HEAVY (INFO)
  const avgStem = publicQuestions.length ? publicQuestions.reduce((s, q) => s + String(q.text || '').length, 0) / publicQuestions.length : 0;
  if (avgStem > 150 && publicQuestions.length >= 10) {
    findings.push(buildFinding({
      severity: 'INFO', code: 'MUSIC_READING_HEAVY', fieldPath: 'questions',
      message: 'Matn oʻqish ogʻir — musiqali muhitda diqqat yoʻqolishi mumkin', actionId: 'simplify_stems',
    }));
  }

  // 8. MISSING_EXPLANATION (INFO)
  for (const [id, q] of privById) {
    if (['single_choice', 'true_false', 'multiple_select'].includes(q.type) && !q.explanation) {
      findings.push(buildFinding({
        severity: 'INFO', code: 'MISSING_EXPLANATION', fieldPath: `questions.private.${id}.explanation`, questionId: id,
        message: `Savol "${id}" uchun izoh (explanation) yoʻq`, actionId: 'add_explanation',
      }));
    }
  }

  // 9. CONTRAST_MEDIA_ACCESSIBILITY (WARNING)
  const acc = config?.accessibility || {};
  if (acc.contrast !== 'high' && publicQuestions.some((q) => (q.media && q.media.type === 'image') || q.text?.includes('![image'))) {
    findings.push(buildFinding({
      severity: 'WARNING', code: 'CONTRAST_MEDIA_ACCESSIBILITY', fieldPath: 'config.accessibility.contrast',
      message: 'Media kontent bor, lekin yuqori kontrast yoqilmagan', actionId: 'enable_contrast',
    }));
  }

  return findings;
}

// ── POSTFLIGHT rules (item 10) ──
export function runPostflight({ config = {}, answersByQuestion = {}, participants = {}, scores = {}, signals = [], events = [] }) {
  const findings = [];
  const totalParticipants = Object.keys(participants).length;
  const allAnswers = Object.values(answersByQuestion).flatMap((byPid) =>
    Object.values(byPid).map((rec) => ({ ...rec }))
  );

  // 1. TIMEOUT_RATE_HIGH (WARNING) — javoblar qancha qismi timer oxiriga yaqin
  let closeToTimeout = 0;
  for (const byPid of Object.values(answersByQuestion)) {
    for (const rec of Object.values(byPid)) {
      if (rec.submittedAt && rec.closesAt) {
        const pct = (rec.closesAt - rec.submittedAt) / Math.max(1, rec.closesAt - rec.openedAt);
        if (pct < 0.1) closeToTimeout++;
      }
    }
  }
  if (allAnswers.length > 5 && closeToTimeout / allAnswers.length > 0.4) {
    findings.push(buildFinding({
      severity: 'WARNING', code: 'TIMEOUT_RATE_HIGH', fieldPath: 'responses',
      message: `${Math.round((closeToTimeout / allAnswers.length) * 100)}% javob timer tugashiga yaqin yuborilgan`,
      actionId: 'lengthen_timer',
    }));
  }

  // 2. DELIVERY_LATENCY_HIGH (WARNING) — javob yuborish orasidagi kechikish (heuristic)
  const latencies = allAnswers.filter((a) => a.openedAt && a.submittedAt).map((a) => a.submittedAt - a.openedAt);
  if (latencies.length > 5) {
    const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
    const defaultSeconds = config?.timer?.defaultSeconds || 30;
    if (avg > defaultSeconds * 1000 * 0.9) {
      findings.push(buildFinding({
        severity: 'WARNING', code: 'DELIVERY_LATENCY_HIGH', fieldPath: 'responses',
        message: `Oʻrtacha javob kechikishi ${Math.round(avg / 1000)}s — timer ${defaultSeconds}s`, actionId: 'increase_timer',
      }));
    }
  }

  // 3. AUTO_CLOSE_READINESS (INFO)
  if (config?.timer?.mode === 'soft' && closeToTimeout / Math.max(1, allAnswers.length) > 0.25) {
    findings.push(buildFinding({
      severity: 'INFO', code: 'AUTO_CLOSE_READINESS', fieldPath: 'config.timer.mode',
      message: 'Koʻplab javoblar oxirgi daqiqada — auto-close rejimini koʻrib chiqing', actionId: 'switch_hard_timer',
    }));
  }

  // 4. DOMINANT_DISTRACTOR (WARNING) — bitta notoʻg'ri variant dominant
  for (const [qid, byPid] of Object.entries(answersByQuestion)) {
    const counts = {};
    for (const rec of Object.values(byPid)) {
      for (const id of rec.selectedOptionIds || []) counts[id] = (counts[id] || 0) + 1;
    }
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    if (total >= 6) {
      for (const [optId, c] of Object.entries(counts)) {
        if (c / total > 0.5) {
          findings.push(buildFinding({
            severity: 'WARNING', code: 'DOMINANT_DISTRACTOR', fieldPath: `questions.private.${qid}.options.${optId}`, questionId: qid,
            message: `Variant "${optId}" dominant distractor (${Math.round((c / total) * 100)}%)`, actionId: 'revise_option',
          }));
        }
      }
    }
  }

  // 5. REVOTE_GAIN_LOW (INFO) — revote natijasi bir xil boʻlsa
  const voteRounds = new Set(allAnswers.map((a) => a.attemptNo || 1));
  if (voteRounds.size >= 2) {
    findings.push(buildFinding({
      severity: 'INFO', code: 'REVOTE_GAIN_LOW', fieldPath: 'responses.voteRound',
      message: 'Qayta ovoz berish natijasi muhim oʻzgarmagan (muhokama samaradorligini tekshiring)', actionId: 'review_discussion',
    }));
  }

  // 6. HIGH_CONFIDENCE_WRONG (WARNING) — ishonchli lekin notoʻg'ri
  let highConfWrong = 0;
  for (const byPid of Object.values(answersByQuestion)) {
    for (const rec of Object.values(byPid)) {
      if (rec.confidence === 'high' && rec.status === 'WRONG') highConfWrong++;
    }
  }
  if (highConfWrong >= 3) {
    findings.push(buildFinding({
      severity: 'WARNING', code: 'HIGH_CONFIDENCE_WRONG', fieldPath: 'responses.confidence',
      message: `${highConfWrong} ta yuqori ishonchli javob notoʻg'ri — tushunmovchilik keng`, actionId: 'clarify_concept',
    }));
  }

  // 7. PARTICIPANT_COVERAGE_LOW (WARNING)
  const answered = new Set(allAnswers.map((a) => a.participantId)).size;
  if (totalParticipants >= 5 && answered / totalParticipants < 0.7) {
    findings.push(buildFinding({
      severity: 'WARNING', code: 'PARTICIPANT_COVERAGE_LOW', fieldPath: 'roster',
      message: `Qatnashuv past: ${answered}/${totalParticipants} javob berdi`, actionId: 'improve_engagement',
    }));
  }

  // 8. AUDIO_MUTE (INFO) — audio/background signal (signalsʻdan)
  const audioSignals = (signals || []).filter((s) => /audio|sound|mute|bgm/i.test(s?.code || ''));
  if (audioSignals.length > 0) {
    findings.push(buildFinding({
      severity: 'INFO', code: 'AUDIO_MUTE', fieldPath: 'signals.audio',
      message: `${audioSignals.length} ta audio/ovoz signali aniqlandi`, actionId: 'check_audio',
    }));
  }

  // 9. HOST_INTERVENTION (INFO) — koʻp pauza/vaqt qoʻshish
  const pauses = (events || []).filter((e) => /pause|addTime|extend/i.test(e?.type || '')).length;
  if (pauses >= 3) {
    findings.push(buildFinding({
      severity: 'INFO', code: 'HOST_INTERVENTION', fieldPath: 'events',
      message: `${pauses} marta pauza/vaqt aralashuvi — pacing rejani tekshiring`, actionId: 'adjust_pacing',
    }));
  }

  return findings;
}

// ── Postflight async wrapper (sessionʻdan oʻqiydi) ──
export async function runPostflightForSession(sessionId) {
  const meta = await getSessionMeta(sessionId);
  if (!meta) throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Sessiya topilmasi');
  const config = await getConfig(sessionId);
  const participants = await listParticipants(sessionId);
  const scores = await getScores(sessionId);
  const state = await getState(sessionId);

  const questions = await getPublicQuestions(sessionId);
  const answersByQuestion = {};
  for (const qid of Object.keys(questions || {})) {
    const byPid = await listAnswersForQuestion(sessionId, qid, 1);
    answersByQuestion[qid] = { ...byPid };
  }

  const findings = runPostflight({ config, answersByQuestion, participants, scores, signals: [], events: [] });
  await persistFindings(sessionId, 'postflight', findings);
  return findings;
}

// ── Storage (item 13: report productionʻdan alohida) ──
export async function persistFindings(sessionId, kind, findings) {
  const root = `${QUALITY_ROOT(sessionId)}/findings`;
  for (const f of findings) {
    await fb.set(`${root}/${f.findingId}`, { ...f, kind, sessionId });
  }
  await fb.set(`${QUALITY_ROOT(sessionId)}/${kind}_report`, {
    kind,
    sessionId,
    createdAt: Date.now(),
    findings: findings.map((f) => f.findingId),
    counts: {
      BLOCKER: findings.filter((f) => f.severity === 'BLOCKER').length,
      WARNING: findings.filter((f) => f.severity === 'WARNING').length,
      INFO: findings.filter((f) => f.severity === 'INFO').length,
    },
  });
}

export async function listFindings(sessionId) {
  const snap = await fb.get(`${QUALITY_ROOT(sessionId)}/findings`);
  return snap.exists() ? snap.val() : {};
}

export async function getFinding(sessionId, findingId) {
  const snap = await fb.get(`${QUALITY_ROOT(sessionId)}/findings/${findingId}`);
  return snap.exists() ? snap.val() : null;
}

/** Teacher accept/dismiss/resolve (item 12). */
export async function updateFindingStatus(sessionId, findingId, status, by = null) {
  if (!FINDING_STATUS[status]) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, `Nomaʻlum status: ${status}`);
  }
  const finding = await getFinding(sessionId, findingId);
  if (!finding) throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Finding topilmadi');
  const now = Date.now();
  const updated = {
    ...finding,
    status,
    updatedAt: now,
    updatedBy: by,
    // RESOLVED bo'lganda faqat resolvedAt yoziladi
    ...(status === 'RESOLVED' ? { resolvedAt: now, resolvedBy: by } : { resolvedAt: null, resolvedBy: null }),
  };
  await fb.set(`${QUALITY_ROOT(sessionId)}/findings/${findingId}`, updated);
  return updated;
}

export function buildReport(findings) {
  return {
    total: findings.length,
    bySeverity: {
      BLOCKER: findings.filter((f) => f.severity === 'BLOCKER').length,
      WARNING: findings.filter((f) => f.severity === 'WARNING').length,
      INFO: findings.filter((f) => f.severity === 'INFO').length,
    },
    byStatus: {
      OPEN: findings.filter((f) => f.status === 'OPEN').length,
      ACCEPTED: findings.filter((f) => f.status === 'ACCEPTED').length,
      DISMISSED: findings.filter((f) => f.status === 'DISMISSED').length,
      RESOLVED: findings.filter((f) => f.status === 'RESOLVED').length,
    },
  };
}

export default {
  FINDING_SEVERITIES,
  FINDING_STATUS,
  buildFinding,
  runPreflight,
  runPostflight,
  runPostflightForSession,
  persistFindings,
  listFindings,
  getFinding,
  updateFindingStatus,
  buildReport,
};
