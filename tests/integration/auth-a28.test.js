/**
 * Edikit — AUTH A-28 Risk-based auth — Integration tests
 * ---------------------------------------------------------------
 *  - Yangi qurilma (device_fp) login → session riskTier=unknown, riskStepup
 *  - /api/auth/device/trust: reauth talab → 403; reauth'dan keyin 200
 *  - Trusted device qayta login → seamless (riskTier=trusted, riskStepup=false)
 *  - Mid-session mismatch → /api/auth/device/check mismatch=true + riskFlagged
 *  - Yuqori risk (vpn+bot+new device) → login blok (renderUserLogin error)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let ipCounter = 200;
function nextIp() {
  ipCounter = 200 + ((ipCounter - 200 + 1) % 54);
  return `203.0.113.${ipCounter}`;
}

// FNV-1a ga o'xshash deterministik hash — client'ning haqiqiy FNV-1a shakli
// bilan bir xil emas (test shart emas) — faqat 16+ hex belgi bo'lishi yetarli.
const FP1 = 'a1b2c3d4e5f60718'; // 16 hex belgi
const FP2 = 'f0e1d2c3b4a59687'; // 16 hex belgi

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
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

async function loginWithDevice(username, fingerprint, extraHeaders = {}) {
  const fresh = supertest.agent(app);
  const page = await fresh.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await fresh.post('/user/login').set('x-forwarded-for', nextIp()).set(extraHeaders).type('form').send({
    _csrf: csrf, username, password: 'parol-2026-x-uzun', lang: 'uz', device_fp: fingerprint,
  });
  return { agent: fresh, res };
}

describe('AUTH A-28 — Risk-based auth + device fingerprint', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('yangi qurilma login → riskTier=unknown, riskStepup=true (step-up)', async () => {
    const agent = supertest.agent(app);
    const uname = `a28a_${Date.now() % 1000000}`;
    await registerUser(agent, uname);

    const { agent: loginAgent, res } = await loginWithDevice(uname, FP1);
    expect(res.status).toBe(302);

    // Panel'ga kirishda risk status
    await loginAgent.get('/user/panel');
    const status = await loginAgent.get('/api/auth/device/status');
    expect(status.body.ok).toBe(true);
    expect(status.body.riskTier).toBe('unknown');
    expect(status.body.riskStepup).toBe(true);
    expect(status.body.riskFlagged).toBe(false);
    expect(status.body.fingerprintHash).toBe(FP1);
  });

  it('device trust: reauth talab qilinadi (403), reauth\'dan keyin 200', async () => {
    const agent = supertest.agent(app);
    const uname = `a28b_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    const { agent: loginAgent } = await loginWithDevice(uname, FP1);
    await loginAgent.get('/user/panel');

    const csrf = csrfFromPanel((await loginAgent.get('/user/panel')).text);
    // Reauth'siz → 403 (requireRecentAuth)
    const noReauth = await loginAgent.post('/api/auth/device/trust').set('x-csrf-token', csrf).send({});
    expect(noReauth.status).toBe(403);

    // Reauth (parol)
    const reauth = await loginAgent.post('/api/auth/reauth').set('x-csrf-token', csrf).send({ password: 'parol-2026-x-uzun' });
    expect(reauth.status).toBe(200);

    // Trust
    const trust = await loginAgent.post('/api/auth/device/trust').set('x-csrf-token', csrf).send({});
    expect(trust.status).toBe(200);
    expect(trust.body.ok).toBe(true);

    // Status: trusted
    const status = await loginAgent.get('/api/auth/device/status');
    expect(status.body.riskTier).toBe('trusted');
    expect(status.body.riskStepup).toBe(false);
  });

  it('trusted device qayta login → seamless (riskTier=trusted, riskStepup=false)', async () => {
    const agent = supertest.agent(app);
    const uname = `a28c_${Date.now() % 1000000}`;
    await registerUser(agent, uname);

    // 1-login: yangi qurilma → unknown
    await loginWithDevice(uname, FP1);
    // Trust (reauth bilan)
    const { agent: agent2 } = await loginWithDevice(uname, FP1);
    await agent2.get('/user/panel');
    const csrf = csrfFromPanel((await agent2.get('/user/panel')).text);
    const ra = await agent2.post('/api/auth/reauth').set('x-csrf-token', csrf).send({ password: 'parol-2026-x-uzun' });
    expect(ra.status).toBe(200);
    const trust = await agent2.post('/api/auth/device/trust').set('x-csrf-token', csrf).send({});
    expect(trust.status).toBe(200);

    // 2-login (trusted): seamless
    const { agent: agent3, res: res3 } = await loginWithDevice(uname, FP1);
    expect(res3.status).toBe(302);
    await agent3.get('/user/panel');
    const status = await agent3.get('/api/auth/device/status');
    expect(status.body.riskTier).toBe('trusted');
    expect(status.body.riskStepup).toBe(false);
  });

  it('mid-session mismatch → /api/auth/device/check mismatch=true + riskFlagged', async () => {
    const agent = supertest.agent(app);
    const uname = `a28d_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    const { agent: loginAgent } = await loginWithDevice(uname, FP1);
    await loginAgent.get('/user/panel');

    const csrf = csrfFromPanel((await loginAgent.get('/user/panel')).text);
    // Boshqa fingerprint → mismatch
    const check = await loginAgent.post('/api/auth/device/check').set('x-csrf-token', csrf).send({ fingerprint: FP2 });
    expect(check.status).toBe(200);
    expect(check.body.ok).toBe(true);
    expect(check.body.mismatch).toBe(true);

    // Status: riskFlagged
    const status = await loginAgent.get('/api/auth/device/status');
    expect(status.body.riskFlagged).toBe(true);

    // Xuddi shu fingerprint → mismatch yo'q
    const ok = await loginAgent.post('/api/auth/device/check').set('x-csrf-token', csrf).send({ fingerprint: FP1 });
    expect(ok.body.mismatch).toBe(false);
  });

  it('yuqori risk (vpn+bot+yangi qurilma) → login blok (session berilmaydi)', async () => {
    const agent = supertest.agent(app);
    const uname = `a28e_${Date.now() % 1000000}`;
    await registerUser(agent, uname);

    // new_device(0.3) + vpn_proxy(0.3) + bot(0.6) = 1.2 → clamp 1 → suspicious → block
    const { agent: blocked, res } = await loginWithDevice(uname, FP2, {
      'x-risk-vpn': '1',
      'x-risk-bot': '1',
    });
    // Error sahifasi (200) — login o'tmagan
    expect(res.status).toBe(200);
    expect(res.text).toContain('blokladi'); // uz copy riskBlocked

    // Session berilmagan — panel'ga kirish rad etiladi (401 yoki redirect)
    const panel = await blocked.get('/user/panel');
    expect([301, 302, 401]).toContain(panel.status);
  });

  it('fingerprintsiz login (privacy blocker) → fail-safe seamless', async () => {
    const agent = supertest.agent(app);
    const uname = `a28f_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    // device_fp yuborilmaydi → risk signal yo'q → trusted/allow
    const fresh = supertest.agent(app);
    const page = await fresh.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await fresh.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: csrf, username: uname, password: 'parol-2026-x-uzun', lang: 'uz',
    });
    expect(res.status).toBe(302);
    await fresh.get('/user/panel');
    const status = await fresh.get('/api/auth/device/status');
    // session.deviceFp null — riskTier null (riskDecision.tier allow bo'lsa ham deviceFp null)
    expect(status.body.fingerprintHash).toBeNull();
    expect(status.body.riskStepup).toBe(false);
  });
});

// Panel CSRF — window.__CSRF_TOKEN yoki window.__CSRF_TOKEN__ (ikki variant)
function csrfFromPanel(html) {
  const t = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return t ? (t[2] || t[3]) : '';
}
