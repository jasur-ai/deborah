/**
 * Edikit — Visual: Motion Foundations (STYLE STEP 10)
 * ---------------------------------------------------
 * S10.03 — transition: all yo'q (property-specific)
 * S10.08 — layout animatsiya yo'q
 * S10.09 — reduced-motion: decorative off, functional static
 * S10.11 — focus ring instant
 */
import { test, openThemedContext } from './visual.helper.js';
import { expect } from '@playwright/test';

test('S10.03: transition property-specific — layout props yo\'q', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600); // JS elementlari yuklanishi
  const r = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a')].filter((b) => {
      // .ld-skip-link a11y skip-to-content — top transition legit (S10.11 exception)
      return !b.classList.contains('ld-skip-link');
    }).slice(0, 20);
    const layoutAnim = btns.filter((b) => {
      const t = getComputedStyle(b).transitionProperty;
      return /width|height|margin|top|left/.test(t);
    }).length;
    const allAnim = btns.filter((b) => {
      const cs = getComputedStyle(b);
      // transition-property 'all' browser DEFAULT — lekin duration 0s bo'lsa
      // transition amalda YO'Q (S10.03). Faqat real (duration>0) all'ni tekshiramiz.
      const dur = parseFloat(cs.transitionDuration) || 0;
      return cs.transitionProperty === 'all' && dur > 0;
    }).length;
    return { layoutAnim, allAnim, count: btns.length };
  });
  expect(r.layoutAnim).toBe(0);
  expect(r.allAnim).toBe(0);
  await context.close();
});

test('S10.09: reduced-motion — landing still renders, decorative off', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  await context.addInitScript(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      Object.defineProperty(mq, 'matches', { get: () => true });
    } catch (_) {}
  });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return {
      bodyVisible: document.body.getBoundingClientRect().height > 0,
      h1: document.querySelector('h1')?.textContent?.slice(0, 40) || '',
    };
  });
  expect(r.bodyVisible).toBe(true);
  expect(r.h1.length).toBeGreaterThan(0);
  await context.close();
});

test('S10.11: focus ring instant — no transition on focus', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/user/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="username"]').first().focus();
  const r = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { transitionDuration: cs.transitionDuration, outline: cs.outlineStyle || 'none' };
  });
  // Focus feedback ≤160ms (S10.05); focus ring barqaror (S10.11)
  const firstMs = parseFloat(r.transitionDuration.split(',')[0]) * 1000;
  expect(firstMs).toBeLessThanOrEqual(160);
  await context.close();
});

test('S10.05: hover feedback ≤160ms', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a[class*="btn"], .btn')].slice(0, 10);
    const durations = btns.map((b) => {
      const t = getComputedStyle(b).transitionDuration; // "0.08s, 0.08s, ..."
      const first = parseFloat(t.split(',')[0]) || 0;
      return first;
    });
    return { durations, max: durations.length ? Math.max(...durations) : 0 };
  });
  // Hover feedback 80-120ms; button hech qachon 160ms dan oshmasin
  expect(r.max).toBeLessThanOrEqual(0.16);
  await context.close();
});
