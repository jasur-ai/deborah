/**
 * Deborah — Theme Core unit testlari (STYLE STEP 07 / S07.12)
 * ----------------------------------------------------------
 * public/js/theme-core.js — pure resolver (DOM'siz, Node'da testable).
 *
 * Qamrov:
 *  - S07.01  States: system|light|dark|hc-light|hc-dark → resolved
 *  - S07.04  colorScheme resolved theme bilan (native form controls)
 *  - S07.05  canvas qiymatlari meta-theme-color bilan sinxron
 *  - S07.08  System preference — faqat user override bo'lmaganda
 *  - Invalid state → system fallback
 */
import { describe, it, expect } from 'vitest';
import { resolveState, STATES, STORAGE_KEY } from '../../public/js/theme-core.js';

describe('Theme Core (S07.01) — state → resolved', () => {
  it('exposes the 5 valid states', () => {
    expect(STATES).toEqual(['system', 'light', 'dark', 'hc-light', 'hc-dark']);
    expect(STORAGE_KEY).toBe('deborah-theme-state');
  });

  it('resolves light → light / colorScheme light', () => {
    const r = resolveState('light', false, false);
    expect(r.state).toBe('light');
    expect(r.resolved).toBe('light');
    expect(r.colorScheme).toBe('light');
  });

  it('resolves dark → dark / colorScheme dark', () => {
    const r = resolveState('dark', true, false); // OS light bo'lsa ham override
    expect(r.resolved).toBe('dark');
    expect(r.colorScheme).toBe('dark');
  });

  it('resolves hc-light → high-contrast / colorScheme light', () => {
    const r = resolveState('hc-light', false, false);
    expect(r.resolved).toBe('high-contrast');
    expect(r.colorScheme).toBe('light');
  });

  it('resolves hc-dark → high-contrast / colorScheme dark', () => {
    const r = resolveState('hc-dark', true, true);
    expect(r.resolved).toBe('high-contrast');
    expect(r.colorScheme).toBe('dark');
  });
});

describe('Theme Core (S07.08) — system state', () => {
  it('system + OS light → light', () => {
    const r = resolveState('system', true, false);
    expect(r.state).toBe('system');
    expect(r.resolved).toBe('light');
    expect(r.colorScheme).toBe('light');
  });

  it('system + OS dark → dark', () => {
    const r = resolveState('system', false, false);
    expect(r.resolved).toBe('dark');
    expect(r.colorScheme).toBe('dark');
  });

  it('system + prefers-contrast: more → high-contrast', () => {
    const r = resolveState('system', false, true);
    expect(r.resolved).toBe('high-contrast');
    expect(r.colorScheme).toBe('dark'); // OS dark bo'lsa
  });

  it('system + HC + OS light → high-contrast / colorScheme light', () => {
    const r = resolveState('system', true, true);
    expect(r.resolved).toBe('high-contrast');
    expect(r.colorScheme).toBe('light');
  });

  it('invalid state string → system fallback', () => {
    const r = resolveState('banana', false, true);
    expect(r.state).toBe('system');
    expect(r.resolved).toBe('high-contrast');
  });

  it('undefined/null state → system fallback', () => {
    expect(resolveState(undefined, false, false).state).toBe('system');
    expect(resolveState(null, true, false).resolved).toBe('light');
  });
});

describe('Theme Core (S07.05) — canvas sync qiymatlari', () => {
  it('light → #F5F7FB (meta-theme-color bilan sinxron)', () => {
    expect(resolveState('light', false, false).canvas).toBe('#F5F7FB');
  });

  it('dark → #080C1A', () => {
    expect(resolveState('dark', false, false).canvas).toBe('#080C1A');
  });

  it('high-contrast → #FFFFFF', () => {
    expect(resolveState('hc-light', false, false).canvas).toBe('#FFFFFF');
    expect(resolveState('hc-dark', false, false).canvas).toBe('#FFFFFF');
    expect(resolveState('system', false, true).canvas).toBe('#FFFFFF');
  });
});
