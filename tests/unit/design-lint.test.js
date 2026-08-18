/**
 * STYLE STEP 37 — Design lint rules unit testlari.
 * - S37.05 inline style klassifikatsiya (color/background error, layout allow)
 * - S37.02 transition: all regex
 * - S37.03 infinite animation allowlist
 * - S37.04 tiny text istisnolari
 * - S37.07 deprecated alias regex
 * - Gate: `node scripts/design-lint.js` joriy codebase'da PASS bo'lishi
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import {
  classifyStyleBody,
  ALLOW_INFINITE_ANIMS,
  TINY_SELECTOR_ALLOW,
  DEPRECATED_ALIASES,
} from '../../scripts/design-lint.js';

describe('S37.05 — inline style klassifikatsiya', () => {
  it('color/background inline → error', () => {
    const r = classifyStyleBody('margin-top:6px;color:var(--text-muted)');
    expect(r.err).toContain('color');
  });
  it('background + border → error (background)', () => {
    const r = classifyStyleBody('background:rgba(0,0,0,.55);border:1px solid var(--border)');
    expect(r.err).toContain('background');
  });
  it('display:none + width (dims) → allow', () => {
    const r = classifyStyleBody('display:none;width:100%');
    expect(r.err).toHaveLength(0);
    expect(r.warn).not.toContain('display');
  });
  it('data-driven custom property → allow', () => {
    const r = classifyStyleBody('--c:var(--accent-purple);--cbg:rgba(100,116,139,.12)');
    expect(r.customProp).toBe(true);
    expect(r.err).toHaveLength(0);
  });
  it('font-size/margin → warn (migratsiya), error emas', () => {
    const r = classifyStyleBody('font-size:12px;margin:4px');
    expect(r.err).toHaveLength(0);
    expect(r.warn).toEqual(expect.arrayContaining(['font-size']));
  });
});

describe('S37.03 — infinite animation allowlist', () => {
  it('loading spinner + approved milestone animatsiyalar allowlistda', () => {
    for (const name of ['btn-spin', 'edikit-spin', 'edikit-skeleton-shimmer', 'switch-pulse', 'tb-pulse', 'offline-blink']) {
      expect(ALLOW_INFINITE_ANIMS.has(name), name).toBe(true);
    }
  });
});

describe('S37.04 — tiny text istisnolari', () => {
  it('badge/auth-meta/density allowlist selectorlariga mos keladi', () => {
    expect(TINY_SELECTOR_ALLOW.some((re) => re.test('.badge'))).toBe(true);
    expect(TINY_SELECTOR_ALLOW.some((re) => re.test('.auth-caps-hint'))).toBe(true);
    expect(TINY_SELECTOR_ALLOW.some((re) => re.test('.tb-step-num'))).toBe(true);
    expect(TINY_SELECTOR_ALLOW.some((re) => re.test('.dt-density'))).toBe(true);
  });
});

describe('S37.07 — deprecated token alias regex', () => {
  it('var(--muted)/var(--accent) ni topadi', () => {
    expect('color: var(--muted)'.match(DEPRECATED_ALIASES)).toBeTruthy();
    expect('background: var(--accent)'.match(DEPRECATED_ALIASES)).toBeTruthy();
    expect('color: var(--edikit-semantic-color-text-primary)'.match(DEPRECATED_ALIASES)).toBeNull();
  });
});

describe('Gate', () => {
  it('design-lint joriy codebase bilan PASS (exit 0)', () => {
    const out = execFileSync('node', ['scripts/design-lint.js'], {
      cwd: path.resolve(__dirname, '..', '..'),
      encoding: 'utf8',
    });
    expect(out).toContain('PASS — design lint');
  });
});
