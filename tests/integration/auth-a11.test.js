/**
 * AUTH A-11 — Roster import: mapping + commit + rollback + invite
 * -------------------------------------------------------------------
 * Integration (server darajasida):
 *  - Upload → map (auto-detect) → preview (hash) → commit → DB'da user/enroll
 *  - Row status + reconciliation endpoint'lar
 *  - Invite yaratish → accept (public) → user login ishlaydi → replay reject
 *  - Rollback → state tiklanadi
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

async function registerAndLogin(xff) {
  const uname = `a11_${Date.now() % 1000000}_${Math.floor(Math.random() * 1000)}`;
  const password = 'parol-2026-x-uzun';
  const { csrf: cr, cookie: ckr } = await getCsrf('/user/login');
  await postForm('/user/login', ckr, {
    _csrf: cr, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password,
      email: `r11_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
  }, xff);

  const { csrf, cookie } = await getCsrf('/user/login');
  const loginRes = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password,
  }, xff);
  expect(loginRes.status).toBe(302);
  const sessionCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];

  const panelRes = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: sessionCookie } });
  const panelHtml = await panelRes.text();
  const m = panelHtml.match(/window\.__CSRF_TOKEN = ["']([^"']+)["']/);
  expect(m, 'panel __CSRF_TOKEN').toBeTruthy();
  return { username: uname, password, cookie: sessionCookie, token: m[1] };
}

async function uploadFile({ cookie, token, filename, bytes, xff }) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'text/csv' }), filename);
  return fetch(`${serverUrl}/api/roster/upload`, {
    method: 'POST',
    headers: { cookie, 'x-csrf-token': token, ...(xff ? { 'x-forwarded-for': xff } : {}) },
    redirect: 'manual',
    body: fd,
  });
}

const HEMIS_CSV = 'talaba_id,F.I.Sh,guruh,kurs,fan\nS0001,Aliyev Ali,A,2026,MATH101\nS0002,Valiyev Vali,A,2026,MATH101\n';

/** Teacher rol'li user + login (invite boshqaruvi teacher/admin talab qiladi). */
async function loginAsTeacher(xff) {
  const key = 'teacher_a11';
  const exists = await fb.get(`users/${key}`);
  if (!exists.exists()) {
    await fb.set(`users/${key}`, {
      username: key, password: 'parol-2026-x-uzun', created_at: Date.now(),
      safeKey: key, role: 'teacher', isVip: false,
    });
  }
  const { csrf, cookie } = await getCsrf('/user/login');
  const loginRes = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'login', username: key, password: 'parol-2026-x-uzun',
  }, xff);
  expect(loginRes.status).toBe(302);
  const sessionCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  const panelRes = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: sessionCookie } });
  const m = (await panelRes.text()).match(/window\.__CSRF_TOKEN = ["']([^"']+)["']/);
  expect(m, 'panel __CSRF_TOKEN').toBeTruthy();
  return { cookie: sessionCookie, token: m[1] };
}

async function uploadAndMap(cookie, token, xff) {
  const up = await uploadFile({
    cookie, token, filename: 'hemis.csv',
    bytes: Buffer.from(HEMIS_CSV, 'utf-8'), xff,
  });
  expect(up.status).toBe(201);
  const { sessionId } = await up.json();

  const mapRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/map`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': token },
    redirect: 'manual',
    body: JSON.stringify({}),
  });
  expect(mapRes.status).toBe(200);
  const map = await mapRes.json();
  expect(map.autoDetected).toBe(true);
  expect(map.unmapped.length).toBe(0);
  return { sessionId, map };
}

const xff = '203.0.113.90';

describe('AUTH A-11 — commit HAQIQATAN yozadi (API orqali)', () => {
  it('upload → map → preview → commit → DB user/enroll/guruh', async () => {
    const { cookie, token } = await registerAndLogin(xff);
    const { sessionId } = await uploadAndMap(cookie, token, xff);

    const previewRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/preview`, {
      headers: { cookie },
    });
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.hash).toBeTruthy();

    const commitRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/commit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': token },
      redirect: 'manual',
      body: JSON.stringify({ hash: preview.hash }),
    });
    expect(commitRes.status).toBe(200);
    const commit = await commitRes.json();
    expect(commit.ok).toBe(true);
    expect(commit.stats.createdUsers).toBe(2);
    expect(commit.stats.createdEnrollments).toBe(2);

    // DB'da user/enroll mavjud
    const user = await fb.get('users/s0001');
    expect(user.exists()).toBe(true);
    expect(user.val().source).toBe('roster');
    expect(user.val().group).toBe('A');
    expect((await fb.get('enrollments/s0001_MATH101')).exists()).toBe(true);
    expect((await fb.get('groups/a')).exists()).toBe(true);

    // Row status + reconcile
    const statusRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/rows/status`, {
      headers: { cookie },
    });
    expect(statusRes.status).toBe(200);
    const status = await statusRes.json();
    expect(status.summary).toMatchObject({ total: 2, ok: 2, error: 0 });

    const recRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/reconcile`, {
      headers: { cookie },
    });
    const rec = await recRes.json();
    expect(rec.matched).toBe(true);
    expect(rec.actual.users).toBeGreaterThanOrEqual(2);

    // Double commit → reject
    const dupRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/commit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': token },
      redirect: 'manual',
      body: JSON.stringify({ hash: preview.hash }),
    });
    expect(dupRes.status).toBe(400);

    // Rollback → state tiklanadi
    const rbRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/rollback`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': token },
      redirect: 'manual',
      body: JSON.stringify({}),
    });
    expect(rbRes.status).toBe(200);
    expect((await rbRes.json()).ok).toBe(true);
    expect((await fb.get('users/s0001')).exists()).toBe(false);
  }, 30000);
});

describe('AUTH A-11 — invite + public aktivatsiya', () => {
  it('IDOR: student invite boshqaruviga kira olmaydi (403)', async () => {
    const { cookie, token } = await registerAndLogin(xff);
    const { sessionId } = await uploadAndMap(cookie, token, xff);

    const listRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/invites`, {
      headers: { cookie },
    });
    expect(listRes.status).toBe(403);

    const pendingRes = await fetch(`${serverUrl}/api/roster/invites/pending-summary`, {
      headers: { cookie },
    });
    expect(pendingRes.status).toBe(403);
  });

  it('invite yaratish → accept (public, guruh prefilled) → login ishlaydi → replay reject', async () => {
    const { cookie, token } = await loginAsTeacher(xff);
    const { sessionId } = await uploadAndMap(cookie, token, xff);

    // Commit
    const previewRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/preview`, { headers: { cookie } });
    const preview = await previewRes.json();
    const commitRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/commit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': token },
      redirect: 'manual',
      body: JSON.stringify({ hash: preview.hash }),
    });
    expect((await commitRes.json()).ok).toBe(true);

    // Invite yaratish
    const invRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/invites`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': token },
      redirect: 'manual',
      body: JSON.stringify({ channel: 'email' }),
    });
    expect(invRes.status).toBe(201);
    const inv = await invRes.json();
    expect(inv.created).toBe(2);
    const token1 = inv.invites[0].token;
    expect(token1).toBeTruthy();

    // Ro'yxat
    const listRes = await fetch(`${serverUrl}/api/roster/sessions/${sessionId}/invites`, { headers: { cookie } });
    const list = await listRes.json();
    expect(list.counts.pending).toBe(2);

    // Public accept — cookie YO'Q, CSRF kerak emas
    const newUser = `talaba_${Date.now() % 1000000}`;
    const acRes = await fetch(`${serverUrl}/api/roster/invites/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'manual',
      body: JSON.stringify({ token: token1, username: newUser, password: 'parol-2026-x-uzun', consent: true }),
    });
    expect(acRes.status).toBe(200);
    const ac = await acRes.json();
    expect(ac.ok).toBe(true);
    expect(ac.group).toBe('A');

    // User yaratildi — guruh prefilled + argon2 parol
    const user = await fb.get(`users/${newUser}`);
    expect(user.exists()).toBe(true);
    expect(user.val().group).toBe('A');
    expect(user.val().password.startsWith('$argon2')).toBe(true);
    expect((await fb.get(`enrollments/${newUser}_MATH101`)).exists()).toBe(true);

    // Replay → reject (1 marta); AUTH B-13 §10: takroriy → 409 Conflict
    const replayRes = await fetch(`${serverUrl}/api/roster/invites/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'manual',
      body: JSON.stringify({ token: token1, username: `${newUser}_2`, password: 'parol-2026-x-uzun', consent: true }),
    });
    expect(replayRes.status).toBe(409);
    expect((await replayRes.json()).error).toMatch(/allaqachon ishlatilgan/);

    // Yangi user login qila oladi (aktivatsiya to'liq ishladi)
    const { csrf, cookie: ck } = await getCsrf('/user/login');
    const loginRes = await postForm('/user/login', ck, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: newUser, password: 'parol-2026-x-uzun',
    }, xff);
    expect(loginRes.status).toBe(302);

    // Revoke boshqa invite → accept reject
    const revokeRes = await fetch(`${serverUrl}/api/roster/invites/${inv.invites[1].id}/revoke`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': token },
      redirect: 'manual',
      body: JSON.stringify({}),
    });
    expect(revokeRes.status).toBe(200);
    const rvAc = await fetch(`${serverUrl}/api/roster/invites/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'manual',
      body: JSON.stringify({ token: inv.invites[1].token, username: `${newUser}_b`, password: 'parol-2026-x-uzun', consent: true }),
    });
    expect(rvAc.status).toBe(400);
    expect((await rvAc.json()).error).toMatch(/bekor qilingan/);

    // Pending summary (teacher P1) — 2 invite: 1 used + 1 revoked → 0 pending
    const pendRes = await fetch(`${serverUrl}/api/roster/invites/pending-summary`, {
      headers: { cookie },
    });
    expect(pendRes.status).toBe(200);
    const pend = await pendRes.json();
    expect(pend.totalPending).toBe(0);
  }, 30000);
});
