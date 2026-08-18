import { test, expect } from '@playwright/test';
import { openThemedContext } from './visual.helper.js';

const DEV = '/_dev/components';

test.describe('STEP 17 — Navigation', () => {
  test('S17.05: active nav state soft fill + weight + indicator', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    for (const theme of ['light', 'dark']) {
      const context = await openThemedContext(browser, theme, testInfo.project.name);
      const page = await context.newPage();
      await page.goto(DEV);
      const active = page.locator('.shell-nav-link.active');
      await expect(active).toHaveCount(1);
      const color = await active.evaluate((el) => getComputedStyle(el).color);
      const weight = await active.evaluate((el) => getComputedStyle(el).fontWeight);
      expect(weight).toBe('700');
      await expect(active).toHaveCSS('box-shadow', /inset/);
      // hover active dan farq qiladi
      const hoverWeight = await page.locator('.shell-nav-link:not(.active)').first().evaluate((el) => getComputedStyle(el).fontWeight);
      expect(hoverWeight).toBe('600');
      await context.close();
    }
  });

  test('S17.09: breadcrumb with separator + aria-current', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    for (const theme of ['light', 'dark']) {
      const context = await openThemedContext(browser, theme, testInfo.project.name);
      const page = await context.newPage();
      await page.goto(DEV);
      const crumb = page.locator('.crumb');
      await expect(crumb).toBeVisible();
      await expect(crumb.getByRole('link')).toHaveCount(2);
      await expect(crumb.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(crumb.locator('.crumb-sep')).toHaveCount(2);
      await expect(page).toHaveScreenshot(`navigation-breadcrumb-${theme}.png`);
      await context.close();
    }
  });

  test('S17.11: account menu toggle + logout grouped', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    for (const theme of ['light', 'dark']) {
      const context = await openThemedContext(browser, theme, testInfo.project.name);
      const page = await context.newPage();
      await page.goto(DEV);
      const acc = page.locator('.shell-account');
      const btn = acc.locator('.shell-account-btn');
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await expect(acc.locator('.shell-account-menu')).toBeVisible();
      await expect(acc.locator('.shell-account-menu-item--logout')).toHaveCount(1);
      await expect(acc.locator('.theme-segmented')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await context.close();
    }
  });
});
