import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { indexEmail, resolveAccountToUserKey, findUserKeyByEmail } from '../../src/modules/auth/email-verify.js';

describe('AUTH A-20 — parol tiklash email (unit)', () => {
  beforeAll(async () => {
    await snapshotDb();
    const u1 = `a20u_${Date.now() % 1000000}`;
    await fb.set(`users/${u1}`, {
      username: u1, email: `${u1}@test.uz`, email_verified: true, password: 'x',
    });
    await indexEmail(`${u1}@test.uz`, u1);
    const u2 = `a20v_${Date.now() % 1000000}`;
    await fb.set(`users/${u2}`, {
      username: u2, email: `${u2}@test.uz`, email_verified: false, password: 'x',
    });
    await indexEmail(`${u2}@test.uz`, u2);
    const u3 = `a20leg_${Date.now() % 1000000}`;
    await fb.set(`users/${u3}`, {
      username: u3, password: 'x', // legacy — email YO'Q
    });
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('findUserKeyByEmail — index orqali topadi', async () => {
    const usersSnap = await fb.get('users');
    const emailUser = Object.entries(usersSnap.val() || {})
      .filter(([k]) => k.startsWith('a20'))
      .find(([, u]) => u.email_verified === true);
    expect(emailUser).toBeTruthy();
    const found = await findUserKeyByEmail(emailUser[1].email);
    expect(found).toBe(emailUser[0]);
  });

  it('resolveAccountToUserKey — username OR email', async () => {
    const usersSnap = await fb.get('users');
    // Faqat o'zimiz yaratgan a20_* userlarini olamiz (admin email'siz — skip)
    const ours = Object.entries(usersSnap.val() || {}).filter(([k]) => k.startsWith('a20'));
    const verified = ours.find(([, u]) => u.email_verified === true);
    const unverified = ours.find(([, u]) => u.email_verified === false);
    const legacy = ours.find(([, u]) => !u.email);
    expect(verified).toBeTruthy();
    expect(unverified).toBeTruthy();
    expect(legacy).toBeTruthy();

    // Username lookup
    const byUsername = await resolveAccountToUserKey(verified[0]);
    expect(byUsername.userKey).toBe(verified[0]);
    expect(byUsername.byEmail).toBe(false);

    // Email lookup (index orqali)
    const byEmail = await resolveAccountToUserKey(verified[1].email);
    expect(byEmail.userKey).toBe(verified[0]);
    expect(byEmail.byEmail).toBe(true);

    // Legacy user (email yo'q) — username lookup ishlaydi
    const legacyByUser = await resolveAccountToUserKey(legacy[0]);
    expect(legacyByUser.userKey).toBe(legacy[0]);

    // Legacy user'ning emaili yo'q — email lookup null
    const noEmail = await resolveAccountToUserKey('nonexistent@test.uz');
    expect(noEmail.userKey).toBeNull();

    // Verified bo'lmagan user — username lookup ishlaydi (verified check boshqa joyda)
    const unv = await resolveAccountToUserKey(unverified[0]);
    expect(unv.userKey).toBe(unverified[0]);
  });

  it('verified check — email_verified=true bo\'lmasa reset blok (route logika)', async () => {
    const usersSnap = await fb.get('users');
    const ours = Object.entries(usersSnap.val() || {}).filter(([k]) => k.startsWith('a20'));
    const unverified = ours.find(([, u]) => u.email_verified === false);
    const legacy = ours.find(([, u]) => !u.email);
    const verified = ours.find(([, u]) => u.email_verified === true);
    expect(verified).toBeTruthy();
    expect(unverified).toBeTruthy();
    expect(legacy).toBeTruthy();

    const v = usersSnap.val()[verified[0]];
    expect(v.email && v.email_verified === true).toBe(true);

    const uv = usersSnap.val()[unverified[0]];
    expect(uv.email && uv.email_verified === true).toBe(false);

    const lg = usersSnap.val()[legacy[0]];
    expect(!!(lg.email && lg.email_verified === true)).toBe(false);
  });

  it('indexEmail idempotent — same user qayta yozsa ok', async () => {
    const usersSnap = await fb.get('users');
    const verified = Object.entries(usersSnap.val() || {})
      .filter(([k]) => k.startsWith('a20'))
      .find(([, u]) => u.email_verified === true);
    expect(verified).toBeTruthy();
    const res = await indexEmail(verified[1].email, verified[0]);
    expect(res.ok).toBe(true);
  });

  it('safeKey — email index key normalizatsiya (katta harf/space)', async () => {
    const usersSnap = await fb.get('users');
    const verified = Object.entries(usersSnap.val() || {})
      .filter(([k]) => k.startsWith('a20'))
      .find(([, u]) => u.email_verified === true);
    expect(verified).toBeTruthy();
    // Katta harf + bo'shliq bilan yozilgan email ham topiladi
    const upper = verified[1].email.toUpperCase();
    const found = await findUserKeyByEmail(`  ${upper}  `);
    expect(found).toBe(verified[0]);
  });
});
