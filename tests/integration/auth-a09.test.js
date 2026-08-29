/**
 * AUTH A-09 — New-device xabar + suspicious activity (integration)
 * -------------------------------------------------------------------
 * Qamrov (guide A-09 §21-§22):
 *  - Login → yangi qurilma xabari queue + deliver (status delivered)
 *  - Takroriy (24h) login → dedupe (yangi alert YO'Q)
 *  - Suspicious: tez ketma-ket login'da suspicious_alert
 *  - Abuse: kuniga cap ≤2 — uchinchi xabar blok
 *  - Preview: sensitive yo'q
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
}, 90000);

afterAll(async () => {
  await stopServer();
  restoreDb();
});

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
      'x-forwarded-for': xff,
      'user-agent': body.__ua || 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

/** Yangi user yaratish + login (first login = session record yo'q). */
async function registerAndLogin(username, xff, ua) {
  // Register (POST /user/login mode=reg)
  const r = await getCsrf('/user/login');
  const reg = await postForm('/user/login', r.cookie, {
    _csrf: r.csrf, username, password: 'parol-2026-x-uzun', mode: 'reg', consent: 'on', lang: 'uz', __ua: ua,
      email: `r10_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
  }, xff);
  expect([302, 303]).toContain(reg.status);

  // Logout'dan keyin yangi sessiya + CSRF (bir xil cookie bilan login)
  await fetch(`${serverUrl}/user/logout`, { redirect: 'manual' });
  const l = await getCsrf('/user/login');
  const login = await postForm('/user/login', l.cookie, {
    _csrf: l.csrf, username, password: 'parol-2026-x-uzun', mode: 'login', lang: 'uz', __ua: ua,
  }, xff);
  expect([302, 303]).toContain(login.status);
}

/** Login helper — cookie + csrf bitta sessiyadan. */
async function loginAs(username, xff, ua) {
  const l = await getCsrf('/user/login');
  return postForm('/user/login', l.cookie, {
    _csrf: l.csrf, username, password: 'parol-2026-x-uzun', mode: 'login', lang: 'uz', __ua: ua,
  }, xff);
}

/** users.{key}/alerts state — bugungi day count (service bilan bir xil dayKey). */
function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function todayAlertCount(userKey) {
  const snap = await fb.get(`users/${userKey}/alerts`);
  if (!snap.exists()) return 0;
  const state = snap.val();
  return state[dayKey()]?.count || 0;
}

async function listAlerts(userKey) {
  const snap = await fb.get(`alerts/${userKey}`);
  if (!snap.exists()) return {};
  return snap.val();
}

/** Alert yozuvi async bo'lgani uchun — polling (login javobidan keyin). */
async function waitForAlerts(userKey, predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    last = await listAlerts(userKey);
    const hits = Object.values(last).filter(predicate);
    if (hits.length) return hits;
    await new Promise((r) => setTimeout(r, 150));
  }
  return Object.values(last).filter(predicate);
}

describe('A-09 — new-device alert flow', () => {
  it('login → alert queue + deliver (status delivered, telegram)', async () => {
    const u = `a09dev_${crypto.randomBytes(3).toString('hex')}`;
    // Birinchi login (record yo'q) — alert emas
    await registerAndLogin(u, '203.0.113.50', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36');

    // Ikkinchi "qurilma" — boshqa IP + boshqa UA → yangi qurilma xabari
    const login = await loginAs(u, '198.51.100.25', 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36');
    expect([302, 303]).toContain(login.status);

    const newDevice = (await waitForAlerts(u, (a) => a.type === 'new_device'))[0];
    expect(newDevice).toBeTruthy();
    expect(newDevice.status).toBe('delivered');
    expect(newDevice.channel).toBe('telegram');
    // geo-lite test bloki: 198.51.100.x → 'Samarqand'
    expect(newDevice.ipHash).toBeTruthy(); // DB'da faqat hash — PII minimal
    expect(newDevice.city).toBe('Samarqand');
  });

  it('dedupe: 24h ichida takroriy yangi qurilma → yangi alert YO\'Q', async () => {
    const u = `a09dd_${crypto.randomBytes(3).toString('hex')}`;
    await registerAndLogin(u, '203.0.113.60', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36');

    // Boshqa IP/UA login → birinchi alert
    await loginAs(u, '198.51.100.26', 'Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile');

    // Birinchi alert'ning yozilishini kutamiz
    const first = await waitForAlerts(u, (a) => a.type === 'new_device');
    const beforeCount = Object.values(await listAlerts(u)).filter((a) => a.type === 'new_device').length;
    expect(first.length).toBeGreaterThan(0);

    // Yana boshqa IP/UA — lekin 24h ichida → dedupe (yangi new_device alert YO'Q)
    await loginAs(u, '203.0.113.61', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13) Chrome/119.0 Safari/537.36');
    await new Promise((r) => setTimeout(r, 500)); // dedupe natijasini kutish
    const after = Object.values(await listAlerts(u)).filter((a) => a.type === 'new_device');
    expect(after.length).toBe(beforeCount); // yangi new_device alert qo'shilmadi
  });

  it('cap: kuniga ≤2 alert — uchinchisi blok', async () => {
    const u = `a09cap_${crypto.randomBytes(3).toString('hex')}`;
    await registerAndLogin(u, '203.0.113.70', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36');

    // 3 xil qurilma logini — birinchi ikkitasi alert, uchinchisi cap'ga yopiladi
    for (const [ip, ua] of [
      ['198.51.100.30', 'Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile'],
      ['203.0.113.71', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13) Chrome/119.0'],
      ['198.51.100.31', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0'],
    ]) {
      await loginAs(u, ip, ua);
    }
    expect(await todayAlertCount(u)).toBeLessThanOrEqual(2);
  });

  it('suspicious: tez ketma-ket login (3 xil IP) → suspicious_alert', async () => {
    const u = `a09susp_${crypto.randomBytes(3).toString('hex')}`;
    await registerAndLogin(u, '203.0.113.80', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0');

    // 3 xil IP'dan tez loginlar — suspicious qoida 2 (rapid_distinct_ips)
    for (const ip of ['198.51.100.40', '203.0.113.81', '198.51.100.41']) {
      await loginAs(u, ip, 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0');
    }

    const suspicious = (await waitForAlerts(u, (a) => a.type === 'suspicious'))[0];
    expect(suspicious).toBeTruthy();
    expect(suspicious.status).toBe('delivered');
  });
});
