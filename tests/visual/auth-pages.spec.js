/**
 * Deborah — Visual: Authenticated Pages (STYLE STEP 03 / S03.04-05, S03.07)
 * ------------------------------------------------------------------------
 * User panel + admin dashboard — real UI login orqali (S03.08 credential
 * fixture: seed 'user/user', 'admin/admin'). Theme: light + dark.
 * Stable clock + fonts ready (S03.03, S03.06).
 */
import { expect } from '@playwright/test';
import {
  test,
  openThemedContext,
  stabilize,
  loginAsUserUI,
  loginAsAdminUI,
  shotName,
  PAGE_STATES,
} from './visual.helper.js';

const THEME_SET = ['light', 'dark'];

const PAGES = [
  { name: 'user-panel', path: '/user/panel', login: loginAsUserUI, creds: { username: 'user', password: 'user' } },
  { name: 'admin-dashboard', path: '/admin/dashboard', login: loginAsAdminUI, creds: { username: 'admin', password: 'admin' } },
];

for (const { name, path, login, creds } of PAGES) {
  for (const theme of THEME_SET) {
    test(`${name} -- ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('projector'), 'auth pages app matrix');
      const project = testInfo.project.name;
      testInfo.annotations.push({ type: 'page', description: name });
      const context = await openThemedContext(browser, theme, project);
      const page = await context.newPage();
      await login(page, creds);
      // login() allaqachon target sahifaga redirect bilan tushadi (waitForURL).
      // Ortiqcha page.goto(path) ikkinchi navigatsiya qilib, session
      // regenerate() cookie'si commit bo'lmagan paytda 401 race berardi.
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(600); // Set-Cookie commit window
      await stabilize(page);
      // Content JS orqali yuklanadi — API tugashini kutamiz (white-baseline race fix)
      if (name === 'admin-dashboard') {
        await page.waitForSelector('#users-tbody tr', { timeout: 15000 });
      } else {
        // STEP 25: panel STEP 17 shell'ga o'tdi (workspace) — `.panel` emas, `#main-content`
        await page.waitForSelector('#main-content .ws-live', { timeout: 15000 });
      }
      await expect(page).toHaveScreenshot(
        shotName(name, PAGE_STATES[name]?.[0] || 'rest', theme, project),
        { animations: 'disabled', caret: 'hide' }
      );
      await context.close();
    });
  }
}
