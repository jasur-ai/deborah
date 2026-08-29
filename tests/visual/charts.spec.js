import { test, expect } from '@playwright/test';
import { openThemedContext } from './visual.helper.js';

test.describe('STEP 19 — Charts & evidence visualization', () => {
  test('distribution bar renders metric + bars + accessible table', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/_dev/components#group-charts');

    const demo = page.locator('#demo-dist');
    await expect(demo.locator('.ev-metric-label')).toContainText('Savol 1');
    await expect(demo.locator('.ev-dist-row')).toHaveCount(4);
    // CVD-safe shape markers
    await expect(demo.locator('.ev-dist-marker').first()).toBeVisible();
    // direct labels + fractions
    await expect(demo.locator('.ev-dist-opt').first()).toContainText('Toshkent');
    await expect(demo.locator('.ev-dist-frac').first()).toContainText('14/24');
    // accessible table alternative
    const alt = demo.locator('.ev-table-alt');
    await expect(alt.locator('summary')).toContainText('Jadval');
    await expect(alt.locator('th[scope="col"]')).toHaveCount(3);
    // no-response line
    await expect(demo.locator('.ev-nr')).toContainText('Javob bermagan: 3');
    await context.close();
  });

  test('revote pair shows before/after comparison', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'dark', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/_dev/components#group-charts');

    const demo = page.locator('#demo-revote');
    await expect(demo.locator('.ev-pair-row')).toHaveCount(4);
    await expect(demo.locator('.ev-pair-lbl').first()).toContainText('Oldin');
    await expect(demo.locator('.is-after').first()).toBeVisible();
    await expect(demo.locator('.ev-table-alt table tbody tr')).toHaveCount(4);
    await context.close();
  });

  test('confidence grid + progress line render with direct values', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/_dev/components#group-charts');

    const conf = page.locator('#demo-conf');
    await expect(conf.locator('.ev-conf-cell')).toHaveCount(3);
    await expect(conf.locator('.ev-conf-cell-val b').first()).toContainText('8');

    const line = page.locator('#demo-progress');
    await expect(line.locator('svg .ev-line-path')).toBeVisible();
    await expect(line.locator('.ev-line-dot')).toHaveCount(7);
    // direct values not hover-only
    await expect(line.locator('.ev-line-val').first()).toContainText('2');
    await context.close();
  });

  test('insufficient evidence state appears below sample threshold', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/_dev/components#group-charts');

    // inject a below-threshold chart via CastCharts
    const insufficient = await page.evaluate(() => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      window.CastCharts.distributionBar(root, {
        label: 'Kam savol', total: 2, sampleThreshold: 5,
        options: [{ id: 'A', label: 'A', count: 1 }, { id: 'B', label: 'B', count: 1 }],
      });
      return root.outerHTML;
    });
    expect(insufficient).toContain('ev-insufficient');
    expect(insufficient).toContain('Yetarli dalil yo‘q');
    await context.close();
  });

  test('no console errors on dev charts page', async ({ browser }) => {
    test.skip(process.env.CI_FAST === '1', 'skip in fast mode');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/_dev/components#group-charts');
    await page.waitForTimeout(400);
    expect(errors).toEqual([]);
    await context.close();
  });
});
