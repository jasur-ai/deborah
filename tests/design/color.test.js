// ─────────────────────────────────────────────────────────────
// Color pipeline tests — STYLE STEP 06 (S06.01–S06.12)
// Final palette, OKLCH masters, contrast, CVD, redundant encoding.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKENS = join(ROOT, 'public', 'design', 'tokens');

const run = (script) => execFileSync(process.execPath, [join(ROOT, 'scripts', script)], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
});

const tokensOf = (file) => JSON.parse(readFileSync(join(TOKENS, file), 'utf8'));

describe('STYLE STEP 06 — Color pipeline', () => {
  describe('S06.01 — Final palette', () => {
    it('Cobalt primary action #1746D1 (cobalt-500)', () => {
      const p = tokensOf('primitive.color.json');
      expect(p.deborah.primitive.cobalt['cobalt-500'].$value).toBe('#1746D1');
    });
    it('Dark action #7AA8FF, Signal, Insight, Ink, Paper final qiymatlar', () => {
      const p = tokensOf('primitive.color.json');
      expect(p.deborah.primitive.cobalt['cobalt-dark-action'].$value).toBe('#7AA8FF');
      expect(p.deborah.primitive.signal['signal-light'].$value).toBe('#007C91');
      expect(p.deborah.primitive.signal['signal-dark'].$value).toBe('#52D0D8');
      expect(p.deborah.primitive.insight['insight-light'].$value).toBe('#9B5E00');
      expect(p.deborah.primitive.insight['insight-dark'].$value).toBe('#F2B84B');
      expect(p.deborah.primitive.foundation.ink.$value).toBe('#0C1426');
      expect(p.deborah.primitive.foundation.paper.$value).toBe('#F6F8FC');
    });
  });

  describe('S06.02 — OKLCH master + sRGB fallback', () => {
    it('har brand primitive $oklch ga ega', () => {
      const p = tokensOf('primitive.color.json');
      const brands = ['cobalt-100', 'cobalt-500', 'cobalt-600', 'cobalt-dark-action', 'signal-light', 'signal-dark', 'insight-light', 'insight-dark'];
      for (const b of brands) {
        expect(p.deborah.primitive.cobalt[b]?.$oklch || p.deborah.primitive.signal[b]?.$oklch || p.deborah.primitive.insight[b]?.$oklch, b).toMatch(/^oklch\(/);
      }
    });
    it('generated CSS @supports oklch block chiqaradi', () => {
      const css = readFileSync(join(ROOT, 'public', 'design', 'generated', 'tokens.css'), 'utf8');
      expect(css).toMatch(/@supports \(color: oklch\(0% 0 0\)\)/);
      expect(css).toMatch(/oklch\(46\.59% 0\.219 264\.4\)/);
    });
  });

  describe('S06.03 — Neutral scales', () => {
    it('har theme surface.sunken parity mavjud', () => {
      for (const f of ['semantic.light.json', 'semantic.dark.json', 'semantic.high-contrast.json']) {
        const t = tokensOf(f);
        expect(t.deborah.semantic.color.surface.sunken.$value, f).toBeTruthy();
        expect(t.deborah.semantic.color.surface.default.$value, f).toBeTruthy();
      }
    });
  });

  describe('S06.04-06 — Contrast checker', () => {
    it('check-contrast exit 0 (40+ pair)', () => {
      const out = run('check-contrast.js');
      expect(out).toContain('Contrast pass');
    });
    it('report mavjud, PASS satrlari bor', () => {
      const rep = readFileSync(join(ROOT, 'design-audit', 'contrast-report.md'), 'utf8');
      expect(rep).toContain('PASS');
      expect(rep).toMatch(/text\.primary on surface/);
    });
  });

  describe('S06.07 — Gradient scrim', () => {
    it('color.surface.scrim solid token 3 theme da', () => {
      for (const f of ['semantic.light.json', 'semantic.dark.json', 'semantic.high-contrast.json']) {
        const t = tokensOf(f);
        expect(t.deborah.semantic.color.surface.scrim.$value, f).toBeTruthy();
      }
    });
  });

  describe('S06.08-09 — CVD checker', () => {
    it('check-cvd exit 0 (redundant encoding gate)', () => {
      const out = run('check-cvd.js');
      expect(out).toContain('CVD pass');
    });
    it('cvd-report redundant encoding audit PASS', () => {
      const rep = readFileSync(join(ROOT, 'design-audit', 'cvd-report.md'), 'utf8');
      expect(rep).toContain('✅ status badge');
      expect(rep).toContain('✅ answer option');
      expect(rep).toContain('✅ focus-visible');
    });
  });

  describe('S06.11 — Forced-colors', () => {
    it('brand.css forced-colors mapping mavjud', () => {
      const css = readFileSync(join(ROOT, 'public', 'design', 'brand.css'), 'utf8');
      expect(css).toMatch(/forced-colors: active/);
      expect(css).toMatch(/CanvasText/);
      expect(css).toMatch(/HighlightText/);
      expect(css).toMatch(/forced-color-adjust: none/);
    });
  });
});
