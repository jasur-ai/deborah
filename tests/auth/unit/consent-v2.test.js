/**
 * AUTH D-25 §18 — Consent v2 (purpose log): revoke, re-consent, izolyatsiya.
 * ---------------------------------------------------------------------------
 *  - revokeConsent: revoked_at yoziladi → hasActiveConsent false (fail-closed).
 *  - Re-consent (§12): versiya o'zgarsa eski yozuv revoke EMAS — yangi so'rov.
 *  - Purpose izolyatsiya: bitta purpose revoke boshqasiga ta'sir qilmaydi.
 *  - listConsents: barcha purpose'lar holati (DSAR/settings ko'rinishi).
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
  revokeConsent,
  getConsent,
  hasActiveConsent,
  listConsents,
  CONSENT_PURPOSES,
  CONSENT_VERSION,
} from '../../../src/modules/legal/consent.js';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
  auditMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUTH D-25 §11 — revoke (fail-closed)', () => {
  it('revokeConsent → revoked_at + audit consent:revoked; hasActiveConsent false', async () => {
    await recordConsent('u1', CONSENT_PURPOSES.TELEGRAM, { lang: 'uz' });
    const r = await revokeConsent('u1', CONSENT_PURPOSES.TELEGRAM, { ipHash: 'cd34' });
    expect(r.ok).toBe(true);
    expect(r.revoked).toBe(true);

    const c = testStore.users.u1.consents.telegram;
    expect(c.revoked_at).toBeGreaterThan(0);
    expect(c.revoked_ip_hash).toBe('cd34');

    const lastCall = auditMock.mock.calls[auditMock.mock.calls.length - 1];
    expect(lastCall[0].action).toBe('consent:revoked');
    expect(lastCall[0].details.purpose).toBe('telegram');

    // Fail-closed: amalda funksiya ishlamaydi
    expect(await hasActiveConsent('u1', CONSENT_PURPOSES.TELEGRAM)).toBe(false);
  });

  it('revoke qilinmagan consent — hasActiveConsent true', async () => {
    await recordConsent('u1', CONSENT_PURPOSES.TELEGRAM, { lang: 'uz' });
    expect(await hasActiveConsent('u1', CONSENT_PURPOSES.TELEGRAM)).toBe(true);
  });

  it('mavjud bo\'lmagan consent revoke → error consent_not_found', async () => {
    const r = await revokeConsent('u1', CONSENT_PURPOSES.CAMERA);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('consent_not_found');
  });

  it('ikkilamchi revoke — idempotent (revoked: false)', async () => {
    await recordConsent('u1', CONSENT_PURPOSES.EMAIL_MARKETING);
    await revokeConsent('u1', CONSENT_PURPOSES.EMAIL_MARKETING);
    const r2 = await revokeConsent('u1', CONSENT_PURPOSES.EMAIL_MARKETING);
    expect(r2.ok).toBe(true);
    expect(r2.revoked).toBe(false);
  });
});

describe('AUTH D-25 §12 — re-consent (versiya)', () => {
  it('versiya o\'zgarsa eski yozuv revoke EMAS — hasActiveConsent(version) false', async () => {
    const OLD = '0.9.0';
    await recordConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY, { version: OLD });
    // Eski yozuv hali granted (revoke emas)
    const c = await getConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY);
    expect(c.granted).toBe(true);
    expect(c.revokedAt).toBeNull();
    // Lekin yangi versiya uchun faol emas → re-consent so'raladi
    expect(await hasActiveConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY, CONSENT_VERSION)).toBe(false);
    // Eski (berilgan) versiya bilan mos — hali granted (revoke emas)
    expect(await hasActiveConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY, OLD)).toBe(true);
    // Versiya parametrsiz — faqat revoke holati tekshiriladi (granted)
    expect(await hasActiveConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY)).toBe(true);
  });

  it('yangi rozilik (qayta) — hasActiveConsent true', async () => {
    await recordConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY, { version: CONSENT_VERSION });
    expect(await hasActiveConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY, CONSENT_VERSION)).toBe(true);
  });
});

describe('AUTH D-25 §07 — purpose izolyatsiya', () => {
  it('bitta purpose revoke — boshqasi ta\'sirlanmaydi', async () => {
    await recordConsent('u1', CONSENT_PURPOSES.TELEGRAM);
    await recordConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY);
    await revokeConsent('u1', CONSENT_PURPOSES.TELEGRAM);

    expect(await hasActiveConsent('u1', CONSENT_PURPOSES.TELEGRAM)).toBe(false);
    expect(await hasActiveConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY)).toBe(true);
  });

  it('listConsents — barcha purpose\'lar holati (DSAR ko\'rinishi)', async () => {
    await recordConsent('u1', CONSENT_PURPOSES.PRIVACY_POLICY);
    await recordConsent('u1', CONSENT_PURPOSES.TELEGRAM);
    await revokeConsent('u1', CONSENT_PURPOSES.TELEGRAM);

    const all = await listConsents('u1');
    expect(all.privacy_policy_v1.granted).toBe(true);
    expect(all.telegram.granted).toBe(true);
    expect(all.telegram.revokedAt).toBeGreaterThan(0);
    expect(all.email_marketing.granted).toBe(false);
    expect(all.mfa.granted).toBe(false);
    expect(all.camera.granted).toBe(false);
  });
});
