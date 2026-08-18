/**
 * Edikit — No-device Paper-Card Mode (C4-03) Tests
 * --------------------------------------------------
 * coverage: normalizeCardId format, assertOrientation, assessConfidence
 * (glare/occlusion threshold — item 9), mapOrientationToOption (four-orientation
 * mapping — item 2), normalizeCardAnswer, mergeScanRecord (duplicate/flag —
 * item 8), buildCorrectionAudit (item 13), projectCardProgress (item 11),
 * classifyPaperStatus (not-scanned never wrong — item 10), evidence-service
 * (not-scanned → no_response, evidenceUnit=card_response — item 15),
 * config cross-field paper mode restriction (item 14).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeCardId,
  assertOrientation,
  assessConfidence,
  mapOrientationToOption,
  normalizeCardAnswer,
  mergeScanRecord,
  buildCorrectionAudit,
  projectCardProgress,
  classifyPaperStatus,
  CARD_EVIDENCE_UNIT,
} from '../../services/cast/card-scan-service.js';
import { computeQuestionEvidence } from '../../services/cast/evidence-service.js';
import { validateCrossField } from '../../services/cast/config-schema.js';

const PRIV_Q = {
  id: 'q1',
  text: 'Savol',
  options: [
    { id: 'o1', text: 'A' },
    { id: 'o2', text: 'B' },
    { id: 'o3', text: 'C' },
    { id: 'o4', text: 'D' },
  ],
};

describe('C4-03: No-device paper-card mode', () => {
  describe('card ID format (item 2)', () => {
    it('accepts CARD-001 style', () => {
      expect(normalizeCardId('card-001')).toBe('CARD-001');
      expect(normalizeCardId('CARD-42')).toBe('CARD-42');
      expect(normalizeCardId('  CARD-999  ')).toBe('CARD-999');
    });

    it('rejects invalid formats', () => {
      expect(() => normalizeCardId('')).toThrow();
      expect(() => normalizeCardId('X-1')).toThrow();
      expect(() => normalizeCardId('CARD')).toThrow();
      expect(() => normalizeCardId('CARD-ABCD')).toThrow();
    });
  });

  describe('four-orientation mapping (item 2/7)', () => {
    it('0° → option 0, 90° → 1, 180° → 2, 270° → 3', () => {
      expect(mapOrientationToOption(PRIV_Q, '0')).toBe('o1');
      expect(mapOrientationToOption(PRIV_Q, '90')).toBe('o2');
      expect(mapOrientationToOption(PRIV_Q, '180')).toBe('o3');
      expect(mapOrientationToOption(PRIV_Q, '270')).toBe('o4');
    });

    it('orientation beyond option count → error', () => {
      const tfQ = { id: 'tf', options: [{ id: 't1', text: 'To‘g‘ri' }, { id: 't2', text: 'Noto‘g‘ri' }] };
      expect(mapOrientationToOption(tfQ, '0')).toBe('t1');
      expect(mapOrientationToOption(tfQ, '90')).toBe('t2');
      expect(() => mapOrientationToOption(tfQ, '180')).toThrow();
      expect(() => mapOrientationToOption(tfQ, '270')).toThrow();
    });

    it('assertOrientation rejects invalid', () => {
      expect(() => assertOrientation('45')).toThrow();
      expect(() => assertOrientation('')).toThrow();
    });
  });

  describe('confidence / glare / occlusion (item 9)', () => {
    it('high confidence → not flagged', () => {
      const r = assessConfidence(0.9);
      expect(r.flagged).toBe(false);
      expect(r.warn).toBe(false);
    });

    it('mid confidence (0.5–0.7) → warn (glare)', () => {
      const r = assessConfidence(0.6);
      expect(r.flagged).toBe(false);
      expect(r.warn).toBe(true);
    });

    it('low confidence (<0.5) → flagged (glare/occlusion)', () => {
      const r = assessConfidence(0.3);
      expect(r.flagged).toBe(true);
    });

    it('out of range → error', () => {
      expect(() => assessConfidence(1.5)).toThrow();
      expect(() => assessConfidence(-1)).toThrow();
      expect(() => assessConfidence('abc')).toThrow();
    });
  });

  describe('normalizeCardAnswer + duplicate flag (item 7/8)', () => {
    it('normalizes card answer payload', () => {
      const a = normalizeCardAnswer({ cardId: 'card-7', orientation: '180', confidence: 0.85 });
      expect(a.cardId).toBe('CARD-7');
      expect(a.orientation).toBe('180');
      expect(a.confidence).toBe(0.85);
      expect(a.flagged).toBe(false);
    });

    it('first scan immutable; duplicate flagged', () => {
      const first = mergeScanRecord(null, { cardId: 'CARD-1', optionId: 'o2', questionId: 'q1', at: 100 });
      expect(first.status).toBe('ACCEPTED');
      const dup = mergeScanRecord(first.record, { cardId: 'CARD-1', optionId: 'o3', questionId: 'q1', at: 200 });
      expect(dup.status).toBe('DUPLICATE');
      expect(dup.record.optionId).toBe('o2'); // first scan stays
      expect(dup.record.duplicateCount).toBe(1);
    });

    it('stored duplicate record carries status DUPLICATE (review fix #1)', () => {
      const first = mergeScanRecord(null, { cardId: 'CARD-1', optionId: 'o2', questionId: 'q1', at: 100 });
      const dup = mergeScanRecord(first.record, { cardId: 'CARD-1', optionId: 'o3', questionId: 'q1', at: 200 });
      // Storage'ga yoziladigan record'ning o'zida status DUPLICATE bo'lishi kerak,
      // aks holda projectCardProgress/classifyPaperStatus hech qachon DUPLICATE ko'rmaydi.
      expect(dup.record.status).toBe('DUPLICATE');
    });

    it('low confidence scan → FLAGGED', () => {
      const r = mergeScanRecord(null, { cardId: 'CARD-2', optionId: 'o1', flagged: true, questionId: 'q1', at: 100 });
      expect(r.status).toBe('FLAGGED');
    });
  });

  describe('manual correction audit (item 12/13)', () => {
    it('builds audit with actor/time/reason', () => {
      const a = buildCorrectionAudit({ actorId: 'd_1', cardId: 'CARD-1', fromOptionId: 'o1', toOptionId: 'o2', reason: 'glare' });
      expect(a.actorId).toBe('d_1');
      expect(a.fromOptionId).toBe('o1');
      expect(a.toOptionId).toBe('o2');
      expect(a.reason).toBe('glare');
      expect(typeof a.at).toBe('number');
    });
  });

  describe('progress projection (item 11)', () => {
    const participants = {
      p1: { cardId: 'CARD-1' },
      p2: { cardId: 'CARD-2' },
      p3: { cardId: 'CARD-3' },
      p4: {}, // no card
    };
    const scans = {
      'CARD-1': { status: 'ACCEPTED' },
      'CARD-2': { status: 'FLAGGED' },
      'CARD-9': { status: 'ACCEPTED' }, // unknown
    };

    it('computes scanned/expected/unknown/duplicate', () => {
      const p = projectCardProgress(participants, scans);
      expect(p.expected).toBe(3);
      expect(p.scanned).toBe(1); // CARD-1 accepted & known
      expect(p.flagged).toBe(1); // CARD-2
      expect(p.unknown).toBe(1); // CARD-9
      expect(p.duplicate).toBe(0);
      expect(p.missing).toBe(1); // CARD-3
    });

    it('cardToPid mapping resolves participant', () => {
      const p = projectCardProgress(participants, scans);
      expect(p.cardToPid['CARD-1']).toBe('p1');
    });
  });

  describe('not-scanned never wrong (item 10)', () => {
    it('classifies card statuses', () => {
      expect(classifyPaperStatus({ participant: { cardId: 'CARD-1' }, scans: { 'CARD-1': { status: 'ACCEPTED' } } })).toBe('card_scanned');
      expect(classifyPaperStatus({ participant: { cardId: 'CARD-2' }, scans: {} })).toBe('not_scanned');
      expect(classifyPaperStatus({ participant: {} }, {})).toBe('no_card');
      expect(classifyPaperStatus({ participant: { cardId: 'CARD-3' }, scans: { 'CARD-3': { status: 'DUPLICATE' } } })).toBe('not_scanned');
    });

    it('evidence: not-scanned → no_response, incorrect stays 0', () => {
      const evidence = computeQuestionEvidence({
        sessionId: 's1',
        questionId: 'q1',
        participants: {
          p1: { cardId: 'CARD-1' }, // scanned
          p2: { cardId: 'CARD-2' }, // not scanned
        },
        answers: {}, // answers yozilmaydi — card scans evidenceUnit=card_response
        cardScans: { 'CARD-1': { status: 'ACCEPTED', optionId: 'o2' } },
        revision: 1,
      });
      expect(evidence.noResponse).toBe(1);
      expect(evidence.incorrect).toBe(0);
      expect(evidence.evidenceUnit).toBe(CARD_EVIDENCE_UNIT);
      expect(evidence.evidenceUnit).toBe('card_response');
    });

    it('non-paper evidence stays individual', () => {
      const evidence = computeQuestionEvidence({
        sessionId: 's1',
        questionId: 'q1',
        participants: { p1: { presence: 'online' } },
        answers: {},
        revision: 1,
      });
      expect(evidence.evidenceUnit).toBe('individual');
    });
  });

  describe('config restriction (item 14)', () => {
    it('paperCardMode + no_points scoring → blocker', () => {
      const cfg = {
        timer: { mode: 'soft' },
        playback: { advanceMode: 'manual', closeTrigger: ['host_or_soft_timeout'] },
        join: { identity: 'safe_alias' },
        leaderboard: { visibility: 'top_n' },
        scoring: { mode: 'no_points', speedBonusMax: 0 },
        participation: { paperCardMode: true },
        accessibility: { showQuestionOnDevice: false },
        teams: { enabled: false },
      };
      const { errors } = validateCrossField(cfg);
      expect(errors.some((e) => e.code === 'CROSS_FIELD_BLOCKER' && e.path === 'participation.paperCardMode')).toBe(true);
    });
  });
});
