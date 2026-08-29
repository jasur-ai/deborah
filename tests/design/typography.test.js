/**
 * Deborah — Typography Foundation unit testlari (STYLE STEP 08 / S08.01-12)
 * ------------------------------------------------------------------------
 * Token'lar + validator bilan birga:
 *  - S08.01  Self-hosted font fayllar mavjud
 *  - S08.03  font-display: swap barcha @font-face'da
 *  - S08.06  Semantic type rollar tokenlashtirilgan
 *  - S08.07  Body 16px/1.55+, metadata 14px+
 *  - S08.08  Weight disiplina (400-700, 800/900 yo'q)
 *  - S08.09  tabular-nums utility mavjud
 *  - S08.12  Nunito/Righteous operational emas
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');

const typo = JSON.parse(readFileSync(join(ROOT, 'public/design/tokens/typography.json'), 'utf8')).deborah.typography;
const typeCss = readFileSync(join(ROOT, 'public/design/foundations/typography.css'), 'utf8');
const styleCss = readFileSync(join(ROOT, 'public/css/style.css'), 'utf8');

describe('S08.01 — self-hosted fonts', () => {
  it('required woff2 fayllar mavjud va minimal hajmda', () => {
    const required = [
      'source-sans-3-latin-200.woff2',
      'source-sans-3-cyrillic-200.woff2',
      'manrope-latin-200.woff2',
      'manrope-cyrillic-200.woff2',
      'ibm-plex-mono-latin-400.woff2',
      'ibm-plex-mono-latin-700.woff2',
    ];
    for (const f of required) {
      const p = join(ROOT, 'public/fonts', f);
      expect(existsSync(p), f).toBe(true);
      expect(readFileSync(p).length, `${f} hajmi`).toBeGreaterThan(2048);
    }
  });

  it('OFL license fayli bor', () => {
    expect(existsSync(join(ROOT, 'public/fonts/OFL-LICENSE.txt'))).toBe(true);
  });
});

describe('S08.03 — font-display swap', () => {
  it('barcha @font-face font-display: swap ishlatadi', () => {
    const faces = typeCss.match(/@font-face\s*\{/g) || [];
    expect(faces.length).toBeGreaterThanOrEqual(10);
    const swap = typeCss.match(/@font-face[^{]*\{[^}]*?font-display:\s*swap/g) || [];
    expect(swap.length).toBe(faces.length);
  });
});

describe('S08.06 — semantic type roles', () => {
  it('role klasslari mavjud', () => {
    for (const cls of ['type-hero', 'type-page-title', 'type-section-title', 'type-card-title', 'type-body', 'type-body-large', 'type-label', 'type-metadata', 'type-badge', 'type-projector-question', 'type-projector-option']) {
      expect(typeCss, cls).toContain(`.${cls}`);
    }
  });

  it('role tokenlari typography.json da', () => {
    expect(typo.role.hero.size).toBe('3rem');
    expect(typo.role['projector-question'].size).toBe('3rem');
    expect(typo.role.metadata.size).toBe('0.875rem');
  });
});

describe('S08.07 — body/metadata o\'lchamlar', () => {
  it('body base 16px (1rem)', () => {
    expect(typo['font-size'].base.$value).toBe('1rem');
  });
  it('metadata 14px+ (0.875rem)', () => {
    expect(typo['font-size'].sm.$value).toBe('0.875rem');
    expect(typo['font-size'].xs.$value).toBe('0.75rem');
  });
  it('body line-height 1.55+', () => {
    expect(Number(typo['line-height'].normal.$value)).toBeGreaterThanOrEqual(1.55);
  });
});

describe('S08.08 — weight disiplina', () => {
  it('tokenlarda 400-700 faqat', () => {
    const node = typo['font-weight'];
    const weights = Object.entries(node)
      .filter(([k, v]) => k !== '$type' && v && v.$value)
      .map(([, v]) => Number(v.$value));
    expect(weights.length).toBeGreaterThanOrEqual(4);
    for (const w of weights) expect(w).toBeLessThanOrEqual(700);
  });
  it('style.css --font-body Source Sans 3', () => {
    expect(styleCss).toContain("'Source Sans 3'");
  });
  it('style.css --font-display Manrope', () => {
    expect(styleCss).toContain("'Manrope'");
  });
  it('style.css --font-mono IBM Plex Mono', () => {
    expect(styleCss).toContain("'IBM Plex Mono'");
  });
});

describe('S08.09 — tabular-nums', () => {
  it('tnum utility + timer/join/score klasslar', () => {
    expect(typeCss).toContain('.tnum');
    expect(typeCss).toContain('font-variant-numeric: tabular-nums lining-nums');
    expect(typeCss).toContain('.proj-timer');
    expect(typeCss).toContain('.proj-code');
  });
});

describe('S08.12 — eski fontlar migratsiya', () => {
  it('style.css da Nunito/Righteous yo\'q', () => {
    expect(styleCss).not.toMatch(/Nunito|Righteous/);
  });
  it('cast-tokens.css da Nunito yo\'q', () => {
    const ct = readFileSync(join(ROOT, 'public/css/cast-tokens.css'), 'utf8');
    expect(ct).not.toMatch(/Nunito/);
  });
});
