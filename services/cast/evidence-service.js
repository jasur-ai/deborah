/**
 * Edikit — Cast Evidence Service (C3-01)
 * --------------------------------------
 * Question lock'dan keyin teacher-private evidence hisoblaydi.
 * - Har bir ishtirokchi statusga ajratiladi: accepted / wrong / no_response /
 *   not_shown / late_join / disconnected / technical_failure / abstain.
 * - Numerator va denominator birga qaytadi (har foiz yonida count bor).
 * - Accuracy faqat accepted scorable responselardan hisoblanadi.
 * - Distractor distribution option ID bo'yicha.
 * - Confidence coverage alohida (C3-04 lens bilan to'ldiriladi).
 * - Tiny countlarda individual identity aggregate panelga chiqmaydi.
 * - First-vote (attemptNo=1) va revote (attemptNo=2) alohida snapshot.
 *
 * Ushbu service hech qachon public roomga yuborilmaydigan ma'lumotlarni
 * chiqaradi — projection faqat director private kanalida.
 */

import { getState, getConfig } from './session-store.js';
// C4-02: network/technical-failure classification (item 9) + coverage split (item 14)
// NOTE: delivery client-tomonidan e'lon qilinadi (advisory) — technical_failure
// hech qachon scoring/excusal emas; faqat telemetry hisobotida ishlatiladi.
import { classifyStatus, splitCoverageByDelivery } from './resilience-service.js';
// C4-03: paper-card not-scanned classification (item 10 — wrong EMAS)
import { classifyPaperStatus, CARD_EVIDENCE_UNIT } from './card-scan-service.js';

/**
 * Compute per-question evidence (teacher-private).
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.questionId
 * @param {number} input.attemptNo — 1 = first vote, 2 = revote
 * @param {object} input.participants — {pid: participant} (listParticipants)
 * @param {object} input.answers — {pid: answerRecord} (listAnswersForQuestion)
 * @param {object} [input.cardScans] — {cardId: scanRecord} (C4-03 paper mode)
 * @param {number} input.revision — current state revision
 * @returns {object} evidence contract (see plan C3-01)
 */
export function computeQuestionEvidence({ sessionId, questionId, attemptNo = 1, participants = {}, answers = {}, cardScans = {}, revision = 0 }) {
  const paperMode = Object.keys(cardScans || {}).length > 0 || Object.values(participants || {}).some((p) => p.cardId);
  const pids = Object.keys(participants || {});
  const eligible = pids.length;

  let active = 0;
  let accepted = 0;
  let correct = 0;
  let incorrect = 0;
  let noResponse = 0;
  let notShown = 0;
  let lateJoin = 0;
  let disconnected = 0;
  let technicalFailure = 0;
  let abstain = 0;
  let confidenceCoverage = 0;
  let elapsedSum = 0;
  let elapsedCount = 0;

  const distractorCounts = {}; // optionId -> count
  const responseTimes = []; // ms

  for (const pid of pids) {
    const p = participants[pid] || {};
    const ans = answers[pid];
    const online = p.presence !== 'offline';
    const hasAnswer = !!ans;

    if (online) active++;

    // ── Status classification ──
    if (hasAnswer) {
      accepted++;
      if (ans.isCorrect) correct++;
      else incorrect++;
      if (ans.elapsedMs !== undefined && ans.elapsedMs !== null) {
        responseTimes.push(ans.elapsedMs);
        elapsedSum += ans.elapsedMs;
        elapsedCount++;
      }
      if (ans.confidence !== undefined && ans.confidence !== null) confidenceCoverage++;
      for (const optId of ans.selectedOptionIds || []) {
        distractorCounts[optId] = (distractorCounts[optId] || 0) + 1;
      }
    } else if (paperMode) {
      // C4-03 (item 10): not-scanned → no_response (wrong deb BELGILANMAYDI).
      const status = classifyPaperStatus({ participant: p, scans: cardScans });
      if (status === 'not_scanned' || status === 'no_card') noResponse++;
      else { lateJoin++; notShown++; }
    } else {
      // C4-02 (item 9): technical failure vs no-response ALOHIDA.
      // Remote + degraded/poor network + no answer → technical_failure
      // (wrong answer EMAS). In-room + online + no answer → no_response.
      const status = classifyStatus({ participant: p, hasAnswer: false });
      if (status === 'late_join') { lateJoin++; notShown++; }
      else if (status === 'disconnected') disconnected++;
      else if (status === 'technical_failure') technicalFailure++;
      else noResponse++;
    }
  }

  // ── C4-02 (item 14): in-room / remote coverage split ──
  const coverageSplit = splitCoverageByDelivery(participants, answers);

  // ── Descriptive response-time aggregate ──
  const responseTime = describeResponseTimes(responseTimes);

  // ── Accuracy: faqat accepted scorable responselardan ──
  const scorable = correct + incorrect;
  const accuracyPercent = scorable > 0 ? Math.round((correct / scorable) * 100) : 0;

  // ── Distribution array (optionId + count + percent) ──
  const distribution = Object.entries(distractorCounts)
    .map(([optionId, count]) => ({
      optionId,
      count,
      percent: accepted > 0 ? Math.round((count / accepted) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    sessionId,
    questionId,
    attemptNo,
    revision,

    // ── Denominators (count bilan birga) ──
    eligible,
    active,
    shown: eligible - notShown,

    // ── Answer statuses ──
    accepted,
    correct,
    incorrect,
    noResponse,
    notShown,
    lateJoin,
    disconnected,
    technicalFailure,
    abstain,

    // ── Percentages (har biri count/denominator bilan) ──
    accuracyPercent,
    responseRate: eligible > 0 ? Math.round((accepted / eligible) * 100) : 0,
    participationPercent: eligible > 0 ? Math.round((active / eligible) * 100) : 0,

    // ── Per-option ──
    distribution,

    // ── Confidence (C3-04 lens bilan to'ldiriladi) ──
    confidenceCoverage,
    confidencePercent: accepted > 0 ? Math.round((confidenceCoverage / accepted) * 100) : 0,

    // ── Timing ──
    responseTime,

    // ── C4-02 (item 14): delivery coverage split ──
    deliverySplit: coverageSplit,

    // ── C4-03 (item 15): evidenceUnit — card_response paper mode'da ──
    evidenceUnit: paperMode ? CARD_EVIDENCE_UNIT : 'individual',

    // ── Privacy: tiny countlarda individual identity YO'Q ──
    // (aggregate panelda faqat sonlar; named drill-down alohida permission)
    namedDrilldownAvailable: false,
    computedAt: Date.now(),
  };
}

/**
 * Load participants + answers for a question and compute evidence.
 * Convenience wrapper for socket handlers.
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.questionId
 * @param {number} input.attemptNo
 * @param {import('./session-store.js')} store — injected store (test friendly)
 */
export async function buildQuestionEvidence({ sessionId, questionId, attemptNo = 1, store }) {
  const [participants, answers, state, cardScans] = await Promise.all([
    store.listParticipants(sessionId),
    store.listAnswersForQuestion(sessionId, questionId, attemptNo),
    store.getState(sessionId),
    store.getCardScans ? store.getCardScans(sessionId, questionId) : Promise.resolve({}),
  ]);
  return computeQuestionEvidence({
    sessionId,
    questionId,
    attemptNo,
    participants,
    answers,
    cardScans,
    revision: state?.revision || 0,
  });
}

/**
 * Descriptive response-time aggregate (count 0 bo'lsa null).
 */
export function describeResponseTimes(timesMs) {
  if (!timesMs || timesMs.length === 0) {
    return { count: 0, avgMs: null, medianMs: null, p90Ms: null, minMs: null, maxMs: null };
  }
  const sorted = [...timesMs].sort((a, b) => a - b);
  const n = sorted.length;
  const avg = sorted.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))];
  return {
    count: n,
    avgMs: Math.round(avg),
    medianMs: Math.round(median),
    p90Ms: Math.round(p90),
    minMs: sorted[0],
    maxMs: sorted[n - 1],
  };
}

/**
 * Director-private evidence event payload (socket `cast:evidence`).
 * Public roomga hech qachon yuborilmaydi.
 */
export function directorEvidenceEvent(evidence) {
  return {
    event: 'cast:evidence',
    data: evidence,
  };
}

/**
 * C3-03: Before/after vote-change matrix (first vote vs revote).
 * Change kodlari: WRONG_TO_CORRECT | CORRECT_TO_WRONG | WRONG_TO_WRONG | CORRECT_TO_CORRECT | NEW (revote-only) | MISSING (first-only).
 *
 * @param {object} firstVotes — listAnswersForQuestion(..., attemptNo=1)
 * @param {object} revotes — listAnswersForQuestion(..., attemptNo=2)
 * @returns {{ matrix: object, counts: object, changed: number, total: number }}
 */
export function computeVoteChangeMatrix(firstVotes = {}, revotes = {}) {
  const matrix = { WRONG_TO_CORRECT: 0, CORRECT_TO_WRONG: 0, WRONG_TO_WRONG: 0, CORRECT_TO_CORRECT: 0, NEW: 0, MISSING: 0 };
  const allPids = new Set([...Object.keys(firstVotes), ...Object.keys(revotes)]);
  let changed = 0;
  for (const pid of allPids) {
    const first = firstVotes[pid];
    const revote = revotes[pid];
    if (first && revote) {
      if (first.isCorrect && revote.isCorrect) matrix.CORRECT_TO_CORRECT++;
      else if (first.isCorrect && !revote.isCorrect) { matrix.CORRECT_TO_WRONG++; changed++; }
      else if (!first.isCorrect && revote.isCorrect) { matrix.WRONG_TO_CORRECT++; changed++; }
      else matrix.WRONG_TO_WRONG++;
    } else if (revote) {
      matrix.NEW++; // revote'da birinchi javob bergan (first'da yo'q edi)
    } else {
      matrix.MISSING++; // faqat first'da javob bergan
    }
  }
  return { matrix, counts: { ...matrix }, changed, total: allPids.size };
}

/**
 * First/revote evidence snapshot — alohida saqlanadi (C3-03 item 3).
 */
export function voteEvidenceSnapshot(firstEvidence, revoteEvidence) {
  return {
    firstVote: firstEvidence ? {
      accepted: firstEvidence.accepted,
      correct: firstEvidence.correct,
      incorrect: firstEvidence.incorrect,
      accuracyPercent: firstEvidence.accuracyPercent,
      distribution: firstEvidence.distribution,
    } : null,
    revote: revoteEvidence ? {
      accepted: revoteEvidence.accepted,
      correct: revoteEvidence.correct,
      incorrect: revoteEvidence.incorrect,
      accuracyPercent: revoteEvidence.accuracyPercent,
      distribution: revoteEvidence.distribution,
    } : null,
  };
}

export default { computeQuestionEvidence, buildQuestionEvidence, describeResponseTimes, directorEvidenceEvent, computeVoteChangeMatrix, voteEvidenceSnapshot };

