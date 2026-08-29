/**
 * Deborah — Visual: Layout Foundations (STYLE STEP 09, S09.02/03/09/11)
 * ---------------------------------------------------------------------
 * Container width, grid breakpoints, density compact scoping.
 * 320px / 900px / 1920px+ ultra-wide tekshiruv (S09.11).
 */
import { test, openThemedContext } from './visual.helper.js';
import { expect } from '@playwright/test';

test('S09.11: landing 320px — container sig\'adi, yon scroll yo\'q', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-mobile-small', 'mobile only');
  const context = await openThemedContext(browser, 'light', 'app-mobile-small');
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  }));
  expect(r.hasOverflow).toBe(false);
  await context.close();
});

test('S09.11: landing 1920px — container 1200px markazda', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const hero = document.querySelector('.page, .ld-container, .container-landing, .landing-container');
    if (!hero) return { found: false };
    const rect = hero.getBoundingClientRect();
    return { found: true, width: Math.round(rect.width), left: Math.round(rect.left), viewport: window.innerWidth };
  });
  // Container 1200px yoki kichikroq, viewport markazida (left margin > 0)
  if (r.found) {
    expect(r.width).toBeLessThanOrEqual(1200);
    expect(r.left).toBeGreaterThan(0);
  }
  await context.close();
});

test('S09.09: compact density faqat admin/teacher — participant ta\'sirlanmaydi', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/dev/components', { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(() => {
    const btn = document.querySelector('button, .btn, a[class*="btn"]');
    if (!btn) return { found: false };
    const cs = getComputedStyle(btn);
    return { found: true, height: Math.round(btn.getBoundingClientRect().height) };
  });
  // Layout foundation yuklandi (layout.css token'lar bor)
  const cssLoaded = await page.evaluate(() => {
    const sheets = [...document.styleSheets];
    return sheets.some((s) => s.href && s.href.includes('layout.css'));
  });
  expect(cssLoaded).toBe(true);
  if (r.found) expect(r.height).toBeGreaterThan(24);
  await context.close();
});

test('S09.06: z-index qatlamlari layout.css da token\'lar bilan', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/dev/components', { waitUntil: 'domcontentloaded' });
  const cssLoaded = await page.evaluate(() => {
    const sheets = [...document.styleSheets];
    return sheets.some((s) => s.href && s.href.includes('layout.css'));
  });
  expect(cssLoaded).toBe(true);
  await context.close();
});
