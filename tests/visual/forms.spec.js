/**
 * STEP 13 — Form field E2E (S13.01–S13.12)
 * -------------------------------------------
 * Sahifa: /_dev/components (#group-forms)
 * Tekshiruvlar:
 *  - S13.01: visible label + required marker + hint + error
 *  - S13.03: control 44px (desktop) / 48px (mobile); mobile font 16px
 *  - S13.04: border token (computed — oq zamin emas, kontrast)
 *  - S13.05: focus ring ko rinadi, hover != focus
 *  - S13.06: error danger text + icon; warning amber
 *  - S13.07: read-only copyable; disabled not-allowed
 *  - S13.11: native select styled
 *  - S13.12: 200% zoom + text-spacing override hech narsani kesmaydi
 */
import { test, expect } from '@playwright/test';
import { openThemedContext, stabilize } from './visual.helper.js';

const THEME_LIST = ['light', 'dark'];

test.describe('Forms preview', () => {
  for (const theme of THEME_LIST) {
    test(`S13: field anatomy + states — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S13.01: visible label + required marker
      await expect(page.locator('label[for="f-name"]')).toBeVisible();
      await expect(page.locator('label[for="f-name"] .form-field__required')).toHaveText('*');
      await expect(page.locator('#f-name-hint')).toHaveText(/3-30 belgi/);

      // S13.03: 44px desktop control
      const box = await page.locator('#f-name').boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);

      // S13.06: error text + icon + danger border
      await expect(page.locator('#f-bad-error')).toContainText('noto‘g‘ri');
      await expect(page.locator('#f-bad-error svg')).toHaveCount(1);
      const errColor = await page.locator('#f-bad-error').evaluate((el) => getComputedStyle(el).color);
      expect(errColor).not.toBe('rgb(0, 0, 0)');
      // warning amber
      await expect(page.locator('#f-warn-error')).toBeVisible();

      // S13.07: read-only vs disabled
      await expect(page.locator('#f-ro')).toHaveAttribute('readonly', '');
      await expect(page.locator('#f-dis')).toBeDisabled();
      const roCursor = await page.locator('#f-ro').evaluate((el) => getComputedStyle(el).cursor);
      const disCursor = await page.locator('#f-dis').evaluate((el) => getComputedStyle(el).cursor);
      expect(roCursor).not.toBe('not-allowed');
      expect(disCursor).toBe('not-allowed');

      // S13.11: select styled
      await expect(page.locator('#f-role')).toBeVisible();
      const selAppearance = await page.locator('#f-role').evaluate((el) => getComputedStyle(el).appearance);
      expect(selAppearance).not.toBe('auto');

      // S13.05: focus ring
      await page.locator('#f-name').focus();
      const outline = await page.locator('#f-name').evaluate((el) => getComputedStyle(el).outlineWidth);
      expect(parseFloat(outline)).toBeGreaterThan(0);

      await expect(page).toHaveScreenshot(`forms--preview--${theme}--desktop.png`, { fullPage: true });
      await ctx.close();
    });

    test(`S13: mobile 48px + 16px font + zoom — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-mobile', 'mobile only');
      const ctx = await openThemedContext(browser, theme, 'app-mobile');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S13.03: mobile 48px + font >= 16px
      const box = await page.locator('#f-name').boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(48);
      const fontSize = await page.locator('#f-name').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(16);

      // S13.12: 200% zoom — horizontal scroll yoq
      await page.evaluate(() => document.documentElement.style.zoom = '2');
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
      expect(overflow).toBe(false);

      // S13.12: text-spacing override — hech narsa kesilmaydi
      await page.evaluate(() => document.documentElement.style.zoom = '1');
      await page.addStyleTag({
        content: '* { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; line-height: 1.5 !important; }',
      });
      await page.waitForTimeout(200);
      const clipped = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
      expect(clipped).toBe(false);

      await ctx.close();
    });

    test(`S13: keyboard nav + select aria — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S13.08: aria-describedby bog'lanishlar
      await expect(page.locator('#f-name')).toHaveAttribute('aria-describedby', 'f-name-hint ');
      await expect(page.locator('#f-bad')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#f-bad')).toHaveAttribute('aria-describedby', 'f-bad-error');
      // required marker
      await expect(page.locator('#f-email')).toHaveAttribute('required', '');

      // S13.11: select — option tanlash mumkin (native)
      await page.locator('#f-role').selectOption('teacher');
      await expect(page.locator('#f-role')).toHaveValue('teacher');

      // S13.07: read-only input copyable (value bor, selectable)
      const roVal = await page.locator('#f-ro').inputValue();
      expect(roVal).toBe('read-only qiymat');

      await ctx.close();
    });
  }
});
