/**
 * Deborah — Cast Mastery, Transfer va Redemption (C3-08) Tests
 * ------------------------------------------------------------
 * coverage: validateTransferMapping, buildMasteryContract,
 *           computeLearningProgress, checkRedemptionLimit, buildNextStep,
 *           MASTERY_FLOW_TYPES, LEADERBOARD_IMPACT, LEARNING_PROGRESS
 */

import { describe, it, expect } from 'vitest';
import {
  MASTERY_FLOW_TYPES,
  MASTERY_FLOW_TYPE_LIST,
  LEADERBOARD_IMPACT,
  LEARNING_PROGRESS,
  DEFAULT_REDEMPTION_LIMIT,
  validateTransferMapping,
  buildMasteryContract,
  computeLearningProgress,
  checkRedemptionLimit,
  buildNextStep,
} from '../../services/cast/mastery-service.js';

// ── Helpers ──
const privateQuestions = {
  'q_04': { id: 'q_04', correctOptionIds: ['b'], options: [{ id: 'a' }, { id: 'b' }] },
  'q_18': { id: 'q_18', correctOptionIds: ['x'], options: [{ id: 'x' }, { id: 'y' }] },
};

const correctSource = { questionId: 'q_04', isCorrect: true };
const wrongSource = { questionId: 'q_04', isCorrect: false };
const correctFollowUp = { questionId: 'q_18', isCorrect: true };
const wrongFollowUp = { questionId: 'q_18', isCorrect: false };

// ── Tests ──
describe('C3-08: Mastery, Transfer va Redemption', () => {

  describe('Constants', () => {
    it('MASTERY_FLOW_TYPES has 2 types', () => {
      expect(Object.keys(MASTERY_FLOW_TYPES).length).toBe(2);
      expect(MASTERY_FLOW_TYPE_LIST).toEqual(['TRANSFER', 'REDEMPTION']);
    });

    it('LEADERBOARD_IMPACT has NONE and SEPARATE', () => {
      expect(LEADERBOARD_IMPACT.NONE).toBe('NONE');
      expect(LEADERBOARD_IMPACT.SEPARATE).toBe('SEPARATE');
    });

    it('LEARNING_PROGRESS has 5 statuses', () => {
      expect(Object.keys(LEARNING_PROGRESS).length).toBe(5);
      expect(LEARNING_PROGRESS.FIRST_WRONG_TRANSFER_CORRECT).toBe('first_wrong_transfer_correct');
      expect(LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_CORRECT).toBe('first_wrong_redeemed_correct');
    });

    it('DEFAULT_REDEMPTION_LIMIT is 3', () => {
      expect(DEFAULT_REDEMPTION_LIMIT).toBe(3);
    });
  });

  describe('validateTransferMapping', () => {
    it('accepts valid TRANSFER mapping', () => {
      const r = validateTransferMapping({ sourceQuestionId: 'q_04', followUpQuestionId: 'q_18', type: 'TRANSFER', privateQuestions });
      expect(r.valid).toBe(true);
      expect(r.errors).toEqual([]);
    });

    it('accepts valid REDEMPTION mapping', () => {
      const r = validateTransferMapping({ sourceQuestionId: 'q_04', followUpQuestionId: 'q_18', type: 'REDEMPTION', privateQuestions });
      expect(r.valid).toBe(true);
    });

    it('rejects missing source', () => {
      const r = validateTransferMapping({ sourceQuestionId: '', followUpQuestionId: 'q_18', type: 'TRANSFER', privateQuestions });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Manba');
    });

    it('rejects missing follow-up', () => {
      const r = validateTransferMapping({ sourceQuestionId: 'q_04', followUpQuestionId: '', type: 'TRANSFER', privateQuestions });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Follow-up');
    });

    it('rejects unknown type', () => {
      const r = validateTransferMapping({ sourceQuestionId: 'q_04', followUpQuestionId: 'q_18', type: 'REVIEW', privateQuestions });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Noma\'lum');
    });

    it('rejects same source and follow-up', () => {
      const r = validateTransferMapping({ sourceQuestionId: 'q_04', followUpQuestionId: 'q_04', type: 'TRANSFER', privateQuestions });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('farqli');
    });

    it('rejects missing source question in store', () => {
      const r = validateTransferMapping({ sourceQuestionId: 'q_99', followUpQuestionId: 'q_18', type: 'TRANSFER', privateQuestions });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('topilmadi');
    });

    it('rejects missing follow-up question in store', () => {
      const r = validateTransferMapping({ sourceQuestionId: 'q_04', followUpQuestionId: 'q_99', type: 'TRANSFER', privateQuestions });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('topilmadi');
    });
  });

  describe('buildMasteryContract', () => {
    it('builds TRANSFER contract with NONE impact', () => {
      const c = buildMasteryContract({ sourceQuestionId: 'q_04', followUpQuestionId: 'q_18', type: 'TRANSFER' });
      expect(c).toEqual({
        sourceQuestionId: 'q_04',
        followUpQuestionId: 'q_18',
        type: 'TRANSFER',
        attemptNo: 1,
        leaderboardImpact: 'NONE',
      });
    });

    it('allows custom attemptNo and impact', () => {
      const c = buildMasteryContract({ sourceQuestionId: 'q_04', followUpQuestionId: 'q_18', type: 'REDEMPTION', attemptNo: 2, leaderboardImpact: 'SEPARATE' });
      expect(c.attemptNo).toBe(2);
      expect(c.leaderboardImpact).toBe('SEPARATE');
    });
  });

  describe('computeLearningProgress', () => {
    it('first correct → FIRST_CORRECT_STAYS', () => {
      const p = computeLearningProgress({ sourceAnswer: correctSource, followUpAnswer: correctFollowUp, type: 'TRANSFER' });
      expect(p.status).toBe(LEARNING_PROGRESS.FIRST_CORRECT_STAYS);
      expect(p.wrongToCorrect).toBe(false);
    });

    it('first wrong + transfer correct → FIRST_WRONG_TRANSFER_CORRECT', () => {
      const p = computeLearningProgress({ sourceAnswer: wrongSource, followUpAnswer: correctFollowUp, type: 'TRANSFER' });
      expect(p.status).toBe(LEARNING_PROGRESS.FIRST_WRONG_TRANSFER_CORRECT);
      expect(p.wrongToCorrect).toBe(true);
    });

    it('first wrong + redemption correct → FIRST_WRONG_REDEEMED_CORRECT', () => {
      const p = computeLearningProgress({ sourceAnswer: wrongSource, followUpAnswer: correctFollowUp, type: 'REDEMPTION' });
      expect(p.status).toBe(LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_CORRECT);
      expect(p.wrongToCorrect).toBe(true);
    });

    it('first wrong + redemption wrong → FIRST_WRONG_REDEEMED_WRONG', () => {
      const p = computeLearningProgress({ sourceAnswer: wrongSource, followUpAnswer: wrongFollowUp, type: 'REDEMPTION' });
      expect(p.status).toBe(LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_WRONG);
      expect(p.wrongToCorrect).toBe(false);
    });

    it('first wrong + transfer wrong → FIRST_WRONG_NO_FOLLOWUP', () => {
      const p = computeLearningProgress({ sourceAnswer: wrongSource, followUpAnswer: wrongFollowUp, type: 'TRANSFER' });
      expect(p.status).toBe(LEARNING_PROGRESS.FIRST_WRONG_NO_FOLLOWUP);
    });

    it('records question IDs', () => {
      const p = computeLearningProgress({ sourceAnswer: wrongSource, followUpAnswer: correctFollowUp, type: 'TRANSFER' });
      expect(p.sourceQuestionId).toBe('q_04');
      expect(p.followUpQuestionId).toBe('q_18');
    });
  });

  describe('checkRedemptionLimit', () => {
    it('allows when under limit', () => {
      const r = checkRedemptionLimit({ attemptsUsed: 1, limit: 3 });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(2);
    });

    it('blocks at limit', () => {
      const r = checkRedemptionLimit({ attemptsUsed: 3, limit: 3 });
      expect(r.allowed).toBe(false);
      expect(r.remaining).toBe(0);
    });

    it('blocks over limit', () => {
      const r = checkRedemptionLimit({ attemptsUsed: 5, limit: 3 });
      expect(r.allowed).toBe(false);
      expect(r.remaining).toBe(0);
    });

    it('uses default limit when not provided', () => {
      const r = checkRedemptionLimit({ attemptsUsed: 2 });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(1);
    });
  });

  describe('buildNextStep', () => {
    it('redeemed wrong → reteach', () => {
      const ns = buildNextStep({ sessionId: 's1', questionId: 'q_04', status: LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_WRONG, followUpQuestionId: 'q_18', flowType: 'REDEMPTION' });
      expect(ns.nextStep).toBe('qayta_ogatish');
    });

    it('redeemed correct → reinforcement', () => {
      const ns = buildNextStep({ sessionId: 's1', questionId: 'q_04', status: LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_CORRECT, followUpQuestionId: 'q_18', flowType: 'REDEMPTION' });
      expect(ns.nextStep).toBe('mustahkamlash');
    });

    it('transfer correct → transfer mastered', () => {
      const ns = buildNextStep({ sessionId: 's1', questionId: 'q_04', status: LEARNING_PROGRESS.FIRST_WRONG_TRANSFER_CORRECT, followUpQuestionId: 'q_18', flowType: 'TRANSFER' });
      expect(ns.nextStep).toBe('transfer_oylashtirildi');
    });

    it('first correct → continue', () => {
      const ns = buildNextStep({ sessionId: 's1', questionId: 'q_04', status: LEARNING_PROGRESS.FIRST_CORRECT_STAYS, followUpQuestionId: 'q_18', flowType: 'TRANSFER' });
      expect(ns.nextStep).toBe('davom_etish');
    });

    it('includes sessionId and questionId', () => {
      const ns = buildNextStep({ sessionId: 's1', questionId: 'q_04', status: LEARNING_PROGRESS.FIRST_CORRECT_STAYS, followUpQuestionId: 'q_18', flowType: 'TRANSFER' });
      expect(ns.sessionId).toBe('s1');
      expect(ns.questionId).toBe('q_04');
    });
  });
});