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
 *  - S07.09     Icon-only control (System/Light/Dark) + accessible state + persist
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
    expect(a.meta).toBe(os === 'light' ? '#E3E2DA' : '#20221D'); // S07.05 — app chrome matches canvas
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
  expect(a.meta).toBe('#AAA596');
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
  expect(a.meta).toBe('#1C1813');
  await context.close();
});

// USER qarori (qotirilgan): landing'da segmented theme tugmalari YO'Q —
// faqat bitta #themeBtn toggle. Qayta qo'shilsa bu test qulaydi.
test("theme landing -- segmented control yo'q, faqat #themeBtn", async ({ browser }, testInfo) => {
  const context = await openThemedContext(browser, 'light', testInfo.project.name, { explicit: false });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.logo-mark')).toHaveAttribute('src', '/images/logo-vintage.png');
  await expect(page.locator('.logo-word')).toHaveCount(0);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/images/logo-icon.svg');
  const button = page.locator('#themeBtn');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-label', 'Tema');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.theme-segmented')).toHaveCount(0);
  await expect(page.locator('[data-theme-state-btn]')).toHaveCount(0);
  const darkSurface = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);

  await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveClass(/theme-transitioning/);
  await page.waitForTimeout(130);
  const midSurface = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(midSurface).not.toBe(darkSurface);
  const veil = await page.locator('html').evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    return {
      image: style.backgroundImage,
      animation: style.animationName,
      durationMs: parseFloat(style.animationDuration) * (style.animationDuration.endsWith('ms') ? 1 : 1000),
      opacity: Number(style.opacity),
    };
  });
  expect(veil.image).toContain('linear-gradient');
  expect(veil.image).not.toContain('radial-gradient');
  expect(veil.image).toContain('0.78');
  expect(veil.animation).toBe('theme-satin-sweep');
  expect(veil.durationMs).toBeCloseTo(900, 0);
  expect(veil.opacity).toBeGreaterThan(0.1);
  await expect(page.locator('html')).not.toHaveClass(/theme-transitioning/, { timeout: 1500 });
  const lightSurface = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(lightSurface).not.toBe(darkSurface);
  expect(lightSurface).not.toBe(midSurface);
  await context.close();
});

test('theme control -- icon-only, accessible, refined and reduced-motion aware', async ({ browser }, testInfo) => {
  const context = await openThemedContext(browser, 'dark', testInfo.project.name);
  const page = await context.newPage();
  await page.goto('/user/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.nav-logo img')).toHaveAttribute('src', '/images/logo-vintage.png');
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/images/logo-icon.svg');
  const group = page.locator('.theme-segmented').first();
  const buttons = group.locator('[data-theme-state-btn]');
  await expect(buttons).toHaveCount(3);
  const details = await buttons.evaluateAll((items) => items.map((button) => ({
    state: button.getAttribute('data-theme-state-btn'),
    label: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
    text: button.textContent.trim(),
    iconHidden: button.querySelector('svg')?.getAttribute('aria-hidden') === 'true',
  })));
  expect(details.map((item) => item.state)).toEqual(['system', 'light', 'dark']);
  expect(details.every((item) => item.label && item.title && item.iconHidden && item.text === '')).toBe(true);
  const targets = await buttons.evaluateAll((items) => items.map((button) => {
    const { width, height } = button.getBoundingClientRect();
    return { width, height };
  }));
  expect(targets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);

  await group.locator('[data-theme-state-btn="light"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(group.locator('[data-theme-state-btn="light"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveClass(/theme-transitioning/);
  await page.waitForTimeout(130);
  const veil = await page.locator('html').evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    return {
      image: style.backgroundImage,
      animation: style.animationName,
      durationMs: parseFloat(style.animationDuration) * (style.animationDuration.endsWith('ms') ? 1 : 1000),
      opacity: Number(style.opacity),
      layer: Number(style.zIndex),
    };
  });
  expect(veil.image).toContain('linear-gradient');
  expect(veil.image).not.toContain('radial-gradient');
  expect(veil.image).toContain('0.78');
  expect(veil.animation).toBe('theme-satin-sweep');
  expect(veil.durationMs).toBeCloseTo(900, 0);
  expect(veil.opacity).toBeGreaterThan(0.1);
  expect(veil.layer).toBeLessThan(1000);
  await expect(page.locator('html')).not.toHaveClass(/theme-transitioning/, { timeout: 1500 });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await group.locator('[data-theme-state-btn="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveClass(/theme-transitioning/);
  const reducedSweep = await page.locator('html').evaluate((element) => getComputedStyle(element, '::before').animationName);
  expect(reducedSweep).not.toBe('theme-satin-sweep');
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
