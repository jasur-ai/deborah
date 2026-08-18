/**
 * Edikit — Cast Psychometric-safe Metrics Service (C5-03)
 * --------------------------------------------------------
 * Report metrikalari hech qachon faqat percent bo'lib chiqmaydi — har doim
 * numerator + denominator bilan. Kichik namunalar suppress qilinadi,
 * `INSUFFICIENT_EVIDENCE` statusi qo'shiladi.
 *
 * Contract:
 *   { metric, numerator, denominator, percent, status, interval? }
 *
 * Status'lar:
 *   VALID_DESCRIPTIVE  — enough evidence, descriptive-only
 *   INSUFFICIENT_EVIDENCE — sample past threshold
 *   TINY_SUBGROUP      — subgroup juda kichik (de-identified)
 */

export const METRICS_VERSION = 'metrics_v1';

/** Small sample threshold — item discrimination/item stats uchun. */
export const SMALL_SAMPLE_THRESHOLD = 6;
/** Tiny subgroup threshold — de-identifikatsiya (item 16). */
export const TINY_SUBGROUP_THRESHOLD = 3;
/** Item discrimination minimum sample. */
export const DISCRIMINATION_MIN_SAMPLE = 10;

export const METRIC_STATUS = Object.freeze({
  VALID_DESCRIPTIVE: 'VALID_DESCRIPTIVE',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  TINY_SUBGROUP: 'TINY_SUBGROUP',
});

export const MISSING_STATUSES = Object.freeze([
  'wrong',
  'no_response',
  'late_join',
  'disconnected',
  'technical_failure',
  'abstain',
]);

/** Percent rounding — integer (item 2: decimal percent UI'da integer/policy). */
export function roundPercent(value, policy = 'integer') {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (policy === 'one_decimal') return Math.round(value * 10) / 10;
  return Math.round(value);
}

/**
 * Basic metric — numerator + denominator + integer percent (item 1, 2).
 * @param {object} input
 * @param {string} input.metric
 * @param {number} input.numerator
 * @param {number} input.denominator
 * @param {string} [input.rounding] — 'integer' | 'one_decimal'
 * @returns {object} metric contract
 */
export function buildMetric({ metric, numerator = 0, denominator = 0, rounding = 'integer' }) {
  const percent = denominator > 0 ? roundPercent((numerator / denominator) * 100, rounding) : null;
  return {
    metric,
    numerator,
    denominator,
    percent,
    status: METRIC_STATUS.VALID_DESCRIPTIVE,
  };
}

/**
 * Small sample guard (item 4, 5) — `INSUFFICIENT_EVIDENCE` qo'shadi.
 * Item discrimination kabi metrikalar uchun — SMALL_SAMPLE_THRESHOLD'dan past.
 */
export function withEvidenceGuard(metric, { minSample = SMALL_SAMPLE_THRESHOLD } = {}) {
  if (metric.denominator < minSample) {
    return {
      ...metric,
      status: METRIC_STATUS.INSUFFICIENT_EVIDENCE,
      // Ko'rsatish mumkin emas (hech qanday qiymat yo'q)
      numerator: null,
      denominator: null,
      percent: null,
    };
  }
  return metric;
}

/**
 * Wilson score interval (item 6) — aggregate report'ga optional qo'shiladi.
 * z = 1.96 → 95% interval. denominator < minSample bo'lsa null.
 * @param {number} numerator
 * @param {number} denominator
 * @param {number} z
 * @returns {{low:number, high:number}|null} — percent (0..100)
 */
export function wilsonInterval(numerator = 0, denominator = 0, z = 1.96) {
  if (denominator <= 0) return null;
  const p = numerator / denominator;
  const z2 = z * z;
  const denom = 1 + z2 / denominator;
  const center = (p + z2 / (2 * denominator)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator)) / denom;
  return {
    low: Math.max(0, Math.round((center - margin) * 1000) / 10),
    high: Math.min(100, Math.round((center + margin) * 1000) / 10),
  };
}

/**
 * Tiny subgroup suppress (item 16) — 3 yoki undan kam participant bo'lgan
 * subgroup metriclari maskalanadi (de-identifikatsiya).
 * Review fix (C5-03): `withEvidenceGuard` denominator'ni null qilib qo'ysa
 * bu check no-op bo'lmasligi uchun — null denominator'da ham TINY hisoblanadi.
 */
export function suppressTinySubgroup(metric, { minCount = TINY_SUBGROUP_THRESHOLD } = {}) {
  const d = metric.denominator;
  if (d === null || d === undefined || d < minCount) {
    return { ...metric, status: METRIC_STATUS.TINY_SUBGROUP, percent: null };
  }
  return metric;
}

/**
 * Combined guard (review fix): evidence guard + tiny subgroup birgalikda.
 * Kichik denominator → INSUFFICIENT_EVIDENCE, null/0 → TINY_SUBGROUP emas
 * (0 ma'lumot yo'q degani). Ishlatish tartibiga bog'liq emas.
 * @returns {object} metric — eng muhim status yutadi
 */
export function guardedMetric(metric, { minSample = SMALL_SAMPLE_THRESHOLD, tinyCount = TINY_SUBGROUP_THRESHOLD } = {}) {
  if (metric.denominator === 0) return withEvidenceGuard(metric, { minSample });
  if (metric.denominator < tinyCount) return suppressTinySubgroup(metric, { minCount: tinyCount });
  if (metric.denominator < minSample) return withEvidenceGuard(metric, { minSample });
  return metric;
}

/**
 * Missing status distribution (item 3) — wrong, no-response, late-join,
 * disconnected, technical-failure va abstain alohida saqlanadi.
 * @param {object} input
 * @param {object} input.participants — {pid: participant}
 * @param {object} input.answersByQuestion — {qid: {pid: rec}}
 * @param {object} [input.options] — { minSample } evidence guard uchun
 * @returns {object}
 */
export function summarizeMissingStatuses({ participants = {}, answersByQuestion = {}, options = {} }) {
  const answered = new Set();
  for (const byPid of Object.values(answersByQuestion || {})) {
    for (const pid of Object.keys(byPid || {})) answered.add(pid);
  }
  const counts = { wrong: 0, no_response: 0, late_join: 0, disconnected: 0, technical_failure: 0, abstain: 0 };
  for (const [pid, p] of Object.entries(participants || {})) {
    const hasAnswer = answered.has(pid);
    if (hasAnswer) {
      // Answer bor — to'g'ri/noto'g'ri hisoblash uchun butun sessiyada qaraymiz
      continue;
    }
    if (p.abstained) counts.abstain++;
    else if (p.late) counts.late_join++;
    else if (p.presence === 'offline') counts.disconnected++;
    else if (p.delivery === 'remote' && ['poor', 'degraded'].includes(p.networkBucket)) counts.technical_failure++;
    else counts.no_response++;
  }
  // Wrong count — accepted lekin noto'g'ri
  for (const byPid of Object.values(answersByQuestion || {})) {
    for (const rec of Object.values(byPid || {})) {
      if (rec && !(rec.isCorrect || rec.status === 'CORRECT')) counts.wrong++;
    }
  }
  const total = Object.keys(participants || {}).length;
  const missing = total - answered.size;
  // Review fix (C5-03): percent endi hisoblanadi (integer), numerator/
  // denominator semantic — qatnashmagan participantlar ulushi.
  const metric = {
    metric: 'missing_status',
    numerator: missing,
    denominator: total,
    percent: total > 0 ? roundPercent((missing / total) * 100) : null,
    counts,
  };
  const guard = withEvidenceGuard(metric, { minSample: options.minSample || SMALL_SAMPLE_THRESHOLD });
  return { ...guard, counts };
}

/**
 * Item discrimination (item 4) — small sample ostida ko'rsatilmaydi.
 * Upper-lower index: yuqori 27% vs past 27% to'g'ri javob farqi.
 * @param {object} input
 * @param {Array<{participantId:string, score:number, correct:boolean}>} input.rows
 * @returns {object} metric contract
 */
export function itemDiscrimination({ rows = [] }) {
  const valid = (rows || []).filter((r) => r && typeof r.correct === 'boolean');
  const metric = {
    metric: 'discrimination',
    numerator: null,
    denominator: valid.length,
    percent: null,
    status: METRIC_STATUS.VALID_DESCRIPTIVE,
    index: null,
  };
  if (valid.length < DISCRIMINATION_MIN_SAMPLE) {
    return withEvidenceGuard(metric, { minSample: DISCRIMINATION_MIN_SAMPLE });
  }
  const sorted = [...valid].sort((a, b) => (b.score || 0) - (a.score || 0));
  const k = Math.max(1, Math.floor(sorted.length * 0.27));
  const upper = sorted.slice(0, k);
  const lower = sorted.slice(-k);
  const upperCorrect = upper.filter((r) => r.correct).length / upper.length;
  const lowerCorrect = lower.filter((r) => r.correct).length / lower.length;
  metric.index = Math.round((upperCorrect - lowerCorrect) * 1000) / 1000;
  return metric;
}

export default {
  METRICS_VERSION,
  SMALL_SAMPLE_THRESHOLD,
  TINY_SUBGROUP_THRESHOLD,
  DISCRIMINATION_MIN_SAMPLE,
  METRIC_STATUS,
  MISSING_STATUSES,
  roundPercent,
  buildMetric,
  withEvidenceGuard,
  guardedMetric,
  wilsonInterval,
  suppressTinySubgroup,
  summarizeMissingStatuses,
  itemDiscrimination,
};
