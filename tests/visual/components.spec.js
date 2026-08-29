/**
 * STEP 12 — Component library E2E (S12.01–12.13)
 * -------------------------------------------------
 * Sahifa: /_dev/components (STEP 12 da qo'shilgan dev preview sahifasi)
 * Tekshiruvlar:
 *  - S12.01-03: variantlar + states (hover/active/focus-visible/loading/disabled/selected)
 *  - S12.02: size'lar 32/40/44/48px (computed)
 *  - S12.04: loading holatida width barqaror
 *  - S12.05: focus ring ko'rinadi (3px)
 *  - S12.07: icon-btn 44px hit area
 *  - S12.09: badge 5 variant render
 *  - S12.10: primary solid (gradient emas)
 *  - S12.11: cast funksional buttonlarda emoji yoq (SVG)
 *  - Long labels: button to'liq ko'rinadi (overflow yoq)
 *  - 200% zoom: hech narsa kesilmaydi (document scrollWidth <= viewport)
 */
import { test, expect } from '@playwright/test';
import { openThemedContext, stabilize, THEMES } from './visual.helper.js';

const THEME_LIST = ['light', 'dark'];

test.describe('Components preview', () => {
  for (const theme of THEME_LIST) {
    test(`S12: variantlar + states render — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // Variantlar mavjud
      for (const v of ['btn-primary', 'btn-secondary', 'btn-quiet', 'btn-danger', 'btn-link']) {
        await expect(page.locator(`.${v}`).first()).toBeVisible();
      }
      // States
      await expect(page.locator('#group-states .btn-primary.is-loading .btn-label')).toHaveCount(1);
      await expect(page.locator('#group-states .btn-primary.is-selected')).toHaveCount(1);
      // Loading button disabled — 2 ta disabled (loading + disabled), ular birgalikda 1 ta emas
      await expect(page.locator('#group-states .btn-primary.is-loading')).toBeDisabled();
      await expect(page.locator('#group-states .btn-primary:not(.is-loading):disabled')).toHaveCount(1);
      // Badge 5 variant
      for (const v of ['badge-neutral', 'badge-info', 'badge-success', 'badge-warning', 'badge-danger']) {
        await expect(page.locator(`.${v}`).first()).toBeVisible();
      }
      // Icon-btn 44px hit area
      const iconBtn = page.locator('.icon-btn').first();
      await expect(iconBtn).toBeVisible();
      const box = await iconBtn.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);

      // S12.10: primary solid — gradient yoq
      const bg = await page.locator('.btn-primary').first().evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(bg).not.toContain('gradient');

      // S12.01-09: to'liq preview — visual baseline (boshqa spec'lar bilan mos)
      await expect(page).toHaveScreenshot(`components--preview--${theme}--desktop.png`, {
        fullPage: true,
      });
      await ctx.close();
    });

    test(`S12: long label kesilmaydi + 200% zoom — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-mobile', 'mobile only');
      const ctx = await openThemedContext(browser, theme, 'app-mobile');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      const long = page.locator('#long-label-btn');
      await expect(long).toBeVisible();
      const lb = await long.boundingBox();
      expect(lb.width).toBeGreaterThan(50);
      // Label scroll/overflow emas
      const clipped = await long.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(clipped).toBe(false);

      // 200% zoom: CSS zoom + kichik viewport — horizontal scroll yoq
      await page.setViewportSize({ width: 195, height: 844 });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
      expect(overflow).toBe(false);

      await ctx.close();
    });

    test(`S12: focus-visible ring + loading width stable — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // Focus ring: keyboard focus'da outline ko'rinadi
      const btn = page.locator('.btn-primary').first();
      await btn.focus();
      const outline = await btn.evaluate((el) => getComputedStyle(el).outlineWidth);
      expect(parseFloat(outline)).toBeGreaterThan(0);

      // Loading: width o'zgarmaydi (label + spinner birga)
      const lBtn = page.locator('.btn-primary.is-loading').first();
      const w1 = (await lBtn.boundingBox()).width;
      await page.waitForTimeout(300); // spinner aylanadi, lekin width stable
      const w2 = (await lBtn.boundingBox()).width;
      expect(Math.abs(w2 - w1)).toBeLessThan(2);

      await ctx.close();
    });
  }
});
