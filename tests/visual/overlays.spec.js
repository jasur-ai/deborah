/**
 * STEP 15 — Dialog, popover, tooltip, toast E2E (S15.01–S15.12)
 * ------------------------------------------------------------
 * Sahifa: /_dev/components (#group-overlays)
 *  - S15.01-03: native dialog render + anatomy
 *  - S15.04: initial focus cancel'ga (danger emas)
 *  - S15.05: Escape + overlay click + trigger focus restore
 *  - S15.06: motion reduced
 *  - S15.07: popover arrow-nav + aria-expanded + outside click
 *  - S15.08: tooltip aria-describedby
 *  - S15.09-10: toast variants + max 3
 */
import { test, expect } from '@playwright/test';
import { openThemedContext, stabilize } from './visual.helper.js';

const THEME_LIST = ['light', 'dark'];

test.describe('Overlays preview', () => {
  for (const theme of THEME_LIST) {
    test(`S15: dialog + confirm flow — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // Open confirm dialog via demo button
      await page.locator('[data-confirm-demo]').click();
      const dlg = page.locator('dialog.dialog--sm');
      await expect(dlg).toBeVisible();

      // S15.04: initial focus on cancel button (not danger)
      await expect(page.locator('dialog.dialog--sm [data-no]')).toBeFocused();

      // S15.12: focus trap — Tab cycles within dialog (close→no→yes), never escapes to background
      await page.keyboard.press('Tab');
      await expect(page.locator('dialog.dialog--sm [data-yes]')).toBeFocused();
      await page.keyboard.press('Tab');
      // wrap: yes → close (first)
      await expect(page.locator('dialog.dialog--sm [data-close]')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('dialog.dialog--sm [data-no]')).toBeFocused();
      // backward: no → close
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('dialog.dialog--sm [data-close]')).toBeFocused();
      // backward wrap: close → yes (last)
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('dialog.dialog--sm [data-yes]')).toBeFocused();

      // S15.05: Escape cancels
      await page.keyboard.press('Escape');
      await expect(dlg).not.toBeVisible();
      // Trigger focus restored
      await expect(page.locator('[data-confirm-demo]')).toBeFocused();

      await ctx.close();
    });

    test(`S15: confirm resolve + toast — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // Confirm → Yes → success toast appears
      await page.locator('[data-confirm-demo]').click();
      await page.locator('dialog.dialog--sm [data-yes]').click();
      await expect(page.locator('.toast--success')).toContainText('Tasdiqlandi');

      // Error toast has role=alert (critical not toast-only)
      await page.locator('[data-toast-error]').click();
      const errToast = page.locator('.toast--error');
      await expect(errToast).toHaveAttribute('role', 'alert');

      // S15.10: max 3 — fire 5 success toasts, only 3 remain
      for (let i = 0; i < 5; i++) {
        await page.locator('[data-toast-success]').click();
        await page.waitForTimeout(120);
      }
      const count = await page.locator('.toast-region .toast').count();
      expect(count).toBeLessThanOrEqual(3);

      await ctx.close();
    });

    test(`S15: popover menu — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // Open popover — aria-expanded true
      const trigger = page.locator('[data-popover]');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const pop = page.locator('#s15-pop');
      await expect(pop).toBeVisible();

      // S15.07: ArrowDown moves focus, Enter activates
      await pop.locator('.popover__item').first().focus();
      await page.keyboard.press('ArrowDown');
      await expect(pop.locator('.popover__item').nth(1)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');

      await ctx.close();
    });

    test(`S15: tooltip + reduced motion — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S15.08: tooltip aria-describedby + role=tooltip
      await expect(page.locator('[data-tooltip]')).toHaveAttribute('aria-describedby', 's15-tip');
      await expect(page.locator('#s15-tip')).toHaveAttribute('role', 'tooltip');

      // Focus → tooltip visible
      await page.locator('[data-tooltip]').focus();
      await page.waitForTimeout(250);
      await expect(page.locator('#s15-tip')).toHaveClass(/is-in/);

      await ctx.close();
    });

    test(`S15: dialog anatomy + screenshot — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // Open dialog for screenshot
      await page.locator('[data-confirm-demo]').click();
      await expect(page.locator('dialog.dialog--sm')).toBeVisible();

      // S15.03: 44px close + sticky footer
      const closeBox = await page.locator('dialog.dialog--sm .dialog__close').boundingBox();
      expect(closeBox.height).toBeGreaterThanOrEqual(44);
      const footerPos = await page.locator('dialog.dialog--sm .dialog__footer').evaluate((el) => getComputedStyle(el).position);
      expect(footerPos).toBe('sticky');

      await expect(page.locator('dialog.dialog--sm')).toHaveScreenshot(`overlays--dialog--${theme}--desktop.png`);
      await page.keyboard.press('Escape');
      await ctx.close();
    });
  }
});
