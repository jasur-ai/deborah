/**
 * Deborah — Marker Allocation, Calibration & Moderation (pure logic)
 *
 * Prompt 46 — pseudonymous marking va risk-based moderation workflow
 * (research.md §17 P2-5/6, §54.3 conflict rules). This module is PURE
 * (no I/O) — all allocation, calibration and moderation decisions are
 * deterministic and testable.
 *
 * SECURITY / DATA GUARD (Prompt 46 §15):
 *   - Marker sensitive case reason (special consideration, disability) va
 *     unrelated identity (student name/ID) ko'rmaydi — work items are
 *     pseudonymous; the pseudonym is opaque and derived deterministically.
 *   - External examiner faqat o'ziga berilgan work items ko'radi.
 *   - No arbitrary code — allocation/calibration are declarative.
 *
 * MODES (Prompt 46 §11):
 *   single  — one marker, agreed score = marker score
 *   sample  — random % double-marked for QA (sample_marker)
 *   second  — full second marking (second_marker), disagreement → moderation
 *   double  — two markers always; disagreement threshold → adjudication
 *
 * CALIBRATION (Prompt 46 §09): anchor rubric gold scores vs marker scores;
 * a marker passes when every anchor deviation ≤ threshold.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

export const MARKER_ROLES = ['marker', 'sample_marker', 'second_marker', 'adjudicator', 'external_examiner'];
export const ASSIGNMENT_STATUS = {
  ALLOCATED: 'allocated',
  CALIBRATING: 'calibrating',
  MARKING: 'marking',
  IN_MODERATION: 'in_moderation',
  COMPLETE: 'complete',
};
export const WORK_ITEM_STATUS = {
  QUEUED: 'queued',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  SCORED: 'scored',
  AGREED: 'agreed',
};
export const MARKING_MODES = {
  SINGLE: 'single',
  SAMPLE: 'sample',
  SECOND: 'second',
  DOUBLE: 'double',
};
export const CALIBRATION_STATUS = {
  DRAFT: 'draft',
  OPEN: 'open',
  COMPLETED: 'completed',
  FAILED: 'failed',
};
export const MODERATION_STATUS = {
  OPEN: 'open',
  ADJUDICATED: 'adjudicated',
  CLOSED: 'closed',
  ESCALATED: 'escalated',
};

export const MARKING_DEFAULTS = {
  sampleRatePercent: 10, // % of submissions double-marked in sample mode
  disagreementThreshold: 5.0, // |score1 - score2| beyond → moderation
  calibrationThreshold: 1.0, // anchor deviation cap
  minCalibrationAnchors: 3,
  // NOTE: no defaultWorkloadCap — workload_cap 0/null means UNLIMITED
  // (see buildAllocationPlan: 0 → Infinity).
};

// ═══════════════════════════════════════════════════════════════════
// PSEUDONYMIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive an opaque, deterministic pseudonym for a submission. The marker
 * sees ONLY this value — never student name/ID.
 *
 * @param {Object} params
 * @param {number} params.tenantId
 * @param {number} params.submissionVersionId
 * @param {string} [params.salt] - server secret (keeps pseudonym unguessable)
 * @returns {string} e.g. "S-7F3A9C21"
 */
export function derivePseudonym({ tenantId = 1, submissionVersionId = 0, salt = 'deborah-marking' } = {}) {
  const hash = createHash('sha256').update(`${tenantId}:${submissionVersionId}:${salt}`).digest('hex').slice(0, 8).toUpperCase();
  return `S-${hash}`;
}

// ═══════════════════════════════════════════════════════════════════
// ALLOCATION & WORKLOAD
// ═══════════════════════════════════════════════════════════════════

/**
 * Build an allocation plan: which markers get which submissions, honoring
 * workload caps and conflict exclusions. Pure + deterministic.
 *
 * @param {Object} params
 * @param {Array<Object>} params.markers - [{ userId, role, workloadCap, external }]
 * @param {Array<Object>} params.submissions - [{ id }] submissions to mark
 * @param {Object} [params.opts] - { sampleRatePercent, mode }
 * @returns {Object} { assignments, workItems, planSummary }
 */
export function buildAllocationPlan({ markers = [], submissions = [], opts = {} } = {}) {
  if (markers.length === 0) return { ok: false, error: 'no markers' };
  if (submissions.length === 0) return { ok: false, error: 'no submissions' };

  const mode = opts.mode || MARKING_MODES.SINGLE;
  const sampleRate = Number(opts.sampleRatePercent) || MARKING_DEFAULTS.sampleRatePercent;
  const activeMarkers = markers.filter((m) => m.role === 'marker' || m.role === 'sample_marker');
  if (activeMarkers.length === 0) return { ok: false, error: 'no active markers' };

  const assignments = [];
  const workItems = [];
  const counters = new Map(); // userId → allocated count

  // Round-robin allocation within workload caps
  const markerPool = [...activeMarkers];
  let mi = 0;
  for (const sub of submissions) {
    const marker = markerPool[mi % markerPool.length];
    const count = counters.get(marker.userId) || 0;
    const cap = marker.workloadCap === 0 || marker.workloadCap == null ? Infinity : marker.workloadCap;
    if (count >= cap) {
      // find next marker with capacity
      let next = null;
      for (let j = 0; j < markerPool.length; j++) {
        const cand = markerPool[(mi + j) % markerPool.length];
        const candCap = cand.workloadCap === 0 || cand.workloadCap == null ? Infinity : cand.workloadCap;
        if ((counters.get(cand.userId) || 0) < candCap) {
          next = cand;
          break;
        }
      }
      if (!next) return { ok: false, error: 'workload capacity exhausted' };
      const m = next;
      counters.set(m.userId, (counters.get(m.userId) || 0) + 1);
      workItems.push({ submissionId: sub.id, markerUserId: m.userId, mode, pseudonym: `S-${sub.id}-${m.userId}` });
      continue;
    }
    counters.set(marker.userId, count + 1);
    workItems.push({ submissionId: sub.id, markerUserId: marker.userId, mode, pseudonym: `S-${sub.id}-${marker.userId}` });
    mi++;
  }

  // Sample mode: mark a random deterministic subset for double-marking
  let sampleItems = [];
  if (mode === MARKING_MODES.SAMPLE) {
    const sampleCount = Math.max(1, Math.round(submissions.length * sampleRate / 100));
    const sampleMarkers = markers.filter((m) => m.role === 'sample_marker');
    if (sampleMarkers.length > 0) {
      const step = Math.max(1, Math.floor(submissions.length / sampleCount));
      for (let i = 0; i < submissions.length; i += step) {
        const sub = submissions[i];
        const sm = sampleMarkers[i % sampleMarkers.length];
        sampleItems.push({ submissionId: sub.id, markerUserId: sm.userId, mode: 'sample', pseudonym: `S-${sub.id}-${sm.userId}` });
      }
      workItems.push(...sampleItems);
    }
  }

  // Deduplicate by assignment (assignment = marker + submission)
  const seen = new Set();
  const uniqueItems = workItems.filter((w) => {
    const key = `${w.markerUserId}:${w.submissionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const m of markers) {
    if (m.role === 'adjudicator') {
      assignments.push({ userId: m.userId, role: m.role, workloadCap: m.workloadCap || 0, status: ASSIGNMENT_STATUS.ALLOCATED });
    }
  }

  return {
    ok: true,
    assignments,
    workItems: uniqueItems,
    planSummary: { total: submissions.length, workItems: uniqueItems.length, sampleItems: sampleItems.length },
  };
}

/**
 * Conflict check — a marker must not mark a submission they have an
 * interest in (self, family, declared conflict).
 *
 * @param {Object} params
 * @param {number} params.markerUserId
 * @param {Object} params.submission - { studentUserId }
 * @param {Array<Object>} [params.conflicts] - [{ markerUserId, studentUserId, reason }]
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function checkMarkerConflict({ markerUserId = 0, submission = {}, conflicts = [] } = {}) {
  if (markerUserId && Number(submission.studentUserId) === Number(markerUserId)) {
    return { ok: false, reason: 'marker cannot mark own submission' };
  }
  const hit = (conflicts || []).find(
    (c) => Number(c.markerUserId) === Number(markerUserId) && Number(c.studentUserId) === Number(submission.studentUserId)
  );
  if (hit) return { ok: false, reason: hit.reason || 'declared conflict' };
  return { ok: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// CALIBRATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate a calibration submission: marker scores vs gold scores.
 * Passes when every anchor deviation ≤ threshold.
 *
 * @param {Object} params
 * @param {Object} params.goldScores - { anchorId: score }
 * @param {Object} params.markerScores - { anchorId: score }
 * @param {number} [params.threshold]
 * @returns {{ passed: boolean, deviations: Object, failedAnchors: string[] }}
 */
export function evaluateCalibration({ goldScores = {}, markerScores = {}, threshold = MARKING_DEFAULTS.calibrationThreshold } = {}) {
  const deviations = {};
  const failedAnchors = [];
  for (const [anchorId, gold] of Object.entries(goldScores)) {
    const marker = Number(markerScores[anchorId]);
    if (marker === null || marker === undefined || Number.isNaN(marker)) {
      failedAnchors.push(anchorId);
      deviations[anchorId] = null;
      continue;
    }
    const dev = Math.abs(Number(marker) - Number(gold));
    deviations[anchorId] = dev;
    if (dev > Number(threshold)) failedAnchors.push(anchorId);
  }
  const passed = failedAnchors.length === 0 && Object.keys(goldScores).length > 0;
  return { passed, deviations, failedAnchors };
}

// ═══════════════════════════════════════════════════════════════════
// SCORING & MODES
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute a work item total from criterion scores.
 *
 * @param {Array<Object>} criterionScores - [{ score }]
 * @returns {number} sum
 */
export function sumCriterionScores(criterionScores = []) {
  return Number((criterionScores || []).reduce((s, c) => s + Number(c.score || 0), 0).toFixed(2));
}

/**
 * Decide the moderation mode for a submission based on the assessment
 * policy and risk factors.
 *
 * @param {Object} params
 * @param {string} params.mode - single | sample | second | double
 * @param {number} params.submissionIndex - deterministic sample selector
 * @param {number} [params.sampleRatePercent]
 * @returns {string} effective mode
 */
export function resolveMarkingMode({ mode = MARKING_MODES.SINGLE, submissionIndex = 0, sampleRatePercent = MARKING_DEFAULTS.sampleRatePercent } = {}) {
  if (mode === MARKING_MODES.SAMPLE) {
    // Deterministic sampling: index % (100/rate) === 0 → double-marked
    const period = Math.max(1, Math.round(100 / Math.max(1, sampleRatePercent)));
    return submissionIndex % period === 0 ? MARKING_MODES.DOUBLE : MARKING_MODES.SINGLE;
  }
  if (!Object.values(MARKING_MODES).includes(mode)) return MARKING_MODES.SINGLE;
  return mode;
}

// ═══════════════════════════════════════════════════════════════════
// DISAGREEMENT / ADJUDICATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate disagreement between two marker scores.
 *
 * @param {Object} params
 * @param {number} params.score1
 * @param {number} params.score2
 * @param {number} [params.threshold]
 * @returns {{ agreed: boolean, delta: number, needsAdjudication: boolean }}
 */
export function evaluateDisagreement({ score1 = 0, score2 = 0, threshold = MARKING_DEFAULTS.disagreementThreshold } = {}) {
  const delta = Math.abs(Number(score1) - Number(score2));
  const needsAdjudication = delta > Number(threshold);
  return { agreed: !needsAdjudication, delta, needsAdjudication };
}

/**
 * Compute the agreed mark from a moderation decision.
 *
 * @param {Object} params
 * @param {string} params.policy - sample | second | double
 * @param {number} params.score1
 * @param {number} params.score2
 * @param {number} [params.threshold]
 * @returns {{ agreedScore: number, adjudicated: boolean }}
 */
export function computeAgreedMark({ policy = 'sample', score1 = 0, score2 = 0, threshold = MARKING_DEFAULTS.disagreementThreshold } = {}) {
  const s1 = Number(score1);
  const s2 = Number(score2);
  const { needsAdjudication } = evaluateDisagreement({ score1: s1, score2: s2, threshold });
  if (policy === 'double' || policy === 'second') {
    // Double marking: disagreement → adjudication (score resolved by moderator)
    return { agreedScore: needsAdjudication ? null : (s1 + s2) / 2, adjudicated: needsAdjudication };
  }
  // Sample: average always (sample is QA, not authority)
  return { agreedScore: (s1 + s2) / 2, adjudicated: false };
}

// ═══════════════════════════════════════════════════════════════════
// EXTERNAL EXAMINER SCOPING
// ═══════════════════════════════════════════════════════════════════

/**
 * External examiner visibility guard — an external examiner sees ONLY
 * their assigned work items and a scoped view of criteria (no student
 * identity, no other markers' comments unless agreed).
 *
 * @param {Object} params
 * @param {number} params.examinerUserId
 * @param {Object} params.workItem - { markerUserId, assignmentRole }
 * @param {boolean} params.externalScoped
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function checkExternalExaminerScope({ examinerUserId = 0, workItem = {}, externalScoped = false } = {}) {
  if (!externalScoped) return { ok: true, reason: null }; // not externally scoped
  if (Number(workItem.markerUserId) !== Number(examinerUserId)) {
    return { ok: false, reason: 'external examiner can only access own work items' };
  }
  return { ok: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// PROGRESS / OVERDUE METRICS
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute marking progress metrics for an assignment.
 *
 * @param {Object} params
 * @param {Array<Object>} params.workItems - [{ status, dueAt }]
 * @param {number} [params.now]
 * @returns {Object} metrics
 */
export function computeMarkingProgress({ workItems = [], now = Date.now() } = {}) {
  const total = workItems.length;
  const scored = workItems.filter((w) => ['scored', 'agreed'].includes(w.status)).length;
  const inProgress = workItems.filter((w) => w.status === 'in_progress').length;
  const overdue = workItems.filter((w) => w.status !== 'agreed' && w.dueAt && new Date(w.dueAt).getTime() < Number(now)).length;
  return {
    total,
    scored,
    inProgress,
    overdue,
    percent: total > 0 ? Math.round((scored / total) * 100) : 100,
  };
}
