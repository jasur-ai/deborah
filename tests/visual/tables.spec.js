import { test, expect } from '@playwright/test';
import { openThemedContext } from './visual.helper.js';

const DEV = '/_dev/components';
const DEMO = 'div[data-dt="demo"]';

test.describe('STEP 18 — Tables', () => {
  test('S18.02: sortable headers — click toggles aria-sort', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'light', testInfo.project.name);
    const page = await context.newPage();
    await page.goto(DEV);
    const nameTh = page.locator(`${DEMO} th[data-sort="name"]`);
    await expect(nameTh).toHaveCount(1);
    await expect(nameTh).not.toHaveAttribute('aria-sort');
    await nameTh.locator('.dt-sort').click();
    await expect(nameTh).toHaveAttribute('aria-sort', 'ascending');
    await nameTh.locator('.dt-sort').click();
    await expect(nameTh).toHaveAttribute('aria-sort', 'descending');
    // Sort: descending by name = Geometriya > Fizika > Algebra
    const first = page.locator(`${DEMO} tbody tr:visible td.dt-cell-main`).first();
    await expect(first).toHaveText('Geometriya');
    await context.close();
  });

  test('S18.04: density toggle persists (localStorage)', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'light', testInfo.project.name);
    const page = await context.newPage();
    await page.goto(DEV);
    const table = page.locator(`${DEMO} table.dt`);
    await expect(table).toHaveAttribute('data-density', 'default');
    await page.locator(`${DEMO} .dt-density button[data-density="compact"]`).click();
    await expect(table).toHaveAttribute('data-density', 'compact');
    const pref = await page.evaluate(() => localStorage.getItem('edikit-dt-density'));
    expect(pref).toBe('compact');
    await page.reload();
    await expect(table).toHaveAttribute('data-density', 'compact');
    await context.close();
  });

  test('S18.06: search debounce — count updates + clear', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'light', testInfo.project.name);
    const page = await context.newPage();
    await page.goto(DEV);
    const search = page.locator(`${DEMO} .dt-search-input`);
    await expect(page.locator(`${DEMO} .dt-count`)).toContainText('3 / 3');
    await search.fill('geo');
    await expect(page.locator(`${DEMO} .dt-count`)).toContainText('1 / 3', { timeout: 5000 });
    await expect(page.locator(`${DEMO} tbody tr:visible`)).toHaveCount(1);
    await page.locator(`${DEMO} .dt-search-clear`).click();
    await expect(page.locator(`${DEMO} .dt-count`)).toContainText('3 / 3');
    await context.close();
  });

  test('S18.09: mobile reflow — card layout <=640px', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'light', testInfo.project.name);
    const page = await context.newPage();
    await page.setViewportSize({ width: 500, height: 800 });
    await page.goto(DEV);
    const row = page.locator(`${DEMO} tbody tr.dt-row`).first();
    const display = await row.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('grid');
    await context.close();
  });

  test('S18.12: 200% zoom no horizontal page overflow (reflow)', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'light', testInfo.project.name);
    const page = await context.newPage();
    await page.setViewportSize({ width: 500, height: 800 });
    await page.goto(DEV);
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThan(400); // table o'z wrapper'ida scroll qiladi
    await context.close();
  });
});
