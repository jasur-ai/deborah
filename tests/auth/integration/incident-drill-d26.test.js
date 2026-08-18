/**
 * AUTH D-26 §06-§11 — Incident drill integration (real hermetic DB, mock yo'q).
 * ---------------------------------------------------------------------------
 *  - Full lifecycle: create → append (append-only) → close + postmortem.
 *  - credentialLeakResponse (§08): haqiqiy user sessiyalari revoke +
 *    force_password_reset yozuvi.
 *  - atoBurstResponse (§09): status='blocked' + sessiya revoke.
 *  - mfaEmergencyOff/On (§11): authMfaEmergencyOff flag toggle.
 *  - HERMETIC: LOCAL_DB_FILE=/tmp — data/db.json'ga TEGMAYDI (parallel-safe).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync } from 'node:fs';

const DB_FILE = '/tmp/deborah-d26-drill-db.json';

let fb;
let recordSession;
let getUserSessions;
let incident;

beforeAll(async () => {
  // LOCAL_DB_FILE import'DAN OLDIN — firebase/local-db.js uni module load'da o'qiydi
  process.env.LOCAL_DB_FILE = DB_FILE;
  process.env.NODE_ENV = 'test';
  rmSync(DB_FILE, { force: true });

  const admin = await import('../../../firebase/admin.js');
  fb = admin.fb;
  const sm = await import('../../../src/modules/auth/session-manager.js');
  recordSession = sm.recordSession;
  getUserSessions = sm.getUserSessions;
  incident = await import('../../../src/modules/auth/incident.js');
  // /tmp papkasi mavjud bo'lishi kerak (Windows'da D:\tmp o'rniga C:\tmp emas —
  // LOCAL_DB_FILE absolute path; resolve() uni shunday ishlatadi)
}, 30000);

afterAll(async () => {
  try { rmSync(DB_FILE, { force: true }); } catch (_) { /* ok */ }
});

describe('AUTH D-26 §06/§07/§15 — incident lifecycle (append-only)', () => {
  let incidentId;

  it('1) createIncident (credential_leak, S1) → open + timeline boshlanadi', async () => {
    const r = await incident.createIncident({
      type: 'credential_leak', severity: 'S1', owner: 'dri-1', reason: 'HIBP alert',
    });
    expect(r.ok).toBe(true);
    expect(r.record.status).toBe('open');
    expect(r.record.type).toBe('credential_leak');
    expect(r.record.severity).toBe('S1');
    expect(r.record.timeline).toHaveLength(1);
    expect(r.record.timeline[0].action).toBe('incident:created');
    incidentId = r.id;
  });

  it('2) appendIncidentAction ×2 → timeline APPEND-ONLY (3 ta, tartib saqlanadi)', async () => {
    await incident.appendIncidentAction(incidentId, { action: 'sessions:revoked', actorId: 'dri-1' });
    await incident.appendIncidentAction(incidentId, { action: 'notify:sent', actorId: 'ops-1' });
    const rec = (await incident.listIncidents({ status: 'open' }))[0];
    expect(rec.timeline).toHaveLength(3);
    expect(rec.timeline.map((t) => t.action)).toEqual(['incident:created', 'sessions:revoked', 'notify:sent']);
  });

  it('3) closeIncident → closed + postmortem + reviewer (2-kishi qoidasi)', async () => {
    const r = await incident.closeIncident(incidentId, {
      postmortem: 'Kompromat parol HIBP da topildi; revoke+reset bajarildi; fix: blacklist.',
      reviewer: 'auth-owner',
    });
    expect(r.ok).toBe(true);
    expect(r.record.status).toBe('closed');
    expect(r.record.postmortem).toContain('HIBP');
    expect(r.record.reviewer).toBe('auth-owner');
    expect(r.record.timeline.at(-1).action).toBe('incident:closed');
  });
});

describe('AUTH D-26 §08/§09 — response drill (real session/status)', () => {
  it('4) credentialLeakResponse → user sessiyalari revoke + force_password_reset', async () => {
    const uid = 'drill-leak-user';
    await fb.set(`users/${uid}`, { username: 'drill_leak', status: 'active' });
    await recordSession({ userId: uid, sessionId: 'leak-sess-1', ipAddress: '203.0.113.1', authMethod: 'password' });
    await recordSession({ userId: uid, sessionId: 'leak-sess-2', ipAddress: '203.0.113.2', authMethod: 'google' });
    expect(Object.keys(await getUserSessions(uid))).toHaveLength(2);

    const r = await incident.credentialLeakResponse({ userIds: [uid], reason: 'HIBP' });
    expect(r.ok).toBe(true);
    expect(r.results[0].ok).toBe(true);
    // 1) Barcha sessiyalar revoke
    const after = await getUserSessions(uid);
    expect(Object.keys(after)).toHaveLength(0);
    // 2) Forced reset — keyingi login'da majburiy parol yangilash
    const reset = await fb.get(`users/${uid}/force_password_reset`);
    expect(reset.exists()).toBe(true);
    expect(reset.val().reason).toBe('HIBP');
  });

  it('5) atoBurstResponse → status blocked + sessiya revoke (C-02 permanent)', async () => {
    const uid = 'drill-ato-user';
    await fb.set(`users/${uid}`, { username: 'drill_ato', status: 'active' });
    await recordSession({ userId: uid, sessionId: 'ato-sess-1', ipAddress: '198.51.100.7', authMethod: 'password' });

    const r = await incident.atoBurstResponse({ userIds: [uid] });
    expect(r.ok).toBe(true);
    expect(Object.keys(await getUserSessions(uid))).toHaveLength(0);
    const st = await fb.get(`users/${uid}/status`);
    expect(st.val()).toBe('blocked');
  });

  it('6) bo\'sh userIds → no_users (fail-closed)', async () => {
    const r = await incident.credentialLeakResponse({ userIds: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_users');
  });
});

describe('AUTH D-26 §11 — MFA emergency off/on', () => {
  it('7) mfaEmergencyOff → authMfaEmergencyOff flag ON', async () => {
    const { default: featureFlags } = await import('../../../src/config/features.js');
    featureFlags.clearOverrides();
    expect(featureFlags.isEnabled('authMfaEmergencyOff')).toBe(false);
    const r = await incident.mfaEmergencyOff({ reason: 'mfa_bypass report' });
    expect(r.ok).toBe(true);
    expect(featureFlags.isEnabled('authMfaEmergencyOff')).toBe(true);
  });

  it('8) mfaEmergencyOn → flag OFF (tiklanish)', async () => {
    const { default: featureFlags } = await import('../../../src/config/features.js');
    const r = await incident.mfaEmergencyOn();
    expect(r.ok).toBe(true);
    expect(featureFlags.isEnabled('authMfaEmergencyOff')).toBe(false);
    featureFlags.clearOverrides();
  });
});
