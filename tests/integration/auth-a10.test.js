/**
 * AUTH A-10 — Roster import: upload + parser (P0)
 * -------------------------------------------------------------------
 * Integration (server darajasida):
 *  - /api/roster/upload auth talab qiladi (unauth → 401)
 *  - HEMIS formatli CSV upload → 201 + sessionId + parse report
 *  - cp1251 (rus) CSV upload → to'g'ri parse + rows'da qiymatlar
 *  - Spoofed extension (.pdf) → 400
 *  - Jumbo fayl → 413 (multer limit ROSTER_CONFIG'dan)
 *  - GET /api/roster/sessions/:id/report → parse report qaytadi
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
}, 90000);

afterAll(async () => {
  await stopServer();
  restoreDb();
});

/** CSRF + cookie (sessiya bilan bog'langan). */
async function getCsrf(path = '/user/login') {
  const res = await fetch(`${serverUrl}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie };
}

async function postForm(path, cookie, body, xff) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

/** Yangi user + login → { cookie, token } (joriy sessiyaga bog'langan CSRF). */
async function registerAndLogin(xff) {
  const uname = `a10_${Date.now() % 1000000}_${Math.floor(Math.random() * 1000)}`;
  const password = 'parol-2026-x-uzun';
  const { csrf: cr, cookie: ckr } = await getCsrf('/user/login');
  await postForm('/user/login', ckr, {
    _csrf: cr, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password,
    // AUTH A-18: email majburiy (A-21 checkpoint regression fix)
    email: `a10_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`,
  }, xff);

  // S17 BUG-108: roster staging endi teacher/admin rol talab qiladi —
  // yangi user'ni teacher'ga ko'taramiz (login keyin rol yangi sessiyaga tushadi)
  const { fb } = await import('../../firebase/admin.js');
  const { safeKey } = await import('../../utils/helpers.js');
  await fb.update(`users/${safeKey(uname)}`, { role: 'teacher', role_version: 1 });

  const { csrf, cookie } = await getCsrf('/user/login');
  const loginRes = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password,
  }, xff);
  expect(loginRes.status).toBe(302);
  const sessionCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];

  // Joriy sessiyaga bog'langan CSRF token — /user/panel dan
  const panelRes = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: sessionCookie } });
  const panelHtml = await panelRes.text();
  const m = panelHtml.match(/window\.__CSRF_TOKEN = ["']([^"']+)["']/);
  expect(m, 'panel __CSRF_TOKEN').toBeTruthy();
  return { username: uname, password, cookie: sessionCookie, token: m[1] };
}

/**
 * Multipart CSV upload. CSRF multipart body'da parse qilinmaydi
 * (validateCsrf multer'dan oldin ishlaydi) — x-csrf-token header ishlatiladi.
 */
async function uploadFile({ cookie, token, filename, bytes, xff }) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'text/csv' }), filename);
  return fetch(`${serverUrl}/api/roster/upload`, {
    method: 'POST',
    headers: {
      cookie,
      'x-csrf-token': token,
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    },
    redirect: 'manual',
    body: fd,
  });
}

describe('AUTH A-10 — upload auth va CSRF', () => {
  const xff = '203.0.113.80';

  it('/api/roster/upload auth talab qiladi (unauth → 401/403)', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['a,b\n1,2'], { type: 'text/csv' }), 'x.csv');
    const res = await fetch(`${serverUrl}/api/roster/upload`, {
      method: 'POST', redirect: 'manual', body: fd,
    });
    // validateCsrf requireAuth'dan oldin ishlaydi → csrf'siz POST 403 (auth fail)
    expect([401, 302, 403]).toContain(res.status);
  });

  it('csrf\'siz upload → 403', async () => {
    const { cookie } = await registerAndLogin(xff);
    const fd = new FormData();
    fd.append('file', new Blob(['a,b\n1,2'], { type: 'text/csv' }), 'x.csv');
    const res = await fetch(`${serverUrl}/api/roster/upload`, {
      method: 'POST', headers: { cookie }, redirect: 'manual', body: fd,
    });
    expect(res.status).toBe(403);
  });

  it('spoofed extension (.pdf mazmuni .csv emas) → 400', async () => {
    const { cookie, token } = await registerAndLogin(xff);
    const res = await uploadFile({
      cookie, token, filename: 'roster.pdf',
      bytes: Buffer.from('a,b\n1,2'), xff,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/Invalid extension|\.pdf/);
  });
});

describe('AUTH A-10 — HEMIS formatli CSV upload oqimi', () => {
  const xff = '203.0.113.81';

  it('HEMIS o\'zbekcha headerlar CSV → 201 + parse report', async () => {
    const { cookie, token } = await registerAndLogin(xff);
    const csv = 'talaba_id,F.I.Sh,guruh,kurs,fan\n001,Aliyev Ali,A,2026,MATH101\n002,Valiyev Vali,A,2026,MATH101\n';
    const res = await uploadFile({ cookie, token, filename: 'hemis.csv', bytes: Buffer.from(csv, 'utf-8'), xff });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBeTruthy();
    expect(body.report.filename).toBe('hemis.csv');
    expect(body.report.totalRows).toBe(2);

    // Parse report endpoint
    const repRes = await fetch(`${serverUrl}/api/roster/sessions/${body.sessionId}/report`, {
      headers: { cookie },
    });
    expect(repRes.status).toBe(200);
    const report = await repRes.json();
    expect(report.sessionId).toBe(body.sessionId);
    expect(report.totalRows).toBe(2);
    expect(report.sheetDetails[0].rowCount).toBe(2);
  });

  it('cp1251 (rus) CSV → to\'g\'ri parse (Имя/Дисциплина)', async () => {
    const { cookie, token } = await registerAndLogin(xff);
    // "Имя,Дисциплина\nАлё,MATH101" — windows-1251 baytlari
    // Д=0xC4 и=0xE8 с=0xF1 ц=0xF6 и=0xE8 п=0xEF л=0xEB и=0xE8 н=0xED а=0xE0
    const cp1251 = Buffer.from([
      0xC8, 0xEC, 0xFF, 0x2C, 0xC4, 0xE8, 0xF1, 0xF6, 0xE8, 0xEF, 0xEB, 0xE8, 0xED, 0xE0, 0x0A,
      0xC0, 0xEB, 0xB8, 0x2C, 0x4D, 0x41, 0x54, 0x48, 0x31, 0x30, 0x31,
    ]);
    const res = await uploadFile({ cookie, token, filename: 'hemis-ru.csv', bytes: cp1251, xff });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.report.totalRows).toBe(1);

    const rowsRes = await fetch(`${serverUrl}/api/roster/sessions/${body.sessionId}/rows`, {
      headers: { cookie },
    });
    expect(rowsRes.status).toBe(200);
    const rows = await rowsRes.json();
    expect(rows.length).toBe(1);
    expect(rows[0].data['Имя']).toBe('Алё');
    expect(rows[0].data['Дисциплина']).toBe('MATH101');
  });

  it('jumbo fayl (10MB+ → 413, multer ROSTER_CONFIG limit)', async () => {
    const { cookie, token } = await registerAndLogin(xff);
    const big = Buffer.alloc(11 * 1024 * 1024, 0x61); // ~11MB
    const res = await uploadFile({ cookie, token, filename: 'big.csv', bytes: big, xff });
    expect(res.status).toBe(413);
  });
});
