import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const layout = JSON.parse(readFileSync(join(ROOT, 'public/design/tokens/layout.json'), 'utf8'));
const tokensCss = readFileSync(join(ROOT, 'public/design/generated/tokens.css'), 'utf8');
const motionCss = readFileSync(join(ROOT, 'public/design/foundations/motion.css'), 'utf8');
const headEjs = readFileSync(join(ROOT, 'views/partials/head.ejs'), 'utf8');

describe('S10.01 — duration scale', () => {
  const d = layout.edikit.motion.duration;
  it('0/80/120/160/220/320/500/800 mavjud', () => {
    expect(d['0'].$value).toBe('0ms');
    expect(d['80'].$value).toBe('80ms');
    expect(d['120'].$value).toBe('120ms');
    expect(d['160'].$value).toBe('160ms');
    expect(d['220'].$value).toBe('220ms');
    expect(d['320'].$value).toBe('320ms');
    expect(d['500'].$value).toBe('500ms');
    expect(d['800'].$value).toBe('800ms');
  });
  it('generated tokens CSS da bor', () => {
    expect(tokensCss).toContain('--edikit-motion-duration-80: 80ms');
    expect(tokensCss).toContain('--edikit-motion-duration-800: 800ms');
  });
});

describe('S10.02 — easing', () => {
  const e = layout.edikit.motion.easing;
  it('standard/enter/exit/emphasis', () => {
    expect(e.standard.$value).toEqual([0.4, 0, 0.2, 1]);
    expect(e.enter.$value).toEqual([0, 0, 0.2, 1]);
    expect(e.exit.$value).toEqual([0.4, 0, 1, 1]);
    expect(e.emphasis.$value).toEqual([0.2, 0.8, 0.2, 1]);
  });
  it('bounce/elastic easing yo\'q', () => {
    const css = tokensCss + motionCss;
    expect(css.toLowerCase()).not.toMatch(/cubic-bezier\([^)]*(?:1\.\d|2\.\d)[^)]*\)/);
  });
});

describe('S10.03 — transition: all = 0', () => {
  it('public/css va foundations da transition:all yo\'q', () => {
    const cssDir = join(ROOT, 'public/css');
    const found = [];
    for (const f of readdirSync(cssDir).filter((x) => x.endsWith('.css'))) {
      const css = readFileSync(join(cssDir, f), 'utf8');
      if (css.includes('transition: all')) found.push(f);
    }
    expect(found).toEqual([]);
  });
});

describe('S10.06 — exit = enter 65-80%', () => {
  const i = layout.edikit.motion.intent;
  it('modal-exit 160 / modal 220', () => {
    const ratio = parseInt(i['modal-exit'].$value) / parseInt(i.modal.$value);
    expect(ratio).toBeGreaterThanOrEqual(0.65);
    expect(ratio).toBeLessThanOrEqual(0.8);
  });
});

describe('S10.09 — reduced-motion parity', () => {
  it('prefers-reduced-motion blok bor, functional static', () => {
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(motionCss).toContain('.proj-timer.urgent');
    expect(motionCss).toContain('animation-duration: 0.01ms');
  });
});

describe('S10.10 — progressive enhancement', () => {
  it('@starting-style + transition-behavior @supports da', () => {
    expect(motionCss).toContain('@supports (transition-behavior: allow-discrete)');
    expect(motionCss).toContain('@starting-style');
  });
});

describe('S10.11 — focus ring instant', () => {
  it('focus-visible transition:none', () => {
    expect(motionCss).toContain(':focus-visible');
    expect(motionCss).toContain('transition: none');
  });
});

describe('S10.12 — head ulanish', () => {
  it('motion.css head.ejs + cast viewlarda', () => {
    expect(headEjs).toContain('foundations/motion.css');
    for (const v of ['director', 'participant', 'projector', 'quality-lab', 'replay', 'results']) {
      const view = readFileSync(join(ROOT, `views/cast/${v}.ejs`), 'utf8');
      expect(view, `${v}.ejs`).toContain('foundations/motion.css');
    }
  });
});
