/**
 * AUTH B-17 — Onboarding: state machine + Orient
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - State machine: welcome→first_win; canAdvance qoidalari (monotonic §15)
 *  - getOrCreateOnboarding: birinchi kirish welcome + welcome_sent_at; qayta kirish idempotent
 *  - submitOrient: → first_win + orient record; qayta submit → o'zgarmaydi (idempotent)
 *  - skipOrient: → first_win + skipped flag; skip'dan keyin orient submit qilinsa o'zgarmaydi
 *  - Demo bank: 4 til × 4 fan qamrov; public DTO'da `correct` YO'Q (§11)
 *  - checkDemoAnswer: to'g'ri/noto'g'ri/noma'lum savol/invalid answer
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import {
  ONBOARDING_STEPS,
  stepIndex,
  canAdvance,
  getOnboardingState,
  getOrCreateOnboarding,
  submitOrient,
  skipOrient,
  onboardingProgress,
} from '../../src/modules/onboarding/index.js';
import {
  DEMO_SUBJECTS,
  getDemoQuestion,
  checkDemoAnswer,
  demoBankCoverage,
} from '../../src/modules/onboarding/index.js';

const USER = 'b17-unit-user';

describe('AUTH B-17 — onboarding state machine', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('stepIndex/canAdvance: §15 monotonik — orqaga qaytish mumkin emas', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'first_win', 'checklist', 'done']);
    expect(stepIndex('welcome')).toBe(0);
    expect(stepIndex('done')).toBe(3);
    expect(canAdvance('welcome', 'first_win')).toBe(true);
    expect(canAdvance('first_win', 'checklist')).toBe(true);
    // Orqaga / bir xil / noma'lum → false
    expect(canAdvance('first_win', 'welcome')).toBe(false);
    expect(canAdvance('welcome', 'welcome')).toBe(false);
    expect(canAdvance('done', 'welcome')).toBe(false);
    expect(canAdvance('welcome', 'nope')).toBe(false);
  });

  it('getOrCreateOnboarding: birinchi kirish welcome + welcome_sent_at; idempotent', async () => {
    const first = await getOrCreateOnboarding(USER);
    expect(first.step).toBe('welcome');
    expect(first.welcome_sent_at).toBeTruthy();
    const snap = await fb.get(`onboarding/${safeKey(USER)}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().welcome_sent_at).toBe(first.welcome_sent_at);

    // Qayta kirish — welcome_sent_at o'zgarmaydi (yangi record YO'Q)
    const again = await getOrCreateOnboarding(USER);
    expect(again.welcome_sent_at).toBe(first.welcome_sent_at);
  });

  it('submitOrient: §10 orient → first_win + orient record', async () => {
    const res = await submitOrient({
      userKey: USER,
      subject: 'matematika',
      goal: 'Kirish imtihoniga tayyorlanish',
      ip: '10.0.0.1',
      userAgent: 'vitest',
    });
    expect(res.ok).toBe(true);
    expect(res.state.step).toBe('first_win');
    expect(res.state.orient.subject).toBe('matematika');
    expect(res.state.orient.goal).toBe('Kirish imtihoniga tayyorlanish');
    expect(res.state.orient.skipped).toBe(false);
    expect(res.state.activated_at).toBeTruthy();

    const stored = await getOnboardingState(USER);
    expect(stored.step).toBe('first_win');
  });

  it('submitOrient qayta: §15 idempotent — holat ozgarmaydi (alreadyAdvanced)', async () => {
    const before = await getOnboardingState(USER);
    const res = await submitOrient({
      userKey: USER,
      subject: 'tarix',
      goal: 'Boshqa maqsad',
      ip: '10.0.0.1',
    });
    expect(res.alreadyAdvanced).toBe(true);
    const after = await getOnboardingState(USER);
    // Orient qayta yozilmaydi — birinchi submit yozuvi saqlanadi
    expect(after.step).toBe('first_win');
    expect(after.orient.subject).toBe(before.orient.subject);
  });

  it('skipOrient: §09 skip → first_win + skipped flag; keyingi submit o\'zgarmaydi', async () => {
    const skipUser = 'b17-skip-user';
    await skipOrient({ userKey: skipUser, ip: '10.0.0.2' });
    const st = await getOnboardingState(skipUser);
    expect(st.step).toBe('first_win');
    expect(st.orient.skipped).toBe(true);
    expect(st.activated_at).toBeTruthy();

    // Skip'dan keyin orient submit → alreadyAdvanced, skipped saqlanadi
    const res = await submitOrient({ userKey: skipUser, subject: 'dasturlash' });
    expect(res.alreadyAdvanced).toBe(true);
    const st2 = await getOnboardingState(skipUser);
    expect(st2.orient.skipped).toBe(true);
  });

  it('onboardingProgress: step asosida 0..100', async () => {
    expect(onboardingProgress({ step: 'welcome' })).toBe(0);
    expect(onboardingProgress({ step: 'first_win' })).toBe(33);
    expect(onboardingProgress({ step: 'checklist' })).toBe(67);
    expect(onboardingProgress({ step: 'done' })).toBe(100);
    expect(onboardingProgress({})).toBe(0);
  });

  it('Demo bank: §11 4 til × 4 fan qamrov (B-18: har til 5 savol) + public DTO\'da correct YO\'Q', () => {
    const cov = demoBankCoverage();
    for (const s of DEMO_SUBJECTS) {
      // B-18 §28: bank 5 savolli kengaydi — har til = 5
      for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
        expect(cov[s][lang]).toBe(5);
      }
    }
    for (const s of DEMO_SUBJECTS) {
      for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
        const q = getDemoQuestion(s, lang);
        expect(q).toBeTruthy();
        expect(q.id).toBeTruthy();
        expect(q.text.length).toBeGreaterThan(3);
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        // Answer key server'da — DTO'da correct BO'LMAYDI
        expect(q.correct).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(q, 'correct')).toBe(false);
      }
    }
  });

  it('checkDemoAnswer: §11 server-side tekshiruv (correct/incorrect/unknown)', () => {
    const q = getDemoQuestion('matematika', 'uz');
    // To'g'ri javob (56 = index 1)
    const right = checkDemoAnswer('matematika', 'uz', q.id, 1);
    expect(right.ok).toBe(true);
    expect(right.correct).toBe(true);
    expect(right.correctIndex).toBe(1);
    // Noto'g'ri
    const wrong = checkDemoAnswer('matematika', 'uz', q.id, 0);
    expect(wrong.ok).toBe(true);
    expect(wrong.correct).toBe(false);
    // Noma'lum savol / invalid answer
    expect(checkDemoAnswer('matematika', 'uz', 'nope', 0).ok).toBe(false);
    expect(checkDemoAnswer('matematika', 'uz', q.id, 99).ok).toBe(false);
    expect(checkDemoAnswer('matematika', 'uz', q.id, -1).ok).toBe(false);
  });
});
