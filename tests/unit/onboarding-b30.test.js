/**
 * AUTH B-30 — Onboarding detail.
 *  1. safeReturnUrl allowlist: open redirect yo'q
 *  2. Monotonik step — orqaga qaytish mumkin emas (canAdvance)
 *  3. skipOrient — skip persistence (skipped: true)
 *  4. onboardingProgress — 0/33/66/100
 *  5. Checklist persistence — normalizeState'dan keyin ham saqlanadi
 */
import { describe, it, expect } from 'vitest';
import { safeReturnUrl } from '../../src/modules/auth/session-timeout.js';
import { canAdvance, stepIndex, ONBOARDING_STEPS, onboardingProgress, normalizeState } from '../../src/modules/onboarding/service.js';

describe('B-30 — returnUrl allowlist (open redirect yo\'q)', () => {
  it('ichki path qabul qilinadi', () => {
    expect(safeReturnUrl('/user/panel')).toBe('/user/panel');
    expect(safeReturnUrl('/teacher')).toBe('/teacher');
  });

  it('absolute URL → default /user/panel (open redirect yo\'q)', () => {
    expect(safeReturnUrl('https://evil.com')).toBe('/user/panel');
    expect(safeReturnUrl('http://evil.com')).toBe('/user/panel');
    expect(safeReturnUrl('javascript:alert(1)')).toBe('/user/panel');
  });

  it('protokolsiz absolute (//) → default (open redirect yo\'q)', () => {
    expect(safeReturnUrl('//evil.com')).toBe('/user/panel');
    expect(safeReturnUrl('//evil.com/path')).toBe('/user/panel');
  });

  it('path-traversal — /user/../admin allowlist prefiksiga tushadi, \'..\' tashqi URL emas', () => {
    const r = safeReturnUrl('/user/../admin/dashboard');
    // Hech qachon tashqi host qaytmaydi — doim ichki path
    expect(r.startsWith('http')).toBe(false);
    expect(r.startsWith('//')).toBe(false);
  });

  it('yaroqsiz qiymat → default /user/panel', () => {
    expect(safeReturnUrl(undefined)).toBe('/user/panel');
    expect(safeReturnUrl(123)).toBe('/user/panel');
    expect(safeReturnUrl('')).toBe('/user/panel');
  });

  it('ruxsat etilmagan prefiks → default /user/panel', () => {
    expect(safeReturnUrl('/dashboard')).toBe('/user/panel');
    expect(safeReturnUrl('/admin-login')).toBe('/user/panel');
  });
});

describe('B-30 — monotonic step', () => {
  it('ONBOARDING_STEPS tartibi: welcome→first_win→checklist→done', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'first_win', 'checklist', 'done']);
  });

  it('canAdvance: faqat oldinga', () => {
    expect(canAdvance('welcome', 'first_win')).toBe(true);
    expect(canAdvance('first_win', 'checklist')).toBe(true);
    expect(canAdvance('checklist', 'done')).toBe(true);
    // Orqaga / o'ziga → false
    expect(canAdvance('first_win', 'welcome')).toBe(false);
    expect(canAdvance('done', 'checklist')).toBe(false);
    expect(canAdvance('welcome', 'welcome')).toBe(false);
  });

  it('stepIndex', () => {
    expect(stepIndex('welcome')).toBe(0);
    expect(stepIndex('done')).toBe(3);
    expect(stepIndex('nope')).toBe(-1);
  });

  it('onboardingProgress: 0/33/66/100', () => {
    expect(onboardingProgress({ step: 'welcome' })).toBe(0);
    expect(onboardingProgress({ step: 'first_win' })).toBe(33);
    expect(onboardingProgress({ step: 'checklist' })).toBe(67);
    expect(onboardingProgress({ step: 'done' })).toBe(100);
  });
});

describe('B-30 — checklist persistence', () => {
  it('normalizeState: checklist object saqlanadi (refresh\'da yo\'qolmaydi)', () => {
    const state = normalizeState({
      step: 'checklist',
      checklist: { done: ['item1', 'item2'], skipped: ['item3'] },
      activated_at: 100,
    });
    expect(state.checklist).toEqual({ done: ['item1', 'item2'], skipped: ['item3'] });
    expect(state.step).toBe('checklist');
  });

  it('normalizeState: orient skipped saqlanadi', () => {
    const state = normalizeState({
      step: 'first_win',
      orient: { subject: 'Math', skipped: true, submittedAt: 100 },
    });
    expect(state.orient.skipped).toBe(true);
    expect(state.orient.subject).toBe('Math');
  });

  it('normalizeState: yaroqsiz step → welcome (default)', () => {
    const state = normalizeState({ step: 'hacked', checklist: null });
    expect(state.step).toBe('welcome');
  });
});
