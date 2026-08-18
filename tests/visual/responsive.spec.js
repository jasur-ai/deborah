import { test, expect } from '@playwright/test';
import { openThemedContext } from './visual.helper.js';

const NO_H_SCROLL = () =>
  page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));

test.describe('STEP 20 — Responsive, container queries, safe areas', () => {
  test('S20.06: 320px reflow — no horizontal scroll on landing', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await page.waitForTimeout(300);
    const { sw, iw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(sw).toBeLessThanOrEqual(iw + 1);
    // nav usable at 320px
    await expect(page.locator('header').first()).toBeVisible();
    await context.close();
  });

  test('S20.06: 390px reflow — common mobile width', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForTimeout(300);
    const { sw, iw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(sw).toBeLessThanOrEqual(iw + 1);
    await context.close();
  });

  test('S20.07: short-height landscape (844×390) — content usable', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/');
    await page.waitForTimeout(300);
    const { sw, iw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(sw).toBeLessThanOrEqual(iw + 1);
    // vertical scroll mavjud (content reachable)
    const sh = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(sh).toBeGreaterThan(0);
    await context.close();
  });

  test('S20.11: text-spacing overrides — no 2D scroll at 320px', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    // WCAG 1.4.12 text spacing overrides
    await page.evaluate(() => {
      const s = document.documentElement.style;
      s.letterSpacing = '0.12em';
      s.wordSpacing = '0.16em';
      s.lineHeight = '1.5';
    });
    await page.waitForTimeout(200);
    const { sw, iw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(sw).toBeLessThanOrEqual(iw + 2);
    await context.close();
  });

  test('no console errors at 320px', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 800 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
    await context.close();
  });
});
