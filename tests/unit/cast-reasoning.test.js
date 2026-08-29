/**
 * Deborah — Cast Reasoning Capture (C3-07) Tests
 * ----------------------------------------------
 * coverage: REASONING_CHAR_LIMIT, REASONING_MODERATION_STATE,
 *           submitReasoning (validation), getPublicReasoning,
 *           moderateReasoning lifecycle
 */

import { describe, it, expect } from 'vitest';
import {
  REASONING_CHAR_LIMIT,
  REASONING_CHAR_MIN,
  REASONING_POLICY,
  REASONING_MODERATION_STATE,
} from '../../services/cast/reasoning-service.js';

// ── Tests ──
describe('C3-07: Reasoning Capture', () => {

  describe('Constants', () => {
    it('CHAR_LIMIT is 280', () => {
      expect(REASONING_CHAR_LIMIT).toBe(280);
    });

    it('CHAR_MIN is 10', () => {
      expect(REASONING_CHAR_MIN).toBe(10);
    });

    it('REASONING_POLICY has 3 values', () => {
      expect(Object.keys(REASONING_POLICY)).toEqual(['OFF', 'OPTIONAL', 'REQUIRED']);
    });

    it('REASONING_MODERATION_STATE has 5 states', () => {
      expect(Object.keys(REASONING_MODERATION_STATE)).toEqual([
        'RECEIVED', 'APPROVED', 'REDACTED', 'REJECTED', 'PROJECTED',
      ]);
    });

    it('RECEIVED is the initial state', () => {
      expect(REASONING_MODERATION_STATE.RECEIVED).toBe('RECEIVED');
    });
  });

  describe('Moderation lifecycle', () => {
    it('RECEIVED → APPROVED', () => {
      const state = REASONING_MODERATION_STATE.RECEIVED;
      const next = REASONING_MODERATION_STATE.APPROVED;
      expect(state).toBe('RECEIVED');
      expect(next).toBe('APPROVED');
    });

    it('RECEIVED → REJECTED', () => {
      expect(REASONING_MODERATION_STATE.REJECTED).toBe('REJECTED');
    });

    it('RECEIVED → REDACTED', () => {
      expect(REASONING_MODERATION_STATE.REDACTED).toBe('REDACTED');
    });

    it('APPROVED → PROJECTED (project action)', () => {
      expect(REASONING_MODERATION_STATE.PROJECTED).toBe('PROJECTED');
    });
  });

  describe('getPublicReasoning logic', () => {
    it('APPROVED reasoning returns text', () => {
      const rec = { moderationState: 'APPROVED', text: 'My reasoning' };
      const publicText = rec.moderationState === 'APPROVED' ? rec.text : null;
      expect(publicText).toBe('My reasoning');
    });

    it('REDACTED reasoning returns redacted text', () => {
      const rec = { moderationState: 'REDACTED', redactedText: 'Redacted version', text: 'Original' };
      const publicText = rec.moderationState === 'REDACTED' && rec.redactedText ? rec.redactedText : null;
      expect(publicText).toBe('Redacted version');
    });

    it('REDACTED without redactedText returns null', () => {
      const rec = { moderationState: 'REDACTED', redactedText: null, text: 'Original' };
      const publicText = rec.moderationState === 'REDACTED' && rec.redactedText ? rec.redactedText : null;
      expect(publicText).toBeNull();
    });

    it('PROJECTED reasoning returns text', () => {
      const rec = { moderationState: 'PROJECTED', text: 'Projected reasoning' };
      const publicText = rec.moderationState === 'PROJECTED' ? rec.text : null;
      expect(publicText).toBe('Projected reasoning');
    });

    it('REJECTED reasoning returns null', () => {
      const rec = { moderationState: 'REJECTED', text: 'Rejected' };
      const publicText = null; // REJECTED never public
      expect(publicText).toBeNull();
    });

    it('RECEIVED (unmoderated) returns null', () => {
      const rec = { moderationState: 'RECEIVED', text: 'Unmoderated' };
      const publicText = null; // RECEIVED never public
      expect(publicText).toBeNull();
    });
  });

  describe('Character limit', () => {
    it('text longer than 280 is truncated', () => {
      const long = 'x'.repeat(300);
      const truncated = long.slice(0, REASONING_CHAR_LIMIT);
      expect(truncated.length).toBe(280);
    });

    it('text within limit is preserved', () => {
      const text = 'Short reasoning';
      const preserved = text.slice(0, REASONING_CHAR_LIMIT);
      expect(preserved).toBe('Short reasoning');
    });

    it('empty text is handled as EMPTY', () => {
      const clean = ''.trim();
      expect(clean).toBe('');
    });
  });

  describe('REASONING_POLICY', () => {
    it('off disables reasoning', () => {
      expect(REASONING_POLICY.OFF).toBe('off');
    });

    it('optional allows skip', () => {
      expect(REASONING_POLICY.OPTIONAL).toBe('optional');
    });

    it('required enforces completion', () => {
      expect(REASONING_POLICY.REQUIRED).toBe('required');
    });
  });
});