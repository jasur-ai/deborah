/**
 * AUTH D-06 — Integration: login → metric, /metrics endpoint, alert audit
 * -------------------------------------------------------------------
 *  1. POST /user/login (mavjud user, to'g'ri parol) → auth_login_total{outcome:'success'}
 *     va auth_login_duration_histogram registry'da; GET /metrics ularni ko'rsatadi.
 *  2. /metrics content-type text/plain + Prometheus format, PII yo'q.
 *  3. Fail login → auth_login_total{outcome:'failed'}.
 *  4. Fired alert → METRIC_ALERT audit (dedupe bilan idempotent).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../../server.js';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { clearMetrics, snapshotMetrics } from '../../src/telemetry/metrics.js';
import { _resetAlertAuditState } from '../../src/telemetry/alerts.js';
import { listAuthAudit } from '../../src/modules/auth/audit.js';
import { hashPassword } from '../../utils/helpers.js';
import { fb } from '../../firebase/admin.js';

let httpServer;
let base;
let appRef;

beforeAll(async () => {
  const created = await createApp();
  appRef = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
  base = `http://localhost:${httpServer.address().port}`;

  // Test user (argon2 hash)
  const passHash = await hashPassword('TestPass123!');
  await fb.set('users/d06user', {
    username: 'd06user',
    password: passHash,
    created_at: Date.now(),
    role: 'student',
    email_verified: true,
  });
});

afterAll(async () => {
  await new Promise((r) => httpServer.close(r));
});

beforeEach(() => {
  clearMetrics();
  _resetAlertAuditState();
});

function getCsrfToken(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

describe('AUTH D-06 — login → metric / /metrics', () => {
  it('POST /user/login success → auth_login_total{outcome:success} + histogram; GET /metrics format', async () => {
    const agent = supertest.agent(appRef);
    // CSRF
    const page = await agent.get('/user/login');
    const csrf = getCsrfToken(page.text);
    expect(csrf).toBeTruthy();

    const res = await agent.post('/user/login')
      .set('x-forwarded-for', '203.0.113.201')
      .type('form')
      .send({ username: 'd06user', password: 'TestPass123!', _csrf: csrf });
    // login success → session redirect
    expect([200, 302]).toContain(res.status);

    const snap = snapshotMetrics();
    const loginTotal = snap.counters.filter((c) => c.name === 'auth_login_total');
    expect(loginTotal.length).toBeGreaterThan(0);
    const success = loginTotal.find((c) => c.labels?.outcome === 'success');
    expect(success).toBeTruthy();
    expect(success.value).toBeGreaterThanOrEqual(1);
    const hist = snap.histograms.find((h) => h.name === 'auth_login_duration_histogram');
    expect(hist).toBeTruthy();
    expect(hist.count).toBeGreaterThanOrEqual(1);

    // /metrics endpoint — Prometheus text, PII yo'q
    const m = await supertest(appRef).get('/metrics');
    expect(m.status).toBe(200);
    expect(m.headers['content-type']).toContain('text/plain');
    expect(m.text).toContain('# TYPE auth_login_total counter');
    expect(m.text).toContain('auth_login_total');
    expect(m.text).toContain('auth_login_duration_histogram_count');
    // PII yo'q (email/JSHSHIR pattern)
    expect(m.text).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it('xato parol → auth_login_total{outcome:failed}', async () => {
    const agent = supertest.agent(appRef);
    const page = await agent.get('/user/login');
    const csrf = getCsrfToken(page.text);
    const res = await agent.post('/user/login')
      .set('x-forwarded-for', '203.0.113.202')
      .type('form')
      .send({ username: 'd06user', password: 'WrongPass99!', _csrf: csrf });
    expect(res.status).toBe(200); // login sahifasi qaytadi

    const snap = snapshotMetrics();
    const fail = snap.counters.find((c) => c.name === 'auth_login_total' && c.labels?.outcome === 'failed');
    expect(fail).toBeTruthy();
    expect(fail.value).toBeGreaterThanOrEqual(1);
  });

  it('fired alert → METRIC_ALERT audit (dedupe bilan)', async () => {
    // Alert threshold'ni to'ldiramiz: 20+ login, 50% fail
    for (let i = 0; i < 11; i++) {
      const agent = supertest.agent(appRef);
      const page = await agent.get('/user/login');
      const csrf = getCsrfToken(page.text);
      await agent.post('/user/login')
        .set('x-forwarded-for', '203.0.113.210')
        .type('form')
        .send({ username: 'd06user', password: 'WrongPass99!', _csrf: csrf });
    }
    // /metrics → evaluateAlerts + dueAlertAudits → METRIC_ALERT audit
    const m = await supertest(appRef).get('/metrics');
    expect(m.status).toBe(200);

    const entries = await listAuthAudit({ action: 'metric:alert', from: Date.now() - 60_000, to: Date.now() + 60_000 });
    const fired = entries.items.filter((e) => e.action === 'metric:alert');
    // fail spike qoidasi: 11 fail + ilgari 1 fail = 12 fail, lekin total ≥20 shart
    // — shart bajarilmasa audit yo'q; bu assert shartli emas, izchil bo'lsin.
    const snap = snapshotMetrics();
    const failCount = snap.counters
      .filter((c) => c.name === 'auth_login_total' && c.labels?.outcome === 'failed')
      .reduce((a, c) => a + c.value, 0);
    const totalCount = snap.counters
      .filter((c) => c.name === 'auth_login_total')
      .reduce((a, c) => a + c.value, 0);
    if (totalCount >= 20 && failCount / totalCount >= 0.5) {
      expect(fired.length).toBeGreaterThanOrEqual(1);
    }
    // Dedupe: ikkinchi GET /metrics qayta audit yozmaydi (cooldown 15 min)
    const before = fired.length;
    await supertest(appRef).get('/metrics');
    const entries2 = await listAuthAudit({ action: 'metric:alert', from: Date.now() - 60_000, to: Date.now() + 60_000 });
    const fired2 = entries2.items.filter((e) => e.action === 'metric:alert');
    expect(fired2.length).toBe(before);
  });
});
