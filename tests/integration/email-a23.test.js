import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';

describe('AUTH A-23 — Email infratuzilmasi (integration)', () => {
  let app;
  let httpServer;
  let base;

  beforeAll(async () => {
    const created = await createApp();
    app = created.app;
    httpServer = created.httpServer;
    await new Promise((r) => httpServer.listen(0, r));
    base = `http://localhost:${httpServer.address().port}`;
  });

  afterAll(async () => {
    await new Promise((r) => httpServer.close(r));
  });

  it('webhook endpoint: noto`g`ri token → 403', async () => {
    process.env.EMAIL_WEBHOOK_TOKEN = 'real-token';
    const res = await fetch(`${base}/api/webhooks/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ MessageID: 'pm-x', Type: 'HardBounce' }),
    });
    expect(res.status).toBe(403);
  });

  it('webhook endpoint: EMAIL_WEBHOOK_TOKEN to`g`ri bo`lsa → ok', async () => {
    process.env.EMAIL_WEBHOOK_TOKEN = 'real-token';
    const res = await fetch(`${base}/api/webhooks/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Postmark-Webhook-Token': 'real-token',
      },
      body: JSON.stringify({ MessageID: 'pm-valid', Type: 'Delivery' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // B-31 §11: Delivery endi 'ignored' emas — email_log 'delivered' deb yangilanadi
    expect(body.event).toBe('email:delivered');
  });

  it('register: disposable email (mailinator) → rad etiladi', async () => {
    // CSRF token olish
    const page = await fetch(`${base}/user/login?mode=reg`);
    const html = await page.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/);
    const csrf = m ? m[1] : null;
    expect(csrf).toBeTruthy();
    const cookies = page.headers.get('set-cookie') || '';

    const res = await fetch(`${base}/user/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
      },
      redirect: 'manual',
      body: new URLSearchParams({
        _csrf: csrf,
        lang: 'uz',
        mode: 'reg', consent: 'on',
        username: `a23d_${Date.now() % 1000000}`,
        password: 'parol-2026-x-uzun',
        email: `user_${Date.now() % 1000000}@mailinator.com`,
      }).toString(),
    });
    const out = await res.text();
    expect(out).toContain('Doimiy email manzilini ishlating');
    expect(out).toContain('data-field="email"');
  });

  it('register: oddiy email (test.uz) → 302 (register davom etadi)', async () => {
    const page = await fetch(`${base}/user/login?mode=reg`);
    const html = await page.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/);
    const csrf = m ? m[1] : null;
    const cookies = page.headers.get('set-cookie') || '';

    const res = await fetch(`${base}/user/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
      },
      redirect: 'manual',
      body: new URLSearchParams({
        _csrf: csrf,
        lang: 'uz',
        mode: 'reg', consent: 'on',
        username: `a23ok_${Date.now() % 1000000}`,
        password: 'parol-2026-x-uzun',
        email: `ok_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      }).toString(),
    });
    expect(res.status).toBe(302);
  });
});
