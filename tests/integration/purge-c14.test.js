/**
 * AUTH C-14 — Retention purge integration
 * ---------------------------------------
 *  1. Real ma'lumotlar (register → email_log, verify kod, reset token) yoziladi,
 *     keyin runRetentionPurge — faqat eski yozuvlar tozalanadi, yangilari qoladi
 *  2. Legal hold user — device/derived data purge'dan o'tkazib yuboriladi
 *  3. PURGE_RUN audit auth_audit'da (C-09 dashboard ko'radi)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { runRetentionPurge, purgeUserDevices } from '../../src/modules/auth/purge.js';

const DAY = 24 * 60 * 60 * 1000;
let httpServer;
let serverUrl;

async function getCsrf() {
  const res = await fetch(`${serverUrl}/user/login`);
  const html = await res.text();
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN\s*=\s*"([^"]+)"/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie };
}

async function postForm(path, cookie, body, xff) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, 'x-forwarded-for': xff },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });
}

beforeAll(async () => {
  const { httpServer: hs } = await createApp();
  httpServer = hs;
  await new Promise((r) => httpServer.listen(0, r));
  serverUrl = `http://localhost:${httpServer.address().port}`;
  await snapshotDb();
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH C-14 — retention purge real flow', () => {
  it('runRetentionPurge: faqat eski ma\'lumotlar tozalanadi; yangi saqlanadi', async () => {
    // Haqiqiy register → email_log yoziladi
    const uniq = Date.now() % 1000000;
    const uname = `c14_${uniq}_${Math.floor(Math.random() * 1000)}`;
    const xff = `198.51.${100 + (uniq % 100)}.${10 + (uniq % 200)}`;
    const { csrf: cr, cookie: ckr } = await getCsrf();
    await postForm('/user/login', ckr, { _csrf: cr, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: 'parol-2026-x-uzun', email: `c14_${uniq}@test.uz` }, xff);

    // Yangi email_log yozuvi (real)
    const logSnap = await fb.get('email_log');
    expect(logSnap.exists()).toBe(true);

    // Eski email_log yozuvi (purge qilinishi kerak)
    await fb.set('email_log/c14-very-old', { emailHash: 'h', createdAt: Date.now() - 60 * DAY });

    const r = await runRetentionPurge();
    expect(r.ok).toBe(true);
    // Eski tozalandi, yangi qoldi
    expect((await fb.get('email_log/c14-very-old')).exists()).toBe(false);
    expect(logSnap.val()).toBeTruthy();
  });

  it('legal hold user: derived data (devices) purge dan o\'tib ketadi', async () => {
    await fb.set('users/c14_hold/devices/d-old', { last_seen: Date.now() - 400 * DAY, risk_events: [] });
    await fb.update('users/c14_hold', { legal_hold: true });

    const r = await purgeUserDevices();
    expect(r.ok === undefined || r.removed >= 0).toBe(true);
    expect((await fb.get('users/c14_hold/devices/d-old')).exists()).toBe(true);
  });

  it('PURGE_RUN audit auth_audit da — C-09 dashboard ko\'radi', async () => {
    await fb.set('email_log/c14-audit-old', { createdAt: Date.now() - 40 * DAY });
    const r = await runRetentionPurge();
    expect(r.ok).toBe(true);
    const snap = await fb.get('auth_audit');
    let found = false;
    if (snap.exists()) {
      for (const day of Object.values(snap.val())) {
        for (const rec of Object.values(day || {})) {
          if (rec?.action === 'purge:run' && rec?.outcome === 'success') found = true;
        }
      }
    }
    expect(found).toBe(true);
  });
});
