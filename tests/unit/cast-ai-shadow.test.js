/**
 * Edikit — AI Co-host Shadow Service/Adapter unit testlari (C5-11)
 *
 * Reja item qamrovi:
 *   1. buildShadowBaseline — rule engine output → baseline
 *   2. buildShadowInput — aggregate/de-identified (PII yo'q)
 *   3. parseSuggestion — strict schema
 *   4. runShadowSuggestion — timeout/cost cap
 *   5. (socket/UI — integration qamrovda)
 *   6. recordShadowDecision — accept/dismiss event
 *   7. suggestion hech qachon live action emas — allowed set tekshiruvi
 *   8. assertSuggestionAllowed — forbidden actionlar rad etiladi
 *   9. evaluateShadowRun — correctness/false interruption/acceptance/subgroup
 *  10. computeShadowGate / shouldPromoteToSuggestion — gate
 */

import { describe, it, expect } from 'vitest';

import {
  SHADOW_FORBIDDEN_ACTIONS,
  SHADOW_ALLOWED_ACTIONS,
  parseSuggestion,
  assertSuggestionAllowed,
  buildShadowBaseline,
  buildShadowInput,
  evaluateShadowRun,
  computeShadowGate,
  shouldPromoteToSuggestion,
  recordShadowDecision,
  SUGGESTION_VERSION,
} from '../../services/cast/ai-shadow-service.js';
import { runShadowSuggestion, heuristicSuggestion } from '../../services/cast/ai-shadow-adapter.js';

describe('C5-11 AI Co-host shadow — item 1: buildShadowBaseline', () => {
  it('evidence/hinge/confusion dan de-identified baseline yigadi', () => {
    const baseline = buildShadowBaseline({
      evidence: { participationRate: 0.7, accuracyRate: 0.55, responseTimeMs: 8200, voteShiftAfterDiscussion: 0.12 },
      hinge: { recommendation: 'DISCUSS', ruleVersion: 'hinge_v1' },
      confusion: { total: 20, counts: { confused: 8 } },
      votes: { total: 20, correctRate: 0.5 },
    });
    expect(baseline.version).toBe('shadow_baseline_v1');
    expect(baseline.aggregate.participationRate).toBeCloseTo(0.7);
    expect(baseline.aggregate.accuracyRate).toBeCloseTo(0.55);
    expect(baseline.hinge).toBe('DISCUSS');
    expect(baseline.confusion.rate).toBeCloseTo(0.4);
    // Hech qanday PII (participant id, name, free text) yo'q
    expect(JSON.stringify(baseline)).not.toContain('participant');
  });

  it('empty input uchun safe baseline qaytaradi', () => {
    const baseline = buildShadowBaseline({});
    expect(baseline.aggregate.participationRate).toBe(0);
    expect(baseline.hinge).toBeNull();
    expect(baseline.confusion).toBeNull();
  });
});

describe('C5-11 — item 2: buildShadowInput de-identified', () => {
  it('faqat baseline + pedagogy — session code / join code / names kirmaydi', () => {
    const baseline = buildShadowBaseline({ evidence: { accuracyRate: 0.6 } });
    const input = buildShadowInput({
      baseline,
      config: { ai: { cohostMode: 'shadow' }, playback: { thinkSeconds: 5 }, scoring: { mode: 'accuracy' } },
      context: { pace: 'instructor', phase: 'QUESTION_OPEN', questionIndex: 3 },
    });
    expect(input.pedagogy.pace).toBe('instructor');
    expect(input.pedagogy.phase).toBe('QUESTION_OPEN');
    expect(input.pedagogy.cohostMode).toBe('shadow');
    expect(input.pedagogy.scoreMode).toBe('accuracy');
    const raw = JSON.stringify(input);
    expect(raw).not.toContain('sessionId');
    expect(raw).not.toContain('joinCode');
  });
});

describe('C5-11 — item 3: parseSuggestion strict schema', () => {
  it("to'g'ri suggestion parse qilinadi", () => {
    const res = parseSuggestion({
      kind: 'pace',
      message: 'Ko\'pchilik chalkashdi — sekinlashtiramiz',
      action: 'pace:slow',
      confidence: 0.8,
    });
    expect(res.ok).toBe(true);
    expect(res.suggestion.action).toBe('pace:slow');
  });

  it('extra key / noto\'g\'ri kind rad etiladi (strict)', () => {
    const extra = parseSuggestion({ kind: 'pace', message: 'x', unexpected: true });
    expect(extra.ok).toBe(false);
    const badKind = parseSuggestion({ kind: 'hack', message: 'x' });
    expect(badKind.ok).toBe(false);
    const empty = parseSuggestion({ kind: 'pace', message: '' });
    expect(empty.ok).toBe(false);
  });

  it('null/undefined rad etiladi', () => {
    expect(parseSuggestion(null).ok).toBe(false);
    expect(parseSuggestion(undefined).ok).toBe(false);
  });
});

describe('C5-11 — item 7/8: forbidden actionlar rad etiladi, live action yo\'q', () => {
  it('barcha forbidden actionlar rad etiladi', () => {
    for (const action of Object.values(SHADOW_FORBIDDEN_ACTIONS)) {
      const reason = assertSuggestionAllowed({ action });
      expect(reason).toBe(`forbidden-action:${action}`);
    }
  });

  it('allowed soft actionlar o\'tadi', () => {
    expect(assertSuggestionAllowed({ action: SHADOW_ALLOWED_ACTIONS.REVOTE })).toBeNull();
    expect(assertSuggestionAllowed({ action: SHADOW_ALLOWED_ACTIONS.DISCUSS })).toBeNull();
    expect(assertSuggestionAllowed({ action: null })).toBeNull();
    expect(assertSuggestionAllowed({})).toBeNull();
  });

  it('noma\'lum action rad etiladi', () => {
    expect(assertSuggestionAllowed({ action: 'system:shutdown' })).toBe('unknown-action:system:shutdown');
  });

  it('suggestion payloadida hech qachon live command yo\'q — faqat card', () => {
    // Har qanday qabul qilingan suggestion action'i SHADOW_ALLOWED_ACTIONS dan
    const good = parseSuggestion({ kind: 'intervention', message: 'test', action: 'content:hinge_review' });
    expect(good.ok).toBe(true);
    expect(assertSuggestionAllowed(good.suggestion)).toBeNull();
  });
});

describe('C5-11 — item 4: adapter timeout/cost cap', () => {
  it('timeout chegarasi ishlaydi', async () => {
    // Fetch kabi abort signalini hurmat qiladigan provider
    const slow = async ({ signal }) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ kind: 'question', message: 'kech' }), 200);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    };
    const res = await runShadowSuggestion({ shadowInput: {}, opts: { timeoutMs: 30, callProvider: slow } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout/);
  });

  it('hard timeout — signal\'ni hurmat qilmaydigan provider ham rad etiladi', async () => {
    // Abort signal'ni tekshirmaydigan provider — 200ms keyin natija beradi,
    // lekin deadline 30ms o'tgan → post-await abort check rad etishi kerak.
    const stubborn = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { kind: 'question', message: 'kechikkan' };
    };
    const res = await runShadowSuggestion({ shadowInput: {}, opts: { timeoutMs: 30, callProvider: stubborn } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout/);
  });

  it('cost cap qo\'llanadi', async () => {
    // Message 280 char ichida (strict schema max) — cost token hajmiga bog'liq
    const big = async () => ({ kind: 'question', message: 'x'.repeat(240) });
    const res = await runShadowSuggestion({ shadowInput: {}, opts: { maxCostUs: 10, callProvider: big } });
    expect(res.ok).toBe(true);
    expect(res.costUs).toBeLessThanOrEqual(10);
  });

  it('provider yo\'q bo\'lsa heuristic fallback ishlaydi', async () => {
    const res = await runShadowSuggestion({ shadowInput: {} });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe('heuristic');
    expect(['pace', 'question', 'intervention', 'climate']).toContain(res.suggestion.kind);
  });

  it('forbidden action qaytarsa rad etiladi', async () => {
    const evil = async () => ({ kind: 'intervention', message: 'reveal', action: 'answer:reveal' });
    const res = await runShadowSuggestion({ shadowInput: {}, opts: { callProvider: evil } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/forbidden-action/);
  });
});

describe('C5-11 — item 6/9: evaluateShadowRun + recordShadowDecision', () => {
  it('correctness baseline hinge bilan mos bo\'lsa 1', () => {
    const ev = evaluateShadowRun({
      suggestion: { id: 's1', kind: 'intervention', action: 'discuss:start' },
      baseline: { hinge: 'DISCUSS' },
      decision: 'accepted',
      latencyMs: 120,
      costUs: 40,
    });
    expect(ev.correctness).toBe(1);
    expect(ev.accepted).toBe(true);
    expect(ev.latencyMs).toBe(120);
    expect(ev.costUs).toBe(40);
    expect(ev.version).toBe(SUGGESTION_VERSION);
  });

  it('dismiss → falseInterruption', () => {
    const ev = evaluateShadowRun({ suggestion: { id: 's2' }, decision: 'dismissed' });
    expect(ev.dismissed).toBe(true);
    expect(ev.falseInterruption).toBe(1);
  });

  it('subgroup effect kuzatiladi', () => {
    const ev = evaluateShadowRun({ suggestion: { id: 's3', subgroupId: 'g1' }, decision: 'pending' });
    expect(ev.subgroup).toEqual({ subgroupId: 'g1' });
  });

  it('recordShadowDecision valid decisionni record qiladi, invalidni rad etadi', () => {
    const ok = recordShadowDecision({ suggestion: { action: 'pace:slow' }, decision: 'accepted' });
    expect(ok.ok).toBe(true);
    const bad = recordShadowDecision({ suggestion: { action: 'pace:slow' }, decision: 'maybe' });
    expect(bad.ok).toBe(false);
    const forbidden = recordShadowDecision({ suggestion: { action: 'score:change' }, decision: 'accepted' });
    expect(forbidden.ok).toBe(false);
  });
});

describe('C5-11 — item 10: shadow evaluation gate', () => {
  function makeRuns(n, { accepted = n, dismissed = 0, correctness = null, latencyMs = null } = {}) {
    const runs = [];
    for (let i = 0; i < n; i += 1) {
      runs.push({
        suggestionId: `s${i}`,
        decision: i < accepted ? 'accepted' : i < accepted + dismissed ? 'dismissed' : 'pending',
        accepted: i < accepted,
        dismissed: i >= accepted && i < accepted + dismissed,
        correctness,
        latencyMs,
      });
    }
    return runs;
  }

  it('yetarli run + yaxshi acceptance/correctness → pass', () => {
    const runs = makeRuns(12, { accepted: 10, dismissed: 2, correctness: 1, latencyMs: 500 });
    const gate = computeShadowGate({ runs });
    expect(gate.pass).toBe(true);
    expect(gate.stats.runs).toBe(12);
    expect(gate.stats.acceptanceRate).toBeCloseTo(10 / 12);
  });

  it('min-runs yetmasa fail', () => {
    const runs = makeRuns(3, { accepted: 3, correctness: 1 });
    const gate = computeShadowGate({ runs });
    expect(gate.pass).toBe(false);
    expect(gate.reasons).toContain('min-runs:3<10');
  });

  it('acceptance past bo\'lsa fail', () => {
    const runs = makeRuns(12, { accepted: 3, dismissed: 9, correctness: 1 });
    const gate = computeShadowGate({ runs });
    expect(gate.pass).toBe(false);
    expect(gate.reasons.some((r) => r.startsWith('acceptance'))).toBe(true);
  });

  it('false interruption yuqori bo\'lsa fail', () => {
    const runs = makeRuns(12, { accepted: 6, dismissed: 6, correctness: 1 });
    const gate = computeShadowGate({ runs });
    expect(gate.pass).toBe(false);
    expect(gate.reasons.some((r) => r.startsWith('false-interruption'))).toBe(true);
  });

  it('shouldPromoteToSuggestion — pass bo\'lsa suggestion mode, aks holda shadow', () => {
    const good = shouldPromoteToSuggestion({ runs: makeRuns(12, { accepted: 11, dismissed: 1, correctness: 1, latencyMs: 400 }) });
    expect(good.canPromote).toBe(true);
    expect(good.nextMode).toBe('suggestion');
    const bad = shouldPromoteToSuggestion({ runs: makeRuns(2, { accepted: 2 }) });
    expect(bad.canPromote).toBe(false);
    expect(bad.nextMode).toBe('shadow');
  });

  it('empty runs → fail', () => {
    const gate = computeShadowGate({ runs: [] });
    expect(gate.pass).toBe(false);
    expect(gate.reasons).toContain('no-runs');
  });
});

describe('C5-11 — heuristicSuggestion deterministik', () => {
  it('confusion baland bo\'lsa pace:slow taklif qiladi', () => {
    const s = heuristicSuggestion({
      shadowInput: {
        baseline: buildShadowBaseline({ confusion: { total: 10, counts: { confused: 6 } } }),
      },
    });
    expect(s.action).toBe('pace:slow');
    expect(s.kind).toBe('pace');
  });

  it('hinge bo\'lsa hinge_review taklif qiladi', () => {
    const s = heuristicSuggestion({
      shadowInput: { baseline: buildShadowBaseline({ hinge: { recommendation: 'RETEACH' } }) },
    });
    expect(s.action).toBe('content:hinge_review');
  });

  it('hech narsa bo\'lmasa neytral qaytaradi (action null)', () => {
    const s = heuristicSuggestion({ shadowInput: { baseline: buildShadowBaseline({}) } });
    expect(s.action).toBeNull();
    expect(s.kind).toBe('question');
  });
});
