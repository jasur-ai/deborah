/**
 * AUTH A-18 — Email verify unit testlar.
 *  1. registerSchema: email format (valid/invalid)
 *  2. generateCode — 6 xonali
 *  3. hashCode — salt farqi → farq; plaintext yo'q
 *  4. sendVerifyCode — kod preview (dev), record'da hash, plaintext yo'q
 *  5. verifyCode — to'g'ri kod → ok + email_verified=true + email_status=verified; replay → 422
 *  6. noto'g'ri kod → 422 otp_invalid; expiry → 422; format → 400
 *  7. email mismatch → 422; boshqa user kodi → 422
 *  8. rate limit: send 3/soat, check 5/15 → 429
 *  9. indexEmail unique → 409
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { registerSchema, parseRegister } from '../../src/modules/auth/validation.js';
import {
  generateCode,
  hashCode,
  sendVerifyCode,
  verifyCode,
  indexEmail,
} from '../../src/modules/auth/email-verify.js';
import { safeKey } from '../../utils/helpers.js';

beforeAll(async () => {
  await snapshotDb();
});

afterAll(async () => {
  await restoreDb();
});

describe('AUTH A-18 — zod email validatsiyasi', () => {
  it('valid email qabul qilinadi; majburiy', () => {
    const ok = registerSchema.safeParse({
      username: 'test_user',
      email: 'user@example.com',
      password: 'parol-2026-x-uzun',
    });
    expect(ok.success).toBe(true);
    expect(ok.data.email).toBe('user@example.com');
  });

  it('noto\'g\'ri email → emailInvalid', () => {
    for (const bad of ['', 'not-an-email', 'a@b', 'a b@c.com', '@x.com']) {
      const r = registerSchema.safeParse({
        username: 'test_user',
        email: bad,
        password: 'parol-2026-x-uzun',
      });
      expect(r.success).toBe(false);
    }
  });

  it('email yo\'q bo\'lsa → majburiy xato (emailInvalid)', () => {
    // Schema darajasida email optional (invite accept email'siz ishlaydi),
    // lekin parseRegister default emailRequired:true — odatiy register email talab qiladi.
    const r = parseRegister({ username: 'test_user', password: 'parol-2026-x-uzun' });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('emailInvalid');
  });

  it('email yo\'q bo\'lsa + emailRequired:false → o\'tadi (invite accept)', () => {
    const r = parseRegister(
      { username: 'test_user', password: 'parol-2026-x-uzun', consent: true },
      { emailRequired: false },
    );
    expect(r.ok).toBe(true);
    expect(r.email).toBe('');
  });
});

describe('AUTH A-18 — kod hash', () => {
  it('generateCode — 6 xonali', () => {
    for (let i = 0; i < 5; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });

  it('hashCode — salt farqi → hash farqi; plaintext qaytarilmaydi', () => {
    const h1 = hashCode('123456', 's1');
    const h2 = hashCode('123456', 's2');
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain('123456');
    expect(h1).toHaveLength(64);
  });
});

describe('AUTH A-18 — sendVerifyCode', () => {
  it('kod yaratiladi + preview (dev); record\'da plaintext kod YO\'Q', async () => {
    const res = await sendVerifyCode({ userKey: 'a18_u1', email: 'u1@test.uz' });
    expect(res.ok).toBe(true);
    expect(res.code).toMatch(/^\d{6}$/); // dev/test preview

    // Record: codeHash bilan saqlangan, plaintext kod yo'q
    const key = hashCode(res.code, '');
    const snap = await fb.get(`email_verify/${key}`);
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    expect(rec.codeHash).not.toContain(res.code);
    expect(rec.userKey).toBe('a18_u1');
    expect(rec.used).toBe(false);
  });

  it('noto\'g\'ri kiritma → 400', async () => {
    const res = await sendVerifyCode({ userKey: '', email: 'x@test.uz' });
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(400);
  });
});

describe('AUTH A-18 — verifyCode', () => {
  async function seedUser(key, email) {
    await fb.set(`users/${key}`, {
      username: key, email, email_verified: false, safeKey: key, isVip: false, created_at: Date.now(),
    });
  }

  it('to\'g\'ri kod → ok; email_verified=true + email_status=verified; replay → 422', async () => {
    await seedUser('a18_v1', 'verify1@test.uz');
    const email = 'verify1@test.uz';
    const res = await sendVerifyCode({ userKey: 'a18_v1', email });
    const code = res.code;

    const ok = await verifyCode({ userKey: 'a18_v1', code, email });
    expect(ok.ok).toBe(true);

    const user = await fb.get(`users/a18_v1`);
    expect(user.exists()).toBe(true);
    expect(user.val().email_verified).toBe(true);
    // B-07 §07: email_status=verified + used_at (B-01 schema izchilligi)
    expect(user.val().email_status).toBe('verified');

    // Replay → otp_invalid (single-use, replay yo'q)
    const replay = await verifyCode({ userKey: 'a18_v1', code, email });
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe('otp_invalid');
    expect(replay.httpStatus).toBe(422);
  });

  it("noto'g'ri kod → 422 otp_invalid; format noto'g'ri → 400", async () => {
    const wrong = await verifyCode({ userKey: 'a18_v2', code: '000001', email: 'v2@test.uz' });
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toBe('otp_invalid');
    expect(wrong.httpStatus).toBe(422);

    const bad = await verifyCode({ userKey: 'a18_v2', code: 'abc', email: 'v2@test.uz' });
    expect(bad.ok).toBe(false);
    expect(bad.httpStatus).toBe(400);
  });

  it('email mismatch → 422 (kod boshqa emailga tegishli)', async () => {
    const res = await sendVerifyCode({ userKey: 'a18_v3', email: 'v3a@test.uz' });
    const mm = await verifyCode({ userKey: 'a18_v3', code: res.code, email: 'v3b@test.uz' });
    expect(mm.ok).toBe(false);
    expect(mm.error).toBe('otp_invalid');
    expect(mm.httpStatus).toBe(422);
  });

  it('user yo\'q bo\'lsa → 404 (user yaratilmaydi)', async () => {
    const res = await sendVerifyCode({ userKey: 'a18_v404', email: 'v404@test.uz' });
    const nf = await verifyCode({ userKey: 'a18_v404', code: res.code, email: 'v404@test.uz' });
    expect(nf.ok).toBe(false);
    expect(nf.error).toBe('user_not_found');
    expect(nf.httpStatus).toBe(404);
    // User YARATILMAGAN bo'lishi kerak
    const u = await fb.get('users/a18_v404');
    expect(u.exists()).toBe(false);
  });

  it("muddati o'tgan kod → 422 expired (B-28 §08 UX alohida kontrakt)", async () => {
    // Muddati o'tgan record'ni to'g'ridan-to'g'ri yozamiz
    const code = '654321';
    const salt = 'x';
    const lookupKey = hashCode(code, '');
    await fb.set(`email_verify/${lookupKey}`, {
      userKey: 'a18_v4',
      email: 'v4@test.uz',
      codeHash: hashCode(code, salt),
      salt,
      used: false,
      expiresAt: Date.now() - 1000,
      createdAt: Date.now() - 16 * 60 * 1000,
    });
    const res = await verifyCode({ userKey: 'a18_v4', code, email: 'v4@test.uz' });
    expect(res.ok).toBe(false);
    // B-28 §08: muddati o'tgan kod endi alohida 'expired' error (UX: yangi kod CTA)
    expect(res.error).toBe('expired');
    expect(res.httpStatus).toBe(422);
  });
});

describe('AUTH A-18 — indexEmail unique', () => {
  it('bitta email bitta user; ikkinchisi → 409', async () => {
    const ok1 = await indexEmail('dup@test.uz', 'a18_i1');
    expect(ok1.ok).toBe(true);
    const ok2 = await indexEmail('DUP@test.uz', 'a18_i2'); // case-insensitive
    expect(ok2.ok).toBe(false);
    expect(ok2.error).toBe('email_taken');
    expect(ok2.httpStatus).toBe(409);
    // Xuddi shu user qayta — idempotent
    const again = await indexEmail('dup@test.uz', 'a18_i1');
    expect(again.ok).toBe(true);
  });
});

describe('AUTH A-18 — rate limits', () => {
  it('send 3/soat per-user → 4-chisi 429', async () => {
    // Per-user limit: bir xil userKey bilan 3 ta send. Har send'dan keyin
    // resend-cooldown record'ini tozalab, cooldown xalaqit bermasligini ta'minlaymiz.
    for (let i = 0; i < 3; i++) {
      await fb.set('email_verify_last/rl_u', { at: 0, lookupKey: '' });
      const r = await sendVerifyCode({ userKey: 'rl_u', email: `rl_u@test.uz` });
      expect(r.ok).toBe(true);
    }
    await fb.set('email_verify_last/rl_u', { at: 0, lookupKey: '' });
    const blocked = await sendVerifyCode({ userKey: 'rl_u', email: 'rl_u@test.uz' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('too_many_requests');
    expect(blocked.httpStatus).toBe(429);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('check 5/15 → 6-chisi 429', async () => {
    for (let i = 0; i < 5; i++) {
      await verifyCode({ userKey: 'rc_u', code: '00000' + i, email: 'rc@test.uz' });
    }
    const blocked = await verifyCode({ userKey: 'rc_u', code: '123456', email: 'rc@test.uz' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('too_many_attempts');
    expect(blocked.httpStatus).toBe(429);
  });

  it('resend cooldown 60s → tez qayta yuborish 429', async () => {
    await fb.set('email_verify_last/rc_1', { at: 0, lookupKey: '' });
    const r1 = await sendVerifyCode({ userKey: 'rc_1', email: 'rc1@test.uz' });
    expect(r1.ok).toBe(true);
    // Xuddi shu user'ga 60s ichida yana — cooldown
    const r2 = await sendVerifyCode({ userKey: 'rc_1', email: 'rc1@test.uz' });
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('resend_cooldown');
    expect(r2.httpStatus).toBe(429);
  });
});
