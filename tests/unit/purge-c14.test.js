/**
 * AUTH C-14 — Data retention + purge jobs
 * --------------------------------------
 *  1. purgeEmailLog: eski (30 kun) record'lar tozalanadi, yangi qoladi
 *  2. purgeVerifyCodes: eski (24 soat) kodlar tozalanadi
 *  3. purgeResetTokens: eski tokenlar + bo'sh user indekslari tozalanadi
 *  4. purgeUserDevices: harakatsiz device + risk_events slice
 *  5. Legal hold: legal_hold=true user'ning device'lari O'TKAZIB YUBORILADI
 *  6. runRetentionPurge: barcha jadvallar ishlaydi + PURGE_RUN audit
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  purgeEmailLog,
  purgeVerifyCodes,
  purgeResetTokens,
  purgeUserDevices,
  purgeRevokedInvites,
  runRetentionPurge,
} from '../../src/modules/auth/purge.js';

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await snapshotDb();
});

afterAll(async () => {
  await restoreDb();
});

describe('AUTH C-14 — per-jadval purgelar (idempotent)', () => {
  it('purgeEmailLog: 30 kundan eski record o\'chadi, yangi qoladi', async () => {
    await fb.set('email_log/old-1', { emailHash: 'h1', createdAt: Date.now() - 40 * DAY });
    await fb.set('email_log/old-2', { emailHash: 'h2' }); // createdAt yo'q → ham eski
    await fb.set('email_log/new-1', { emailHash: 'h3', createdAt: Date.now() - 1000 });

    const r = await purgeEmailLog();
    expect(r.removed).toBe(2);
    expect((await fb.get('email_log/old-1')).exists()).toBe(false);
    expect((await fb.get('email_log/old-2')).exists()).toBe(false);
    expect((await fb.get('email_log/new-1')).exists()).toBe(true);
  });

  it('purgeVerifyCodes: 24 soatdan eski kodlar (email_verify + _last) o\'chadi', async () => {
    await fb.set('email_verify/oldc', { userKey: 'u', createdAt: Date.now() - 3 * DAY, expiresAt: Date.now() - 2 * DAY });
    await fb.set('email_verify/newc', { userKey: 'u', createdAt: Date.now() - 1000, expiresAt: Date.now() + DAY });
    await fb.set('email_verify_last/u', { at: Date.now() - 3 * DAY, lookupKey: 'oldc' });

    const r = await purgeVerifyCodes();
    expect(r.removed).toBeGreaterThanOrEqual(2);
    expect((await fb.get('email_verify/oldc')).exists()).toBe(false);
    expect((await fb.get('email_verify/newc')).exists()).toBe(true);
    expect((await fb.get('email_verify_last/u')).exists()).toBe(false);
  });

  it('purgeResetTokens: eski token + bo\'sh user indeksi o\'chadi; yangi qoladi', async () => {
    await fb.set('resetTokens/oldTok', { safeKey: 'u1', expiresAt: Date.now() - 2 * DAY });
    await fb.set('resetTokens/newTok', { safeKey: 'u1', expiresAt: Date.now() + DAY });
    await fb.set('resetTokensByUser/u1', { oldTok: true });
    await fb.set('resetTokensByUser/u2', {}); // bo'sh → tozalanadi

    const r = await purgeResetTokens();
    expect(r.removed).toBeGreaterThanOrEqual(2);
    expect((await fb.get('resetTokens/oldTok')).exists()).toBe(false);
    expect((await fb.get('resetTokens/newTok')).exists()).toBe(true);
    expect((await fb.get('resetTokensByUser/u2')).exists()).toBe(false);
  });

  it('purgeUserDevices: harakatsiz device o\'chadi; legal_hold user o\'tib ketadi', async () => {
    await fb.set('users/purge_u1/devices/d-old', { last_seen: Date.now() - 13 * 30 * DAY, risk_events: [] });
    await fb.set('users/purge_u1/devices/d-new', { last_seen: Date.now() - 1000, risk_events: [] });
    // Legal hold user — device'lari o'tkazib yuboriladi
    await fb.set('users/purge_hold/devices/d-old', { last_seen: Date.now() - 13 * 30 * DAY, risk_events: [] });
    await fb.update('users/purge_hold', { legal_hold: true });

    const r = await purgeUserDevices();
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect((await fb.get('users/purge_u1/devices/d-old')).exists()).toBe(false);
    expect((await fb.get('users/purge_u1/devices/d-new')).exists()).toBe(true);
    // Legal hold — fail-closed: device saqlanadi
    expect((await fb.get('users/purge_hold/devices/d-old')).exists()).toBe(true);
  });

  it('purgeRevokedInvites: revoked + 90 kun eski o\'chadi; pending/used qoladi', async () => {
    await fb.set('invites/oldRev', { status: 'revoked', revokedAt: Date.now() - 100 * DAY });
    await fb.set('invites/pend', { status: 'pending', expiresAt: Date.now() + DAY });
    await fb.set('invites/used', { status: 'used', usedAt: Date.now() - 100 * DAY });

    const r = await purgeRevokedInvites();
    expect(r.removed).toBe(1);
    expect((await fb.get('invites/oldRev')).exists()).toBe(false);
    expect((await fb.get('invites/pend')).exists()).toBe(true);
    expect((await fb.get('invites/used')).exists()).toBe(true); // faqat revoked
  });

  it('runRetentionPurge: barcha jadvallar ishlaydi + PURGE_RUN audit (ok)', async () => {
    await fb.set('email_log/run-old', { createdAt: Date.now() - 40 * DAY });
    const r = await runRetentionPurge();
    expect(r.ok).toBe(true);
    expect(typeof r.counts.emailLog).toBe('number');
    expect(r.counts.emailLog).toBeGreaterThanOrEqual(1);

    // PURGE_RUN audit yozildi
    const snap = await fb.get('auth_audit');
    let found = false;
    if (snap.exists()) {
      const days = snap.val();
      for (const day of Object.values(days)) {
        for (const rec of Object.values(day || {})) {
          if (rec?.action === 'purge:run' && rec?.outcome !== 'failed') found = true;
        }
      }
    }
    expect(found).toBe(true);
  });
});
