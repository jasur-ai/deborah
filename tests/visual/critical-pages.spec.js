/**
 * Deborah — Visual: Critical Public Pages (STYLE STEP 03 / S03.04-05)
 * -------------------------------------------------------------------
 * Landing ( / ), Login ( /user/login ), Play ( /play ) — rest state.
 * Theme'lar: light, dark, reduced-motion (S03.04).
 * Screenshot nomi: {page}--{state}--{theme}--{viewport}.png (S03.08).
 */
import { expect } from '@playwright/test';
import {
  test,
  openThemedContext,
  stabilize,
  shotName,
  PAGE_STATES,
} from './visual.helper.js';

const THEME_SET = ['light', 'dark', 'reduced-motion'];

const PAGES = [
  { name: 'landing', path: '/', state: 'rest' },
  { name: 'login', path: '/user/login', state: 'rest' },
  { name: 'play', path: '/play', state: 'rest' },
];

for (const { name, path } of PAGES) {
  for (const theme of THEME_SET) {
    test(`${name} -- ${theme}`, async ({ browser }, testInfo) => {
      // App project'larida ishlaydi (projector'da emas) — S03.02 alohida
      test.skip(testInfo.project.name.startsWith('projector'), 'public pages app matrix');
      const project = testInfo.project.name;
      testInfo.annotations.push({ type: 'page', description: name });
      const context = await openThemedContext(browser, theme, project);
      const page = await context.newPage();
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await stabilize(page);
      await expect(page).toHaveScreenshot(
        shotName(name, PAGE_STATES[name]?.[0] || 'rest', theme, project),
        { animations: 'disabled', caret: 'hide' }
      );
      await context.close();
    });
  }
}

// ── S03.05: hover / focus state'lar ──
// Landing: CTA link ustida hover (rest'dan farqli holat).
// Landing hover — 3 theme (S03.05 hover state)
for (const theme of ['light', 'dark', 'reduced-motion']) {
  test(`landing -- hover -- ${theme}`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('projector'), 'public pages app matrix');
    const project = testInfo.project.name;
    const context = await openThemedContext(browser, theme, project);
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await stabilize(page);
    // Birinchi CTA/hover element: landing'ning primary tugmasi.
    // Landing'da `ld-demo-backdrop` overlay CTA'ni intercept qiladi —
    // force:true hover'ni ko'rinish tekshiruvlarisiz majburan bajaradi,
    // :hover CSS holati real trigger bo'ladi (S03.05 state).
    const cta = page.locator('a.ld-btn-primary, a[class*="btn-primary"], a.ld-btn').first();
    await cta.hover({ force: true });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot(
      shotName('landing', 'hover', theme, project),
      { animations: 'disabled', caret: 'hide' }
    );
    await context.close();
  });
}

// Login focus — light/dark (reduced-motion'da focus ring flake — S03.09
// threshold ichida emas; fixtures ham faqat light/dark talab qiladi).
for (const theme of ['light', 'dark']) {
  test(`login -- focus -- ${theme}`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('projector'), 'public pages app matrix');
    const project = testInfo.project.name;
    const context = await openThemedContext(browser, theme, project);
    const page = await context.newPage();
    await page.goto('/user/login', { waitUntil: 'domcontentloaded' });
    await stabilize(page);
    await page.locator('#login-username').focus();
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot(
      shotName('login', 'focus', theme, project),
      { animations: 'disabled', caret: 'hide' }
    );
    await context.close();
  });
}
