/**
 * AUTH D-24 §10 / D-25 §07 — Consent log unit testlari (purpose'li API).
 * ---------------------------------------------------------------------------
 *  - recordConsent: users/{key}/consents/{purpose} (version + ip_hash).
 *  - Legacy (D-24) users/{key}/consent o'qiladi (migratsiya).
 *  - hasCurrentConsent: versiya mos bo'lsa true (DPIA D-25 bog'lanish).
 *  - isConsentGiven: checkbox qiymatlari ('on'/'true'/true/1).
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
  AUDIT_ACTIONS: { CONSENT_GRANTED: 'consent:granted', CONSENT_REVOKED: 'consent:revoked', CONSENT_VERSION_BUMPED: 'consent:version_bumped' },
  __esModule: true,
}));

import {
  recordConsent,
  getConsent,
  hasCurrentConsent,
  isConsentGiven,
  CONSENT_VERSION,
  CONSENT_PURPOSES,
} from '../../../src/modules/legal/consent.js';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
  auditMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUTH D-24 §10 / D-25 §07 — recordConsent (purpose)', () => {
  it('users/{key}/consents/{purpose} yoziladi (version + ip_hash + lang)', async () => {
    const r = await recordConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY, { lang: 'uz', ipHash: 'ab12' });
    expect(r.ok).toBe(true);
    expect(r.purpose).toBe('privacy_policy_v1');
    const c = testStore.users.u1.consents.privacy_policy_v1;
    expect(c.version).toBe(CONSENT_VERSION);
    expect(c.granted_at).toBeGreaterThan(0);
    expect(c.ip_hash).toBe('ab12');
    expect(c.revoked_at).toBeNull();
    expect(c.lang).toBe('uz');
  });

  it('audit consent:granted chaqiriladi (purpose bilan)', async () => {
    await recordConsent('u1', CONSENT_PURPOSES.TELEGRAM, { lang: 'en' });
    expect(auditMock).toHaveBeenCalledTimes(1);
    const [arg] = auditMock.mock.calls[0];
    expect(arg.action).toBe('consent:granted');
    expect(arg.userId).toBe('u1');
    expect(arg.details.purpose).toBe('telegram');
  });

  it('idempotent — qayta rozilik yangilaydi; versiya o\'zgarsa consent:version_bumped', async () => {
    await recordConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY, { lang: 'uz' });
    auditMock.mockClear();
    await recordConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY, { lang: 'ru', version: '2.0.0' });
    const [arg] = auditMock.mock.calls[0];
    expect(arg.action).toBe('consent:version_bumped');
    const c = testStore.users.u1.consents.privacy_policy_v1;
    expect(c.lang).toBe('ru');
    expect(c.version).toBe('2.0.0');
  });
});

describe('AUTH D-24 §10 — holat', () => {
  it('getConsent: consent yo\'q → granted false', async () => {
    const s = await getConsent('ghost', CONSENT_PURPOSES.PRIVACY_POLICY);
    expect(s.granted).toBe(false);
  });

  it('getConsent: bor → versiya + sana', async () => {
    testStore.users = { u1: { consents: { privacy_policy_v1: { version: '1.0.0', granted_at: 123, ip_hash: null, revoked_at: null } } } };
    const s = await getConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY);
    expect(s.granted).toBe(true);
    expect(s.version).toBe('1.0.0');
    expect(s.grantedAt).toBe(123);
    expect(s.revokedAt).toBeNull();
  });

  it('legacy (D-24) users/{key}/consent o\'qiladi — migratsiya', async () => {
    testStore.users = { u1: { consent: { version: '1.0.0', acceptedAt: 123, lang: 'uz' } } };
    const s = await getConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY);
    expect(s.granted).toBe(true);
    expect(s.version).toBe('1.0.0');
    expect(s.legacy).toBe(true);
  });

  it('hasCurrentConsent: joriy versiya mos → true; eski versiya → false', async () => {
    testStore.users = { u1: { consents: { privacy_policy_v1: { version: CONSENT_VERSION, granted_at: 1, revoked_at: null } } } };
    expect(await hasCurrentConsent('u1')).toBe(true);

    testStore.users = { u1: { consents: { privacy_policy_v1: { version: '0.9.0', granted_at: 1, revoked_at: null } } } };
    expect(await hasCurrentConsent('u1')).toBe(false);
  });
});

describe('AUTH D-24 §10 — checkbox qiymatlari', () => {
  it("isConsentGiven: true / 'true' / 'on' / '1' qabul qiladi", () => {
    expect(isConsentGiven(true)).toBe(true);
    expect(isConsentGiven('true')).toBe(true);
    expect(isConsentGiven('on')).toBe(true);
    expect(isConsentGiven('1')).toBe(true);
  });

  it("isConsentGiven: false / 'off' / bo'sh / undefined → false", () => {
    expect(isConsentGiven(false)).toBe(false);
    expect(isConsentGiven('off')).toBe(false);
    expect(isConsentGiven('')).toBe(false);
    expect(isConsentGiven(undefined)).toBe(false);
    expect(isConsentGiven(null)).toBe(false);
  });
});
