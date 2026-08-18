/**
 * Deborah — Cast Quick Prompt (C3-06) Tests
 * ------------------------------------------
 * coverage: validateQuickPrompt, buildPromptQuestion, generatePromptQuestionId,
 *           saveToLibrary, getFromLibrary, listLibrary, QUICK_PROMPT_TYPES,
 *           QUICK_PROMPT_SCORED_TYPES, QUICK_PROMPT_SHORT_ANSWER_MAX
 */

import { describe, it, expect } from 'vitest';
import {
  validateQuickPrompt,
  buildPromptQuestion,
  generatePromptQuestionId,
  QUICK_PROMPT_TYPES,
  QUICK_PROMPT_TYPE_LIST,
  QUICK_PROMPT_SCORED_TYPES,
  QUICK_PROMPT_SHORT_ANSWER_MAX,
} from '../../services/cast/quick-prompt-service.js';

// ── Helpers ──
const validSingleChoice = {
  type: 'single_choice',
  text: 'What is 2+2?',
  options: [
    { id: 'o_1', text: '3' },
    { id: 'o_2', text: '4' },
    { id: 'o_3', text: '5' },
  ],
  correctOptionIds: ['o_2'],
  timer: { mode: 'soft', seconds: 30 },
};

const validTrueFalse = {
  type: 'true_false',
  text: 'The sky is blue.',
  options: [
    { id: 'o_t', text: 'True' },
    { id: 'o_f', text: 'False' },
  ],
  correctOptionIds: ['o_t'],
  timer: { mode: 'soft', seconds: 20 },
};

const validShortAnswer = {
  type: 'short_answer',
  text: 'What is the capital of France?',
  correctAnswer: 'Paris',
};

const validExitTicket = {
  type: 'exit_ticket',
  text: 'How did you find today\'s lesson?',
};

// ── Tests ──
describe('C3-06: Quick Prompt', () => {

  describe('QUICK_PROMPT_TYPES', () => {
    it('has 8 types', () => {
      expect(Object.keys(QUICK_PROMPT_TYPES).length).toBe(8);
    });

    it('includes all expected types', () => {
      expect(QUICK_PROMPT_TYPE_LIST).toContain('single_choice');
      expect(QUICK_PROMPT_TYPE_LIST).toContain('true_false');
      expect(QUICK_PROMPT_TYPE_LIST).toContain('multiple_select');
      expect(QUICK_PROMPT_TYPE_LIST).toContain('short_answer');
      expect(QUICK_PROMPT_TYPE_LIST).toContain('exit_ticket');
      expect(QUICK_PROMPT_TYPE_LIST).toContain('confidence');
      expect(QUICK_PROMPT_TYPE_LIST).toContain('prediction');
      expect(QUICK_PROMPT_TYPE_LIST).toContain('rating');
    });

    it('has 3 scored types', () => {
      expect(QUICK_PROMPT_SCORED_TYPES.has('single_choice')).toBe(true);
      expect(QUICK_PROMPT_SCORED_TYPES.has('true_false')).toBe(true);
      expect(QUICK_PROMPT_SCORED_TYPES.has('multiple_select')).toBe(true);
      expect(QUICK_PROMPT_SCORED_TYPES.has('short_answer')).toBe(false);
    });

    it('SHORT_ANSWER_MAX is 280', () => {
      expect(QUICK_PROMPT_SHORT_ANSWER_MAX).toBe(280);
    });
  });

  describe('validateQuickPrompt', () => {
    it('accepts valid single_choice', () => {
      const r = validateQuickPrompt(validSingleChoice);
      expect(r.valid).toBe(true);
      expect(r.errors).toEqual([]);
    });

    it('accepts valid true_false', () => {
      const r = validateQuickPrompt(validTrueFalse);
      expect(r.valid).toBe(true);
    });

    it('accepts valid short_answer', () => {
      const r = validateQuickPrompt(validShortAnswer);
      expect(r.valid).toBe(true);
    });

    it('accepts valid exit_ticket', () => {
      const r = validateQuickPrompt(validExitTicket);
      expect(r.valid).toBe(true);
    });

    it('rejects null draft', () => {
      const r = validateQuickPrompt(null);
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it('rejects empty draft', () => {
      const r = validateQuickPrompt({});
      expect(r.valid).toBe(false);
    });

    it('rejects unknown type', () => {
      const r = validateQuickPrompt({ type: 'essay', text: 'Write an essay' });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Noma\'lum');
    });

    it('rejects missing text', () => {
      const r = validateQuickPrompt({ type: 'single_choice', text: '', options: [{ id: 'a', text: 'A' }], correctOptionIds: ['a'] });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('matni');
    });

    it('rejects text over 1000 chars', () => {
      const r = validateQuickPrompt({ type: 'single_choice', text: 'x'.repeat(1001), options: [{ id: 'a', text: 'A' }], correctOptionIds: ['a'] });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('1000');
    });

    it('rejects scored type with less than 2 options', () => {
      const r = validateQuickPrompt({ type: 'single_choice', text: 'Test', options: [{ id: 'a', text: 'A' }], correctOptionIds: ['a'] });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('2 ta variant');
    });

    it('rejects scored type with no correctOptionIds', () => {
      const r = validateQuickPrompt({ type: 'single_choice', text: 'Test', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionIds: [] });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('To\'g\'ri javob');
    });

    it('rejects invalid correctOptionId reference', () => {
      const r = validateQuickPrompt({ type: 'single_choice', text: 'Test', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionIds: ['c'] });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Noto\'g\'ri variant ID');
    });

    it('rejects over 10 options', () => {
      const opts = Array.from({ length: 11 }, (_, i) => ({ id: `o_${i}`, text: `Opt ${i}` }));
      const r = validateQuickPrompt({ type: 'single_choice', text: 'Test', options: opts, correctOptionIds: ['o_0'] });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('10 tadan');
    });

    it('rejects timer seconds < 5', () => {
      const r = validateQuickPrompt({ ...validSingleChoice, timer: { seconds: 2 } });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('5–600');
    });

    it('rejects timer seconds > 600', () => {
      const r = validateQuickPrompt({ ...validSingleChoice, timer: { seconds: 601 } });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('5–600');
    });

    it('accepts timer without seconds (default)', () => {
      const r = validateQuickPrompt({ ...validSingleChoice, timer: {} });
      expect(r.valid).toBe(true);
    });

    it('short_answer correctAnswer max 280 chars', () => {
      const r = validateQuickPrompt({ type: 'short_answer', text: 'Test', correctAnswer: 'x'.repeat(281) });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('280');
    });
  });

  describe('generatePromptQuestionId', () => {
    it('generates ID starting with qp_', () => {
      const id = generatePromptQuestionId('test_session');
      expect(id.startsWith('qp_')).toBe(true);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 50 }, () => generatePromptQuestionId('s')));
      expect(ids.size).toBe(50);
    });
  });

  describe('buildPromptQuestion', () => {
    it('builds public question for single_choice', () => {
      const { public: pub } = buildPromptQuestion(validSingleChoice, 'qp_test');
      expect(pub.id).toBe('qp_test');
      expect(pub.type).toBe('single_choice');
      expect(pub.text).toBe('What is 2+2?');
      expect(pub.isQuickPrompt).toBe(true);
      expect(pub.options).toHaveLength(3);
    });

    it('builds private question for scored types', () => {
      const { private: priv } = buildPromptQuestion(validSingleChoice, 'qp_test');
      expect(priv).not.toBeNull();
      expect(priv.correctOptionIds).toEqual(['o_2']);
      expect(priv.isQuickPrompt).toBe(true);
    });

    it('does not build private question for unscored types', () => {
      const { private: priv } = buildPromptQuestion(validExitTicket, 'qp_test');
      expect(priv).toBeNull();
    });

    it('builds exit_ticket with default options when none provided', () => {
      const { public: pub } = buildPromptQuestion({ type: 'exit_ticket', text: 'Rate' }, 'qp_exit');
      expect(pub.options).toHaveLength(3);
      expect(pub.options[0].text).toContain('Tushunarli');
    });

    it('builds rating with default 5-star options', () => {
      const { public: pub } = buildPromptQuestion({ type: 'rating', text: 'Rate' }, 'qp_rating');
      expect(pub.options).toHaveLength(5);
    });

    it('builds confidence with default 3 options', () => {
      const { public: pub } = buildPromptQuestion({ type: 'confidence', text: 'Confidence' }, 'qp_conf');
      expect(pub.options).toHaveLength(3);
    });

    it('preserves options when provided (not default)', () => {
      const customOptions = [{ id: 'c1', text: 'Custom' }];
      const { public: pub } = buildPromptQuestion({ type: 'exit_ticket', text: 'Test', options: customOptions }, 'qp_custom');
      expect(pub.options).toHaveLength(1);
      expect(pub.options[0].text).toBe('Custom');
    });
  });
});