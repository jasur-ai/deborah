/**
 * Edikit — Intervention Loop, Adaptive Practice & Support (e2e/security tests, Prompt 55)
 *
 * Security & data guards (§15-17):
 *   - Teacher approval'siz intervention assign qilinmaydi (AI assign emas).
 *   - Permanent low-ability label / auto penalty / private chat sentiment
 *     ishlatilmaydi (§47 #10 Ethical Student Success).
 *   - Student contest (appeal) flow har doim ochiq.
 *   - Different-item reassessment non-duplication.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTeacherDecision,
  assertNoPermanentLabelOrPenalty,
  validateSupportSignal,
  planDifferentItemReassessment,
  estimateMasteryBkt,
  mapMisconceptionToIntervention,
  INTERVENTION_STATUS,
  FORBIDDEN_EVIDENCE_SOURCES,
} from '../../src/modules/intervention/index.js';

describe('intervention — e2e/security (Prompt 55 §15-17)', () => {
  it('SECURITY: AI hech qachon assign qilmaydi — teacher approval shart', () => {
    // AI suggestion mapping → hech qachon assign emas
    const mapping = mapMisconceptionToIntervention({
      misconception: { label: 'Kalvin sikli xatosi', severity: 'high' },
      interventions: [{ id: 1, kind: 'reteach', title: 'Reteach', status: INTERVENTION_STATUS.PUBLISHED }],
    });
    expect(mapping.ok).toBe(true);
    // Mapping faqat recommendation — assign faqat teacher approved'dan keyin
    expect(validateTeacherDecision({ decision: 'assign', status: 'pending' }).ok).toBe(false);
    expect(validateTeacherDecision({ decision: 'assign', status: 'approved' }).ok).toBe(true);
  });

  it('SECURITY: permanent low-ability label hech qachon yozilmaydi', () => {
    // Yozuv uchun barcha yo'llar guard'dan o'tadi
    expect(assertNoPermanentLabelOrPenalty({ isTemporary: false, autoPenalty: false }).ok).toBe(false);
    expect(assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: false }).ok).toBe(true);
    // "low ability" ma'lumoti ham guard'dan o'tishi shart
    expect(assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: false, evidence: { permanent_label: 'low_ability' } }).ok).toBe(false);
  });

  it('SECURITY: auto penalty yo\u2018q — faqat teacher action', () => {
    expect(assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: true }).ok).toBe(false);
    expect(assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: false }).ok).toBe(true);
  });

  it('SECURITY: private chat sentiment manba sifatida ishlatilmaydi', () => {
    expect(FORBIDDEN_EVIDENCE_SOURCES).toContain('private_chat');
    expect(FORBIDDEN_EVIDENCE_SOURCES).toContain('chat_sentiment');
    expect(validateSupportSignal({ signalType: 'at_risk', evidence: { source: 'chat_sentiment' } }).ok).toBe(false);
    // Ruxsat: attempt evidence (real assessment data)
    expect(validateSupportSignal({ signalType: 'at_risk', evidence: { source: 'attempt', score: 0.4 } }).ok).toBe(true);
  });

  it('INTEGRITY: reassessment different-item — hech qanday source item takrorlanmaydi', () => {
    const pool = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, difficulty: ((i * 37) % 100) / 100 }));
    const source = [3, 7, 11, 15, 19];
    const r = planDifferentItemReassessment({ itemPool: pool, sourceItemIds: source, count: 5 });
    expect(r.ok).toBe(true);
    for (const s of source) {
      expect(r.picked.some((i) => i.id === s)).toBe(false);
    }
    expect(r.excluded).toBe(source.length);
  });

  it('PRIVACY: mastery estimate faqat assessment evidence — shaxsiy suhbat emas', () => {
    // BKT faqat answer responses bilan ishlaydi (hech qanday sentiment input)
    const r = estimateMasteryBkt({ priorP: 0.3, responses: [1, 1, 0, 1, 1] });
    expect(r.ok).toBe(true);
    expect(r.est).toBeGreaterThan(0.4);
    expect(r.est).toBeLessThan(1);
  });

  it('TEACHER FLOW: pending → approve → assign (to\u2018liq teacher action zanjiri)', () => {
    expect(validateTeacherDecision({ decision: 'approve', status: 'pending' }).ok).toBe(true);
    expect(validateTeacherDecision({ decision: 'assign', status: 'approved' }).ok).toBe(true);
    expect(validateTeacherDecision({ decision: 'dismiss', status: 'approved' }).ok).toBe(true);
  });
});
