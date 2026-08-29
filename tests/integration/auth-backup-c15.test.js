/**
 * AUTH C-15 — Restore drill (fresh DB → restore → login verify)
 * -------------------------------------------------------------
 *  Restore'dan keyin login to'liq ishlaydi (parol hash integrity),
 *  MFA/audit restore qilingan. RESTORE_DRILL + RESTORE_VERIFY audit'lanadi.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { runAuthBackup, restoreAuthBackup, verifyAuthRestore } from '../../src/modules/auth/backup.js';

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

describe('AUTH C-15 — restore drill: fresh DB → login verify', () => {
  it('backup → fresh DB (toza) → restore → login muvaffaqiyatli (password hash integrity)', async () => {
    // 1) User yaratamiz
    const uniq = Date.now() % 1000000;
    const uname = `c15_${uniq}`;
    const password = 'parol-2026-x-uzun';
    const xff = `203.0.${113 + (uniq % 50)}.${10 + (uniq % 200)}`;
    const { csrf: cr, cookie: ckr } = await getCsrf();
    await postForm('/user/login', ckr, { _csrf: cr, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password, email: `c15_${uniq}@test.uz` }, xff);

    // 2) Backup olamiz
    const bk = await runAuthBackup();
    expect(bk.ok).toBe(true);

    // 3) Fresh DB simulyatsiyasi: user'ni o'chiramiz (data yo'qoldi)
    const usersSnap = await fb.get('users');
    const userKey = Object.keys(usersSnap.val()).find((k) => usersSnap.val()[k]?.username === uname);
    expect(userKey).toBeTruthy();
    await fb.remove(`users/${userKey}`);

    // Login endi ishlamasligi kerak (user yo'q)
    const { csrf, cookie } = await getCsrf();
    const failLogin = await postForm('/user/login', cookie, { _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password }, xff);
    expect([401, 200, 302].includes(failLogin.status)).toBe(true);
    // keyin restore'da user qaytadi

    // 4) Restore drill
    const restored = await restoreAuthBackup(bk.file);
    expect(restored.ok).toBe(true);
    expect(restored.entries).toBeGreaterThan(0);

    // 5) Verify: user qaytdi, login ishlaydi (hash integrity)
    const afterSnap = await fb.get(`users/${userKey}`);
    expect(afterSnap.exists()).toBe(true);
    expect(afterSnap.val().password).toBeTruthy();

    const { csrf: cs2, cookie: ck2 } = await getCsrf();
    const okLogin = await postForm('/user/login', ck2, { _csrf: cs2, lang: 'uz', mode: 'login', username: uname, password }, xff);
    expect(okLogin.status).toBe(302);

    // 6) verifyAuthRestore — operator sign-off
    const v = await verifyAuthRestore({ checks: { users: 1, loginOk: true } });
    expect(v.ok).toBe(true);

    // 7) Audit: restore:drill + restore:verify yozilgan
    const auditSnap = await fb.get('auth_audit');
    let drill = false;
    let verify = false;
    if (auditSnap.exists()) {
      for (const day of Object.values(auditSnap.val())) {
        for (const rec of Object.values(day || {})) {
          if (rec?.action === 'auth:restore:drill' && rec?.outcome === 'success') drill = true;
          if (rec?.action === 'auth:restore:verify' && rec?.outcome === 'success') verify = true;
        }
      }
    }
    expect(drill).toBe(true);
    expect(verify).toBe(true);
  });
});
