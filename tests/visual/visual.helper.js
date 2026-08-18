/**
 * Edikit — Visual Test Helper (STYLE STEP 03)
 * ---------------------------------------------
 * Playwright Test runner bilan ishlaydi. WebServer (playwright.config.js)
 * NODE_ENV=test modida ishga tushadi; bu yerda faqat context/page + login +
 * screenshot util'ari bor.
 *
 * S03.03: Deterministic clock — `page.clock.install({ time })` sahifa JS'ini
 *         stable vaqt bilan ishlatadi (relative date/random vizual diff
 *         buzmaydi).
 * S03.04: Theme emulation — context options orqali (colorScheme,
 *         forcedColors, reducedMotion).
 * S03.06: `fontsReady(page)` — document.fonts.ready kutiladi;
 *         `animations: 'disabled'` config darajasida.
 * S03.08: `shotName(...)` — {page}--{state}--{theme}--{viewport}.png.
 */
import { test as base } from '@playwright/test';

export const THEMES = {
  light: { colorScheme: 'light' },
  dark: { colorScheme: 'dark' },
  'high-contrast-light': { forcedColors: 'active', colorScheme: 'light' },
  'high-contrast-dark': { forcedColors: 'active', colorScheme: 'dark' },
  'reduced-motion': { reducedMotion: 'reduce', colorScheme: 'light' },
};

// Vaqt: data/db.json seed'idagi eng so'nggi createdAt (ago(60d) = oldin).
// Visual diff uchun sahifa vaqtini STABLE qilamiz.
export const STABLE_TIME = new Date('2026-08-01T12:00:00Z');

/** Sahifa nomi → qaysi state'lar kerak (S03.12 coverage uchun). */
export const PAGE_STATES = {
  landing: ['rest', 'hover'],
  login: ['rest', 'focus'],
  play: ['rest', 'empty'],
  'user-panel': ['rest', 'hover'],
  'admin-dashboard': ['rest', 'hover'],
  'cast-projector': ['rest'],
};

/**
 * Sahifa name → route. S03.08 nomlash: `{page}--{state}--{theme}--{viewport}`.
 * viewport proyekt nomidan olinadi (app-desktop → desktop).
 */
export function viewportOf(projectName) {
  return projectName.replace(/^(app|projector)-/, '');
}

export function shotName(pageName, state, theme, projectName) {
  return `${pageName}--${state}--${theme}--${viewportOf(projectName)}.png`;
}

/** Fonts ready + animatsiya settle — S03.06 */
export async function fontsReady(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/**
 * Sahifa yuklangach stable holatga keltiramiz:
 * deterministic clock + fonts ready + scroll top.
 *
 * `setFixedTime` ishlatiladi (Date.now freeze, real timer'lar ishlayveradi).
 * `install()` dan foydalanmaymiz — u sahifa timer'larini muzlatadi va
 * vizual testlarda real kutishlarni buzishi mumkin.
 */
export async function stabilize(page, { clock = STABLE_TIME } = {}) {
  await page.clock.setFixedTime(clock.getTime());
  // CSS animation/transition'lar (skeleton shimmer, spinner spin, progress glow,
  // switch pulse) screenshot stabilizatsiyasini buzadi — barchasini o'chiramiz.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // `*` selektori pseudo-elementlarga taalluqli emas — ::before/::after animatsiyalari
  // (skeleton shimmer, spinner) ham o'chishi uchun ularni ham qamraymiz.
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await fontsReady(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Qoldiq layout/kompozitsiya o'zgarishlari (font swap, JS timer'lar) tinchsin —
  // toHaveScreenshot'ning "two consecutive stable" tekshiruvi ishonchli o'tsin.
  await page.waitForTimeout(600);
}

/** UI orqali login (user panel uchun) — csrf hidden input forma'da. */
export async function loginAsUserUI(page, { username = 'user', password = 'user' } = {}) {
  await page.goto('/user/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/user/panel', { timeout: 15000 });
}

/** Admin login (dashboard uchun). */
export async function loginAsAdminUI(page, { username = 'admin', password = 'admin' } = {}) {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
}

/**
 * Theme'li context ochish. Har test'da browser fixture orqali.
 *
 * STEP 07 determinizm (S07.12): visual screenshot'lar uchun theme state
 * LOCALSTORAGE orqali EXPLICIT o'rnatiladi — `prefers-color-scheme`
 * emulation'i Playwright'da parse/DOMContentLoaded'ga nisbatan kechroq
 * qo'llanishi mumkin (flake), shuning uchun system'ga tayanmaymiz.
 * `explicit:false` — real boot/system xulqini test qiluvchi E2E'lar uchun.
 *
 * DIQQAT (determinizm blind spot): explicit localStorage tufayli boot script
 * o'ziyoq to'g'ri theme'ni qo'yadi — vizual suite theme.js apply() to'liq
 * buzilsa ham pass bo'lardi. Theme ENGINE xulqini faqat tests/visual/theme.spec.js
 * qo'riqlaydi (segmented control, persist, boot sync). Shu sabab theme.js
 * o'zgartirilganda theme.spec.js ham ishga tushirilishi SHART.
 *
 * Map: light→light, dark→dark, high-contrast-*→hc-*, reduced-motion→light.
 */
export const THEME_TO_STATE = {
  light: 'light',
  dark: 'dark',
  'high-contrast-light': 'hc-light',
  'high-contrast-dark': 'hc-dark',
  'reduced-motion': 'light',
};

export async function openThemedContext(browser, theme, projectName, { explicit = true } = {}) {
  const viewport = viewportOf(projectName);
  const base = {
    desktop: { width: 1440, height: 900 },
    'small-desktop': { width: 1280, height: 800 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 },
    'mobile-small': { width: 320, height: 568 },
    'projector-hd': { width: 1920, height: 1080 },
    'projector-720p': { width: 1280, height: 720 },
    'projector-xga': { width: 1024, height: 768 },
  };
  const context = await browser.newContext({
    viewport: base[viewport] || { width: 1280, height: 800 },
    ...THEMES[theme],
    locale: 'uz-UZ',
  });
  if (explicit) {
    const state = THEME_TO_STATE[theme] || 'light';
    await context.addInitScript((st) => {
      try { localStorage.setItem('edikit-theme-state', st); } catch (_) {}
    }, state);
  }
  return context;
}

/** Eslatma: shotName + stabilize helper'lari test'da ishlatiladi. */
export const test = base;
