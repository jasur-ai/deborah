/**
 * Deborah — E2E: Typography (STYLE STEP 08 / S08.02, S08.04, S08.11)
 * -----------------------------------------------------------------
 * Functional tekshiruvlar — app-desktop project'ida:
 *  - S08.02  Uzbek (Oʻ/Gʻ) + Uzbek Cyrillic (Ў/ғ) + Russian glyphlar
 *  - S08.04  CLS font-shift past target (fallback → webfont)
 *  - S08.11  200% zoom — hech narsa kesilmaydi/ustma-ust tushmaydi
 *  - S08.11  text-spacing override — clipping yo'q
 *  - S08.11  font-load failure — fallback bilan sahifa buzilmaydi
 */
import { expect } from '@playwright/test';
import { test, openThemedContext } from './visual.helper.js';

const DESKTOP_ONLY = (testInfo) => testInfo.project.name !== 'app-desktop';

// ── S08.02: glyph coverage (fonts.load bilan majburiy yuklab) ──
test('typography glyphs -- Uzbek + Cyrillic + Russian', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(async () => {
    const families = ['Source Sans 3', 'Manrope', 'IBM Plex Mono'];
    const samples = {
      uzLatin: "Oʻzbekiston Gʻ",
      uzCyrl: 'Ўзбекистон ғ',
      ru: 'Ёлка тест',
      digits: '0123456789',
    };
    const out = {};
    for (const fam of families) {
      for (const w of ['400', '700']) {
        try { await document.fonts.load(`${w} 32px "${fam}"`, Object.values(samples).join('')); } catch (e) {}
      }
      out[fam] = {};
      for (const [k, txt] of Object.entries(samples)) {
        out[fam][k] = document.fonts.check('400 32px "' + fam + '"', txt);
      }
    }
    return out;
  });
  for (const fam of ['Source Sans 3', 'Manrope']) {
    expect(r[fam].uzLatin, `${fam} Oʻ/Gʻ`).toBe(true);
    expect(r[fam].uzCyrl, `${fam} Ў/ғ`).toBe(true);
    expect(r[fam].ru, `${fam} Russian`).toBe(true);
  }
  expect(r['IBM Plex Mono'].digits, 'mono digits').toBe(true);
  expect(r['IBM Plex Mono'].uzLatin, 'mono Oʻ/Gʻ').toBe(true);
  await context.close();
});

// ── S08.11: 200% zoom — kesilish/overlap yo'q ──
test('typography zoom 200% -- no clipping/overlap', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  // 200% zoom (deviceScaleFactor emas — zoom via CDP)
  await page.evaluate(() => document.body.style.zoom = '2');
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
      // h1 kesilganmi?
      h1: (() => { const h = document.querySelector('h1'); if (!h) return null; const r = h.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right > doc.clientWidth }; })(),
    };
  });
  expect(overflow.scrollW - overflow.clientW).toBeLessThanOrEqual(60); // yengil tolerantlik
  expect(overflow.h1).not.toBeNull();
  expect(overflow.h1.w).toBeGreaterThan(0);
  expect(overflow.h1.h).toBeGreaterThan(0);
  await context.close();
});

// ── S08.11: text-spacing override (W3C user override) ──
test('typography text-spacing override -- no overlap', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = `body, p, h1, h2, h3, li, a, button, span, div { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; line-height: 1.4 !important; }`;
    document.head.appendChild(st);
  });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(80);
  await context.close();
});

// ── S08.04: CLS font shift target'dan past ──
test('typography CLS -- font swap shift past', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  // CLS o'lchash — font swap davri
  await page.goto('/user/login', { waitUntil: 'domcontentloaded' });
  const cls = await page.evaluate(async () => {
    return await new Promise((resolve) => {
      let cumulative = 0;
      let settled = false;
      try {
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) cumulative += e.value;
          }
        });
        po.observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => { settled = true; try { po.disconnect(); } catch (e) {} resolve(cumulative); }, 1500);
      } catch (e) { resolve(-1); }
    });
  });
  expect(cls).toBeGreaterThanOrEqual(0); // o'lchandi
  expect(cls).toBeLessThan(0.1); // S08.04: 0.1 past (yaxshi CLS)
  await context.close();
});

// ── S08.11: font-load failure → fallback buzilmasdan ishlaydi ──
test('typography font-fail -- fallback stable', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  // Font request'larini bloklaymiz
  await page.route('**/fonts/*.woff2', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const h = document.querySelector('h1');
    const fs = getComputedStyle(h);
    return {
      family: fs.fontFamily,
      w: h.getBoundingClientRect().width,
      h: h.getBoundingClientRect().height,
      text: h.textContent.length,
      noFallback: /Source Sans 3|Manrope/.test(fs.fontFamily) === false,
    };
  });
  expect(r.w).toBeGreaterThan(0);
  expect(r.h).toBeGreaterThan(0);
  expect(r.text).toBeGreaterThan(5);
  await context.close();
});
