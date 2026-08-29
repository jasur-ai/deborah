/**
 * Deborah — Board Ratification, Result Release & Grade Ledger Schema
 *
 * Prompt 47 — provisional markni authorized board orqali immutable final
 * resultga aylantirish (research.md §49.15, §67.1 steps 14–16). Pure
 * schema (no I/O) — every rule below is deterministic and testable:
 *
 *   - BOARD_ROLES / meeting / decision status constants.
 *   - checkBoardReady — board-ready BLOCKER checker: a grade can only be
 *     put before the board when every precondition holds (rule approved,
 *     calculation run exists, final grade set, no pending moderation,
 *     no blocked run, moderation cases closed). FAIL-CLOSED.
 *   - checkQuorum — quorum is computed from NON-conflicted attendees who
 *     attended; approval ratio from votes. A conflicted member cannot
 *     vote (conflict declaration).
 *   - buildSnapshotHash — canonical gradebook snapshot → deterministic
 *     sha256 (immutable ratification evidence).
 *   - nextAmendmentNo / validateAmendment — append-only ledger numbering.
 *   - RELEASE_POLICY — ratification'siz release yo'q (§15).
 *   - buildSisPayload — SIS/HEMIS outbox payload (idempotent external_key).
 */

import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const BOARD_ROLES = ['chair', 'secretary', 'member', 'external'];

export const MEETING_STATUS = {
  SCHEDULED: 'scheduled',
  OPEN: 'open',
  RATIFIED: 'ratified',
  REJECTED: 'rejected',
};

export const DECISION_STATUS = {
  RATIFIED: 'ratified',
  REJECTED: 'rejected',
};

export const VOTES = ['approve', 'reject', 'abstain'];

export const OUTBOX_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  RECONCILED: 'reconciled',
  FAILED: 'failed',
};

export const BOARD_DEFAULTS = {
  requiredQuorum: 3,
  requiredApprovalRatio: 0.6, // 60% of non-abstaining voters approve
  maxAmendmentsPerRun: 10,
  // RELEASE_POLICY: a result can only be released AFTER a ratified board
  // decision. There is no 'release without ratification' path (§15).
  releasePolicy: 'ratification_required',
  holdingGrade: 'provisional', // provisional → ratified (never direct UPDATE)
};

// ═══════════════════════════════════════════════════════════════════
// BOARD-READY BLOCKER CHECKER (fail-closed)
// ═══════════════════════════════════════════════════════════════════

/**
 * Check whether a provisional grade is ready to be placed before the
 * board for ratification. FAIL-CLOSED: every precondition must hold,
 * otherwise the result cannot be ratified.
 *
 * @param {Object} params
 * @param {Object} [params.rule] - { status } rule version
 * @param {Object} [params.run] - { id, status, final_grade, grade_label }
 * @param {Array<Object>} [params.openModerationCases] - pending cases
 * @param {Array<Object>} [params.pendingAmendments] - not used as blocker
 * @param {Object} [params.policy] - BOARD_DEFAULTS overrides
 * @returns {{ ok: boolean, blockers: string[] }}
 */
export function checkBoardReady({
  rule = null,
  run = null,
  openModerationCases = [],
  policy = {},
} = {}) {
  const blockers = [];

  if (!rule) {
    blockers.push('approved grade rule required');
  } else if (rule.status !== 'approved') {
    blockers.push(`grade rule must be approved (got: ${rule.status})`);
  }

  if (!run) {
    blockers.push('grade calculation run required');
  } else {
    if (run.final_grade === null || run.final_grade === undefined) {
      blockers.push('final grade must be computed');
    }
    if (run.blocked) {
      blockers.push('calculation run is blocked (pending components)');
    }
  }

  if (openModerationCases && openModerationCases.length > 0) {
    blockers.push(`${openModerationCases.length} open moderation case(s) must be closed`);
  }

  // Release policy guard: this module NEVER releases without ratification.
  const releasePolicy = policy.releasePolicy || BOARD_DEFAULTS.releasePolicy;
  if (releasePolicy !== BOARD_DEFAULTS.releasePolicy) {
    blockers.push(`unsupported release policy: ${releasePolicy}`);
  }

  return { ok: blockers.length === 0, blockers };
}

// ═══════════════════════════════════════════════════════════════════
// QUORUM & CONFLICT DECLARATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute quorum from attendees. A conflicted attendee is EXCLUDED from
 * quorum and CANNOT vote (conflict declaration §09).
 *
 * @param {Object} params
 * @param {Array<Object>} params.attendees - [{ attended, conflict_declared, vote }]
 * @param {number} [params.requiredQuorum]
 * @param {number} [params.requiredApprovalRatio]
 * @returns {{ ok: boolean, quorumMet: boolean, eligibleVoters: number,
 *            conflicted: number, approvals: number, rejections: number,
 *            abstentions: number, approvalRatio: number, reason: string|null }}
 */
export function checkQuorum({
  attendees = [],
  requiredQuorum = BOARD_DEFAULTS.requiredQuorum,
  requiredApprovalRatio = BOARD_DEFAULTS.requiredApprovalRatio,
} = {}) {
  const conflicted = attendees.filter((a) => a.conflict_declared).length;
  const eligible = attendees.filter((a) => a.attended && !a.conflict_declared);
  const eligibleVoters = eligible.length;

  const votes = eligible.filter((a) => a.vote);
  const approvals = votes.filter((a) => a.vote === 'approve').length;
  const rejections = votes.filter((a) => a.vote === 'reject').length;
  const abstentions = votes.filter((a) => a.vote === 'abstain').length;

  const quorumMet = eligibleVoters >= Number(requiredQuorum);
  // Approval ratio is computed over NON-abstaining voters.
  const decisive = approvals + rejections;
  const approvalRatio = decisive > 0 ? approvals / decisive : 0;
  const ratioMet = approvalRatio >= Number(requiredApprovalRatio);

  let reason = null;
  if (!quorumMet) reason = `quorum not met (${eligibleVoters}/${requiredQuorum} eligible)`;
  else if (!ratioMet) reason = `approval ratio not met (${(approvalRatio * 100).toFixed(1)}% < ${(Number(requiredApprovalRatio) * 100).toFixed(0)}%)`;

  return {
    ok: quorumMet && ratioMet,
    quorumMet,
    eligibleVoters,
    conflicted,
    approvals,
    rejections,
    abstentions,
    approvalRatio: Number(approvalRatio.toFixed(4)),
    reason,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT HASH (immutable ratification evidence)
// ═══════════════════════════════════════════════════════════════════

/**
 * Canonicalize an object (stable key ordering — no deep clone pitfalls)
 * and return a deterministic sha256 hex digest. Used to fingerprint the
 * gradebook snapshot at ratification time.
 *
 * @param {Object} value
 * @returns {string} sha256 hex (64 chars)
 */
export function canonicalStringify(value) {
  const seen = new WeakSet();
  const canon = (v) => {
    if (v === null || typeof v !== 'object') {
      return typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(4)) : v;
    }
    if (typeof v === 'object') {
      if (seen.has(v)) throw new Error('circular reference in snapshot');
      seen.add(v);
    }
    if (Array.isArray(v)) return v.map(canon);
    const sorted = Object.keys(v).sort();
    const out = {};
    for (const k of sorted) out[k] = canon(v[k]);
    return out;
  };
  return JSON.stringify(canon(value));
}

/**
 * Build a deterministic snapshot hash over the gradebook evidence.
 *
 * @param {Object} params
 * @param {Object} [params.run] - grade_calculation_run row
 * @param {Object} [params.ruleVersion] - approved rule version (hash)
 * @param {Array<Object>} [params.amendments] - existing ledger rows
 * @returns {string} sha256 hex
 */
export function buildSnapshotHash({ run = {}, ruleVersion = null, amendments = [] } = {}) {
  const snapshot = {
    run_id: run.id ?? null,
    final_grade: run.final_grade ?? null,
    grade_label: run.grade_label ?? null,
    rule_hash: ruleVersion?.rule_hash ?? null,
    amendments: (amendments || []).map((a) => ({
      no: a.amendment_no,
      from: a.old_final,
      to: a.new_final,
      reason: a.reason,
    })),
  };
  return createHash('sha256').update(canonicalStringify(snapshot)).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════
// AMENDMENT LEDGER (append-only)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the next amendment number for a run (1-based, append-only).
 *
 * @param {Array<Object>} [amendments]
 * @returns {number}
 */
export function nextAmendmentNo(amendments = []) {
  return (amendments || []).length + 1;
}

/**
 * Validate an amendment against the ledger policy (fail-closed).
 *
 * @param {Object} params
 * @param {number} params.amendmentNo
 * @param {number|string} params.oldFinal
 * @param {number|string} params.newFinal
 * @param {string} params.reason
 * @param {number} [params.maxAmendments]
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function validateAmendment({
  amendmentNo = 1,
  oldFinal = null,
  newFinal = null,
  reason = '',
  maxAmendments = BOARD_DEFAULTS.maxAmendmentsPerRun,
} = {}) {
  if (oldFinal === null || newFinal === null) {
    return { ok: false, reason: 'old and new final grades are required' };
  }
  if (Number(oldFinal) === Number(newFinal)) {
    return { ok: false, reason: 'amendment must change the grade' };
  }
  if (!reason || String(reason).trim().length < 5) {
    return { ok: false, reason: 'amendment reason is required (min 5 chars)' };
  }
  if (Number(amendmentNo) > Number(maxAmendments)) {
    return { ok: false, reason: `amendment limit reached (max ${maxAmendments})` };
  }
  return { ok: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// SIS / HEMIS OUTBOX PAYLOAD
// ═══════════════════════════════════════════════════════════════════

/**
 * Build an idempotent SIS/HEMIS outbox payload. The external_key embeds
 * the run + amendment version so re-releases are deduplicated.
 *
 * @param {Object} params
 * @param {Object} [params.decision] - board_decisions row
 * @param {Object} [params.run] - grade_calculation_runs row
 * @param {Object} [params.user] - { external_id } student SIS id
 * @param {number} [params.version] - 0 = original ratified release
 * @returns {{ externalKey: string, payload: Object }}
 */
export function buildSisPayload({ decision = null, run = null, user = null, version = 0, effectiveFinal = null } = {}) {
  const externalKey = `gr-${run?.id ?? 0}-v${Number(version)}`;
  // The grade released to SIS is the EFFECTIVE grade — the last ledger
  // amendment's new_final when amendments exist, otherwise the frozen
  // ratified final. run.final_grade alone is NOT the source of truth
  // once the grade has been amended (amendment chain).
  const finalGrade = effectiveFinal !== null && effectiveFinal !== undefined
    ? Number(effectiveFinal)
    : Number(run?.final_grade ?? decision?.ratified_final ?? 0);
  return {
    externalKey,
    payload: {
      type: 'grade_result',
      schemaVersion: '1.0',
      studentExternalId: user?.external_id || null,
      runId: run?.id ?? null,
      decisionId: decision?.id ?? null,
      finalGrade,
      gradeLabel: run?.grade_label ?? null,
      snapshotHash: decision?.snapshot_hash || null,
      ratifiedAt: decision?.decided_at || null,
      source: 'deborah-board',
    },
  };
}
