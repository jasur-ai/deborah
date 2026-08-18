import { describe, it, expect } from 'vitest';
import { extractAssets, measureRoute, checkRouteSplit, checkFonts, checkBackdropFallback, checkServiceWorker, runBudget, stripComments } from '../../scripts/performance-budget.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('STEP 38 — Performance budget gate', () => {
  it('S38.02: extractAssets href/src attribute tartibi mustaqil', () => {
    const src = `
      <link rel="stylesheet" href="/css/a.css">
      <link href="/css/b.css" rel="stylesheet" media="print">
      <script src="/js/x.js"></script>
      <script defer src="/js/y.js"></script>
    `;
    const { css, js } = extractAssets(src);
    expect(css).toEqual(['/css/a.css', '/css/b.css']);
    expect(js).toEqual(['/js/x.js', '/js/y.js']);
  });

  it("S38.02: stripComments socket.io false positive'ni tozalaydi", () => {
    const src = `<!-- comment: socket.io/main.js yo'q -->\n// socket.io legacy\n<link rel="stylesheet" href="/css/a.css">`;
    const clean = stripComments(src);
    expect(clean).not.toMatch(/socket\.io/);
    expect(clean).toMatch(/a\.css/);
  });

  it('S38.02: landing kritik CSS ≤35KB gzip', () => {
    const m = measureRoute('views/partials/landing-head.ejs');
    expect(m.missing).toBe(false);
    expect(m.cssKb).toBeLessThanOrEqual(35);
  });

  it('S38.02: app shell CSS ≤60KB gzip, JS ≤250KB gzip', () => {
    const m = measureRoute('views/partials/head.ejs');
    expect(m.missing).toBe(false);
    expect(m.cssKb).toBeLessThanOrEqual(60);
    expect(m.jsKb).toBeLessThanOrEqual(250);
  });

  it('S38.03: socket.io faqat realtime viewlarda (comment lar ignore)', () => {
    const v = checkRouteSplit(['views/user/panel.ejs', 'views/cast/director.ejs']);
    // panel socket.io yuklamasligi kerak; director o'z yuklaydi (realtime)
    expect(v).toEqual([]);
  });

  it('S38.04: fontlar woff2, ≤100KB, font-display swap', () => {
    const f = checkFonts();
    expect(f.violations).toEqual([]);
    expect(f.totalKb).toBeGreaterThan(0);
  });

  it('S38.06: backdrop-filter low-power fallback mavjud', () => {
    expect(checkBackdropFallback()).toEqual([]);
  });

  it('S38.10: SW precache assetlari mavjud va cacheFirst bor', () => {
    expect(checkServiceWorker()).toEqual([]);
  });

  it('S38.12: to\'liq budget run PASS', () => {
    const { errors } = runBudget();
    expect(errors).toEqual([]);
  });

  it('S38.12: SW precache fayli JSON emas — real fayl tekshiriladi', () => {
    const sw = readFileSync(join(ROOT, 'public/service-worker.js'), 'utf8');
    expect(sw).toMatch(/CACHE_VERSION/);
    expect(sw).toMatch(/theme-core\.js/); // S38.10: precache'da bo'lishi kerak
  });
});
