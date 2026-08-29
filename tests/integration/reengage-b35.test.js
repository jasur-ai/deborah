/**
 * AUTH B-35 — Re-engagement e2e: real webhook suppress + real prefs opt-out
 * -------------------------------------------------------------------------
 *  1. Webhook HardBounce (A-23) → user suppress → re-engagement job skip qiladi
 *  2. User prefs API (B-21, ch_email=false) → marketing opt-out → job skip
 *  3. Opt-in user → job r7 yuboradi + reengageSent flag (idempotent)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import supertest from 'supertest';
import { processEmailWebhook } from '../../src/modules/email/webhook.js';
import { runReEngagementSequence } from '../../src/modules/onboarding/reengage.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

const DAY = 86400000;
const NOW = Date.now();

let app;
let httpServer;
let base;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
  base = `http://localhost:${httpServer.address().port}`;
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

const PW = 'parol-2026-x-uzun';

async function seedInactiveUser({ key, email, days, prefs }) {
  await fb.set(`users/${key}`, {
    username: key,
    email,
    password: PW, // legacy plaintext branch — test login uchun (argon2 og'ir)
    settings: { lang: 'uz' },
    last_active: NOW - days * DAY,
    notif_prefs: prefs,
  });
  // Email index — webhook findUserByEmail (A-23) qidiradi
  await fb.set(`users_email_index/${safeKey(email)}`, key);
  await fb.set(`onboarding/${safeKey(key)}`, {
    step: 'checklist',
    activated_at: NOW - (days + 2) * DAY,
    orient: { subject: 'matematika', skipped: false, submittedAt: NOW - (days + 2) * DAY },
    firstWin: { subject: 'matematika', completedAt: NOW - days * DAY, score: 3, total: 5 },
  });
}

async function loginUser(key) {
  const agent = supertest.agent(app);
  const page = await agent.get('/user/login');
  const csrf = (page.text.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
  const r = await agent.post('/user/login').type('form').set('x-forwarded-for', '203.0.113.99').send({
    _csrf: csrf, lang: 'uz', mode: 'login', username: key, password: PW,
  });
  expect([302, 200]).toContain(r.status);
  // Login session'ni regeneratsiya qilgan — panel'dan yangi CSRF token olamiz
  const panel = await agent.get('/user/panel');
  const m = panel.text.match(/__CSRF_TOKEN\s*=\s*'([^']+)'/) || panel.text.match(/__CSRF_TOKEN\s*=\s*"([^"]+)"/);
  agent.__csrf = m ? m[1] : '';
  return agent;
}

describe('AUTH B-35 — re-engagement e2e', () => {
  it('webhook HardBounce → suppress → job skip qiladi (spam yo\'q)', async () => {
    await seedInactiveUser({ key: 'b35e-bounce', email: 'b35e-bounce@test.uz', days: 10, prefs: { channels: { email: true } } });

    // Real webhook: HardBounce — A-23 suppress yo'lini ishga tushiramiz
    const wh = await processEmailWebhook({
      MessageID: 'b35e-msg-1',
      Type: 'HardBounce',
      Email: 'b35e-bounce@test.uz',
    });
    expect(wh.event).toBe('email:bounced');

    const r = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async () => { throw new Error('suppress bo\'lganiga qaramay yuborildi!'); } },
    });
    expect(r.sent).toBe(0);
    expect(r.skippedSuppressed).toBeGreaterThanOrEqual(1);
  });

  it('prefs API ch_email=false → marketing opt-out → job skip', async () => {
    await seedInactiveUser({ key: 'b35e-optout', email: 'b35e-optout@test.uz', days: 12, prefs: { channels: { email: true } } });
    // Real prefs endpoint (B-21): email kanalini o'chiramiz
    const agent = await loginUser('b35e-optout');
    const res = await agent.post('/api/notifications/prefs').send({ ch_email: false }).set('x-csrf-token', agent.__csrf);
    expect([200, 302]).toContain(res.status);

    const r = await runReEngagementSequence({
      now: NOW,
      deps: { sendEmail: async () => { throw new Error('opt-out bo\'lganiga qaramay yuborildi!'); } },
    });
    expect(r.sent).toBe(0);
    expect(r.skippedOptOut).toBeGreaterThanOrEqual(1);
  });

  it('opt-in user → r7 yuboriladi, flag yoziladi, ikkinchi run hech narsa yubormaydi', async () => {
    await seedInactiveUser({ key: 'b35e-ok', email: 'b35e-ok@test.uz', days: 9, prefs: { channels: { email: true } } });

    const sent = [];
    const deps = { sendEmail: async (msg) => { sent.push(msg.tag); return { ok: true }; } };
    const r1 = await runReEngagementSequence({ now: NOW, deps });
    expect(sent).toContain('reengage-r7');

    const snap = await fb.get(`onboarding/${safeKey('b35e-ok')}/reengageSent`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().r7).toBeTruthy();

    const r2 = await runReEngagementSequence({ now: NOW, deps: { sendEmail: async () => { throw new Error('duplicate!'); } } });
    expect(r2.sent).toBe(0);
    expect(r1.sent).toBeGreaterThanOrEqual(1);
  });
});
