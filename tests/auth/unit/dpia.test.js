/**
 * AUTH D-25 §06 — DPIA hujjati unit testlari.
 * ---------------------------------------------------------------------------
 *  - PII inventarizatsiya (auth PII, sensitive marker).
 *  - Risk × mitigation (breach/misuse/insider — har riskda mitigation bor).
 *  - Retention + DSAR qo'llab-quvvatlash (D-23 bilan bog'langan).
 *  - Review (§27): yillik period; markDpiaReviewed operator imzosi.
 */

import { describe, it, expect } from 'vitest';
import { getDpia, markDpiaReviewed, DPIA_VERSION, DPIA_REVIEW_PERIOD_DAYS } from '../../../src/modules/legal/dpia.js';

describe('AUTH D-25 §06 — DPIA struktura', () => {
  it('PII inventarizatsiya — auth PII + sensitive marker', () => {
    const dpia = getDpia();
    expect(dpia.pii.length).toBeGreaterThanOrEqual(8);
    const fields = dpia.pii.map((p) => p.field);
    expect(fields).toContain('email');
    expect(fields).toContain('password_hash (argon2id)');
    expect(fields).toContain('telegram_id');
    expect(fields).toContain('device_fingerprint_hash');
    expect(fields).toContain('ip_hash');
    // Har bir yozuvda purpose + retention bor
    for (const p of dpia.pii) {
      expect(p.purpose).toBeTruthy();
      expect(p.retention).toBeTruthy();
      expect(typeof p.sensitive).toBe('boolean');
    }
  });

  it('har riskda mitigation bor (breach/misuse/insider)', () => {
    const dpia = getDpia();
    expect(dpia.risks.length).toBeGreaterThanOrEqual(4);
    for (const r of dpia.risks) {
      expect(r.risk).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(r.likelihood);
      expect(['low', 'medium', 'high']).toContain(r.impact);
      expect(r.mitigation.length, r.risk).toBeGreaterThanOrEqual(2);
    }
    const riskText = dpia.risks.map((r) => r.risk).join(' ');
    expect(riskText.toLowerCase()).toContain('breach');
  });

  it('retention + DSAR qo\'llab-quvvatlash (D-23 bog\'lanish)', () => {
    const dpia = getDpia();
    expect(dpia.retention.length).toBeGreaterThanOrEqual(3);
    expect(dpia.dsar).toEqual(expect.arrayContaining(['export (collectUserPii)', 'delete (30-day grace + purge worker)']));
  });

  it('version + created + review period (§27 har yili)', () => {
    const dpia = getDpia();
    expect(dpia.version).toBe(DPIA_VERSION);
    expect(dpia.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DPIA_REVIEW_PERIOD_DAYS).toBe(365);
  });

  it('markDpiaReviewed — operator imzosi + nextReviewDue', () => {
    const reviewed = markDpiaReviewed({ reviewer: 'legal@deborah.uz', date: '2026-08-17' });
    expect(reviewed.reviewedAt).toBe('2026-08-17');
    expect(reviewed.reviewer).toBe('legal@deborah.uz');
    expect(reviewed.nextReviewDue).toBe('2026-08-17');
    expect(reviewed.pii.length).toBeGreaterThan(0);
  });
});
