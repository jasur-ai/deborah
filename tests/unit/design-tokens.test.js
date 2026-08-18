// ─────────────────────────────────────────────────────────────
// Design Token system tests — STYLE STEP 04 (S04.05–S04.09)
// Validator + build determinism + generated output sanity.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKENS_DIR = join(ROOT, 'public', 'design', 'tokens');
const GENERATED_DIR = join(ROOT, 'public', 'design', 'generated');
const CSS_PATH = join(GENERATED_DIR, 'tokens.css');
const FLAT_PATH = join(GENERATED_DIR, 'tokens.flat.json');

function runScript(name, args = []) {
  return execFileSync(process.execPath, [join(ROOT, 'scripts', name), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('STYLE STEP 04 — Design token system', () => {
  beforeAll(() => {
    // Build bir marta (baseline) — keyingi determinism test'lari uchun
    runScript('build-design-tokens.js');
  });

  describe('S04.05-06 — Validator', () => {
    it('valid fayllar uchun exit 0', () => {
      const out = runScript('validate-design-tokens.js');
      expect(out).toContain('valid');
    });

    it('har bir theme fayli JSON parse bo\'ladi', () => {
      const files = readdirSync(TOKENS_DIR).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThanOrEqual(6);
      for (const f of files) {
        expect(() => JSON.parse(readFileSync(join(TOKENS_DIR, f), 'utf8'))).not.toThrow();
      }
    });
  });

  describe('S04.07 — Deterministic build', () => {
    it('ikki build natijasi byte-identical (determinizm)', () => {
      const first = readFileSync(CSS_PATH, 'utf8');
      runScript('build-design-tokens.js');
      const second = readFileSync(CSS_PATH, 'utf8');
      expect(second).toBe(first);
    });

    it('generated CSS banner bilan belgilanadi (qo\'lda tahrir taqiqlangan)', () => {
      const css = readFileSync(CSS_PATH, 'utf8');
      expect(css).toMatch(/GENERATED|generated|@generated/i);
    });

    it('flat map va contrast fixture generatsiya qilinadi', () => {
      expect(existsSync(FLAT_PATH)).toBe(true);
      const flat = JSON.parse(readFileSync(FLAT_PATH, 'utf8'));
      expect(Object.keys(flat).length).toBeGreaterThan(100);
      expect(existsSync(join(ROOT, 'design-audit', 'contrast-fixture.json'))).toBe(true);
    });
  });

  describe('S04.03-04 — Generated CSS content', () => {
    let css;
    beforeAll(() => {
      css = readFileSync(CSS_PATH, 'utf8');
    });

    it('semantic intent tokenlar mavjud (color.action.primary)', () => {
      expect(css).toMatch(/--edikit-semantic-color-action-primary:/);
    });

    it('light/dark/high-contrast theme blocklar mavjud', () => {
      expect(css).toMatch(/\[data-theme="light"\], body\.theme-light/);
      expect(css).toMatch(/\[data-theme="high-contrast"\]/);
    });

    it('theme qiymatlari farqlanadi (parity ≠ identical values)', () => {
      // surface-default: dark (:root) vs light vs high-contrast
      const vals = [...css.matchAll(/--edikit-semantic-color-surface-default:\s*([^;]+);/g)].map((m) => m[1].trim());
      expect(vals.length).toBeGreaterThanOrEqual(2);
      expect(new Set(vals).size).toBeGreaterThan(1);
    });

    it('backward-compat alias `--accent` semantic token\'ga havola qiladi', () => {
      expect(css).toMatch(/--accent:\s*var\(--edikit-semantic-color-action-primary\)/);
    });

    it('unresolved alias qolmagan (hech qanday braced ref)', () => {
      expect(css).not.toMatch(/\{[a-z.-]+\}/);
    });
  });

  describe('S04.10 — Check script', () => {
    it('design:tokens:check chain ishlaydi (validate + build)', () => {
      // package.json'dagi script tekshiruvi — validator va build mavjud
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
      expect(pkg.scripts['design:tokens:build']).toBeTruthy();
      expect(pkg.scripts['design:tokens:check']).toBeTruthy();
    });
  });

  describe('S04.12 — Migration doc', () => {
    it('token-migration.md mavjud va legacy→final map bor', () => {
      const doc = readFileSync(join(ROOT, 'design-audit', 'token-migration.md'), 'utf8');
      expect(doc).toMatch(/draft|legacy|final/i);
      expect(doc).toMatch(/action.primary|action-primary/i);
    });
  });
});
