/**
 * AUTH D-05 — Request ID + trace (integration)
 *
 * 1. Xato login → auth.login span (outcome error) yaratiladi.
 * 2. Register (mode=reg) → auth.register span (outcome success).
 * 3. trace_id auth_audit'da saqlanadi va span traceId bilan bog'lanadi (C-09).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { getSpans, clearSpans } from '../../src/telemetry/tracer.js';
import { fb } from '../../firebase/admin.js';

let app;
let httpServer;
let ipCounter = 10;
const nextIp = () => `203.0.113.${++ipCounter}`;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
}

async function registerUser(agent, username) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    mode: 'reg', consent: 'on', _csrf: csrf, username,
    email: `${username}@test.uz`, password: 'parol-2026-x-uzun', lang: 'uz',
  });
  return res;
}

describe('AUTH D-05 — trace spans + audit trace_id (integration)', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });
  beforeEach(() => {
    clearSpans();
  });

  it('xato login → auth.login span (outcome error, PII attribute yo\'q)', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: csrf, username: 'nonexistent-d05', password: 'parol-2026-x-uzun', lang: 'uz',
    });
    expect([200, 302, 401, 429].includes(res.status)).toBe(true);

    const spans = getSpans();
    const loginSpans = spans.filter((s) => s.name === 'auth.login');
    expect(loginSpans.length).toBeGreaterThan(0);
    const last = loginSpans[loginSpans.length - 1];
    expect(last.attributes['auth.outcome']).toBe('error');
    expect(last.status).toBe('error');
    // PII yo'q: parol/token span attribute'larida emas
    const raw = JSON.stringify(spans);
    expect(raw).not.toContain('parol-2026-x-uzun');
  });

  it('register → auth.register span (outcome success)', async () => {
    const agent = supertest.agent(app);
    const res = await registerUser(agent, `d05reg${Date.now() % 100000}`);
    expect([200, 302].includes(res.status)).toBe(true);

    const spans = getSpans();
    const regSpans = spans.filter((s) => s.name === 'auth.register');
    expect(regSpans.length).toBeGreaterThan(0);
    expect(regSpans[regSpans.length - 1].attributes['auth.outcome']).toBe('success');
  });

  it('trace_id auth_audit\'da saqlanadi va span traceId bilan bog\'lanadi (D-05 §13)', async () => {
    // Mavjud user + XATO parol → AUTH_LOGIN_FAIL audit (trace_id bilan) yoziladi.
    // (Nonexistent-user branch enumeration-safe — logAuthEvent chaqirmaydi.)
    const uname = `auditd05${Date.now() % 1000000}`;
    const regAgent = supertest.agent(app);
    const reg = await registerUser(regAgent, uname);
    expect([200, 302].includes(reg.status)).toBe(true);

    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: csrf, username: uname, password: 'xato-parol', lang: 'uz',
    });

    // Audit yozuvi yozilishi uchun kutiladi (fire-and-forget logAuthEvent)
    await new Promise((r) => setTimeout(r, 400));

    const snap = await fb.get('auth_audit');
    const entries = [];
    if (snap.exists()) {
      const byDay = snap.val();
      for (const day of Object.values(byDay)) {
        for (const entry of Object.values(day)) {
          if (entry && entry.trace_id) entries.push(entry);
        }
      }
    }
    expect(entries.length).toBeGreaterThan(0);
    // Audit trace_id'si mavjud span'lar ichida bo'lishi kerak (korrelyatsiya)
    const spanTraceIds = new Set(getSpans().map((s) => s.traceId));
    const matching = entries.filter((e) => spanTraceIds.has(e.trace_id));
    expect(matching.length).toBeGreaterThan(0);
  });
});
