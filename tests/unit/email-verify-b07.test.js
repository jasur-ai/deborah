/**
 * AUTH B-07 — Email verify check (unit)
 * -------------------------------------
 * - verifyCode: to'g'ri kod → email_verified + email_status=verified + used_at
 * - Noto'g'ri/replay → 422 otp_invalid; eskirgan → 422 expired (B-28 UX CTA)
 * - Kod bitta foydalanish (used_at set, replay yo'q)
 * - Brute-force lockout: check 5/15 → 429
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import {
  hashCode,
  sendVerifyCode,
  verifyCode,
} from '../../src/modules/auth/email-verify.js';

beforeAll(async () => {
  await snapshotDb();
});

afterAll(async () => {
  await restoreDb();
});

describe('AUTH B-07 — verifyCode kontrakti', () => {
  it("to'g'ri kod → email_verified + email_status=verified + used_at", async () => {
    const key = 'b07v1';
    await fb.set(`users/${key}`, {
      username: key, email: 'b07v1@test.uz', email_verified: false, safeKey: key, isVip: false, created_at: Date.now(),
    });
    const sent = await sendVerifyCode({ userKey: key, email: 'b07v1@test.uz' });
    expect(sent.ok).toBe(true);

    const ok = await verifyCode({ userKey: key, code: sent.code, email: 'b07v1@test.uz' });
    expect(ok.ok).toBe(true);

    const user = await fb.get(`users/${key}`);
    expect(user.val().email_verified).toBe(true);
    expect(user.val().email_status).toBe('verified');

    // Record: used=true + used_at timestamp (B-07 §09)
    const rec = await fb.get(`email_verify/${hashCode(sent.code, '')}`);
    expect(rec.val().used).toBe(true);
    expect(typeof rec.val().used_at).toBe('number');
  });

  it("barcha yomon holatlar → 422 otp_invalid (replay, noto'g'ri, eskirgan)", async () => {
    const key = 'b07v2';
    await fb.set(`users/${key}`, {
      username: key, email: 'b07v2@test.uz', email_verified: false, safeKey: key, isVip: false, created_at: Date.now(),
    });
    const sent = await sendVerifyCode({ userKey: key, email: 'b07v2@test.uz' });
    const code = sent.code;

    // Replay (birinchi ishlatamiz)
    const first = await verifyCode({ userKey: key, code, email: 'b07v2@test.uz' });
    expect(first.ok).toBe(true);
    const replay = await verifyCode({ userKey: key, code, email: 'b07v2@test.uz' });
    expect(replay.error).toBe('otp_invalid');
    expect(replay.httpStatus).toBe(422);

    // Noto'g'ri kod
    const wrong = await verifyCode({ userKey: key, code: '123456', email: 'b07v2@test.uz' });
    expect(wrong.error).toBe('otp_invalid');
    expect(wrong.httpStatus).toBe(422);

    // Eskirgan record
    const code2 = '987654';
    const salt = 's';
    await fb.set(`email_verify/${hashCode(code2, '')}`, {
      userKey: key,
      email: 'b07v2@test.uz',
      codeHash: hashCode(code2, salt),
      salt,
      used: false,
      expiresAt: Date.now() - 1000,
      createdAt: Date.now() - 16 * 60 * 1000,
    });
    const expired = await verifyCode({ userKey: key, code: code2, email: 'b07v2@test.uz' });
    // B-28 §08: muddati o'tgan kod → alohida 'expired' (UX: "Yangi kod yuborish" CTA)
    expect(expired.error).toBe('expired');
    expect(expired.httpStatus).toBe(422);
  });

  it("brute-force lockout: 5 noto'g'ri → 6-chisi 429", async () => {
    const key = 'b07rl';
    for (let i = 0; i < 5; i++) {
      await verifyCode({ userKey: key, code: '00000' + i, email: 'b07rl@test.uz' });
    }
    const blocked = await verifyCode({ userKey: key, code: '123456', email: 'b07rl@test.uz' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('too_many_attempts');
    expect(blocked.httpStatus).toBe(429);
  });
});
