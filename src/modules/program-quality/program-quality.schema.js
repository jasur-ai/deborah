/**
 * Edikit — Program Quality & Accreditation Workspace (pure logic)
 *
 * Prompt 62 — curriculum map, aggregate evidence, finding va improvement
 * action workflow (research.md §56). This module is PURE (no I/O, no DB):
 *
 *   - IRMA levels: Introduced / Reinforced / Mastered / Assessed.
 *   - computeCurriculumGaps: unmapped outcomes, over-assessed cells,
 *     I/R/M/A coverage report — version-aware.
 *   - applyCellSuppression: aggregate cell sample_size < min_cell_size →
 *     observed_pct null (suppressed), never leaks small-sample truth.
 *   - assertNoTeacherLeaderboard: individual teacher punishment leaderboard
 *     defaultda mavjud emas — aggregate queries hech qachon teacher-level
 *     ranking qaytarmaydi.
 *   - assertNoRawPiiInAggregate: raw student PII aggregate UIga chiqmaydi —
 *     faqat anonymized sample meta.
 *   - evaluateFinding / transitionFindingStatus: finding FSM.
 *   - assertActionClose: action owner/deadline + follow-up evidence'siz
 *     close bo'lmaydi (close blocker).
 *   - assertFollowUpDecision: effective/insufficient/confounded validation.
 *   - buildExportManifest + verifyExportManifest: reproducible manifest/hash.
 *
 * SECURITY / DATA GUARD (Prompt 62 §15, §56.5):
 *   - Teacher punishment leaderboard yo'q; raw PII aggregate'ga chiqmaydi;
 *     action evidence'siz yopilmaydi.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** I/R/M/A curriculum map levels. */
export const IRMA_LEVELS = ['introduced', 'reinforced', 'mastered', 'assessed'];

export const MAP_STATUS = { DRAFT: 'draft', REVIEW: 'review', PUBLISHED: 'published', ARCHIVED: 'archived' };

/** Curriculum map status FSM (version history). */
export const MAP_TRANSITIONS = {
  draft: ['review', 'published'],
  review: ['draft', 'published'],
  published: ['archived'],
  archived: [],
};

export const FINDING_STATUS = { OPEN: 'open', IN_PROGRESS: 'in_progress', RESOLVED: 'resolved' };

export const ACTION_STATUS = { OPEN: 'open', IN_PROGRESS: 'in_progress', VERIFICATION: 'verification', CLOSED: 'closed' };

export const EVIDENCE_TYPES = ['direct', 'indirect'];

export const FOLLOW_UP_DECISIONS = ['effective', 'insufficient', 'confounded'];

export const DEFAULT_MIN_CELL_SIZE = 5;

// ═══════════════════════════════════════════════════════════════════
// CURRICULUM GAP ANALYSIS (version-aware)
// ═══════════════════════════════════════════════════════════════════

/**
 * Curriculum gap report: qaysi program outcomes hech bir course'da
 * introduced/assessed emas (unmapped), qaysi outcome haddan tashqari ko'p
 * course'da assessed (over-assessed), va I/R/M/A coverage har outcome uchun.
 *
 * @param {Object} opts
 *   outcomes: [{ id, code, name }]
 *   entries:  [{ course_id, course_code, outcome_id, irma_level, assessment_points }]
 */
export function computeCurriculumGaps({ outcomes = [], entries = [] } = {}) {
  const mapped = new Map(); // outcomeId -> { courses, assessedCourses, assessmentPoints }
  for (const e of entries) {
    const oid = e.outcome_id;
    const cur = mapped.get(oid) || { courses: 0, assessedCourses: 0, assessmentPoints: 0, levels: new Set() };
    cur.courses += 1;
    cur.assessmentPoints += Number(e.assessment_points || 0);
    cur.levels.add(e.irma_level);
    if (e.irma_level === 'assessed') cur.assessedCourses += 1;
    mapped.set(oid, cur);
  }

  const gaps = [];
  for (const o of outcomes) {
    const m = mapped.get(o.id);
    if (!m) {
      gaps.push({ outcomeId: o.id, code: o.code, name: o.name, kind: 'unmapped', detail: 'outcome mapped to no course' });
      continue;
    }
    if (!m.levels.has('introduced')) {
      gaps.push({ outcomeId: o.id, code: o.code, name: o.name, kind: 'missing_introduction', detail: 'no course introduces this outcome' });
    }
    if (!m.levels.has('assessed')) {
      gaps.push({ outcomeId: o.id, code: o.code, name: o.name, kind: 'missing_assessment', detail: 'outcome is never formally assessed for program evidence' });
    }
    if (m.assessedCourses > 1) {
      gaps.push({ outcomeId: o.id, code: o.code, name: o.name, kind: 'over_assessed', detail: `assessed in ${m.assessedCourses} courses (redundant assessment)` });
    }
  }

  return {
    ok: true,
    gaps,
    summary: {
      totalOutcomes: outcomes.length,
      unmapped: gaps.filter((g) => g.kind === 'unmapped').length,
      missingIntroduction: gaps.filter((g) => g.kind === 'missing_introduction').length,
      missingAssessment: gaps.filter((g) => g.kind === 'missing_assessment').length,
      overAssessed: gaps.filter((g) => g.kind === 'over_assessed').length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// CELL SUPPRESSION (minimum cell size)
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimum cell suppression: sample_size < min_cell_size bo'lgan aggregate
 * cell'ning observed_pct qiymati null qilinadi (suppressed) — kichik
 * namunada shaxsni aniqlash mumkin bo'lgan haqiqat sizib chiqmasligi uchun.
 */
export function applyCellSuppression({ observedPct = null, sampleSize = 0, minCellSize = DEFAULT_MIN_CELL_SIZE } = {}) {
  const threshold = Math.max(Number(minCellSize) || DEFAULT_MIN_CELL_SIZE, 1);
  if (Number(sampleSize) < threshold) {
    return { suppressed: true, observedPct: null, reason: `cell below minimum size (${sampleSize} < ${threshold})` };
  }
  return { suppressed: false, observedPct: Number(observedPct), reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// SECURITY GUARDS (§15, §56.5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Guard: individual teacher punishment leaderboard defaultda mavjud emas.
 * Outcome data teacher ranking yoki avtomatik performance sanction uchun
 * ishlatilmaydi. Har qanday teacher-level ranking request rad etiladi.
 */
export function assertNoTeacherLeaderboard({ includeTeacherRanking = false, teacherId = null } = {}) {
  if (includeTeacherRanking || teacherId) {
    return { ok: false, reason: 'individual teacher ranking is not permitted by default — outcome data is cohort/curriculum level (§56.5)' };
  }
  return { ok: true };
}

/**
 * Guard: sensitive raw PII aggregate UIga chiqmaydi. Aggregate payload
 * faqat anonymized sample meta bo'lishi kerak — student name/email/ID yoki
 * raw submission HECH QACHON aggregate'ga chiqmaydi.
 */
export function assertNoRawPiiInAggregate({ payload = {}, piiKeys = ['studentName', 'studentEmail', 'studentId', 'submission', 'promptLog', 'rawText'] } = {}) {
  const leaked = piiKeys.filter((k) => payload[k] !== undefined || (payload.aggregateMeta && payload.aggregateMeta[k] !== undefined));
  if (leaked.length > 0) {
    return { ok: false, reason: `raw PII blocked from aggregate view (${leaked.join(', ')})` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// FINDING — evaluation + FSM
// ═══════════════════════════════════════════════════════════════════

/** Evaluate finding gap: target vs observed → gap pct + verdict. */
export function evaluateFinding({ targetPct = 0, observedPct = null } = {}) {
  if (observedPct === null || observedPct === undefined) {
    return { ok: true, gapPct: null, met: false, verdict: 'no_observed_data' };
  }
  const gapPct = Number((Number(targetPct) - Number(observedPct)).toFixed(3));
  const met = Number(observedPct) >= Number(targetPct);
  const verdict = met ? 'met' : gapPct >= 10 ? 'critical_gap' : 'gap';
  return { ok: true, gapPct, met, verdict };
}

const FINDING_TRANSITIONS = {
  open: ['in_progress', 'resolved'],
  in_progress: ['open', 'resolved'],
  resolved: [],
};

/** Finding status FSM. */
export function assertFindingTransition({ from = '', to = '' } = {}) {
  const allowed = FINDING_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `invalid finding transition ${from} -> ${to}` };
  return { ok: true, from, to };
}

// ═══════════════════════════════════════════════════════════════════
// IMPROVEMENT ACTION — close blocker
// ═══════════════════════════════════════════════════════════════════

const ACTION_TRANSITIONS = {
  open: ['in_progress'],
  in_progress: ['open', 'verification'],
  verification: ['closed'],
  closed: [],
};

/** Action status FSM (close faqat verification'dan). */
export function assertActionTransition({ from = '', to = '' } = {}) {
  const allowed = ACTION_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `invalid action transition ${from} -> ${to}` };
  return { ok: true, from, to };
}

/**
 * Close blocker: action faqat follow-up evidence mavjud bo'lganda close
 * bo'ladi. Owner + deadline + evidence'siz close qabul qilinmaydi —
 * "action yozilib qolmasligi uchun reminder va evidence-required closure".
 */
export function assertActionClose({ owner = '', deadline = null, followUpEvidence = [] } = {}) {
  if (!owner) return { ok: false, reason: 'action requires an owner before closure' };
  if (!deadline) return { ok: false, reason: 'action requires a deadline before closure' };
  if (!Array.isArray(followUpEvidence) || followUpEvidence.length === 0) {
    return { ok: false, reason: 'action cannot close without follow-up evidence (close blocker §56.3)' };
  }
  const hasDecision = followUpEvidence.some((e) => e && FOLLOW_UP_DECISIONS.includes(e.decision));
  if (!hasDecision) return { ok: false, reason: 'follow-up evidence must carry a decision (effective/insufficient/confounded)' };
  return { ok: true };
}

/** Validate follow-up decision value. */
export function assertFollowUpDecision({ decision = '' } = {}) {
  if (!FOLLOW_UP_DECISIONS.includes(decision)) {
    return { ok: false, reason: `invalid follow-up decision: ${decision} (expected ${FOLLOW_UP_DECISIONS.join('/')})` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// ACCREDITATION EXPORT — reproducible manifest/hash
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministic export manifest: content (findings + actions + evidence
 * summary + standard) canonical JSON → sha256. Bir xil content => bir xil
 * hash — export reproducible.
 */
export function buildExportManifest({ standard = '', standardVersion = '', mapName = '', findings = [], actions = [], evidence = [] } = {}) {
  const canonical = JSON.stringify({
    standard,
    standardVersion,
    mapName,
    findings: findings.map((f) => ({ code: f.outcomeCode, title: f.title, target: f.targetPct, observed: f.observedPct, status: f.status })),
    actions: actions.map((a) => ({ title: a.title, owner: a.owner, status: a.status, hasFollowUp: Boolean(a.followUpCount) })),
    evidence: evidence.map((e) => ({ outcomeCode: e.outcomeCode, type: e.evidenceType, sample: e.sampleSize, observedPct: e.observedPct, suppressed: Boolean(e.isSuppressed) })),
  });
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return { ok: true, manifest: JSON.parse(canonical), hash };
}

/** Verify a stored manifest hash matches freshly recomputed content. */
export function verifyExportManifest({ expectedHash = '', standard = '', standardVersion = '', mapName = '', findings = [], actions = [], evidence = [] } = {}) {
  const built = buildExportManifest({ standard, standardVersion, mapName, findings, actions, evidence });
  const matches = built.hash === expectedHash;
  return { ok: matches, matches, reason: matches ? 'manifest hash matches content' : 'manifest hash mismatch — export not reproducible' };
}
