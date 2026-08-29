/**
 * Deborah — Cast Evidence Service tests (C3-01)
 * ---------------------------------------------
 * - Status classification (accepted/wrong/no_response/late_join/disconnected/…)
 * - Numerator + denominator birga
 * - Accuracy accepted scorable'dan
 * - Distractor distribution
 * - Confidence coverage
 * - Response time descriptive aggregate
 * - First-vote vs revote alohida snapshot
 * - Projector/public payload'da individual ma'lumot yo'q
 */

import { describe, it, expect } from 'vitest';
import { computeQuestionEvidence, describeResponseTimes } from '../../services/cast/evidence-service.js';
import { publicEvidenceProjection, directorEvidenceProjection } from '../../services/cast/projections.js';

function p(id, overrides = {}) {
  return { participantId: id, displayAlias: 'P' + id, presence: 'online', late: false, ...overrides };
}

function ans(overrides = {}) {
  return {
    status: 'ACCEPTED',
    isCorrect: true,
    selectedOptionIds: ['o_b'],
    elapsedMs: 4200,
    ...overrides,
  };
}

describe('computeQuestionEvidence', () => {
  it('counts correct / incorrect / no-response separately with denominators', () => {
    const ev = computeQuestionEvidence({
      sessionId: 's1',
      questionId: 'q1',
      participants: { p1: p('p1'), p2: p('p2'), p3: p('p3'), p4: p('p4') },
      answers: {
        p1: ans({ isCorrect: true, selectedOptionIds: ['o_b'] }),
        p2: ans({ isCorrect: false, selectedOptionIds: ['o_c'] }),
        p3: ans({ isCorrect: true, selectedOptionIds: ['o_b'] }),
      },
      revision: 48,
    });

    expect(ev.eligible).toBe(4);          // denominator
    expect(ev.accepted).toBe(3);
    expect(ev.correct).toBe(2);
    expect(ev.incorrect).toBe(1);
    expect(ev.noResponse).toBe(1);
    // Accuracy faqat scorable'dan (3), hammasidan emas (4)
    expect(ev.accuracyPercent).toBe(67);  // round(2/3*100)
    expect(ev.responseRate).toBe(75);     // 3/4
    expect(ev.revision).toBe(48);
  });

  it('separates late join, disconnected and technical failure', () => {
    const ev = computeQuestionEvidence({
      sessionId: 's1',
      questionId: 'q1',
      participants: {
        p1: p('p1', { late: true }),                 // kech qo'shildi, savolni ko'rmadi
        p2: p('p2', { presence: 'offline' }),        // uzildi
        p3: p('p3', { presence: 'online' }),         // javobsiz
      },
      answers: {},
      revision: 5,
    });

    expect(ev.lateJoin).toBe(1);
    expect(ev.notShown).toBe(1);
    expect(ev.disconnected).toBe(1);
    expect(ev.noResponse).toBe(1);
    expect(ev.active).toBe(2);   // p1 + p3 onlayn
    expect(ev.eligible).toBe(3);
  });

  it('late answer marked late but still accepted counts as accepted', () => {
    const ev = computeQuestionEvidence({
      sessionId: 's1',
      questionId: 'q1',
      participants: { p1: p('p1') },
      answers: { p1: ans({ isCorrect: true, late: true, elapsedMs: 45000 }) },
    });
    expect(ev.accepted).toBe(1);
    expect(ev.correct).toBe(1);
    expect(ev.lateJoin).toBe(0);
    expect(ev.technicalFailure).toBe(0);
  });

  it('computes distractor distribution with count and percent', () => {
    const ev = computeQuestionEvidence({
      sessionId: 's1',
      questionId: 'q1',
      participants: { p1: p('p1'), p2: p('p2'), p3: p('p3'), p4: p('p4') },
      answers: {
        p1: ans({ selectedOptionIds: ['o_b'] }),
        p2: ans({ selectedOptionIds: ['o_b'] }),
        p3: ans({ selectedOptionIds: ['o_a'] }),
        p4: ans({ selectedOptionIds: ['o_c'] }),
      },
    });
    expect(ev.distribution).toEqual([
      { optionId: 'o_b', count: 2, percent: 50 },
      { optionId: 'o_a', count: 1, percent: 25 },
      { optionId: 'o_c', count: 1, percent: 25 },
    ]);
  });

  it('tracks confidence coverage separately', () => {
    const ev = computeQuestionEvidence({
      sessionId: 's1',
      questionId: 'q1',
      participants: { p1: p('p1'), p2: p('p2'), p3: p('p3') },
      answers: {
        p1: ans({ confidence: 0.8 }),
        p2: ans({ confidence: 0.5 }),
        p3: ans({}),  // confidence yo'q
      },
    });
    expect(ev.confidenceCoverage).toBe(2);
    expect(ev.confidencePercent).toBe(67);
  });

  it('computes descriptive response-time aggregate', () => {
    const ev = computeQuestionEvidence({
      sessionId: 's1',
      questionId: 'q1',
      participants: { p1: p('p1'), p2: p('p2'), p3: p('p3') },
      answers: {
        p1: ans({ elapsedMs: 1000 }),
        p2: ans({ elapsedMs: 3000 }),
        p3: ans({ elapsedMs: 5000 }),
      },
    });
    expect(ev.responseTime.count).toBe(3);
    expect(ev.responseTime.avgMs).toBe(3000);
    expect(ev.responseTime.medianMs).toBe(3000);
    expect(ev.responseTime.minMs).toBe(1000);
    expect(ev.responseTime.maxMs).toBe(5000);
  });

  it('returns null response-time aggregate when no answers', () => {
    const ev = computeQuestionEvidence({ sessionId: 's', questionId: 'q', participants: {}, answers: {} });
    expect(ev.responseTime).toEqual({ count: 0, avgMs: null, medianMs: null, p90Ms: null, minMs: null, maxMs: null });
  });

  it('separates first vote (attemptNo=1) from revote (attemptNo=2) evidence', () => {
    const first = computeQuestionEvidence({
      sessionId: 's1', questionId: 'q1', attemptNo: 1,
      participants: { p1: p('p1'), p2: p('p2') },
      answers: { p1: ans({ isCorrect: false, selectedOptionIds: ['o_a'] }) },
    });
    const revote = computeQuestionEvidence({
      sessionId: 's1', questionId: 'q1', attemptNo: 2,
      participants: { p1: p('p1'), p2: p('p2') },
      answers: { p1: ans({ isCorrect: true, selectedOptionIds: ['o_b'] }) },
    });
    expect(first.attemptNo).toBe(1);
    expect(first.correct).toBe(0);
    expect(first.incorrect).toBe(1);
    expect(revote.attemptNo).toBe(2);
    expect(revote.correct).toBe(1);
    expect(revote.incorrect).toBe(0);
  });

  it('tiny counts do not leak individual identity into aggregate', () => {
    const ev = computeQuestionEvidence({
      sessionId: 's1', questionId: 'q1',
      participants: { p1: p('p1') },
      answers: { p1: ans({ isCorrect: true }) },
    });
    // Aggregate panelda faqat sonlar — ism/participantId YO'Q
    expect(JSON.stringify(ev)).not.toContain('displayAlias');
    expect(JSON.stringify(ev)).not.toContain('Pp1');
    expect(ev.namedDrilldownAvailable).toBe(false);
  });
});

describe('evidence projections', () => {
  const ev = computeQuestionEvidence({
    sessionId: 's1', questionId: 'q1',
    participants: { p1: p('p1'), p2: p('p2'), p3: p('p3'), p4: p('p4') },
    answers: {
      p1: ans({ isCorrect: true }),
      p2: ans({ isCorrect: false }),
      p3: ans({ isCorrect: true }),
    },
    revision: 9,
  });

  it('director projection contains full aggregate (count + denominator)', () => {
    const d = directorEvidenceProjection(ev);
    expect(d.correct).toBe(2);
    expect(d.incorrect).toBe(1);
    expect(d.accuracyPercent).toBe(67);
    expect(d.eligible).toBe(4);
    expect(d.distribution).toHaveLength(1);
    expect(d.responseTime.avgMs).toBe(4200);
  });

  it('public projection exposes ONLY aggregate counts — no correct/incorrect/distractor', () => {
    const pub = publicEvidenceProjection(ev);
    expect(pub.accepted).toBe(3);
    expect(pub.responseRate).toBe(75);
    expect(pub.eligible).toBe(4);
    // Xavfsiz: individual splitlar public'ga chiqmaydi
    expect(pub.correct).toBeUndefined();
    expect(pub.incorrect).toBeUndefined();
    expect(pub.distribution).toBeUndefined();
    expect(pub.noResponse).toBeUndefined();
  });
});

describe('describeResponseTimes', () => {
  it('computes median and p90', () => {
    const r = describeResponseTimes([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
    expect(r.medianMs).toBe(5500);
    expect(r.p90Ms).toBe(10000);
    expect(r.count).toBe(10);
  });
});
