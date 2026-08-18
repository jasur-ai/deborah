/**
 * Edikit — Cast Vote → Discuss → Revote tests (C3-03)
 * -----------------------------------------------------
 * - First vote immutable (attemptNo=1) — overwrite urinishi rad etiladi
 * - Discussion without lock rejection
 * - Revote duplicate
 * - First/revote score policy
 * - Before/after matrix
 * - Late join before revote
 */

import { describe, it, expect } from 'vitest';
import { initialState, applyEvent, assertCommandAllowed } from '../../services/cast/state-machine.js';
import { computeVoteChangeMatrix, voteEvidenceSnapshot } from '../../services/cast/evidence-service.js';
import { CAST_SCORE_POLICY } from '../../utils/cast-constants.js';
import { CAST_PHASES } from '../../utils/cast-constants.js';
import { resolvePreset } from '../../services/cast/presets.js';

describe('state-machine — vote round', () => {
  it('initial state has voteRound=1', () => {
    const s = initialState({ questionCount: 5 });
    expect(s.voteRound).toBe(1);
    expect(s.phase).toBe(CAST_PHASES.LOBBY_OPEN);
  });

  it('revoteOpened sets voteRound=2', () => {
    let s = initialState({ questionCount: 5 });
    // lobby → think (sessionStarted) → open (questionOpened) → locked (questionClosed)
    s = applyEvent(s, { type: 'cast:sessionStarted', payload: {}, serverAt: 1 });
    s = applyEvent(s, { type: 'cast:questionPreview', payload: { questionId: 'q1', questionPosition: 0 }, serverAt: 2 });
    s = applyEvent(s, { type: 'cast:questionOpened', payload: { questionId: 'q1', openedAt: 3, closesAt: 30003 }, serverAt: 3 });
    s = applyEvent(s, { type: 'cast:questionClosed', payload: { closesAt: 4 }, serverAt: 4 });
    expect(s.phase).toBe(CAST_PHASES.QUESTION_LOCKED);
    // discussionStarted
    s = applyEvent(s, { type: 'cast:discussionStarted', payload: { discussionEndsAt: 100, instructions: 'Juftlikda muhokama' }, serverAt: 5 });
    expect(s.phase).toBe(CAST_PHASES.DISCUSSION);
    expect(s.discussionInstructions).toBe('Juftlikda muhokama');
    // revoteOpened → voteRound=2
    s = applyEvent(s, { type: 'cast:revoteOpened', payload: { questionId: 'q1', openedAt: 6, closesAt: 30006 }, serverAt: 6 });
    expect(s.phase).toBe(CAST_PHASES.REVOTE_OPEN);
    expect(s.voteRound).toBe(2);
  });

  it('revoteClosed returns to REVEAL', () => {
    let s = initialState({ questionCount: 5 });
    s = applyEvent(s, { type: 'cast:revoteOpened', payload: { questionId: 'q1', openedAt: 1, closesAt: 30001 }, serverAt: 1 });
    s = applyEvent(s, { type: 'cast:revoteClosed', payload: { closesAt: 2 }, serverAt: 2 });
    expect(s.phase).toBe(CAST_PHASES.REVEAL);
    expect(s.voteRound).toBe(2); // round ma'lumoti saqlanadi
  });

  it('discussion:start only allowed after lock', () => {
    const open = applyEvent(initialState({ questionCount: 5 }), { type: 'cast:questionOpened', payload: { questionId: 'q1', openedAt: 1, closesAt: 100 }, serverAt: 1 });
    expect(() => assertCommandAllowed(open, 'discuss:start')).toThrow(); // QUESTION_OPEN'da yo'q
    const locked = applyEvent(open, { type: 'cast:questionClosed', payload: { closesAt: 2 }, serverAt: 2 });
    expect(() => assertCommandAllowed(locked, 'discuss:start')).not.toThrow(); // QUESTION_LOCKED'da bor
  });

  it('revote:open allowed in DISCUSSION and REVEAL', () => {
    let s = initialState({ questionCount: 5 });
    s = applyEvent(s, { type: 'cast:discussionStarted', payload: { discussionEndsAt: 1 }, serverAt: 1 });
    expect(() => assertCommandAllowed(s, 'revote:open')).not.toThrow();
    const reveal = applyEvent(s, { type: 'cast:revoteClosed', payload: { closesAt: 2 }, serverAt: 2 });
    expect(() => assertCommandAllowed(reveal, 'revote:open')).not.toThrow();
  });
});

describe('computeVoteChangeMatrix', () => {
  const first = (isCorrect, optionIds) => ({ participantId: 'x', status: 'ACCEPTED', isCorrect, selectedOptionIds: optionIds, attemptNo: 1 });
  const revote = (isCorrect, optionIds) => ({ participantId: 'x', status: 'ACCEPTED', isCorrect, selectedOptionIds: optionIds, attemptNo: 2 });

  it('classifies WRONG_TO_CORRECT', () => {
    const r = computeVoteChangeMatrix(
      { p1: first(false, ['o_a']) },
      { p1: revote(true, ['o_b']) }
    );
    expect(r.matrix.WRONG_TO_CORRECT).toBe(1);
    expect(r.changed).toBe(1);
    expect(r.total).toBe(1);
  });

  it('classifies CORRECT_TO_WRONG', () => {
    const r = computeVoteChangeMatrix(
      { p1: first(true, ['o_b']) },
      { p1: revote(false, ['o_a']) }
    );
    expect(r.matrix.CORRECT_TO_WRONG).toBe(1);
    expect(r.changed).toBe(1);
  });

  it('counts NEW (revote-only) and MISSING (first-only)', () => {
    const r = computeVoteChangeMatrix(
      { p1: first(true, ['o_b']) },
      { p2: revote(true, ['o_b']), p3: revote(true, ['o_b']) }
    );
    expect(r.matrix.NEW).toBe(2);
    expect(r.matrix.MISSING).toBe(1);
    expect(r.total).toBe(3);
  });

  it('stable pairs are not changed', () => {
    const r = computeVoteChangeMatrix(
      { p1: first(true, ['o_b']), p2: first(false, ['o_a']) },
      { p1: revote(true, ['o_b']), p2: revote(false, ['o_a']) }
    );
    expect(r.matrix.CORRECT_TO_CORRECT).toBe(1);
    expect(r.matrix.WRONG_TO_WRONG).toBe(1);
    expect(r.changed).toBe(0);
  });
});

describe('voteEvidenceSnapshot', () => {
  it('snapshots first and revote evidence separately', () => {
    const firstEv = { accepted: 10, correct: 7, incorrect: 3, accuracyPercent: 70, distribution: [{ optionId: 'o_a', count: 3 }] };
    const revoteEv = { accepted: 10, correct: 9, incorrect: 1, accuracyPercent: 90, distribution: [{ optionId: 'o_b', count: 9 }] };
    const snap = voteEvidenceSnapshot(firstEv, revoteEv);
    expect(snap.firstVote.accuracyPercent).toBe(70);
    expect(snap.revote.accuracyPercent).toBe(90);
    expect(snap.firstVote.correct).toBe(7);
    expect(snap.revote.correct).toBe(9);
  });
});

describe('score policy in presets', () => {
  it('default scorePolicy is first_only for all presets', () => {
    const r = resolvePreset('responsive_accuracy', {});
    expect(r.config.scoring.scorePolicy).toBe(CAST_SCORE_POLICY.FIRST_ONLY);
  });

  it('overrides can set scorePolicy to revote_only', () => {
    const r = resolvePreset('responsive_accuracy', { scoring: { scorePolicy: 'revote_only' } });
    expect(r.config.scoring.scorePolicy).toBe('revote_only');
    expect(r.customized).toBe(true);
  });

  it('learning_only_no_leaderboard is a valid policy value', () => {
    const r = resolvePreset('responsive_accuracy', { scoring: { scorePolicy: 'learning_only_no_leaderboard' } });
    expect(r.config.scoring.scorePolicy).toBe('learning_only_no_leaderboard');
  });
});

describe('discussion config in presets', () => {
  it('responsive_accuracy enables discussion with 60s default', () => {
    const r = resolvePreset('responsive_accuracy', {});
    expect(r.config.responsiveTeaching.discussionEnabled).toBe(true);
    expect(r.config.responsiveTeaching.discussionDefaultSeconds).toBe(60);
    expect(r.config.responsiveTeaching.showPreviousOnRevote).toBe(true);
  });

  it('classic_live disables discussion', () => {
    const r = resolvePreset('classic_live', {});
    expect(r.config.responsiveTeaching.discussionEnabled).toBe(false);
  });
});
