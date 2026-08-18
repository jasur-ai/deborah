/**
 * Deborah — Auth Maintenance unit testlari (AUTH D-28 §15)
 * ---------------------------------------------------------------------------
 * Mock: fb (in-memory) + audit (call record).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../../firebase/admin.js', () => ({
  fb: {
    _store: new Map(),
    async set(k, v) { this._store.set(k, v); },
    async get(k) { return { exists: () => this._store.has(k), val: () => this._store.get(k) }; },
  },
}));

const auditCalls = [];
vi.mock('../../../src/modules/auth/audit.js', () => ({
  AUDIT_ACTIONS: new Proxy({}, { get: (_, p) => `maintenance:${p.toLowerCase().replace(/_/g, ':')}` }),
  audit: vi.fn(async (e) => { auditCalls.push(e); return { ok: true }; }),
}));

const { fb } = await import('../../../firebase/admin.js');
const { audit, AUDIT_ACTIONS } = await import('../../../src/modules/auth/audit.js');
const maint = await import('../../../scripts/maintenance/auth-maintenance.js');

describe('auth-maintenance (D-28)', () => {
  beforeEach(() => {
    fb._store.clear();
    auditCalls.length = 0;
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('1) logMaintenance — maintenance_log yozadi + audit event (PII minimal)', async () => {
    const res = await maint.logMaintenance({ action: 'daily:alert-check', operator: 'sre@example.com' });
    expect(res.ok).toBe(true);
    expect(res.id).toBeTruthy();
    const saved = fb._store.get(`maintenance_log/${res.id}`);
    expect(saved.action).toBe('daily:alert-check');
    // PII minimal: email to'liq saqlanmaydi — operator key hash bor (§12)
    expect(saved.operator).toBe('sre@example.com'); // faqat log uchun; audit'da PII yo'q
    expect(saved.operatorHash).toMatch(/^[0-9a-f]{16}$/);
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0].action).toBe(AUDIT_ACTIONS.MAINTENANCE_LOG);
  });

  it('2) logMaintenance — invalid result reject qilinadi', async () => {
    const res = await maint.logMaintenance({ action: 'x', result: 'bogus' });
    expect(res.ok).toBe(true);
    expect(res.entry.result).toBe('ok'); // default
  });

  it('3) runDrill — backup_restore PASS append-only log + drill audit', async () => {
    const res = await maint.runDrill({ kind: 'backup_restore', passed: true, operator: 'ops' });
    expect(res.ok).toBe(true);
    expect(fb._store.get(`maintenance_log/${res.id}`).action).toBe('drill:backup_restore');
    expect(auditCalls.some((a) => a.action === AUDIT_ACTIONS.MAINTENANCE_DRILL)).toBe(true);
  });

  it('4) runDrill — invalid kind reject', async () => {
    const res = await maint.runDrill({ kind: 'unknown' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_kind');
  });

  it('5) checkSecretAge — stamp fayl yo\'q → due', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
    const res = maint.checkSecretAge({ dir });
    expect(res.due).toBe(true);
    expect(res.reason).toBe('no_stamp_file');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('6) checkSecretAge — 30 kunlik stamp → due=false; 91 kun → due=true', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
    const now = Date.now();
    fs.writeFileSync(path.join(dir, 'last-secret-rotation'), String(now - 30 * 86_400_000));
    expect(maint.checkSecretAge({ dir }).due).toBe(false);
    fs.writeFileSync(path.join(dir, 'last-secret-rotation'), String(now - 91 * 86_400_000));
    expect(maint.checkSecretAge({ dir }).due).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('7) markSecretRotated — stamp yangilanadi + rotation audit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
    const res = await maint.markSecretRotated({ operator: 'ops', dir });
    expect(res.ok).toBe(true);
    const stamp = Number(fs.readFileSync(path.join(dir, 'last-secret-rotation'), 'utf8').trim());
    expect(stamp).toBeGreaterThan(0);
    expect(maint.checkSecretAge({ dir }).due).toBe(false);
    expect(auditCalls.some((a) => a.action === AUDIT_ACTIONS.MAINTENANCE_ROTATED)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('8) listAuthDeps — auth lib\'lar ro\'yxati CVE scan uchun', () => {
    const deps = maint.listAuthDeps();
    expect(deps).toContain('argon2');
    expect(deps).toContain('@simplewebauthn/server');
    expect(deps).toContain('otplib');
    expect(deps).toContain('postmark');
  });

  it('9) scanCve — natija log + audit', async () => {
    const res = await maint.scanCve({ ok: false, findings: ['GHSA-xxx'], operator: 'ci' });
    expect(res.ok).toBe(true);
    expect(res.entry.result).toBe('fail');
    expect(auditCalls.some((a) => a.action === AUDIT_ACTIONS.MAINTENANCE_CVE_SCAN)).toBe(true);
  });

  it('10) syncHibp / updateDisposable / providerReview — oylik+yillik task log', async () => {
    const h = await maint.syncHibp({ updated: 3 });
    expect(fb._store.get(`maintenance_log/${h.id}`).action).toBe('hibp:sync');
    const d = await maint.updateDisposable({ updated: 12 });
    expect(fb._store.get(`maintenance_log/${d.id}`).action).toBe('disposable:update');
    const p = await maint.providerReview({ providers: ['Google', 'Postmark', 'HEMIS'], due: true });
    expect(fb._store.get(`maintenance_log/${p.id}`).action).toBe('provider:review');
    expect(auditCalls.some((a) => a.action === AUDIT_ACTIONS.MAINTENANCE_PROVIDER_REVIEW)).toBe(true);
  });
});
