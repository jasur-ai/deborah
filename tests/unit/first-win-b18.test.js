/**
 * AUTH B-18 — Onboarding: Activate (first-win)
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - getFirstWinSet: 5 savol (public DTO — correct/explain YO'Q); 4 til × 4 fan
 *  - checkFirstWinAnswer: server scoring + elaborative feedback (izoh)
 *  - startFirstWin: → firstWin record; welcome'da emas / qayta start idempotent
 *  - submitFirstWinAnswer: scoring; replay (duplicate) blok; aktiv attempt yo'q blok
 *  - completeFirstWin: scoring + ACTIVATION EVENT (step=checklist, activated_at);
 *    hammasi javob berilmagan → error; takroriy complete → idempotent
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import {
  getOrCreateOnboarding,
  submitOrient,
  startFirstWin,
  submitFirstWinAnswer,
  completeFirstWin,
  getOnboardingState,
  FIRST_WIN_ITEMS,
} from '../../src/modules/onboarding/index.js';
import {
  DEMO_SUBJECTS,
  getFirstWinSet,
  checkFirstWinAnswer,
  demoBankCoverage,
} from '../../src/modules/onboarding/index.js';

const USER = 'b18-unit-user';

describe('AUTH B-18 — first-win bank', () => {
  it('demoBankCoverage: 4 fan × 4 til = 5 savol', () => {
    const cov = demoBankCoverage();
    for (const s of DEMO_SUBJECTS) {
      for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
        expect(cov[s][lang]).toBe(5);
      }
    }
  });

  it('getFirstWinSet: 5 savol, public DTO — correct/explain YO\'Q (§07/§16)', () => {
    const set = getFirstWinSet('matematika', 'uz');
    expect(set.length).toBe(5);
    for (const q of set) {
      expect(q.id).toBeTruthy();
      expect(q.text.length).toBeGreaterThan(3);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(Object.prototype.hasOwnProperty.call(q, 'correct')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(q, 'explain')).toBe(false);
      expect(q.correct).toBeUndefined();
    }
    // Fallback: barcha tillar mavjud (uz fallback ishlamaydi)
    for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
      expect(getFirstWinSet('tarix', lang).length).toBe(5);
    }
  });

  it('checkFirstWinAnswer: server scoring + elaborative feedback (§08)', () => {
    const set = getFirstWinSet('matematika', 'uz');
    const q0 = set[0]; // 7 × 8 = 56 → index 1
    const right = checkFirstWinAnswer('matematika', 'uz', q0.id, 1);
    expect(right.ok).toBe(true);
    expect(right.correct).toBe(true);
    expect(right.correctIndex).toBe(1);
    expect(right.explain.length).toBeGreaterThan(10); // izoh majburiy
    const wrong = checkFirstWinAnswer('matematika', 'uz', q0.id, 0);
    expect(wrong.ok).toBe(true);
    expect(wrong.correct).toBe(false);
    expect(wrong.explain.length).toBeGreaterThan(10);
    // Noma'lum savol / invalid answer
    expect(checkFirstWinAnswer('matematika', 'uz', 'nope', 0).ok).toBe(false);
    expect(checkFirstWinAnswer('matematika', 'uz', q0.id, 99).ok).toBe(false);
    expect(checkFirstWinAnswer('matematika', 'uz', q0.id, -1).ok).toBe(false);
  });
});

describe('AUTH B-18 — first-win service', () => {
  beforeAll(async () => {
    await snapshotDb();
    await getOrCreateOnboarding(USER);
    await submitOrient({ userKey: USER, subject: 'matematika', ip: '10.0.0.1' });
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('startFirstWin: firstWin record yaratadi (subject, startedAt, answers=[])', async () => {
    const res = await startFirstWin({ userKey: USER, lang: 'uz', ip: '10.0.0.1' });
    expect(res.ok).toBe(true);
    expect(res.alreadyStarted).toBeUndefined();
    const fw = res.state.firstWin;
    expect(fw.subject).toBe('matematika'); // orient'dan meros
    expect(fw.startedAt).toBeTruthy();
    expect(fw.completedAt).toBeNull();
    expect(fw.answers).toEqual([]);
    expect(fw.total).toBe(5);
  });

  it('startFirstWin qayta: idempotent (alreadyStarted) — yangi attempt YO\'Q', async () => {
    const res = await startFirstWin({ userKey: USER, subject: 'tarix', lang: 'uz' });
    expect(res.ok).toBe(true);
    expect(res.alreadyStarted).toBe(true);
    const st = await getOnboardingState(USER);
    expect(st.firstWin.subject).toBe('matematika'); // birinchi start saqlanadi
  });

  it('submitFirstWinAnswer: scoring + feedback; replay 409 (duplicate)', async () => {
    const q0 = getFirstWinSet('matematika', 'uz')[0];
    const res = await submitFirstWinAnswer({ userKey: USER, itemId: q0.id, answer: 1, lang: 'uz' });
    expect(res.ok).toBe(true);
    expect(res.correct).toBe(true);
    expect(res.explain.length).toBeGreaterThan(10);
    expect(res.answered).toBe(1);
    expect(res.total).toBe(5);

    // Replay — bir xil savol ikki marta
    const dup = await submitFirstWinAnswer({ userKey: USER, itemId: q0.id, answer: 0, lang: 'uz' });
    expect(dup.ok).toBe(false);
    expect(dup.error).toBe('duplicate_answer');
  });

  it('completeFirstWin: hammasi javob berilmagan → error', async () => {
    const res = await completeFirstWin({ userKey: USER, lang: 'uz' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_all_answered');
    expect(res.answered).toBe(1);
    expect(res.total).toBe(5);
  });

  it('completeFirstWin: qolgan 4 savolga javob → ACTIVATION EVENT (step=checklist, activated_at, score)', async () => {
    const set = getFirstWinSet('matematika', 'uz');
    // q0 allaqachon javob berilgan (to'g'ri) — qolgan 4 tasi
    for (let i = 1; i < 5; i++) {
      await submitFirstWinAnswer({ userKey: USER, itemId: set[i].id, answer: 0, lang: 'uz' });
    }
    const res = await completeFirstWin({ userKey: USER, lang: 'uz' });
    expect(res.ok).toBe(true);
    // q0 to'g'ri (answer 1) + q2 ham to'g'ri (100−37=63 → index 0) = 2
    expect(res.summary.score).toBe(2);
    expect(res.summary.total).toBe(5);
    expect(res.summary.percent).toBe(40);
    expect(res.summary.answers.length).toBe(5);
    expect(res.summary.message).toContain('amaliyot qiling');
    // ACTIVATION EVENT
    expect(res.state.step).toBe('checklist');
    const st = await getOnboardingState(USER);
    expect(st.step).toBe('checklist');
    expect(st.activated_at).toBeTruthy();
    expect(st.firstWin.score).toBe(2);
    expect(st.firstWin.completedAt).toBeTruthy();
  });

  it('completeFirstWin takroriy: idempotent (alreadyCompleted)', async () => {
    const res = await completeFirstWin({ userKey: USER, lang: 'uz' });
    expect(res.ok).toBe(true);
    expect(res.alreadyCompleted).toBe(true);
  });

  it("startFirstWin checklist'dan keyin: not_in_first_win", async () => {
    const res = await startFirstWin({ userKey: USER, lang: 'uz' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_in_first_win');
  });

  it("submitFirstWinAnswer aktiv attempt yo'q: no_active_attempt", async () => {
    const q0 = getFirstWinSet('matematika', 'uz')[0];
    const res = await submitFirstWinAnswer({ userKey: USER, itemId: q0.id, answer: 1, lang: 'uz' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no_active_attempt');
  });

  it('FIRST_WIN_ITEMS = 5 (B-18 §06)', () => {
    expect(FIRST_WIN_ITEMS).toBe(5);
  });
});
