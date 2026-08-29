/**
 * AUTH D-23 §19 — DSAR user service unit testlari.
 * ---------------------------------------------------------------------------
 *  - collectUserPii: eksport to'liqligi; parol hash qaytmaydi.
 *  - softDeleteUser: 30 kun grace + login blok.
 *  - Legal hold'da delete RAD (fail-closed).
 *  - restrictUser: privacy_restricted flag.
 *  - purgeExpiredDeletedUsers: grace o'tgan → hard purge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── FB in-memory mock ──
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
  function setAt(store, path, value) {
    const parts = path.split('/').filter(Boolean);
    let cur = store;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
  }
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => setAt(testStore, path, value)),
      update: vi.fn(async (path, patch) => {
        const r = navigate(testStore, path);
        if (r.found && typeof r.value === 'object' && r.value !== null) {
          Object.assign(r.value, JSON.parse(JSON.stringify(patch)));
        } else {
          setAt(testStore, path, patch);
        }
      }),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach((k) => delete testStore[k]);
      }),
    },
    default: {},
  };
});

vi.mock('../../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => {}),
  AUDIT_ACTIONS: {},
  __esModule: true,
}));

import {
  collectUserPii,
  softDeleteUser,
  restrictUser,
  purgeDerivedCopies,
  purgeExpiredDeletedUsers,
  getDsarStatus,
} from '../../../src/modules/privacy/dsar-user.js';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUTH D-23 §06 — collectUserPii (eksport to\'liqligi)', () => {
  it('profil + devices hash + MFA metadata yig\'iladi; parol hash qaytmaydi', async () => {
    testStore.users = {
      u1: { username: 'student42', email: 's@test.uz', password: 'argon2hash...', role: 'student', created_at: 123 },
    };
    testStore.devices = {
      u1: { d1: { fingerprint: 'a1b2c3d4', last_city: 'Toshkent', last_seen: 456 } },
    };
    testStore.mfa_totp = {
      u1: { enabled: true, backup_codes: [{ h: 'x' }, { h: 'y' }], created_at: 789 },
    };

    const r = await collectUserPii('u1');
    expect(r.ok).toBe(true);
    expect(r.data.username).toBe('student42');
    expect(r.data.email).toBe('s@test.uz');
    // PII minimal: parol hash EKSPORT QILINMAYDI
    expect(JSON.stringify(r.data)).not.toContain('argon2hash');
    // devices — faqat hash + shahar
    expect(r.data.devices[0].fingerprintHash).toBe('a1b2c3d4');
    expect(r.data.devices[0].lastCity).toBe('Toshkent');
    // MFA — secret emas, faqat metadata
    expect(r.data.mfa.enabled).toBe(true);
    expect(r.data.mfa.backupCodesCount).toBe(2);
  });

  it('mavjud bo\'lmagan user → error', async () => {
    const r = await collectUserPii('ghost');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('user_not_found');
  });

  // AUTH E-03: push token = PII (UZ qonuni) → DSAR export'ga kiradi
  it('push device tokenlar (FCM + web) eksportga kiradi (PII)', async () => {
    testStore.users = {
      u1: {
        username: 'student42', email: 's@test.uz',
        fcm_tokens: {
          t1: { token: 'fcm-token-123456', platform: 'android', created_at: 111, last_used_at: 222 },
          t2: { token: 'fcm-token-654321', platform: 'ios', created_at: 333, last_used_at: 444 },
        },
        push_subs: {
          s1: { endpoint: 'https://fcm.googleapis.com/send/x', keys: {}, created_at: 555, last_used_at: 555 },
        },
      },
    };
    const r = await collectUserPii('u1');
    expect(r.ok).toBe(true);
    expect(r.data.pushDevices).toHaveLength(2);
    expect(r.data.pushDevices[0].token).toBe('fcm-token-123456');
    expect(r.data.pushDevices[0].platform).toBe('android');
    expect(r.data.pushDevices[1].platform).toBe('ios');
    expect(r.data.webPushSubscriptions).toBe(1);
  });

  it('push token bo\'lmagan user → pushDevices []', async () => {
    testStore.users = { u1: { username: 'x', email: 'x@test.uz' } };
    const r = await collectUserPii('u1');
    expect(r.ok).toBe(true);
    expect(r.data.pushDevices).toEqual([]);
  });
});

describe('AUTH D-23 §09 — softDeleteUser (30 kun grace + login blok)', () => {
  it('delete → deleted_at + grace 30 kun + blocked (login blok)', async () => {
    testStore.users = { u1: { username: 'student42', email: 's@test.uz' } };
    const r = await softDeleteUser('u1', { reason: 'user request' });
    expect(r.ok).toBe(true);
    expect(r.graceUntil).toBeGreaterThan(Date.now());
    const user = testStore.users.u1;
    expect(user.deleted_at).toBeTruthy();
    expect(user.blocked).toBe(true);
    // login blok: checkUserLockout `status === 'blocked'` orqali ishlaydi (C-02 §10)
    expect(user.status).toBe('blocked');
    expect(user.deleted_grace_until - user.deleted_at).toBe(30 * 24 * 60 * 60 * 1000);
  });

  // AUTH E-03: soft delete'da push tokenlar darhol revoke (PII yopilishi)
  it('delete → push tokenlar darhol o\'chiriladi', async () => {
    testStore.users = {
      u1: {
        username: 'student42', email: 's@test.uz',
        fcm_tokens: { t1: { token: 'fcm-token-1' } },
        push_subs: { s1: { endpoint: 'https://x' } },
      },
    };
    const r = await softDeleteUser('u1', { reason: 'user request' });
    expect(r.ok).toBe(true);
    expect(testStore.users.u1.fcm_tokens).toBeUndefined();
    expect(testStore.users.u1.push_subs).toBeUndefined();
  });

  it('mavjud bo\'lmagan user → error', async () => {
    const r = await softDeleteUser('ghost');
    expect(r.ok).toBe(false);
  });
});

describe('AUTH D-23 §16 — legal hold', () => {
  it('legal hold bilan user delete qilolmaydi (fail-closed)', async () => {
    // data-governance service'ni mock qilamiz (legal hold active)
    vi.doMock('../../../src/modules/data-governance/data-governance.service.js', () => ({
      hasActiveLegalHold: vi.fn(async () => true),
    }));
    vi.resetModules();
    const { softDeleteUser: sd } = await import('../../../src/modules/privacy/dsar-user.js');
    testStore.users = { u1: { username: 'x' } };
    const r = await sd('u1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('legal_hold');
  });
});

describe('AUTH D-23 §10 — restrictUser', () => {
  it('restrict → privacy_restricted flag', async () => {
    testStore.users = { u1: { username: 'x' } };
    const r = await restrictUser('u1', { restrict: true });
    expect(r.ok).toBe(true);
    expect(testStore.users.u1.privacy_restricted).toBe(true);
  });

  it('unrestrict → flag false', async () => {
    testStore.users = { u1: { username: 'x', privacy_restricted: true } };
    await restrictUser('u1', { restrict: false });
    expect(testStore.users.u1.privacy_restricted).toBe(false);
  });
});

describe('AUTH D-23 §13 — derived copy purge + grace worker', () => {
  it('purgeDerivedCopies: devices + MFA + push tokenlar tozalanadi', async () => {
    testStore.devices = { u1: { d1: {} } };
    testStore.mfa_totp = { u1: { enabled: true } };
    testStore.users = {
      u1: {
        username: 'x',
        fcm_tokens: { t1: { token: 'fcm-token-1' } },
        push_subs: { s1: { endpoint: 'https://x' } },
      },
    };
    const r = await purgeDerivedCopies('u1');
    expect(r.ok).toBe(true);
    // user-ga tegishli derived copy'lar o'chirildi (parent bo'sh qolishi mumkin)
    expect(testStore.devices.u1).toBeUndefined();
    expect(testStore.mfa_totp.u1).toBeUndefined();
    // E-03: push token'lar ham tozalanadi
    expect(testStore.users.u1.fcm_tokens).toBeUndefined();
    expect(testStore.users.u1.push_subs).toBeUndefined();
    expect(r.removed.pushTokens).toBe(1);
    expect(r.removed.webPush).toBe(1);
  });

  it('purgeExpiredDeletedUsers: grace o\'tgan user hard delete qilinadi', async () => {
    const past = Date.now() - 31 * 24 * 60 * 60 * 1000;
    testStore.users = {
      old: { username: 'old', deleted_at: past, deleted_grace_until: past },
      fresh: { username: 'fresh' }, // grace yo'q — qoladi
    };
    const r = await purgeExpiredDeletedUsers(Date.now());
    expect(r.ok).toBe(true);
    expect(r.purged).toBe(1);
    expect(testStore.users.old).toBeUndefined();
    expect(testStore.users.fresh).toBeTruthy();
  });
});

describe('AUTH D-23 §11 — DSAR status', () => {
  it('getDsarStatus: holat qaytaradi', async () => {
    testStore.users = { u1: { username: 'x' } };
    const s = await getDsarStatus('u1');
    expect(s.exists).toBe(true);
    expect(s.softDeleted).toBe(false);
    expect(s.restricted).toBe(false);
  });
});
