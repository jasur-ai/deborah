/**
 * AUTH D-26 §19 — Incident response unit testlari (runbook steps, mock).
 * ---------------------------------------------------------------------------
 *  - createIncident: append-only yozuv (type/severity validatsiya).
 *  - appendIncidentAction: timeline faqat append (overwrite yo'q).
 *  - closeIncident: postmortem + status closed.
 *  - credentialLeakResponse (§08): revokeByUser + force_password_reset.
 *  - atoBurstResponse (§09): block + revoke.
 *  - mfaEmergencyOff/On (§11): feature flag toggle + audit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const testStore = {};

vi.mock('../../../firebase/admin.js', () => {
  function navigate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
      if (current === null || typeof current !== 'object' || !(parts[i] in current))
        return { found: false, parent: current, key: parts[i] };
      if (i === parts.length - 1) return { found: true, value: current[parts[i]], parent: current, key: parts[i] };
      current = current[parts[i]];
    }
    return { found: true, value: current, parent: null, key: null };
  }
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => {
        const parts = path.split('/').filter(Boolean);
        let cur = testStore;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
      }),
    },
    default: {},
  };
});

const auditMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../../src/modules/auth/audit.js', () => ({
  audit: auditMock,
  AUDIT_ACTIONS: {
    INCIDENT_CREATED: 'incident:created',
    INCIDENT_ACTION: 'incident:action',
    INCIDENT_CLOSED: 'incident:closed',
    INCIDENT_LEAK_RESPONSE: 'incident:leak_response',
    INCIDENT_ATO_BLOCK: 'incident:ato_block',
    INCIDENT_MFA_EMERGENCY_OFF: 'incident:mfa_emergency_off',
    INCIDENT_MFA_EMERGENCY_ON: 'incident:mfa_emergency_on',
  },
  __esModule: true,
}));

const revokeByUserMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../../../src/modules/auth/session-manager.js', () => ({
  revokeByUser: revokeByUserMock,
  __esModule: true,
}));

const flagOverrides = {};
const featureFlagsMock = {
  isEnabled: vi.fn((name) => flagOverrides[name] === true),
  setOverride: vi.fn((name, val) => { flagOverrides[name] = val; }),
  clearOverride: vi.fn((name) => { delete flagOverrides[name]; }),
};
vi.mock('../../../src/config/features.js', () => ({
  default: featureFlagsMock, // real modul default export (D-26 fix)
  featureFlags: featureFlagsMock,
  __esModule: true,
}));

import {
  createIncident,
  appendIncidentAction,
  closeIncident,
  listIncidents,
  credentialLeakResponse,
  atoBurstResponse,
  mfaEmergencyOff,
  mfaEmergencyOn,
} from '../../../src/modules/auth/incident.js';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
  auditMock.mockClear();
  revokeByUserMock.mockClear();
  flagOverrides['authMfaEmergencyOff'] = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUTH D-26 §15 — incident log (append-only)', () => {
  it('createIncident → yozuv (id, type, severity, timeline boshlang\'ich)', async () => {
    const r = await createIncident({ type: 'credential_leak', severity: 'S1', owner: 'soc@edikit.uz', reason: 'HIBP alert' });
    expect(r.ok).toBe(true);
    const rec = testStore.incidents[r.id];
    expect(rec.id).toBe(r.id);
    expect(rec.type).toBe('credential_leak');
    expect(rec.severity).toBe('S1');
    expect(rec.status).toBe('open');
    expect(rec.timeline.length).toBe(1);
    expect(rec.timeline[0].action).toBe('incident:created');
    expect(auditMock).toHaveBeenCalled();
  });

  it('invalid type/severity → reject', async () => {
    expect((await createIncident({ type: 'unknown' })).ok).toBe(false);
    expect((await createIncident({ type: 'ato_burst', severity: 'S9' })).ok).toBe(false);
  });

  it('appendIncidentAction — timeline faqat APPEND (avvalgi yozuvlar saqlanadi)', async () => {
    const { id } = await createIncident({ type: 'session_hijack', severity: 'S2' });
    await appendIncidentAction(id, { action: 'revoke_sessions', actorId: 'sec' });
    await appendIncidentAction(id, { action: 'notify_user', actorId: 'sec' });
    const rec = testStore.incidents[id];
    expect(rec.timeline.map((t) => t.action)).toEqual(['incident:created', 'revoke_sessions', 'notify_user']);
  });

  it('closeIncident → status closed + postmortem + timeline append', async () => {
    const { id } = await createIncident({ type: 'email_compromise', severity: 'S2' });
    const r = await closeIncident(id, { postmortem: 'Root cause: phish; fix: ...', reviewer: 'legal@edikit.uz' });
    expect(r.ok).toBe(true);
    const rec = testStore.incidents[id];
    expect(rec.status).toBe('closed');
    expect(rec.postmortem).toContain('phish');
    expect(rec.reviewer).toBe('legal@edikit.uz');
    expect(rec.closed_at).toBeGreaterThan(0);
  });

  it('listIncidents — filter status/type + tartib', async () => {
    await createIncident({ type: 'ato_burst', severity: 'S1' });
    await createIncident({ type: 'credential_leak', severity: 'S2' });
    const all = await listIncidents();
    expect(all.length).toBe(2);
    const open = await listIncidents({ status: 'open' });
    expect(open.length).toBe(2);
    const ato = await listIncidents({ type: 'ato_burst' });
    expect(ato.length).toBe(1);
    expect(ato[0].type).toBe('ato_burst');
  });
});

describe('AUTH D-26 §08 — credential leak response', () => {
  it('revokeByUser + force_password_reset (har affected user)', async () => {
    testStore.users = { u1: {}, u2: {} };
    const r = await credentialLeakResponse({ userIds: ['u1', 'u2'], reason: 'HIBP breach' });
    expect(r.ok).toBe(true);
    expect(r.results.length).toBe(2);
    expect(revokeByUserMock).toHaveBeenCalledTimes(2);
    expect(testStore.users.u1.force_password_reset).toBeTruthy();
    expect(testStore.users.u2.force_password_reset.reason).toBe('HIBP breach');
  });

  it('userIds bo\'sh → error no_users', async () => {
    const r = await credentialLeakResponse({ userIds: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_users');
  });
});

describe('AUTH D-26 §09 — ATO burst response', () => {
  it('block (status=blocked) + revoke', async () => {
    testStore.users = { u1: {} };
    const r = await atoBurstResponse({ userIds: ['u1'] });
    expect(r.ok).toBe(true);
    expect(revokeByUserMock).toHaveBeenCalledTimes(1);
    expect(testStore.users.u1.status).toBe('blocked');
    expect(testStore.users.u1.blocked_reason).toBe('ato_burst');
  });
});

describe('AUTH D-26 §11 — MFA emergency off/on', () => {
  it('mfaEmergencyOff → flag true + audit', async () => {
    const r = await mfaEmergencyOff({ reason: 'bypass report S1' });
    expect(r.ok).toBe(true);
    expect(flagOverrides['authMfaEmergencyOff']).toBe(true);
    const lastAudit = auditMock.mock.calls[auditMock.mock.calls.length - 1][0];
    expect(lastAudit.action).toBe('incident:mfa_emergency_off');
  });

  it('mfaEmergencyOn → flag false + audit', async () => {
    await mfaEmergencyOff({ reason: 'bypass' });
    const r = await mfaEmergencyOn();
    expect(r.ok).toBe(true);
    expect(flagOverrides['authMfaEmergencyOff']).toBe(false);
  });
});
