/**
 * Deborah — Cast Misconception Map (C3-05) Tests
 * ----------------------------------------------
 * coverage: recordMisconceptionDecision, buildDominantDistractorCard,
 *           buildOptionMisconceptionMap, getMisconception, pinMisconceptionVersion
 */

import { describe, it, expect } from 'vitest';
import {
  getMisconception,
  buildOptionMisconceptionMap,
  buildDominantDistractorCard,
  recordMisconceptionDecision,
  pinMisconceptionVersion,
  MISCONCEPTION_REGISTRY,
  MISCONCEPTION_VERSION,
} from '../../services/cast/misconception-service.js';

// ── Helpers ──
const fakePrivateQuestion = {
  correctOptionIds: ['A', 'B'],
  options: [
    { id: 'A', text: 'To\'g\'ri A' },
    { id: 'B', text: 'To\'g\'ri B' },
    { id: 'C', text: 'Distraktor C' },
    { id: 'D', text: 'Distraktor D' },
  ],
};

const fakeMisconceptionByOptionId = {
  'C': 'mean_ignores_repeated_values',
  'D': 'confuses_median_mean',
};

const fakeEvidence = {
  correct: 18,
  incorrect: 6,
  noResponse: 2,
  eligible: 26,
};

// ── Tests ──
describe('C3-05: Misconception Map', () => {

  describe('getMisconception', () => {
    it('returns known misconception by ID', () => {
      const m = getMisconception('mean_ignores_repeated_values');
      expect(m).toBeTruthy();
      expect(m.misconceptionId).toBe('mean_ignores_repeated_values');
      expect(m.title).toContain('O\'rtacha');
    });

    it('returns null for unknown ID', () => {
      expect(getMisconception('fake_id_123')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getMisconception('')).toBeNull();
    });

    it('MISCONCEPTION_REGISTRY has at least 5 entries', () => {
      expect(Object.keys(MISCONCEPTION_REGISTRY).length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('buildOptionMisconceptionMap', () => {
    it('returns map for all options', () => {
      const map = buildOptionMisconceptionMap(fakeMisconceptionByOptionId, fakePrivateQuestion);
      expect(map).toHaveLength(4);
    });

    it('marks correct options correctly', () => {
      const map = buildOptionMisconceptionMap(fakeMisconceptionByOptionId, fakePrivateQuestion);
      expect(map.find((o) => o.optionId === 'A').isCorrect).toBe(true);
      expect(map.find((o) => o.optionId === 'C').isCorrect).toBe(false);
    });

    it('attaches misconception for mapped options', () => {
      const map = buildOptionMisconceptionMap(fakeMisconceptionByOptionId, fakePrivateQuestion);
      expect(map.find((o) => o.optionId === 'C').misconception).toBeTruthy();
      expect(map.find((o) => o.optionId === 'C').misconception.misconceptionId).toBe('mean_ignores_repeated_values');
    });

    it('returns null misconception for unmapped options', () => {
      const map = buildOptionMisconceptionMap({}, fakePrivateQuestion);
      map.forEach((o) => {
        expect(o.misconception).toBeNull();
      });
    });

    it('handles empty options gracefully', () => {
      const map = buildOptionMisconceptionMap({}, { correctOptionIds: [], options: [] });
      expect(map).toEqual([]);
    });

    it('handles partial mapping (only some options mapped)', () => {
      const partial = { 'C': 'ignores_negative_sign' };
      const map = buildOptionMisconceptionMap(partial, fakePrivateQuestion);
      expect(map.find((o) => o.optionId === 'C').misconception).toBeTruthy();
      expect(map.find((o) => o.optionId === 'D').misconception).toBeNull();
    });
  });

  describe('buildDominantDistractorCard', () => {
    const optionMap = buildOptionMisconceptionMap(fakeMisconceptionByOptionId, fakePrivateQuestion);

    it('returns null if no dominant signal', () => {
      const card = buildDominantDistractorCard(null, optionMap, fakeEvidence);
      expect(card).toBeNull();
    });

    it('returns null if no optionMap', () => {
      const card = buildDominantDistractorCard({ optionId: 'C', count: 4 }, null, fakeEvidence);
      expect(card).toBeNull();
    });

    it('returns card with mapping for known distractor', () => {
      const signal = { optionId: 'C', count: 4 };
      const card = buildDominantDistractorCard(signal, optionMap, fakeEvidence);
      expect(card).toBeTruthy();
      expect(card.hasMapping).toBe(true);
      expect(card.misconception.misconceptionId).toBe('mean_ignores_repeated_values');
      expect(card.optionId).toBe('C');
      expect(card.count).toBe(4);
      expect(card.teacherConfirmed).toBeNull();
    });

    it('returns card without mapping for unknown distractor', () => {
      // Option 'Z' is not in the question options
      const signal = { optionId: 'Z', count: 3 };
      const card = buildDominantDistractorCard(signal, optionMap, fakeEvidence);
      // Since 'Z' is not in optionMap, find returns undefined → entry is null
      expect(card).toBeNull();
    });

    it('returns card with hasMapping=false for unmapped option', () => {
      // Option 'D' is in the question but has no misconception mapping in partial map
      const partialMap = buildOptionMisconceptionMap({ 'C': 'mean_ignores_repeated_values' }, fakePrivateQuestion);
      const signal = { optionId: 'D', count: 2 };
      const card = buildDominantDistractorCard(signal, partialMap, fakeEvidence);
      expect(card).toBeTruthy();
      expect(card.hasMapping).toBe(false);
      expect(card.misconception).toBeNull();
    });

    it('includes total from evidence', () => {
      const signal = { optionId: 'C', count: 4 };
      const card = buildDominantDistractorCard(signal, optionMap, fakeEvidence);
      expect(card.total).toBe(24);
    });
  });

  describe('recordMisconceptionDecision', () => {
    it('records confirmation with misconceptionId', () => {
      const rec = recordMisconceptionDecision({
        sessionId: 's1',
        questionId: 'q1',
        optionId: 'C',
        misconceptionId: 'mean_ignores_repeated_values',
        confirmed: true,
        teacherId: 'teacher1',
        at: 1000,
      });
      expect(rec.type).toBe('cast:misconceptionDecision');
      expect(rec.confirmed).toBe(true);
      expect(rec.misconceptionId).toBe('mean_ignores_repeated_values');
      expect(rec.version).toBe(MISCONCEPTION_VERSION);
    });

    it('records rejection with null misconceptionId', () => {
      const rec = recordMisconceptionDecision({
        sessionId: 's1',
        questionId: 'q1',
        optionId: 'C',
        confirmed: false,
        teacherId: 'teacher1',
        at: 2000,
      });
      expect(rec.confirmed).toBe(false);
      expect(rec.misconceptionId).toBeNull();
    });

    it('includes teacherExplanation when provided', () => {
      const rec = recordMisconceptionDecision({
        sessionId: 's1',
        questionId: 'q1',
        optionId: 'D',
        confirmed: true,
        misconceptionId: 'confuses_median_mean',
        teacherExplanation: 'Talabalar medianani o\'rtacha bilan aralashtirishadi',
        teacherId: 'teacher1',
        at: 3000,
      });
      expect(rec.teacherExplanation).toContain('mediana');
    });

    it('auto-sets at if not provided', () => {
      const now = Date.now();
      const rec = recordMisconceptionDecision({
        sessionId: 's1',
        questionId: 'q1',
        optionId: 'C',
        confirmed: true,
        misconceptionId: 'mean_ignores_repeated_values',
        teacherId: 'teacher1',
      });
      expect(rec.at).toBeGreaterThanOrEqual(now);
    });
  });

  describe('pinMisconceptionVersion', () => {
    it('pins current version with source', () => {
      const pinned = pinMisconceptionVersion({ source: { preset: 'responsive_accuracy' } });
      expect(pinned.version).toBe(MISCONCEPTION_VERSION);
      expect(pinned.source.preset).toBe('responsive_accuracy');
      expect(pinned.pinnedAt).toBeGreaterThan(0);
    });

    it('handles null config', () => {
      const pinned = pinMisconceptionVersion(null);
      expect(pinned.version).toBe(MISCONCEPTION_VERSION);
      expect(pinned.source).toBeNull();
    });
  });
});