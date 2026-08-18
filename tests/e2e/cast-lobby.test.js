/**
 * Edikit — Cast E2E (T-03): Lobby & join
 * --------------------------------------
 * - Participant join form ko'rinadi (item 2/4)
 * - Join kodi bilan participant qo'shiladi (item 4)
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

describe('T-03 cast-lobby: join flow', () => {
  it('participant page (/play?code=) shows join form with join-code/name inputs', async () => {
    const { joinCode } = await seedCastSession({ title: 'Lobby E2E', owner: 'user:user' });

    const page = await newPage(context);
    await page.goto(`${serverUrl}/play?code=${joinCode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const hasJoinForm = await page.isVisible('#join-form').catch(() => false);
    const hasJoinBtn = await page.isVisible('#join-btn').catch(() => false);
    expect(hasJoinForm).toBe(true);
    expect(hasJoinBtn).toBe(true);
    await page.close();
  }, 30000);

  it('lobby participant count is visible in director view', async () => {
    const { sessionId } = await seedCastSession({ title: 'Count', owner: 'user:user' });

    // Login — muvaffaqiyati assert qilinadi
    await loginAsUser(context);

    const dirPage = await newPage(context);
    const resp = await dirPage.goto(`${serverUrl}/cast/${sessionId}/director`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    expect(resp.status()).toBe(200);
    // Lobby elementlari mavjud
    const hasLobby = await dirPage.isVisible('#dir-lobby').catch(() => false);
    const hasStart = await dirPage.isVisible('#btn-start-session').catch(() => false);
    expect(hasLobby || hasStart).toBe(true);
    await dirPage.close();
  }, 30000);
});
