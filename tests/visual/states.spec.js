/**
 * STEP 16 — Loading, progress, empty, error, offline states E2E (S16.01–S16.12)
 * ---------------------------------------------------------------------------
 * Sahifa: /_dev/components (#group-states) + /no-such-page (404)
 *  - S16.01: spinner + determinate progress render
 *  - S16.03: skeleton structured + aria-busy
 *  - S16.05-07: empty states — title + action; no-results query pill
 *  - S16.08: error page message structure (no raw stack)
 *  - S16.09: offline banner demo — pending saved + reconnect progress
 *  - S16.11: progressbar semantics
 */
import { test, expect } from '@playwright/test';
import { openThemedContext, stabilize } from './visual.helper.js';

const THEME_LIST = ['light', 'dark'];

test.describe('States preview', () => {
  for (const theme of THEME_LIST) {
    test(`S16: loading + empty states — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S16.01: spinner + determinate progressbar with semantics
      await expect(page.locator('#group-states .inline-status .spinner')).toHaveCount(1);
      const bar = page.locator('#group-states [role="progressbar"]');
      await expect(bar).toHaveAttribute('aria-valuenow', '72');
      await expect(bar).toHaveAttribute('aria-valuemax', '100');

      // S16.03: skeleton structured + aria-busy region
      await expect(page.locator('#group-states [aria-busy="true"] .skeleton--title')).toBeVisible();
      await expect(page.locator('#group-states .skeleton--list-item')).toHaveCount(3);

      // S16.05-07: empty states — title + action + query pill
      await expect(page.locator('.empty-state--no-results .empty-state__query')).toHaveText('"algebra"');
      await expect(page.locator('.empty-state--first-use .btn')).toBeVisible();
      await expect(page.locator('.empty-state--completion')).toBeVisible();

      // S16.08: message structure
      await expect(page.locator('#group-states .message--error .message__title')).toContainText('Saqlash amalga oshmadi');
      await expect(page.locator('#group-states .message--error .btn')).toBeVisible();

      await expect(page).toHaveScreenshot(`states--loading-empty--${theme}--desktop.png`, { fullPage: true });
      await ctx.close();
    });

    test(`S16: offline banner flow — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S16.09: offline — banner appears with status + retry
      await page.locator('[data-offline-demo]').click();
      const banner = page.locator('.offline-banner');
      await expect(banner).toHaveClass(/is-in/);
      await expect(banner).toContainText('Internet aloqasi uzildi');
      await expect(banner.locator('.btn')).toBeVisible(); // retry

      // reconnect — progress + online
      await page.locator('[data-reconnect-demo]').click();
      await expect(banner).toContainText('Qayta ulanmoqda');
      await expect(banner.locator('.progress')).toBeVisible();
      await page.waitForTimeout(1600);
      await expect(banner).toContainText('Aloqa tiklandi');

      await ctx.close();
    });

    test(`S16: 404 error page — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/no-such-page-xyz', { waitUntil: 'domcontentloaded' });

      // S16.08: error structure — no raw stack visible, actionable
      const err = page.locator('.error-page .error-box');
      await expect(err).toBeVisible();
      await expect(err).toContainText('404');
      await expect(page.locator('.error-page .error-actions .btn-primary')).toBeVisible();
      // No raw stack visible — technical block faqat dev rejimida va yopiq (details)
      await expect(page.locator('.error-page .error-technical pre')).toBeHidden();

      await expect(page.locator('.error-page')).toHaveScreenshot(`states--error--${theme}--desktop.png`);
      await ctx.close();
    });
  }
});
