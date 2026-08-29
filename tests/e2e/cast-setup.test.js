/**
 * Deborah — Cast E2E (T-03): Setup
 * -------------------------------
 * Real browser (Playwright chromium) + real server (createApp).
 * - Server/bootstrap fixture ishlaydi (item 1)
 * - Director sahifasi owner role bilan render qilinadi
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

describe('T-03 cast-setup: server + browser + director render', () => {
  it('server is up and serves /user/login', async () => {
    const page = await newPage(context);
    const resp = await page.goto(`${serverUrl}/user/login`);
    expect(resp.status()).toBe(200);
    await page.close();
  });

  it('director page renders for owner (seeded session)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Setup E2E', owner: 'user:user' });

    // Login as user (session cookie in context) — login muvaffaqiyati assert qilinadi
    await loginAsUser(context);

    // Director page (domcontentloaded — socket.io 'load' ni bloklamaydi)
    const dirPage = await newPage(context);
    const resp = await dirPage.goto(`${serverUrl}/cast/${sessionId}/director`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    expect(resp.status()).toBe(200);
    const title = await dirPage.textContent('#dir-title');
    expect(title).toContain('Setup E2E');
    await dirPage.close();
  }, 30000);

  it('director page rejects non-owner (403 or redirect)', async () => {
    const { sessionId } = await seedCastSession({ title: 'NoRole', owner: 'user:someone-else' });
    const page = await newPage(context);
    const resp = await page.goto(`${serverUrl}/cast/${sessionId}/director`);
    expect([401, 403, 302]).toContain(resp.status());
    await page.close();
  });
});
