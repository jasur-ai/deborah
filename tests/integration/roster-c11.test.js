/**
 * AUTH C-11 — Roster import admin UI + admin-session API access
 * --------------------------------------------------------------
 *  - /admin/roster sahifasi: admin auth talab qiladi; 4-til copy; JS/CSS.
 *  - Admin sessiya roster API'lariga kira oladi (requireRosterAuth — yangi):
 *    upload → map → preview → commit → rollback.
 *  - API flow'ning o'zi A-11 da to'liq testlangan — bu yerda ADMIN yoli.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import supertest from 'supertest';

let app;
let httpServer;

beforeAll(async () => {
  snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

/** Admin login — supetest agent (cookie jar) + CSRF. */
async function adminAgent() {
  const agent = supertest.agent(app);
  const page = await agent.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/admin/login').type('form').send({
    _csrf: csrf, username: 'testadmin', password: 'testpass',
  });
  expect(res.status).toBe(302);
  return agent;
}

const HEMIS_CSV = 'talaba_id,F.I.Sh,guruh,kurs,fan\n001,Aliyev Ali,A,2026,MATH101\n002,Valiyev Vali,A,2026,MATH101\n';

describe('AUTH C-11 — roster admin UI', () => {
  it('unauth /admin/roster → 302 /admin/login', async () => {
    const res = await supertest(app).get('/admin/roster').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location || '').toContain('/admin/login');
  });

  it('/admin/roster → 200, 4-til copy, JS/CSS, CSRF, A11y label', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/admin/roster');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Roster import');
    expect(res.text).toContain('/js/admin/roster.js');
    expect(res.text).toContain('/css/admin.css');
    expect(res.text).toContain('roster-file-input');
    expect(res.text).toContain('__ROSTER_COPY__');
    expect(res.text).toMatch(/window\.__CSRF_TOKEN = '[a-f0-9]{64}'/);
    // A11y: fayl tanlash label'li (input label bilan bog'langan)
    expect(res.text).toContain('for="rs-file"');
  });

  it('admin sessiya roster API: upload → map → preview → commit → rollback', async () => {
    const agent = await adminAgent();
    const page = await agent.get('/admin/roster');
    const csrf = csrfFrom(page.text);

    // Upload (multipart) — requireRosterAuth admin'ni o'tkazishi kerak
    const up = await agent
      .post('/api/roster/upload')
      .set('x-csrf-token', csrf)
      .attach('file', Buffer.from(HEMIS_CSV, 'utf8'), 'hemis-c11.csv');
    expect(up.status).toBe(201);
    const upBody = up.body;
    expect(upBody.ok).toBe(true);
    const sessionId = upBody.sessionId;
    expect(sessionId).toBeTruthy();

    // Map (auto-detect)
    const map = await agent
      .post(`/api/roster/sessions/${sessionId}/map`)
      .set('x-csrf-token', csrf)
      .send({});
    expect(map.status).toBe(200);
    expect(map.body.mapping).toBeTruthy();

    // Preview (diff + hash)
    const prev = await agent.get(`/api/roster/sessions/${sessionId}/preview`);
    expect(prev.status).toBe(200);
    expect(prev.body.hash).toBeTruthy();
    expect(prev.body.diff.summary).toBeTruthy();

    // Approve + Commit (idempotency hash bilan)
    const appr = await agent
      .post(`/api/roster/sessions/${sessionId}/approve`)
      .set('x-csrf-token', csrf)
      .send({ approve: true });
    expect(appr.status).toBe(200);

    const commit = await agent
      .post(`/api/roster/sessions/${sessionId}/commit`)
      .set('x-csrf-token', csrf)
      .send({ hash: prev.body.hash });
    expect(commit.status).toBe(200);
    expect(commit.body.ok).toBe(true);

    // DB'da yozilgan — username idKey'dan (001/002), ism display_name'da
    const usersSnap = await fb.get('users');
    let found = false;
    if (usersSnap.exists()) {
      const users = usersSnap.val();
      for (const [key, u] of Object.entries(users)) {
        if (u.source === 'roster' && String(u.display_name || '').toLowerCase().includes('aliyev')) found = true;
      }
    }
    expect(found).toBe(true);

    // Reconcile
    const rec = await agent.get(`/api/roster/sessions/${sessionId}/reconcile`);
    expect(rec.status).toBe(200);

    // Rollback → state tiklanadi
    const rb = await agent
      .post(`/api/roster/sessions/${sessionId}/rollback`)
      .set('x-csrf-token', csrf)
      .send({});
    expect(rb.status).toBe(200);
    expect(rb.body.ok).toBe(true);

    const afterSnap = await fb.get('users');
    let stillFound = false;
    if (afterSnap.exists()) {
      const users = afterSnap.val();
      for (const [key, u] of Object.entries(users)) {
        if (u.source === 'roster' && String(u.display_name || '').toLowerCase().includes('aliyev')) stillFound = true;
      }
    }
    expect(stillFound).toBe(false);
  });
});
