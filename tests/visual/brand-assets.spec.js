/**
 * Deborah — Visual: Brand Assets (STYLE STEP 05 / S05.01–S05.12)
 * ------------------------------------------------------------------
 * Blind-recognition gallery (public/brand/gallery.html):
 *   - Evidence Mark variantlari + 16/24/32/64px legibility
 *   - Signal Rail 4 state
 *   - Response Mosaic 5×5
 * Static sahifa — socket talab qilmaydi, screenshot deterministic.
 * Legacy gradient brand'ning olib tashlanganini lock qiladi.
 */
import { expect } from '@playwright/test';
import {
  test,
  openThemedContext,
  stabilize,
  shotName,
} from './visual.helper.js';

const THEME_SET = ['light', 'dark'];

// 1) Gallery (full page) — har app viewport project'ida
for (const theme of THEME_SET) {
  for (const target of ['app-desktop', 'app-tablet']) {
    test(`brand gallery -- ${theme} -- ${target}`, async ({ browser }, testInfo) => {
      test.skip(!testInfo.project.name.startsWith('app'), 'app matrix');
      testInfo.annotations.push({ type: 'page', description: 'brand-gallery' });
      const context = await openThemedContext(browser, theme, target);
      const page = await context.newPage();
      await page.goto('/brand/gallery.html', { waitUntil: 'domcontentloaded' });
      await stabilize(page);
      await expect(page.locator('h1')).toHaveText(/Brand Gallery/);
      await expect(page).toHaveScreenshot(
        shotName('brand-gallery', 'rest', theme, target),
        { animations: 'disabled', caret: 'hide', fullPage: true }
      );
      await context.close();
    });
  }
}

// 2) Evidence Mark legibility 16/24/32/64px — desktop, light (yuqori aniqlik)
test('brand evidence-mark legibility -- light -- app-desktop', async ({ browser }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('app'), 'app matrix');
  testInfo.annotations.push({ type: 'page', description: 'brand-legibility' });
  const context = await openThemedContext(browser, 'light', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/brand/gallery.html', { waitUntil: 'domcontentloaded' });
  await stabilize(page);
  await page.locator('.sizes').scrollIntoViewIfNeeded();
  await expect(page.locator('.sizes img')).toHaveCount(4);
  await expect(page).toHaveScreenshot(
    shotName('brand-legibility', 'rest', 'light', 'app-desktop'),
    { animations: 'disabled', caret: 'hide' }
  );
  await context.close();
});
