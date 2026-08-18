/**
 * Deborah — Visual: CVD Matrix (STYLE STEP 06 / S06.08)
 * ------------------------------------------------------------------
 * public/brand/cvd-test.html — status + answer option + focus state
 * (redundant encoding: color+icon+text, color+shape+letter).
 *
 * Har bir CVD filter (protanopia/deuteranopia/tritanopia/grayscale)
 * sahifaga qo'llanadi va screenshot baseline olinadi. Ma'no filter'dan
 * keyin ham icon/text/shape orqali saqlanadi — bu visual diff'da lock.
 *
 * Screenshot: design-audit/screenshots/cvd-{filter}--rest--light--desktop.png
 */
import { expect } from '@playwright/test';
import {
  test,
  openThemedContext,
  stabilize,
  shotName,
} from './visual.helper.js';

const CVD_FILTERS = ['protanopia', 'deuteranopia', 'tritanopia', 'grayscale'];

for (const filter of CVD_FILTERS) {
  test(`cvd ${filter} -- light -- app-desktop`, async ({ browser }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('app'), 'app matrix');
    testInfo.annotations.push({ type: 'page', description: `cvd-${filter}` });
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/brand/cvd-test.html', { waitUntil: 'domcontentloaded' });
    await stabilize(page);
    // SVG filter'ni sahifaga qo'llash
    await page.evaluate((f) => {
      const root = document.getElementById('cvd-root');
      if (root) root.style.filter = `url(#cvd-${f})`;
    }, filter);
    await page.waitForTimeout(100);
    await expect(page.locator('.status')).toHaveCount(5);
    await expect(page).toHaveScreenshot(
      shotName(`cvd-${filter}`, 'rest', 'light', 'app-desktop'),
      { animations: 'disabled', caret: 'hide' }
    );
    await context.close();
  });
}
