/**
 * AUTH D-16 §12/§13 — Email change edge-case + session invalidation (wsl)
 * -----------------------------------------------------------------------
 *  - confirm: commit race — email commit paytida band bo'lib qolsa 409 +
 *    pending tozalanadi (B-24 §08 race himoya).
 *  - confirm: noto'g'ri uzunlikdagi kod (5 xona) → invalid_code.
 *  - getEmailChangeStatus: expired flag (B-24 §TTL).
 *  - Session invalidation (B-25): revokeByUser — joriy sessiya saqlanadi,
 *    qolganlari tozalanadi (parol/MFA/passkey triggerlari uchun).
 * Manba: B-24 §07/§08, B-25.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/modules/email/provider.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../../../src/modules/email/validation.js', () => ({
  validateEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

const { sendEmail } = await import('../../../src/modules/email/provider.js');
const { validateEmail } = await import('../../../src/modules/email/validation.js');
const { fb } = await import('../../../firebase/admin.js');
const { safeKey } = await import('../../../utils/helpers.js');
const { indexEmail } = await import('../../../src/modules/auth/email-verify.js');
const {
  requestEmailChange,
  confirmEmailChange,
  getEmailChangeStatus,
  _resetEmailChangeRate,
} = await import('../../../src/modules/auth/email-change.js');
const { revokeByUser } = await import('../../../src/modules/auth/session-manager.js');

const USER_KEY = 'ec2_unit_user';
const OTHER_KEY = 'ec2_other_user';
const OLD_EMAIL = 'ec2-old@test.uz';
const NEW_EMAIL = 'ec2-new@test.uz';

async function seedUser(key = USER_KEY, email = OLD_EMAIL) {
  await fb.set(`users/${key}`, { username: 'ec2user', email, email_verified: true, created_at: Date.now() });
  await indexEmail(email, key);
}

beforeEach(async () => {
  _resetEmailChangeRate();
  vi.clearAllMocks();
  validateEmail.mockResolvedValue({ ok: true });
  sendEmail.mockResolvedValue({ ok: true });
  for (const k of [USER_KEY, OTHER_KEY]) {
    await fb.remove(`users/${k}`);
    await fb.remove(`email_change/${k}`);
  }
  await fb.remove(`users_email_index/${safeKey(OLD_EMAIL)}`);
  await fb.remove(`users_email_index/${safeKey(NEW_EMAIL)}`);
  await fb.remove(`users_email_index/${safeKey('ec2-taken@test.uz')}`);
  await fb.remove('sessions');
});

describe('AUTH D-16 §12 — email change edge-cases (B-24)', () => {
  it('confirm: commit race — email band bo\'lib qolsa → 409 emailTaken + pending tozalanadi', async () => {
    await seedUser();
    const req = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    expect(req.ok).toBe(true);

    // Request'dan KEYIN boshqa user yangi email'ni egallab oladi (race)
    await fb.set(`users/${OTHER_KEY}`, { username: 'other', email: NEW_EMAIL });
    await indexEmail(NEW_EMAIL, OTHER_KEY);

    const r = await confirmEmailChange({ userKey: USER_KEY, newCode: req.codePreview, oldToken: req.oldTokenPreview });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('emailTaken');
    expect(r.httpStatus).toBe(409);
    // Pending tozalandi — keyingi confirm no_pending_change
    const again = await confirmEmailChange({ userKey: USER_KEY, newCode: req.codePreview, oldToken: req.oldTokenPreview });
    expect(again.error).toBe('no_pending_change');
    // User email o'zgarmadi
    expect((await fb.get(`users/${USER_KEY}`)).val().email).toBe(OLD_EMAIL);
  });

  it('confirm: noto\'g\'ri uzunlikdagi kod (5 xona) → invalid_code (6 xona shart)', async () => {
    await seedUser();
    const req = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    expect(req.ok).toBe(true);
    const r = await confirmEmailChange({
      userKey: USER_KEY,
      newCode: String(req.codePreview).slice(0, 5), // 5 xona
      oldToken: req.oldTokenPreview,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_code');
    // Pending saqlanadi (xato kod pending'ni o'chirmaydi)
    expect(await getEmailChangeStatus(USER_KEY)).not.toBeNull();
  });

  it('getEmailChangeStatus: TTL o\'tgan → expired flag true', async () => {
    await seedUser();
    const req = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    expect(req.ok).toBe(true);
    // Record'ning expiresAt'ini o'tmishga qo'yamiz (TTL sinovi)
    const rec = (await fb.get(`email_change/${USER_KEY}`)).val();
    await fb.set(`email_change/${USER_KEY}`, { ...rec, expiresAt: Date.now() - 1000 });
    const st = await getEmailChangeStatus(USER_KEY);
    expect(st.pending).toBe(true);
    expect(st.expired).toBe(true);
    // Confirm endi 422 change_expired
    const r = await confirmEmailChange({ userKey: USER_KEY, newCode: req.codePreview, oldToken: req.oldTokenPreview });
    expect(r.httpStatus).toBe(422);
    expect(r.error).toBe('change_expired');
  });
});

describe('AUTH D-16 §13 — session invalidation (B-25)', () => {
  it('revokeByUser: exceptSessionId saqlanadi, qolgan sessiyalar DB\'dan o\'chadi', async () => {
    const uid = 'b25_core_user';
    await fb.set(`users/${uid}`, { username: 'b25u', role: 'student' });
    // 3 ta sessiya yozuvi: joriy + 2 eski
    await fb.set(`sessions/${uid}/ses_current`, { sessionId: 'ses_current', authMethod: 'password', createdAt: Date.now() });
    await fb.set(`sessions/${uid}/ses_old1`, { sessionId: 'ses_old1', authMethod: 'password', createdAt: Date.now() });
    await fb.set(`sessions/${uid}/ses_old2`, { sessionId: 'ses_old2', authMethod: 'password', createdAt: Date.now() });

    const r = await revokeByUser(uid, { exceptSessionId: 'ses_current', reason: 'password_change' });
    expect(r.ok).toBe(true);

    const remaining = (await fb.get(`sessions/${uid}`)).val();
    expect(remaining).toEqual({ ses_current: { sessionId: 'ses_current', authMethod: 'password', createdAt: expect.any(Number) } });
    // Eski sessiyalar yo'q
    expect(remaining.ses_old1).toBeUndefined();
    expect(remaining.ses_old2).toBeUndefined();
  });

  it('revokeByUser: except bo\'lmasa barchasi tozalanadi (parol/email trigger)', async () => {
    const uid = 'b25_core_user2';
    await fb.set(`sessions/${uid}/a`, { sessionId: 'a', authMethod: 'password' });
    await fb.set(`sessions/${uid}/b`, { sessionId: 'b', authMethod: 'password' });
    const r = await revokeByUser(uid, { reason: 'email_changed' });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    // Barcha sessiya yozuvlari o'chgan (tugun bo'sh object bo'lib qoladi)
    const left = (await fb.get(`sessions/${uid}`)).val();
    expect(left || {}).toEqual({});
  });
});
