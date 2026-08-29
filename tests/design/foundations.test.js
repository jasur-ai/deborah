import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('S11.01 — reset foundation', () => {
  const reset = rd('public/design/foundations/reset.css');
  it('box-sizing + body margin + media + font inheritance', () => {
    expect(reset).toContain('box-sizing: border-box');
    expect(reset).toContain('body {\n    margin: 0;');
    expect(reset).toContain('max-width: 100%');
    expect(reset).toContain('input, button, textarea, select');
    expect(reset).toContain('font: inherit');
  });
  it('@layer reset', () => {
    expect(reset).toContain('@layer reset');
  });
});

describe('S11.02 — base semantic + ambient removed', () => {
  const base = rd('public/design/foundations/base.css');
  const style = rd('public/css/style.css');
  it('body semantic tokens', () => {
    expect(base).toContain('--deborah-semantic-color-surface-default');
    expect(base).toContain('--deborah-semantic-color-text-primary');
  });
  it('global body::before ambient overlay yo\'q', () => {
    expect(style).not.toMatch(/body::before\s*\{/);
  });
  it('scroll-padding-top sticky header', () => {
    expect(base).toContain('scroll-padding-top: 72px');
  });
});

describe('S11.03 — link rules content vs app', () => {
  const base = rd('public/design/foundations/base.css');
  it('.prose a / .content a underline', () => {
    expect(base).toContain('.prose a,');
    expect(base).toContain('text-decoration: underline');
    expect(base).toContain('text-underline-offset: 3px');
  });
  it('visited state', () => {
    expect(base).toContain(':visited');
  });
});

describe('S11.04 — focus 3px', () => {
  const focus = rd('public/design/foundations/focus.css');
  it('outline 3px + offset 3px + transition none', () => {
    expect(focus).toContain('outline: 3px solid');
    expect(focus).toContain('outline-offset: 3px');
    expect(focus).toContain('transition: none');
  });
  it('sticky z-index token', () => {
    expect(focus).toContain('[data-sticky]');
    expect(focus).toContain('--deborah-z-index-sticky');
  });
});

describe('S11.05 — forced-colors', () => {
  const focus = rd('public/design/foundations/focus.css');
  it('focus + selection + control boundary', () => {
    expect(focus).toContain('@media (forced-colors: active)');
    expect(focus).toContain('outline: 3px solid Highlight');
    expect(focus).toContain('::selection');
    expect(focus).toContain('input, button, select, textarea');
    expect(focus).toContain('border: 1px solid ButtonText');
  });
});

describe('S11.06 — utilities', () => {
  const utils = rd('public/design/foundations/utilities.css');
  it('.sr-only, .skip-link, scroll-margin', () => {
    expect(utils).toContain('.sr-only');
    expect(utils).toContain('.skip-link');
    expect(utils).toContain('.skip-link:focus-visible');
    expect(utils).toContain('scroll-margin-top');
  });
  it('spacing utilities faqat token', () => {
    expect(utils).toContain('var(--deborah-spacing-2, 8px)');
    expect(utils).not.toContain('padding: 13px');
  });
});

describe('S11.08 — utility scope', () => {
  it('utilities.css da komponent styling yo\'q', () => {
    const utils = rd('public/design/foundations/utilities.css');
    expect(utils).not.toMatch(/box-shadow/);
    expect(utils).not.toMatch(/gradient/);
  });
});

describe('S11.10 — cascade layers', () => {
  it('4 foundation fayl @layer ishlatadi', () => {
    const count = ['reset', 'base', 'focus', 'utilities']
      .filter((n) => rd(`public/design/foundations/${n}.css`).includes('@layer'))
      .length;
    expect(count).toBe(4);
  });
  it('head.ejs barcha foundation import', () => {
    const head = rd('views/partials/head.ejs');
    for (const n of ['reset', 'base', 'focus', 'utilities']) {
      expect(head, n).toContain(`foundations/${n}.css`);
    }
  });
});

describe('S11.11 — !important allowlist', () => {
  it('!important ≤26 (reduced-motion/HC + S13 mobil-a11y: input 16px anti-zoom ×3)', () => {
    const cssDir = join(ROOT, 'public/css');
    let total = 0;
    for (const f of readdirSync(cssDir).filter((x) => x.endsWith('.css'))) {
      total += (rd(`public/css/${f}`).match(/!important/g) || []).length;
    }
    expect(total).toBeLessThanOrEqual(26);
  });
});
