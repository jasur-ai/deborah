/**
 * Deborah — Program Quality & Accreditation Workspace (unit tests, Prompt 62)
 *
 * Pure schema functions: curriculum gap analysis (unmapped / missing
 * introduction / missing assessment / over-assessed), minimum cell
 * suppression, security guards (no teacher leaderboard, no raw PII),
 * finding evaluation + FSM, action close blocker, follow-up decision
 * validation, reproducible export manifest hash.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCurriculumGaps,
  applyCellSuppression,
  assertNoTeacherLeaderboard,
  assertNoRawPiiInAggregate,
  evaluateFinding,
  assertFindingTransition,
  assertActionTransition,
  assertActionClose,
  assertFollowUpDecision,
  buildExportManifest,
  verifyExportManifest,
} from '../../src/modules/program-quality/program-quality.schema.js';

describe('program quality — curriculum gap analysis', () => {
  const outcomes = [
    { id: 1, code: 'PLO-1', name: 'Analitik fikrlash' },
    { id: 2, code: 'PLO-2', name: 'Ilmiy tadqiqot' },
    { id: 3, code: 'PLO-3', name: 'Kommunikatsiya' },
  ];

  it('reports unmapped outcomes', () => {
    const r = computeCurriculumGaps({
      outcomes,
      entries: [{ course_id: 1, outcome_id: 1, irma_level: 'introduced', assessment_points: 1 }],
    });
    expect(r.ok).toBe(true);
    expect(r.gaps.some((g) => g.kind === 'unmapped' && g.outcomeId === 2)).toBe(true);
    expect(r.gaps.some((g) => g.kind === 'unmapped' && g.outcomeId === 3)).toBe(true);
    expect(r.summary.unmapped).toBe(2);
  });

  it('reports missing introduction and missing assessment', () => {
    const r = computeCurriculumGaps({
      outcomes,
      entries: [
        { course_id: 1, outcome_id: 1, irma_level: 'assessed', assessment_points: 2 },
        { course_id: 2, outcome_id: 2, irma_level: 'introduced', assessment_points: 1 },
      ],
    });
    expect(r.gaps.some((g) => g.kind === 'missing_introduction' && g.outcomeId === 1)).toBe(true);
    expect(r.gaps.some((g) => g.kind === 'missing_assessment' && g.outcomeId === 2)).toBe(true);
    expect(r.summary.missingIntroduction).toBe(1);
    expect(r.summary.missingAssessment).toBe(1);
  });

  it('reports over-assessed outcomes (redundant program assessment)', () => {
    const r = computeCurriculumGaps({
      outcomes,
      entries: [
        { course_id: 1, outcome_id: 1, irma_level: 'assessed', assessment_points: 1 },
        { course_id: 2, outcome_id: 1, irma_level: 'assessed', assessment_points: 1 },
      ],
    });
    expect(r.gaps.some((g) => g.kind === 'over_assessed' && g.outcomeId === 1)).toBe(true);
    expect(r.summary.overAssessed).toBe(1);
  });

  it('fully covered outcome has no gaps', () => {
    const r = computeCurriculumGaps({
      outcomes: [outcomes[0]],
      entries: [
        { course_id: 1, outcome_id: 1, irma_level: 'introduced', assessment_points: 1 },
        { course_id: 2, outcome_id: 1, irma_level: 'assessed', assessment_points: 2 },
      ],
    });
    expect(r.gaps).toHaveLength(0);
    expect(r.summary.unmapped).toBe(0);
  });
});

describe('program quality — minimum cell suppression', () => {
  it('suppresses cells below minimum size', () => {
    const r = applyCellSuppression({ observedPct: 58, sampleSize: 3, minCellSize: 5 });
    expect(r.suppressed).toBe(true);
    expect(r.observedPct).toBeNull();
  });

  it('keeps observed pct when sample meets minimum', () => {
    const r = applyCellSuppression({ observedPct: 58, sampleSize: 8, minCellSize: 5 });
    expect(r.suppressed).toBe(false);
    expect(r.observedPct).toBe(58);
  });

  it('default min cell size is 5', () => {
    const r = applyCellSuppression({ observedPct: 70, sampleSize: 4 });
    expect(r.suppressed).toBe(true);
  });
});

describe('program quality — security guards (§15, §56.5)', () => {
  it('rejects teacher ranking leaderboards by default', () => {
    expect(assertNoTeacherLeaderboard({}).ok).toBe(true);
    const r = assertNoTeacherLeaderboard({ includeTeacherRanking: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/teacher ranking/i);
    expect(assertNoTeacherLeaderboard({ teacherId: 5 }).ok).toBe(false);
  });

  it('rejects raw PII in aggregate payload', () => {
    expect(assertNoRawPiiInAggregate({ payload: { sampleSize: 8 } }).ok).toBe(true);
    const r = assertNoRawPiiInAggregate({ payload: { studentName: 'Aziz' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/PII/i);
    const r2 = assertNoRawPiiInAggregate({ payload: { aggregateMeta: { submission: 'RAW' } } });
    expect(r2.ok).toBe(false);
  });
});

describe('program quality — finding evaluation + FSM', () => {
  it('evaluates gap verdict', () => {
    expect(evaluateFinding({ targetPct: 75, observedPct: 58 }).verdict).toBe('critical_gap');
    expect(evaluateFinding({ targetPct: 75, observedPct: 70 }).verdict).toBe('gap');
    expect(evaluateFinding({ targetPct: 75, observedPct: 80 }).verdict).toBe('met');
    expect(evaluateFinding({ targetPct: 75, observedPct: null }).verdict).toBe('no_observed_data');
  });

  it('enforces finding FSM', () => {
    expect(assertFindingTransition({ from: 'open', to: 'in_progress' }).ok).toBe(true);
    expect(assertFindingTransition({ from: 'open', to: 'resolved' }).ok).toBe(true);
    expect(assertFindingTransition({ from: 'resolved', to: 'open' }).ok).toBe(false);
  });

  it('enforces action FSM', () => {
    expect(assertActionTransition({ from: 'open', to: 'in_progress' }).ok).toBe(true);
    expect(assertActionTransition({ from: 'in_progress', to: 'verification' }).ok).toBe(true);
    expect(assertActionTransition({ from: 'verification', to: 'closed' }).ok).toBe(true);
    expect(assertActionTransition({ from: 'open', to: 'closed' }).ok).toBe(false);
  });
});

describe('program quality — action close blocker (§56.3)', () => {
  it('blocks close without owner', () => {
    const r = assertActionClose({ owner: '', deadline: '2026-09-01', followUpEvidence: [{ decision: 'effective' }] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/owner/i);
  });

  it('blocks close without deadline', () => {
    const r = assertActionClose({ owner: 'lead', deadline: null, followUpEvidence: [{ decision: 'effective' }] });
    expect(r.ok).toBe(false);
  });

  it('blocks close without follow-up evidence', () => {
    const r = assertActionClose({ owner: 'lead', deadline: '2026-09-01', followUpEvidence: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/follow-up evidence/i);
  });

  it('blocks close when evidence has no decision', () => {
    const r = assertActionClose({ owner: 'lead', deadline: '2026-09-01', followUpEvidence: [{ evidenceRef: 'x' }] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/decision/i);
  });

  it('allows close with owner + deadline + decided evidence', () => {
    const r = assertActionClose({ owner: 'lead', deadline: '2026-09-01', followUpEvidence: [{ decision: 'effective' }] });
    expect(r.ok).toBe(true);
  });
});

describe('program quality — follow-up decision', () => {
  it('accepts only effective/insufficient/confounded', () => {
    expect(assertFollowUpDecision({ decision: 'effective' }).ok).toBe(true);
    expect(assertFollowUpDecision({ decision: 'insufficient' }).ok).toBe(true);
    expect(assertFollowUpDecision({ decision: 'confounded' }).ok).toBe(true);
    expect(assertFollowUpDecision({ decision: 'whatever' }).ok).toBe(false);
  });
});

describe('program quality — reproducible export manifest', () => {
  const payload = {
    standard: 'UZWQAA-2026',
    standardVersion: 'v1',
    mapName: 'BSc Matematika 2026',
    findings: [{ outcomeCode: 'PLO-4', title: 'gap', targetPct: 75, observedPct: 58, status: 'open' }],
    actions: [{ title: 'scaffold', owner: 'lead', status: 'open', followUpCount: 0 }],
    evidence: [{ outcomeCode: 'PLO-4', evidenceType: 'direct', sampleSize: 8, observedPct: 58, isSuppressed: false }],
  };

  it('produces deterministic hash for identical content', () => {
    const a = buildExportManifest(payload);
    const b = buildExportManifest(payload);
    expect(a.ok).toBe(true);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes hash when content changes', () => {
    const a = buildExportManifest(payload);
    const b = buildExportManifest({ ...payload, mapName: 'BSc Fizika 2026' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('verifies matching manifest and rejects tampered', () => {
    const built = buildExportManifest(payload);
    expect(verifyExportManifest({ expectedHash: built.hash, ...payload }).matches).toBe(true);
    expect(verifyExportManifest({ expectedHash: 'deadbeef', ...payload }).matches).toBe(false);
  });
});
