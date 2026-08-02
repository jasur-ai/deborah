/**
 * Edikit — Board Ratification, Result Release & Grade Ledger unit tests
 * (Prompt 47)
 *
 * Pure-schema coverage:
 *   - Board-ready blocker checker: fail-closed on missing rule/run/final,
 *     open moderation, blocked run, unsupported release policy.
 *   - Quorum: conflicted members excluded, quorum met, approval ratio,
 *     abstention handling, reject cases.
 *   - Snapshot hash: deterministic, order-independent, amendment-sensitive.
 *   - Amendment ledger: numbering, validation (no-op rejected, reason
 *     required, limit).
 *   - SIS payload: idempotent external_key, versioned re-release.
 */

import { describe, it, expect } from 'vitest';
import {
  checkBoardReady,
  checkQuorum,
  buildSnapshotHash,
  canonicalStringify,
  nextAmendmentNo,
  validateAmendment,
  buildSisPayload,
  BOARD_ROLES,
  MEETING_STATUS,
  DECISION_STATUS,
  VOTES,
  OUTBOX_STATUS,
  BOARD_DEFAULTS,
} from '../../src/modules/board/index.js';

// ═══════════════════════════════════════════════════════════════════
// BOARD-READY BLOCKER CHECKER (fail-closed)
// ═══════════════════════════════════════════════════════════════════

describe('checkBoardReady', () => {
  it('is ready when every precondition holds', () => {
    const r = checkBoardReady({
      rule: { status: 'approved' },
      run: { id: 1, final_grade: 85, grade_label: 'A', blocked: false },
      openModerationCases: [],
    });
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('fails closed when the rule is missing', () => {
    const r = checkBoardReady({ rule: null, run: { id: 1, final_grade: 85 } });
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain('approved grade rule required');
  });

  it('fails when the rule is not approved', () => {
    const r = checkBoardReady({ rule: { status: 'draft' }, run: { id: 1, final_grade: 85 } });
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toContain('must be approved');
  });

  it('fails when the run is missing or has no final grade', () => {
    expect(checkBoardReady({ rule: { status: 'approved' }, run: null }).ok).toBe(false);
    const r = checkBoardReady({ rule: { status: 'approved' }, run: { id: 1, final_grade: null } });
    expect(r.blockers).toContain('final grade must be computed');
  });

  it('fails when the run is blocked', () => {
    const r = checkBoardReady({ rule: { status: 'approved' }, run: { id: 1, final_grade: 85, blocked: true } });
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toContain('blocked');
  });

  it('fails when moderation cases are still open', () => {
    const r = checkBoardReady({
      rule: { status: 'approved' },
      run: { id: 1, final_grade: 85 },
      openModerationCases: [{ id: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toContain('open moderation');
  });

  it('rejects an unsupported release policy (ratification is mandatory)', () => {
    const r = checkBoardReady({
      rule: { status: 'approved' },
      run: { id: 1, final_grade: 85 },
      policy: { releasePolicy: 'auto_release' },
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toContain('unsupported release policy');
  });
});

// ═══════════════════════════════════════════════════════════════════
// QUORUM & CONFLICT DECLARATION
// ═══════════════════════════════════════════════════════════════════

describe('checkQuorum', () => {
  it('passes when quorum and approval ratio are met', () => {
    const r = checkQuorum({
      attendees: [
        { attended: true, conflict_declared: false, vote: 'approve' },
        { attended: true, conflict_declared: false, vote: 'approve' },
        { attended: true, conflict_declared: false, vote: 'approve' },
      ],
      requiredQuorum: 3,
      requiredApprovalRatio: 0.6,
    });
    expect(r.ok).toBe(true);
    expect(r.quorumMet).toBe(true);
    expect(r.eligibleVoters).toBe(3);
    expect(r.approvalRatio).toBe(1);
  });

  it('excludes conflicted members from quorum and votes', () => {
    const r = checkQuorum({
      attendees: [
        { attended: true, conflict_declared: true, vote: 'approve' }, // excluded
        { attended: true, conflict_declared: false, vote: 'approve' },
        { attended: true, conflict_declared: false, vote: 'approve' },
      ],
      requiredQuorum: 3,
    });
    expect(r.conflicted).toBe(1);
    expect(r.eligibleVoters).toBe(2);
    expect(r.quorumMet).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('quorum not met');
  });

  it('computes approval ratio over non-abstaining voters', () => {
    const r = checkQuorum({
      attendees: [
        { attended: true, conflict_declared: false, vote: 'approve' },
        { attended: true, conflict_declared: false, vote: 'reject' },
        { attended: true, conflict_declared: false, vote: 'abstain' },
      ],
      requiredQuorum: 3,
      requiredApprovalRatio: 0.6,
    });
    expect(r.abstentions).toBe(1);
    expect(r.approvalRatio).toBe(0.5); // 1 approve / 2 decisive
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('approval ratio');
  });

  it('fails when approval ratio is not met', () => {
    const r = checkQuorum({
      attendees: [
        { attended: true, conflict_declared: false, vote: 'approve' },
        { attended: true, conflict_declared: false, vote: 'reject' },
        { attended: true, conflict_declared: false, vote: 'reject' },
      ],
      requiredQuorum: 3,
      requiredApprovalRatio: 0.6,
    });
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT HASH (immutable evidence)
// ═══════════════════════════════════════════════════════════════════

describe('buildSnapshotHash', () => {
  it('is deterministic for the same snapshot', () => {
    const run = { id: 1, final_grade: 85, grade_label: 'A' };
    const a = buildSnapshotHash({ run });
    const b = buildSnapshotHash({ run });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the final grade changes', () => {
    const a = buildSnapshotHash({ run: { id: 1, final_grade: 85 } });
    const b = buildSnapshotHash({ run: { id: 1, final_grade: 84 } });
    expect(a).not.toBe(b);
  });

  it('changes when amendments are appended', () => {
    const run = { id: 1, final_grade: 85 };
    const a = buildSnapshotHash({ run, amendments: [] });
    const b = buildSnapshotHash({ run, amendments: [{ amendment_no: 1, old_final: 85, new_final: 90, reason: 'regrade' }] });
    expect(a).not.toBe(b);
  });
});

describe('canonicalStringify', () => {
  it('is order-independent', () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(canonicalStringify({ b: 2, a: 1 }));
  });

  it('normalizes floats to 4dp', () => {
    const s = canonicalStringify({ x: 85.123456 });
    expect(s).toContain('85.1235');
  });
});

// ═══════════════════════════════════════════════════════════════════
// AMENDMENT LEDGER (append-only)
// ═══════════════════════════════════════════════════════════════════

describe('nextAmendmentNo / validateAmendment', () => {
  it('numbers amendments sequentially starting at 1', () => {
    expect(nextAmendmentNo([])).toBe(1);
    expect(nextAmendmentNo([{}, {}])).toBe(3);
  });

  it('rejects a no-op amendment (same grade)', () => {
    const r = validateAmendment({ oldFinal: 85, newFinal: 85, reason: 'nothing changed' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('must change');
  });

  it('requires a meaningful reason', () => {
    const r = validateAmendment({ oldFinal: 85, newFinal: 90, reason: 'x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('reason');
  });

  it('enforces the amendment limit', () => {
    const r = validateAmendment({ amendmentNo: 11, oldFinal: 85, newFinal: 90, reason: 'valid reason here', maxAmendments: 10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('limit');
  });

  it('accepts a valid amendment', () => {
    const r = validateAmendment({ amendmentNo: 2, oldFinal: 85, newFinal: 90, reason: 'error corrected after appeal' });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SIS / HEMIS OUTBOX PAYLOAD
// ═══════════════════════════════════════════════════════════════════

describe('buildSisPayload', () => {
  it('builds an idempotent external_key (run + version)', () => {
    const p = buildSisPayload({ run: { id: 7 }, version: 0 });
    expect(p.externalKey).toBe('gr-7-v0');
    const v2 = buildSisPayload({ run: { id: 7 }, version: 2 });
    expect(v2.externalKey).toBe('gr-7-v2');
    expect(v2.externalKey).not.toBe(p.externalKey);
  });

  it('embeds snapshot hash and ratified grade', () => {
    const p = buildSisPayload({
      decision: { id: 3, snapshot_hash: 'abc123', decided_at: '2026-08-01T00:00:00Z' },
      run: { id: 7, final_grade: 88, grade_label: 'B+' },
      user: { external_id: 'hemis-42' },
    });
    expect(p.payload.studentExternalId).toBe('hemis-42');
    expect(p.payload.snapshotHash).toBe('abc123');
    expect(p.payload.gradeLabel).toBe('B+');
    expect(p.payload.source).toBe('edikit-board');
  });

  it('uses the EFFECTIVE final grade (last amendment) for re-release', () => {
    // run.final_grade stays frozen at the ORIGINAL ratified value (§15 —
    // no direct UPDATE); the effective grade comes from the ledger.
    const p = buildSisPayload({
      decision: { id: 3, snapshot_hash: 'abc123', decided_at: '2026-08-01T00:00:00Z' },
      run: { id: 7, final_grade: 85, grade_label: 'B' },
      effectiveFinal: 92,
      version: 1,
    });
    expect(p.payload.finalGrade).toBe(92); // amended grade, NOT the frozen 85
    expect(p.externalKey).toBe('gr-7-v1');
  });

  it('falls back to the frozen ratified final when no amendment exists', () => {
    const p = buildSisPayload({ run: { id: 7, final_grade: 85 } });
    expect(p.payload.finalGrade).toBe(85);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('constants', () => {
  it('exposes the expected board vocabulary', () => {
    expect(BOARD_ROLES).toContain('chair');
    expect(BOARD_ROLES).toContain('external');
    expect(MEETING_STATUS.RATIFIED).toBe('ratified');
    expect(DECISION_STATUS.RATIFIED).toBe('ratified');
    expect(VOTES).toEqual(['approve', 'reject', 'abstain']);
    expect(OUTBOX_STATUS.RECONCILED).toBe('reconciled');
  });

  it('enforces ratification-required release policy by default', () => {
    expect(BOARD_DEFAULTS.releasePolicy).toBe('ratification_required');
    expect(BOARD_DEFAULTS.holdingGrade).toBe('provisional');
  });
});
