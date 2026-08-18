/**
 * Edikit — Cast Whole-Class Goal va Personal Best (C3-09) Tests
 * ---------------------------------------------------------------
 * coverage: validateClassGoal, computeClassGoalProgress, buildGoalCompleteEvent,
 *           evidenceToGoalCounters, computeComparableFingerprint,
 *           isComparableSession, computePersonalProgress, buildPersonalBest,
 *           canShowPublic, CLASS_GOAL_TYPES, PERSONAL_BEST_VISIBILITY
 */

import { describe, it, expect } from 'vitest';
import {
  CLASS_GOAL_TYPES,
  CLASS_GOAL_TYPE_LIST,
  CLASS_GOAL_STATUS,
  validateClassGoal,
  computeClassGoalProgress,
  buildGoalCompleteEvent,
  evidenceToGoalCounters,
} from '../../services/cast/class-goal-service.js';
import {
  PERSONAL_BEST_VISIBILITY,
  computeComparableFingerprint,
  isComparableSession,
  computePersonalProgress,
  buildPersonalBest,
  canShowPublic,
} from '../../services/cast/personal-progress-service.js';

// ── Tests ──
describe('C3-09: Whole-Class Goal va Personal Best', () => {

  describe('CLASS_GOAL_TYPES', () => {
    it('has 4 goal types', () => {
      expect(Object.keys(CLASS_GOAL_TYPES).length).toBe(4);
      expect(CLASS_GOAL_TYPE_LIST).toEqual([
        'accuracy_threshold', 'misconceptions_resolved', 'knowledge_points', 'mastery_rounds',
      ]);
    });

    it('has active/complete statuses', () => {
      expect(CLASS_GOAL_STATUS.ACTIVE).toBe('active');
      expect(CLASS_GOAL_STATUS.COMPLETE).toBe('complete');
    });
  });

  describe('validateClassGoal', () => {
    it('accepts valid accuracy goal', () => {
      const r = validateClassGoal({ type: 'accuracy_threshold', target: 80 });
      expect(r.valid).toBe(true);
    });

    it('accepts valid knowledge_points goal', () => {
      const r = validateClassGoal({ type: 'knowledge_points', target: 50 });
      expect(r.valid).toBe(true);
    });

    it('rejects null goal', () => {
      const r = validateClassGoal(null);
      expect(r.valid).toBe(false);
    });

    it('rejects unknown type', () => {
      const r = validateClassGoal({ type: 'speed_run', target: 10 });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Noma\'lum');
    });

    it('rejects non-positive target', () => {
      const r = validateClassGoal({ type: 'knowledge_points', target: 0 });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('musbat');
    });

    it('rejects accuracy target > 100', () => {
      const r = validateClassGoal({ type: 'accuracy_threshold', target: 150 });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('1–100');
    });
  });

  describe('computeClassGoalProgress', () => {
    const questions = {
      q1: { correct: 8, incorrect: 2 },  // 80%
      q2: { correct: 4, incorrect: 6 },  // 40%
    };

    it('accuracy_threshold — class weighted accuracy', () => {
      const p = computeClassGoalProgress({ goal: { type: 'accuracy_threshold', target: 70 }, questions });
      // (8+4)/(10+10) = 60%
      expect(p.current).toBe(60);
      expect(p.percent).toBe(Math.round((60 / 70) * 100));
      expect(p.unit).toBe('%');
      expect(p.status).toBe(CLASS_GOAL_STATUS.ACTIVE);
    });

    it('accuracy_threshold complete when reached', () => {
      const p = computeClassGoalProgress({ goal: { type: 'accuracy_threshold', target: 60 }, questions });
      expect(p.status).toBe(CLASS_GOAL_STATUS.COMPLETE);
      expect(p.percent).toBe(100);
    });

    it('knowledge_points sums correct answers', () => {
      const p = computeClassGoalProgress({ goal: { type: 'knowledge_points', target: 10 }, questions });
      expect(p.current).toBe(12);
      expect(p.unit).toBe('ball');
      expect(p.status).toBe(CLASS_GOAL_STATUS.COMPLETE);
    });

    it('knowledge_points not complete when below target', () => {
      const p = computeClassGoalProgress({ goal: { type: 'knowledge_points', target: 20 }, questions });
      expect(p.status).toBe(CLASS_GOAL_STATUS.ACTIVE);
    });

    it('misconceptions_resolved uses events counter', () => {
      const p = computeClassGoalProgress({ goal: { type: 'misconceptions_resolved', target: 5 }, questions, events: { misconceptionsResolved: 3 } });
      expect(p.current).toBe(3);
      expect(p.unit).toBe('ta');
      expect(p.status).toBe(CLASS_GOAL_STATUS.ACTIVE);
    });

    it('mastery_rounds uses events counter', () => {
      const p = computeClassGoalProgress({ goal: { type: 'mastery_rounds', target: 4 }, questions, events: { masteryRoundsCompleted: 5 } });
      expect(p.current).toBe(5);
      expect(p.unit).toBe('ta');
      expect(p.status).toBe(CLASS_GOAL_STATUS.COMPLETE);
    });

    it('no goal → empty progress', () => {
      const p = computeClassGoalProgress({ goal: null });
      expect(p.type).toBeNull();
      expect(p.current).toBe(0);
    });

    it('no questions → zero progress', () => {
      const p = computeClassGoalProgress({ goal: { type: 'knowledge_points', target: 10 }, questions: {} });
      expect(p.current).toBe(0);
    });
  });

  describe('buildGoalCompleteEvent', () => {
    it('returns null when not complete', () => {
      const p = computeClassGoalProgress({ goal: { type: 'knowledge_points', target: 100 }, questions: { q1: { correct: 1 } } });
      expect(buildGoalCompleteEvent(p)).toBeNull();
    });

    it('returns aggregate event when complete', () => {
      const p = computeClassGoalProgress({ goal: { type: 'knowledge_points', target: 1 }, questions: { q1: { correct: 1 } } });
      const ev = buildGoalCompleteEvent(p);
      expect(ev).not.toBeNull();
      expect(ev.type).toBe('cast:goalComplete');
      expect(ev.aggregate).toBe(true);
      expect(ev.participantId).toBeUndefined(); // no individual blame
    });
  });

  describe('evidenceToGoalCounters', () => {
    it('extracts correct/incorrect/accepted', () => {
      const c = evidenceToGoalCounters({ correct: 5, incorrect: 3, accepted: 8 });
      expect(c).toEqual({ correct: 5, incorrect: 3, accepted: 8 });
    });

    it('handles null evidence', () => {
      const c = evidenceToGoalCounters(null);
      expect(c).toEqual({ correct: 0, incorrect: 0, accepted: 0 });
    });
  });

  describe('computeComparableFingerprint + isComparableSession', () => {
    it('same config → same fingerprint', () => {
      const cfg = { scoring: { mode: 'accuracy', correctBase: 1000 }, timer: { mode: 'soft', defaultSeconds: 30 } };
      expect(computeComparableFingerprint(cfg)).toBe(computeComparableFingerprint(cfg));
    });

    it('different scoring mode → different fingerprint', () => {
      const a = computeComparableFingerprint({ scoring: { mode: 'accuracy' } });
      const b = computeComparableFingerprint({ scoring: { mode: 'speed' } });
      expect(a).not.toBe(b);
    });

    it('isComparableSession true for same fingerprint', () => {
      const fp = computeComparableFingerprint({ scoring: { mode: 'accuracy' } });
      expect(isComparableSession(fp, fp)).toBe(true);
    });

    it('isComparableSession false for different/null', () => {
      expect(isComparableSession('a', 'b')).toBe(false);
      expect(isComparableSession(null, 'a')).toBe(false);
    });
  });

  describe('computePersonalProgress', () => {
    const rosterLinked = { participantId: 'p1', displayAlias: 'Ali', rosterLinked: true };
    const answers = { q1: { isCorrect: true }, q2: { isCorrect: false }, q3: { isCorrect: true } };

    it('computes progress for roster-linked participant', () => {
      const p = computePersonalProgress({ participant: rosterLinked, answers, fingerprint: 'fp' });
      expect(p.available).toBe(true);
      expect(p.correct).toBe(2);
      expect(p.total).toBe(3);
      expect(p.accuracyPercent).toBe(67);
    });

    it('blocked for non-roster-linked participant', () => {
      const p = computePersonalProgress({ participant: { participantId: 'p2', rosterLinked: false }, answers, fingerprint: 'fp' });
      expect(p.available).toBe(false);
      expect(p.reason).toBe('not_roster_linked');
    });

    it('blocked for shared-device', () => {
      const p = computePersonalProgress({ participant: { participantId: 'p3', rosterLinked: true, sharedDevice: true }, answers, fingerprint: 'fp' });
      expect(p.available).toBe(false);
      expect(p.reason).toBe('shared_device');
    });

    it('blocked without participant', () => {
      const p = computePersonalProgress({ participant: null, answers, fingerprint: 'fp' });
      expect(p.available).toBe(false);
    });

    it('no answers → zero progress', () => {
      const p = computePersonalProgress({ participant: rosterLinked, answers: {}, fingerprint: 'fp' });
      expect(p.correct).toBe(0);
      expect(p.total).toBe(0);
      expect(p.accuracyPercent).toBe(0);
    });
  });

  describe('buildPersonalBest + canShowPublic', () => {
    const progress = { available: true, participantId: 'p1', correct: 2, total: 3, accuracyPercent: 67, fingerprint: 'fp' };

    it('default visibility private', () => {
      const pb = buildPersonalBest({ participant: { participantId: 'p1' }, progress });
      expect(pb.available).toBe(true);
      expect(pb.visibility).toBe(PERSONAL_BEST_VISIBILITY.PRIVATE);
      expect(pb.publicVisible).toBe(false);
    });

    it('opt-in public visible', () => {
      const pb = buildPersonalBest({ participant: { participantId: 'p1' }, progress, visibility: PERSONAL_BEST_VISIBILITY.OPT_IN_PUBLIC });
      expect(pb.publicVisible).toBe(true);
      expect(canShowPublic(pb)).toBe(true);
    });

    it('private never public', () => {
      const pb = buildPersonalBest({ participant: { participantId: 'p1' }, progress, visibility: PERSONAL_BEST_VISIBILITY.PRIVATE });
      expect(canShowPublic(pb)).toBe(false);
    });

    it('unavailable progress → unavailable', () => {
      const pb = buildPersonalBest({ participant: { participantId: 'p1' }, progress: { available: false } });
      expect(pb.available).toBe(false);
      expect(canShowPublic(pb)).toBe(false);
    });
  });
});