/**
 * AUTH D-16 §10 — Onboarding state machine edge-case (wsl qo'shimchasi)
 * ---------------------------------------------------------------------
 *  - stepIndex/canAdvance: monotonik (B-17 §15), unknown step.
 *  - normalizeState: noto'g'ri raw → welcome default (fail-safe).
 *  - onboardingProgress: 0/33/67/100%, unknown → 0.
 *  - checklist: first_win avtomatik, unknown item, progress 0..100 (B-19).
 * Manba: B-17 §15, B-18 §06, B-19 §06/§28.
 */
import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STEPS,
  stepIndex,
  canAdvance,
  normalizeState,
  onboardingProgress,
  CHECKLIST_ITEMS,
  checklistItemState,
  checklistProgress,
} from '../../../src/modules/onboarding/service.js';

describe('AUTH D-16 §10 — stepIndex / canAdvance (B-17 §15 monotonik)', () => {
  it('stepIndex: barcha step\'lar indekslanadi; unknown → -1', () => {
    expect(stepIndex('welcome')).toBe(0);
    expect(stepIndex('first_win')).toBe(1);
    expect(stepIndex('checklist')).toBe(2);
    expect(stepIndex('done')).toBe(3);
    expect(stepIndex('bogus_step')).toBe(-1);
    expect(stepIndex(undefined)).toBe(-1);
  });

  it('canAdvance: welcome→first_win ruxsat; orqaga va o\'ziga → yo\'q', () => {
    expect(canAdvance('welcome', 'first_win')).toBe(true);
    expect(canAdvance('first_win', 'checklist')).toBe(true);
    expect(canAdvance('checklist', 'done')).toBe(true);
    expect(canAdvance('first_win', 'welcome')).toBe(false); // orqaga
    expect(canAdvance('done', 'checklist')).toBe(false);
    expect(canAdvance('first_win', 'first_win')).toBe(false); // o'ziga
    expect(canAdvance('bogus', 'first_win')).toBe(false); // unknown from
  });
});

describe('AUTH D-16 §10 — normalizeState (fail-safe)', () => {
  it('bo\'sh/noto\'g\'ri raw → welcome default, maydonlar null', () => {
    const s = normalizeState(null);
    expect(s.step).toBe('welcome');
    expect(s.checklist).toBeNull();
    expect(s.activated_at).toBeNull();
    expect(s.firstWin).toBeNull();
  });

  it('checklist string (noto\'g\'ri) → null; to\'g\'ri object saqlanadi', () => {
    expect(normalizeState({ checklist: 'nope' }).checklist).toBeNull();
    expect(normalizeState({ checklist: { items: [] } }).checklist).toEqual({ items: [] });
  });

  it('unknown step → welcome (inkrement qilingan buzilgan holat ham xavfsiz)', () => {
    expect(normalizeState({ step: 'hacked' }).step).toBe('welcome');
  });
});

describe('AUTH D-16 §10 — onboardingProgress (0..100)', () => {
  it('welcome 0%, first_win 33%, checklist 67%, done 100%', () => {
    expect(onboardingProgress({ step: 'welcome' })).toBe(0);
    expect(onboardingProgress({ step: 'first_win' })).toBe(33);
    expect(onboardingProgress({ step: 'checklist' })).toBe(67);
    expect(onboardingProgress({ step: 'done' })).toBe(100);
  });

  it('state yo\'q / unknown → 0', () => {
    expect(onboardingProgress(null)).toBe(0);
    expect(onboardingProgress({ step: 'bogus' })).toBe(0);
  });
});

describe('AUTH D-16 §10 — checklist (B-19 §06/§28)', () => {
  it('CHECKLIST_ITEMS: 5 item — first_win avtomatik (client o\'zgartira olmaydi)', () => {
    expect(CHECKLIST_ITEMS).toEqual(['profil', 'telegram', 'first_win', 'kalendar', 'streak']);
    // first_win checklist'dagi done ro'yxatga bog'liq EMAS — firstWinCompleted'dan keladi
    expect(checklistItemState({ items: [{ itemId: 'first_win', done: false }] }, 'first_win', true)).toBe(true);
    expect(checklistItemState({ items: [{ itemId: 'first_win', done: true }] }, 'first_win', false)).toBe(false);
  });

  it('unknown item → false; done item → true', () => {
    expect(checklistItemState(null, 'bogus_item', false)).toBe(false);
    expect(
      checklistItemState({ items: [{ itemId: 'profil', done: true }] }, 'profil', false)
    ).toBe(true);
    expect(
      checklistItemState({ items: [{ itemId: 'profil', done: false }] }, 'profil', false)
    ).toBe(false);
  });

  it('checklistProgress: 0/5 → 0%, 5/5 → 100%, first_win avtomatik hisoblanadi', () => {
    expect(checklistProgress(null, false)).toEqual({ done: 0, total: 5, percent: 0 });
    const allDone = { items: CHECKLIST_ITEMS.filter((i) => i !== 'first_win').map((i) => ({ itemId: i, done: true })) };
    expect(checklistProgress(allDone, true)).toEqual({ done: 5, total: 5, percent: 100 });
    // faqat first_win → 20%
    expect(checklistProgress({ items: [] }, true)).toEqual({ done: 1, total: 5, percent: 20 });
  });
});
