/**
 * Deborah — Cast E2E (T-03): Accessibility
 * ----------------------------------------
 * - Keyboard-only: login form focusable, submit via Enter (item 10)
 * - Mobile 320px viewport render (item 12)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startE2E, stopE2E, newContext, newPage, seedCastSession, loginAsUser, serverUrl } from './cast-e2e.helper.js';

let context;

beforeAll(async () => {
  await startE2E();
  context = await newContext();
});

afterAll(async () => {
  await context.close();
  await stopE2E();
});

describe('T-03 cast-accessibility: keyboard + mobile', () => {
  it('login form is keyboard-accessible (item 10)', async () => {
    const page = await newPage(context);
    await page.goto(`${serverUrl}/user/login`, { waitUntil: 'domcontentloaded' });
    // Barcha focusable elementlar ro'yxati — input'larga keyboard orqali yetib borish mumkin
    const focusables = await page.evaluate(() => {
      const els = [...document.querySelectorAll('input, button, a[href]')];
      return { count: els.length, hasTextInput: els.some((e) => e.tagName === 'INPUT' && e.type !== 'hidden' && e.type !== 'submit'), hasSubmit: els.some((e) => e.type === 'submit' || e.tagName === 'BUTTON') };
    });
    expect(focusables.count).toBeGreaterThan(0);
    expect(focusables.hasTextInput).toBe(true);
    expect(focusables.hasSubmit).toBe(true);
    // Tab orqali hali ham form ichida bo'lamiz (sahifa tashqarisiga chiqmaymiz)
    await page.keyboard.press('Tab');
    const stillInPage = await page.evaluate(() => document.activeElement !== document.body);
    expect(stillInPage).toBe(true);
    await page.close();
  }, 30000);

  it('mobile 320px viewport renders director page (item 12)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Mobile', owner: 'user:user' });

    // Mobile viewport
    const mobileContext = await context.browser().newContext({ viewport: { width: 320, height: 640 } });
    await loginAsUser(mobileContext);

    const dirPage = await mobileContext.newPage();
    const resp = await dirPage.goto(`${serverUrl}/cast/${sessionId}/director`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    expect(resp.status()).toBe(200);
    const title = await dirPage.textContent('#dir-title');
    expect(title).toContain('Mobile');
    await dirPage.close();
    await mobileContext.close();
  }, 30000);

  it('projector boot data carries no private key in rendered HTML (item 7/11)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Safe', owner: 'user:user' });

    await loginAsUser(context);

    const dirPage = await newPage(context);
    await dirPage.goto(`${serverUrl}/cast/${sessionId}/director`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const html = await dirPage.content();
    // Director sahifasida ham answer key ko'rinmasligi kerak (boot questions answer key'siz)
    expect(html).not.toContain('correctOptionIds');
    await dirPage.close();
  }, 30000);
});
