/**
 * Deborah — E2E: Theme Engine (STYLE STEP 07 / S07.12)
 * ---------------------------------------------------
 * Functional (screenshot'siz) tekshiruvlar — app-desktop project'ida ishlaydi.
 *
 * Qamrov:
 *  - S07.01/02  Boot: data-theme/data-resolved-theme/data-theme-state
 *               synchronous (domcontentloaded'da) — FOUC guard
 *  - S07.03     Yagona attribute model + legacy migration (deborah-theme)
 *  - S07.04     color-scheme native form control bilan
 *  - S07.05     meta-theme-color real canvas token bilan sinxron
 *  - S07.08     System: localStorage yo'q bo'lsa OS colorScheme ishlaydi
 *  - S07.09     Segmented control (System/Light/Dark) + persist + reload
 *  - S07.10     Projector/classroom sahifalarida engine o'chgan (strukturaviy)
 */
import { expect } from '@playwright/test';
import { test, openThemedContext } from './visual.helper.js';

const DESKTOP_ONLY = (testInfo) => testInfo.project.name !== 'app-desktop';

function themeAttrs(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return {
      theme: d.getAttribute('data-theme'),
      resolved: d.getAttribute('data-resolved-theme'),
      state: d.getAttribute('data-theme-state'),
      colorScheme: d.style.colorScheme,
      meta: (document.getElementById('meta-theme-color') || {}).getAttribute?.('content'),
      stored: localStorage.getItem('deborah-theme-state'),
    };
  });
}

// ── S07.01/02: Synchronous boot — FOUC guard ──
for (const os of ['light', 'dark']) {
  test(`theme boot -- system (${os}) -- sync attributes`, async ({ browser }, testInfo) => {
    test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
    // explicit:false — real boot/system xulqi (localStorage'siz, faqat OS pref)
    const context = await openThemedContext(browser, os, 'app-desktop', { explicit: false });
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const a = await themeAttrs(page);
    expect(a.theme).toBe(os);
    expect(a.resolved).toBe(os);
    expect(a.state).toBe('system');
    expect(a.meta).toBe(os === 'light' ? '#F5F7FB' : '#080C1A'); // S07.05
    await context.close();
  });
}

// ── S07.09: Segmented control — click → apply + persist + reload ──
test('theme segmented control -- light -- persist across reload', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  // explicit:false — test o'z state'ini boshqaradi (init script reload'da
  // localStorage'ni qayta yozib click natijasini o'chirmasligi uchun)
  const context = await openThemedContext(browser, 'dark', 'app-desktop', { explicit: false }); // OS dark bo'lsa ham override
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.theme-segmented').waitFor({ state: 'visible' });
  await page.locator('[data-theme-state-btn="light"]').click();
  let a = await themeAttrs(page);
  expect(a.theme).toBe('light');
  expect(a.state).toBe('light');
  expect(a.stored).toBe('light');
  expect(a.meta).toBe('#F5F7FB');
  // aria-pressed active state
  await expect(page.locator('[data-theme-state-btn="light"]')).toHaveAttribute('aria-pressed', 'true');
  // Reload → persisted
  await page.reload({ waitUntil: 'domcontentloaded' });
  a = await themeAttrs(page);
  expect(a.theme).toBe('light');
  expect(a.state).toBe('light');
  await context.close();
});

test('theme segmented control -- dark -- override system', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop', { explicit: false }); // OS light bo'lsa ham
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.theme-segmented').waitFor({ state: 'visible' });
  await page.locator('[data-theme-state-btn="dark"]').click();
  const a = await themeAttrs(page);
  expect(a.theme).toBe('dark');
  expect(a.state).toBe('dark');
  expect(a.stored).toBe('dark');
  expect(a.meta).toBe('#080C1A');
  await context.close();
});

test('theme segmented control -- system -- returns to OS pref', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop', { explicit: false });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-theme-state-btn="system"]').waitFor({ state: 'visible' });
  await page.locator('[data-theme-state-btn="dark"]').click();
  await page.locator('[data-theme-state-btn="system"]').click();
  const a = await themeAttrs(page);
  expect(a.state).toBe('system');
  expect(a.theme).toBe('light'); // OS light
  expect(a.stored).toBe('system');
  await context.close();
});

// ── S07.03: Legacy migration (eski deborah-theme) ──
test('theme legacy migration -- deborah-theme=dark -> state dark', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop', { explicit: false });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('deborah-theme', 'dark'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const a = await themeAttrs(page);
  expect(a.theme).toBe('dark');
  expect(a.state).toBe('dark'); // migrated
  await context.close();
});

// ── S07.04: color-scheme inline (native form controls) ──
test('theme color-scheme -- native select rendering', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'dark', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const a = await themeAttrs(page);
  expect(a.colorScheme).toBe('dark');
  await context.close();
});

// ── S07.10: Projector/classroom sahifalari theme engine'ni yuklamaydi ──
test('theme projector independence -- cast sahifalarida engine yo‘q', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'dark', 'app-desktop');
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Engine faqat head.ejs ishlatadigan sahifalarda yuklanadi
  const engineLoaded = await page.evaluate(() => typeof window.DeborahTheme === 'object');
  expect(engineLoaded).toBe(true);
  // Cast viewlari head.ejs ishlatmaydi (route tekshiruvi quyida emas, strukturaviy).
  // isIndependentThemePage() guard: data-cast-theme body'da bo'lsa engine hech narsa qilmaydi.
  const guarded = await page.evaluate(() => {
    const b = document.body;
    const was = b.hasAttribute('data-cast-theme');
    if (!was) b.setAttribute('data-cast-theme', 'focus_dark');
    const result = typeof window.DeborahTheme !== 'undefined' && window.DeborahTheme.apply();
    if (!was) b.removeAttribute('data-cast-theme');
    return { result, theme: document.documentElement.getAttribute('data-theme') };
  });
  expect(guarded.result).toBe(undefined); // apply() skip → undefined
  expect(guarded.theme).toBe('dark'); // hech narsa o'zgarmadi
  await context.close();
});
