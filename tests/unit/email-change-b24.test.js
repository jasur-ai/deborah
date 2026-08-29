/**
 * AUTH B-24 — Email change (reauth + double opt-in) unit tests.
 * -------------------------------------------------------------
 * 1) requestEmailChange: required, validatsiya (emailInvalid/emailTaken/same_email),
 *    rate limit 3/soat, ikkala emailga yuborish (sendEmail × 2).
 * 2) confirmEmailChange: no_pending_change, invalid_code, invalid_token, expired,
 *    success (users.email = new, index yangilanadi, pending o'chadi).
 * 3) cancelEmailChange: invalid_token, success (pending o'chadi).
 * 4) getEmailChangeStatus: pending holat + masked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/modules/email/provider.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../../src/modules/email/validation.js', () => ({
  validateEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

const { sendEmail } = await import('../../src/modules/email/provider.js');
const { validateEmail } = await import('../../src/modules/email/validation.js');
const { fb } = await import('../../firebase/admin.js');
const { safeKey } = await import('../../utils/helpers.js');
const { indexEmail } = await import('../../src/modules/auth/email-verify.js');
const {
  requestEmailChange,
  confirmEmailChange,
  cancelEmailChange,
  getEmailChangeStatus,
  _resetEmailChangeRate,
  _emailChangeConfig,
} = await import('../../src/modules/auth/email-change.js');

const USER_KEY = 'ec_unit_user';
const OLD_EMAIL = 'ec-old@test.uz';
const NEW_EMAIL = 'ec-new@test.uz';

async function seedUser(key = USER_KEY, email = OLD_EMAIL) {
  await fb.set(`users/${key}`, { username: 'ecuser', email, email_verified: true, created_at: Date.now() });
  await indexEmail(email, key);
}

beforeEach(async () => {
  _resetEmailChangeRate();
  vi.clearAllMocks();
  validateEmail.mockResolvedValue({ ok: true });
  sendEmail.mockResolvedValue({ ok: true });
  await fb.remove(`users/${USER_KEY}`);
  await fb.remove(`users/ec_other_user`);
  await fb.remove(`email_change/${USER_KEY}`);
  await fb.remove(`email_change/ec_other_user`);
  await fb.remove(`users_email_index/${safeKey(OLD_EMAIL)}`);
  await fb.remove(`users_email_index/${safeKey(NEW_EMAIL)}`);
  await fb.remove(`users_email_index/${safeKey('ec-other@test.uz')}`);
});

describe('AUTH B-24 email-change', () => {
  it('konfig: 3/soat rate, 5dk yangi code, 15dk eski token', () => {
    const c = _emailChangeConfig();
    expect(c.REQUEST_MAX_PER_HOUR).toBe(3);
    expect(c.NEW_CODE_TTL_MS).toBe(5 * 60 * 1000);
    expect(c.OLD_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
  });

  it('required: userKey yoki newEmail bo‘lmasa 400', async () => {
    expect((await requestEmailChange({ userKey: '', newEmail: NEW_EMAIL })).error).toBe('required');
    expect((await requestEmailChange({ userKey: USER_KEY, newEmail: '' })).error).toBe('required');
  });

  it('validatsiya: emailInvalid', async () => {
    validateEmail.mockResolvedValue({ ok: false, reason: 'syntax' });
    const r = await requestEmailChange({ userKey: USER_KEY, newEmail: 'bad' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('emailInvalid');
  });

  it('validatsiya: disposable / no-mx', async () => {
    validateEmail.mockResolvedValueOnce({ ok: false, reason: 'disposable' });
    expect((await requestEmailChange({ userKey: USER_KEY, newEmail: 'x@tempmail.io' })).error).toBe('emailDisposable');
    validateEmail.mockResolvedValueOnce({ ok: false, reason: 'no-mx' });
    expect((await requestEmailChange({ userKey: USER_KEY, newEmail: 'x@nomx.uz' })).error).toBe('emailNoMx');
  });

  it('same_email: joriy email bilan bir xil bo‘lsa 400', async () => {
    await seedUser();
    const r = await requestEmailChange({ userKey: USER_KEY, newEmail: OLD_EMAIL });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('same_email');
  });

  it('emailTaken: boshqa user ga tegishli email', async () => {
    await seedUser();
    await fb.set('users/ec_other_user', { username: 'other', email: NEW_EMAIL, created_at: Date.now() });
    await indexEmail(NEW_EMAIL, 'ec_other_user');
    const r = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('emailTaken');
  });

  it('no_email: user da email yo‘q bo‘lsa 400', async () => {
    await fb.set(`users/${USER_KEY}`, { username: 'ecuser', created_at: Date.now() });
    const r = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_email');
  });

  it('rate limit: 3/soat — 4-chi so‘rov 429', async () => {
    await seedUser();
    for (let i = 0; i < 3; i++) {
      const r = await requestEmailChange({ userKey: USER_KEY, newEmail: `ec-new${i}@test.uz` });
      expect(r.ok).toBe(true);
    }
    const r4 = await requestEmailChange({ userKey: USER_KEY, newEmail: 'ec-new4@test.uz' });
    expect(r4.ok).toBe(false);
    expect(r4.error).toBe('too_many_requests');
    expect(r4.httpStatus).toBe(429);
  });

  it('muvaffaqiyatli request: ikkala emailga yuboriladi + masked + preview', async () => {
    await seedUser();
    const r = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL, lang: 'uz' });
    expect(r.ok).toBe(true);
    expect(r.maskedNew).toContain('@test.uz');
    expect(r.codePreview).toMatch(/^\d{6}$/);
    expect(r.oldTokenPreview).toHaveLength(64);
    // sendEmail 2 marta: yangi (code) + eski (token)
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.to === NEW_EMAIL && c.tag === 'email-change-new')).toBe(true);
    expect(calls.some((c) => c.to === OLD_EMAIL && c.tag === 'email-change-old')).toBe(true);
    // pending state saqlangan
    const status = await getEmailChangeStatus(USER_KEY);
    expect(status.pending).toBe(true);
    expect(status.newEmailMasked).toBe(r.maskedNew);
  });

  it('confirm: pending bo‘lmasa no_pending_change', async () => {
    await seedUser();
    const r = await confirmEmailChange({ userKey: USER_KEY, newCode: '123456', oldToken: 'x'.repeat(64) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_pending_change');
  });

  it('confirm: noto‘g‘ri newCode', async () => {
    await seedUser();
    const req = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    const r = await confirmEmailChange({ userKey: USER_KEY, newCode: '000000', oldToken: req.oldTokenPreview });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_code');
  });

  it('confirm: noto‘g‘ri oldToken', async () => {
    await seedUser();
    const req = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    const r = await confirmEmailChange({ userKey: USER_KEY, newCode: req.codePreview, oldToken: 'f'.repeat(64) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_token');
  });

  it('confirm: success — email o‘zgaradi, index yangilanadi, pending o‘chadi', async () => {
    await seedUser();
    const req = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    const r = await confirmEmailChange({ userKey: USER_KEY, newCode: req.codePreview, oldToken: req.oldTokenPreview });
    expect(r.ok).toBe(true);
    const user = (await fb.get(`users/${USER_KEY}`)).val();
    expect(user.email).toBe(NEW_EMAIL);
    expect(user.email_verified).toBe(true);
    // index: yangi email → USER_KEY, eski o‘chirilgan
    expect((await fb.get(`users_email_index/${safeKey(NEW_EMAIL)}`)).val()).toBe(USER_KEY);
    expect((await fb.get(`users_email_index/${safeKey(OLD_EMAIL)}`)).exists()).toBe(false);
    // pending tozalandi
    expect(await getEmailChangeStatus(USER_KEY)).toBeNull();
    // eski emailga "o'zgartirildi" xabari
    const calls = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.to === OLD_EMAIL && c.tag === 'email-change-done')).toBe(true);
  });

  it('confirm: expired — 422 change_expired', async () => {
    await seedUser();
    const req = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    // expiresAt ni o'tkazib yuboramiz
    const rec = (await fb.get(`email_change/${USER_KEY}`)).val();
    await fb.update(`email_change/${USER_KEY}`, { expiresAt: Date.now() - 1000 });
    const r = await confirmEmailChange({ userKey: USER_KEY, newCode: req.codePreview, oldToken: req.oldTokenPreview });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('change_expired');
    expect(rec.expiresAt).toBeTruthy();
  });

  it('cancel: noto‘g‘ri token → invalid_token', async () => {
    await seedUser();
    await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    const r = await cancelEmailChange({ userKey: USER_KEY, oldToken: 'z'.repeat(64) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_token');
  });

  it('cancel: success — pending o‘chadi, email o‘zgarmaydi', async () => {
    await seedUser();
    const req = await requestEmailChange({ userKey: USER_KEY, newEmail: NEW_EMAIL });
    const r = await cancelEmailChange({ userKey: USER_KEY, oldToken: req.oldTokenPreview });
    expect(r.ok).toBe(true);
    expect(await getEmailChangeStatus(USER_KEY)).toBeNull();
    const user = (await fb.get(`users/${USER_KEY}`)).val();
    expect(user.email).toBe(OLD_EMAIL);
  });

  it('getEmailChangeStatus: pending bo‘lmasa null', async () => {
    await seedUser();
    expect(await getEmailChangeStatus(USER_KEY)).toBeNull();
  });
});
