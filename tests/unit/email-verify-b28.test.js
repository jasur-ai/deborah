/**
 * AUTH B-28 — Email verify detail.
 *  1. delay() — jitter helper (100-300ms oralig'i)
 *  2. sendVerifyCode: resend eski kodni bekor qiladi (replay yo'q)
 *  3. verifyCode: expired → alohida 'expired' error (B-08 UX)
 *  4. verifyCode: noto'g'ri kod → otp_invalid (B-07 kontrakt saqlanadi)
 *  5. Autofill/format — 6-raqam, faqat raqam (validatsiya)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import {
  generateCode,
  hashCode,
  sendVerifyCode,
  verifyCode,
  delay,
} from '../../src/modules/auth/email-verify.js';
import { safeKey } from '../../utils/helpers.js';

beforeAll(async () => {
  await snapshotDb();
});

afterAll(async () => {
  await restoreDb();
});

describe('B-28 — email verify detail', () => {
  it('generateCode: 6-xonali, faqat raqam', () => {
    for (let i = 0; i < 20; i++) {
      const c = generateCode();
      expect(c).toMatch(/^\d{6}$/);
    }
  });

  it('delay: jitter helper — taxminiy kutish (testda stub qilinadi)', async () => {
    const spy = vi.spyOn(global, 'setTimeout');
    await delay(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('sendVerifyCode: resend eski kodni bekor qiladi (replay yo\'q)', async () => {
    const userKey = 'b28resenduser';
    // Eski kod yaratamiz
    const r1 = await sendVerifyCode({ userKey, email: 'b28resend@test.uz', lang: 'uz' });
    expect(r1.ok).toBe(true);

    const lastSnap = await fb.get(`email_verify_last/${safeKey(userKey)}`);
    const last = lastSnap.val();
    const oldRec = await fb.get(`email_verify/${last.lookupKey}`);
    expect(oldRec.exists()).toBe(true);
    expect(oldRec.val().used).toBe(false);

    // Resend cooldown 60s — bypass: email_verify_last ni eski qilamiz
    await fb.set(`email_verify_last/${safeKey(userKey)}`, { at: Date.now() - 70000, lookupKey: last.lookupKey });

    const r2 = await sendVerifyCode({ userKey, email: 'b28resend@test.uz', lang: 'uz' });
    expect(r2.ok).toBe(true);

    const lastSnap2 = await fb.get(`email_verify_last/${safeKey(userKey)}`);
    const last2 = lastSnap2.val();
    expect(last2.lookupKey).not.toBe(last.lookupKey);

    // Eski kod endi bekor (used=true)
    const oldRec2 = await fb.get(`email_verify/${last.lookupKey}`);
    expect(oldRec2.exists()).toBe(true);
    expect(oldRec2.val().used).toBe(true);
  });

  it('verifyCode: expired → alohida "expired" error (B-28 §08 UX)', async () => {
    const userKey = 'b28expired';
    const r = await sendVerifyCode({ userKey, email: 'b28exp@test.uz', lang: 'uz' });
    expect(r.ok).toBe(true);
    const code = r.code;
    expect(code).toMatch(/^\d{6}$/);

    // Muddati o'tgan qilamiz
    const lookupKey = hashCode(String(code), '');
    await fb.update(`email_verify/${lookupKey}`, { expiresAt: Date.now() - 1000 });

    const v = await verifyCode({ userKey, code, email: 'b28exp@test.uz' });
    expect(v.ok).toBe(false);
    expect(v.error).toBe('expired');
    expect(v.httpStatus).toBe(422);
  });

  it('verifyCode: noto\'g\'ri kod → otp_invalid (B-07 kontrakt saqlanadi)', async () => {
    const userKey = 'b28wrong';
    const r = await verifyCode({ userKey, code: '000000', email: 'x@test.uz' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('otp_invalid');
    expect(r.httpStatus).toBe(422);
  });

  it('verifyCode: format xato (5 raqam / harf) → invalid_code_format 400', async () => {
    const userKey = 'b28format';
    const r1 = await verifyCode({ userKey, code: '12345', email: 'x@test.uz' });
    expect(r1.error).toBe('invalid_code_format');
    expect(r1.httpStatus).toBe(400);
    const r2 = await verifyCode({ userKey, code: 'abc123', email: 'x@test.uz' });
    expect(r2.error).toBe('invalid_code_format');
  });

  it('verifyCode: rate limit — 5/15 daqiqa per-user (brute-force)', async () => {
    const userKey = 'b28ratelimit';
    let blocked = false;
    for (let i = 0; i < 8; i++) {
      const r = await verifyCode({ userKey, code: String(i).padStart(6, '0'), email: 'x@test.uz' });
      if (r.error === 'too_many_attempts') { blocked = true; break; }
    }
    expect(blocked).toBe(true);
  });
});
