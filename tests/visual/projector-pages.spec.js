/**
 * Deborah — Visual: Projector Matrix (STYLE STEP 03 / S03.02, S03.07)
 * ------------------------------------------------------------------
 * Projector viewportlar: 1920×1080 (HD), 1280×720 (720p), 1024×768 (XGA).
 * Sahifa: `/play` (cast join) — projector'da real use-case (direktor katta
 * ekranda join kod ko'rsatadi). Dynamic socket talab qilmaydi — screenshot
 * deterministic (S03.07: real network timing ta'sir qilmaydi).
 */
import { expect } from '@playwright/test';
import {
  test,
  openThemedContext,
  stabilize,
  shotName,
} from './visual.helper.js';

const THEME_SET = ['light', 'dark'];

for (const theme of THEME_SET) {
  test(`play -- projector -- ${theme}`, async ({ browser }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('projector'), 'projector-only matrix');
    const project = testInfo.project.name;
    testInfo.annotations.push({ type: 'page', description: 'play-projector' });
    const context = await openThemedContext(browser, theme, project);
    const page = await context.newPage();
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await stabilize(page);
    await expect(page).toHaveScreenshot(
      shotName('play', 'rest', theme, project),
      { animations: 'disabled', caret: 'hide' }
    );
    await context.close();
  });
}
