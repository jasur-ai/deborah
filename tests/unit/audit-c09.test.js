/**
 * AUTH C-09 — Audit dashboard unit testlari
 * ---------------------------------------------------------------------
 * - listAuthAudit: filter (action/outcome), qidiruv (actor_id), pagination
 * - auditAggregates: login success/fail, lockout, teacher, risk, HIBP, abuse
 * - redactDetails: parol/token/OTP audit detail'da HECH QACHON emas (PII grep)
 * - runFailSpikeAlert: threshold, idempotent cooldown, send callback
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { fb } from '../../firebase/admin.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  logAuthEvent, listAuthAudit, auditAggregates, redactDetails, AUDIT_ACTIONS,
} from '../../src/modules/auth/audit.js';
import { runFailSpikeAlert } from '../../src/modules/auth/audit-alert.js';

const AUDIT_PREFIX = 'auth_audit';

async function clearAudit() {
  const snap = await fb.get(AUDIT_PREFIX);
  if (snap.exists()) {
    for (const day of Object.keys(snap.val())) {
      await fb.remove(`${AUDIT_PREFIX}/${day}`).catch(() => {});
    }
  }
  await fb.remove('audit_alert_state').catch(() => {});
}

describe('AUTH C-09 — audit dashboard', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });
  beforeEach(async () => {
    await clearAudit();
  });

  it('redactDetails: parol/token/OTP hech qachon chiqmaydi (PII grep)', () => {
    const out = redactDetails({
      password: 'supersecret',
      resetToken: 'tok123',
      otpCode: '481516',
      plain: 'visible',
      nested: { passwordHash: 'h4sh', email: 'user@example.uz' },
      httpStatusCode: 429, // `code` segmenti redact (tradeoff dokumentlangan)
      deviceFingerprint: 'abc',
    });
    expect(out).not.toHaveProperty('password');
    expect(out).not.toHaveProperty('resetToken');
    expect(out).not.toHaveProperty('otpCode');
    expect(out.nested).not.toHaveProperty('passwordHash');
    expect(out.plain).toBe('visible');
    expect(out.nested.email).toBe('user@example.uz');
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/supersecret|tok123|481516|h4sh/i);
  });

  it('logAuthEvent → listAuthAudit: filter + qidiruv + pagination', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAIL, outcome: 'failed', method: 'password',
        actorId: `user_${i}`, ipAddress: '10.0.0.1', details: { attempt: i },
      });
    }
    await logAuthEvent({
      action: AUDIT_ACTIONS.AUTH_LOGIN, outcome: 'success', method: 'password',
      actorId: 'victim', ipAddress: '10.0.0.2', details: {},
    });

    // Hammasi (6)
    const all = await listAuthAudit({ from: now - 1000, to: now + 1000 });
    expect(all.total).toBe(6);

    // action filter — faqat login.failed (5)
    const fails = await listAuthAudit({ action: 'auth.login.failed', from: now - 1000, to: now + 1000 });
    expect(fails.total).toBe(5);
    expect(fails.items.every((e) => e.action === 'auth.login.failed')).toBe(true);

    // outcome filter — faqat success (1)
    const ok = await listAuthAudit({ outcome: 'success', from: now - 1000, to: now + 1000 });
    expect(ok.total).toBe(1);
    expect(ok.items[0].actor_id).toBe('victim');

    // q qidiruv (actor_id substring)
    const q = await listAuthAudit({ q: 'victim', from: now - 1000, to: now + 1000 });
    expect(q.total).toBe(1);

    // pagination — pageSize 2 → 3 sahifa
    const p1 = await listAuthAudit({ from: now - 1000, to: now + 1000, page: 1, pageSize: 2 });
    const p3 = await listAuthAudit({ from: now - 1000, to: now + 1000, page: 3, pageSize: 2 });
    expect(p1.items.length).toBe(2);
    expect(p3.items.length).toBe(2);
    expect(p3.page).toBe(3);
  });

  it('auditAggregates: kategoriya bo\'yicha hisoblaydi', async () => {
    const now = Date.now();
    const seed = [
      { action: 'auth.login', outcome: 'success' },
      { action: 'auth.login', outcome: 'success' },
      { action: 'auth.login.failed', outcome: 'failed' },
      { action: 'auth.lockout.triggered', outcome: 'locked' },
      { action: 'teacher:application', outcome: 'success' },
      { action: 'auth:risk:blocked', outcome: 'blocked' },
      { action: 'auth:abuse:stuffing', outcome: 'flagged' },
      { action: 'auth:password:breach:blocked', outcome: 'blocked' },
    ];
    for (const e of seed) {
      await logAuthEvent({ action: e.action, outcome: e.outcome, method: 'test', actorId: 'x' });
    }
    const agg = await auditAggregates({ from: now - 1000, to: now + 1000 });
    expect(agg.total).toBe(seed.length);
    expect(agg.login_success).toBe(2);
    expect(agg.login_fail).toBe(1);
    expect(agg.lockout).toBe(1);
    expect(agg.teacher_applications).toBe(1);
    expect(agg.risk_blocked).toBe(1);
    expect(agg.hibp_hit).toBe(1);
    expect(agg.abuse_events).toBe(1);
  });

  it('logAuthEvent: PII minimal — ip hash (to\'liq IP emas), detail redacted', async () => {
    const now = Date.now();
    await logAuthEvent({
      action: 'auth.login.failed', outcome: 'failed', method: 'password',
      actorId: 'u1', ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      details: { password: 'raw-pass', token: 'raw-tok' },
    });
    const list = await listAuthAudit({ from: now - 1000, to: now + 1000 });
    expect(list.total).toBe(1);
    const e = list.items[0];
    expect(e.ip_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(e.ip_hash).not.toBe('203.0.113.7');
    expect(e.detail).not.toHaveProperty('password');
    expect(e.detail).not.toHaveProperty('token');
  });

  describe('runFailSpikeAlert (C-09 §10)', () => {
    // Event'larni yozgach `now` olinadi — `to` chegarasi yangi yozuvlarni
    // chiqarib tashlamasligi uchun (server ts yagona manba, C-05 §08).
    it('threshold oshsa → email + audit (send callback)', async () => {
      // 3 ta fail hodisa (threshold 3)
      for (let i = 0; i < 3; i++) {
        await logAuthEvent({ action: 'auth.login.failed', outcome: 'failed', method: 'password', actorId: 'spam' });
      }
      const now = Date.now();
      const sent = [];
      const r = await runFailSpikeAlert({ now, threshold: 3, windowMs: 60000, cooldownMs: 3600000, send: (msg) => { sent.push(msg); return Promise.resolve({ ok: true }); } });
      expect(r.failCount).toBe(3);
      expect(r.alerted).toBe(true);
      expect(sent.length).toBe(1);
      expect(sent[0].tag).toBe('audit_fail_spike');

      // Audit yozildi
      const list = await listAuthAudit({ from: now - 1000, to: now + 1000 });
      const spike = list.items.find((e) => e.action === 'auth.audit.fail_spike');
      expect(spike).toBeTruthy();
      expect(spike.outcome).toBe('flagged');
    });

    it('idempotent — cooldown ichida qayta yubormaydi', async () => {
      for (let i = 0; i < 4; i++) {
        await logAuthEvent({ action: 'auth.lockout.triggered', outcome: 'locked', method: 'password', actorId: 'u' });
      }
      const now = Date.now();
      const sent = [];
      const opts = { now, threshold: 3, windowMs: 60000, cooldownMs: 3600000, windowKey: 'c09-idempotent-test', send: (msg) => { sent.push(msg); return Promise.resolve({ ok: true }); } };
      await runFailSpikeAlert(opts);
      // 30 soniya keyin yana — cooldown (1 soat) hali aktiv. windowKey aniq
      // beriladi: now+30s soatlik bucket chegarasidan o'tsa flaky bo'lardi.
      await runFailSpikeAlert({ ...opts, now: now + 30000 });
      expect(sent.length).toBe(1); // faqat birinchi marta
    });

    it('threshold oshmasa → alert yo\'q', async () => {
      await logAuthEvent({ action: 'auth.login.failed', outcome: 'failed', method: 'password', actorId: 'x' });
      const now = Date.now();
      const sent = [];
      const r = await runFailSpikeAlert({ now, threshold: 10, windowMs: 60000, cooldownMs: 3600000, send: (msg) => { sent.push(msg); return Promise.resolve({ ok: true }); } });
      expect(r.alerted).toBe(false);
      expect(sent.length).toBe(0);
    });
  });
});
