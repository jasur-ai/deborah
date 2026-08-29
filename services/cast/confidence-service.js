/**
 * Deborah — Cast Confidence Lens (C3-04)
 * -------------------------------------
 * Selected questionlarda answer bilan confidence (low/medium/high) yig'iladi
 * va private aggregate matrix yaratiladi (teacher-director kanali).
 *
 * Qoidalar:
 * - Confidence grade/score/rankga TA'SIR QILMAYDI (faqat o'rganish telemetry).
 * - Missing confidence wrong deb hisoblanmaydi — coverage alohida.
 * - Individual confidence projector va leaderboardga CHIQMAYDI.
 * - First va revote confidence alohida saqlanadi (attemptNo bo'yicha).
 * - Tiny cohortda matrix cell suppression (cell < minCellCount → masked).
 */

import { CAST_CONFIDENCE_LEVEL } from '../../utils/cast-constants.js';

/** Default minimum cell count before suppression. */
export const MIN_CELL_COUNT = 3;

/** Valid confidence levels. */
export const CONFIDENCE_LEVELS = Object.values(CAST_CONFIDENCE_LEVEL);

/**
 * Validate + normalize a confidence value.
 * @param {unknown} raw
 * @returns {string|null} 'low' | 'medium' | 'high' | null
 */
export function normalizeConfidence(raw) {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).toLowerCase();
  return CONFIDENCE_LEVELS.includes(v) ? v : null;
}

/**
 * Compute confidence × correctness aggregate matrix (teacher-private).
 *
 * @param {object} answers — listAnswersForQuestion result {pid: answerRecord}
 * @param {object} opts
 * @param {number} [opts.minCellCount] — suppression threshold (default 3)
 * @returns {{
 *   coverage: number,
 *   coveragePercent: number,
 *   correctHigh: number,
 *   correctLowOrMedium: number,
 *   wrongHigh: number,
 *   wrongLowOrMedium: number,
 *   missingConfidence: number,
 *   matrix: Array<{confidence:string, correct:number, wrong:number}>,
 *   suppressed: boolean,
 *   minCellCount: number
 * }}
 */
export function computeConfidenceMatrix(answers = {}, opts = {}) {
  const minCellCount = opts.minCellCount ?? MIN_CELL_COUNT;
  const rows = {
    [CAST_CONFIDENCE_LEVEL.HIGH]: { correct: 0, wrong: 0 },
    [CAST_CONFIDENCE_LEVEL.MEDIUM]: { correct: 0, wrong: 0 },
    [CAST_CONFIDENCE_LEVEL.LOW]: { correct: 0, wrong: 0 },
  };
  let coverage = 0;
  let missingConfidence = 0;

  for (const rec of Object.values(answers)) {
    const conf = normalizeConfidence(rec.confidence);
    if (!conf) {
      missingConfidence++;
      continue; // missing confidence wrong deb hisoblanmaydi
    }
    coverage++;
    const cell = rows[conf];
    if (rec.isCorrect) cell.correct++;
    else cell.wrong++;
  }

  const totalWithConf = coverage;
  const matrix = Object.entries(rows)
    .filter(([, c]) => c.correct + c.wrong > 0)
    .map(([confidence, c]) => ({ confidence, correct: c.correct, wrong: c.wrong }));

  const correctHigh = rows[CAST_CONFIDENCE_LEVEL.HIGH].correct;
  const wrongHigh = rows[CAST_CONFIDENCE_LEVEL.HIGH].wrong;
  const correctLowOrMedium =
    rows[CAST_CONFIDENCE_LEVEL.LOW].correct + rows[CAST_CONFIDENCE_LEVEL.MEDIUM].correct;
  const wrongLowOrMedium =
    rows[CAST_CONFIDENCE_LEVEL.LOW].wrong + rows[CAST_CONFIDENCE_LEVEL.MEDIUM].wrong;

  // Tiny cohort suppression: har bir cell kamida minCellCount bo'lishi kerak,
  // aks holda individual identifikatsiya xavfi bor → maskalanadi.
  const hasSmallCell = matrix.some((c) => c.correct < minCellCount || c.wrong < minCellCount);
  const suppressed = matrix.length > 0 && hasSmallCell;

  return {
    coverage,
    coveragePercent: totalWithConf > 0 ? Math.round((totalWithConf / Math.max(1, Object.keys(answers).length)) * 100) : 0,
    correctHigh,
    correctLowOrMedium,
    wrongHigh,
    wrongLowOrMedium,
    missingConfidence,
    matrix,
    suppressed,
    minCellCount,
  };
}

/**
 * Director-private confidence event payload (socket `cast:confidenceUpdated`).
 * Faqat director room'ga yuboriladi.
 */
export function directorConfidenceEvent(matrix) {
  return { event: 'cast:confidenceUpdated', data: matrix };
}

export default { normalizeConfidence, computeConfidenceMatrix, directorConfidenceEvent, MIN_CELL_COUNT };
