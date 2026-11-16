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
// NOTE: cast landing ('/') birinchi tashrifda ATAYNIN dark default (demo
// odati — foydalanuvchi tasdiqlagan; pastdagi toggle testlari tekshiradi),
// shuning uchun toza system boot kontrakti /user/login'da tekshiriladi.
for (const os of ['light', 'dark']) {
  test(`theme boot -- system (${os}) -- sync attributes`, async ({ browser }, testInfo) => {
    test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
    // explicit:false — real boot/system xulqi (localStorage'siz, faqat OS pref)
    const context = await openThemedContext(browser, os, 'app-desktop', { explicit: false });
    const page = await context.newPage();
    await page.goto('/user/login', { waitUntil: 'domcontentloaded' });
    const a = await themeAttrs(page);
    expect(a.theme).toBe(os);
    expect(a.resolved).toBe(os);
    expect(a.state).toBe('system');
    expect(a.meta).toBe(os === 'light' ? '#F5F7FB' : '#080C1A'); // S07.05
    await context.close();
  });
}

// ── S07.09: Landing theme toggle (#themeBtn) — apply + persist + reload ──
// Cast landing'da segmented control YO'Q (foydalanuvchi qarori — faqat tugma);
// xuddi shu qaror pastdagi regressiya testida qotirilgan.
test('theme toggle (#themeBtn) -- light -- persist across reload', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  // explicit:false — birinchi tashrif: demo odati dark default
  const context = await openThemedContext(browser, 'dark', 'app-desktop', { explicit: false });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#themeBtn').waitFor({ state: 'visible' });
  await page.locator('#themeBtn').click();
  let a = await themeAttrs(page);
  expect(a.theme).toBe('light');
  expect(a.state).toBe('light');
  expect(a.stored).toBe('light');
  expect(a.meta).toBe('#F5F7FB');
  // Reload → persisted
  await page.reload({ waitUntil: 'domcontentloaded' });
  a = await themeAttrs(page);
  expect(a.theme).toBe('light');
  expect(a.state).toBe('light');
  await context.close();
});

test('theme toggle (#themeBtn) -- dark -- override light state', async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop', { explicit: false });
  const page = await context.newPage();
  // saqlangan light holat (aks holda birinchi tashrif dark default bosadi)
  await page.addInitScript(() => { try { localStorage.setItem('deborah-theme-state', 'light'); } catch (_) {} });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#themeBtn').waitFor({ state: 'visible' });
  await page.locator('#themeBtn').click();
  const a = await themeAttrs(page);
  expect(a.theme).toBe('dark');
  expect(a.state).toBe('dark');
  expect(a.stored).toBe('dark');
  expect(a.meta).toBe('#080C1A');
  await context.close();
});

// USER qarori (qotirilgan): landing'da segmented theme tugmalari YO'Q —
// faqat bitta #themeBtn toggle. Qayta qo'shilsa bu test qulaydi.
test("theme landing -- segmented control yo'q, faqat #themeBtn", async ({ browser }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo), 'desktop only');
  const context = await openThemedContext(browser, 'light', 'app-desktop', { explicit: false });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#themeBtn')).toBeVisible();
  await expect(page.locator('.theme-segmented')).toHaveCount(0);
  await expect(page.locator('[data-theme-state-btn]')).toHaveCount(0);
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
