/**
 * Edikit — AUTH A-16: Telegram OTP core unit testlari
 *
 * Covers (guide §22):
 *  1. Kod hash — plaintext hech qachon saqlanmaydi
 *  2. Timing-safe taqqoslash (uzunlik farqi ham xavfsiz)
 *  3. HMAC callback signature verify (to'g'ri/noto'g'ri/secret yo'q)
 *  4. createStart → 6-kod + token; record'da plaintext kod YO'Q
 *  5. consumeByCode — single-use (replay → 410), noto'g'ri → 401, expiry → 410
 *  6. attachTelegramId (bot callback) + hijack guard (mos kelmagan id → 409)
 *  7. linkTelegram UNIQUE (ikkinchi user → 409)
 *  8. Rate limit: start/verify 5/15 → 6-chisi 429
 *  9. Gating: bot token yo'q → disabled
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import {
  hashValue,
  hashOtp,
  timingSafeEqual,
  verifyCallbackSignature,
  generateOtp,
  createStart,
  consumeByCode,
  attachTelegramId,
  linkTelegram,
  unlinkTelegram,
  checkStartLimit,
  checkVerifyLimit,
  isTelegramEnabled,
} from '../../src/modules/auth/telegram-otp.js';

beforeAll(() => snapshotDb());
afterAll(() => restoreDb());

describe('AUTH A-16 — hash helpers', () => {
  it('generateOtp — 6 xonali raqam', () => {
    const code = generateOtp();
    expect(/^\d{6}$/.test(code)).toBe(true);
    // Determinizm emas — 100 ta kod turlicha bo'lishi kerak (koliziya ehtimoli past)
    const set = new Set(Array.from({ length: 100 }, generateOtp));
    expect(set.size).toBeGreaterThan(90);
  });

  it('hashOtp — salt farqi → hash farqi; plaintext qaytarilmaydi', () => {
    const h1 = hashOtp('123456', 's1');
    const h2 = hashOtp('123456', 's2');
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain('123456');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('timingSafeEqual — mos/mos emas/uzunlik farqi', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('AUTH A-16 — callback signature (HMAC)', () => {
  const secret = 'bot-secret-123';
  const payload = 'start_token=tok123&id=777&auth_date=1700000000';
  const sign = (s, p) => crypto.createHmac('sha256', s).update(p).digest('hex');

  it("to'g'ri HMAC → true", () => {
    expect(verifyCallbackSignature({ payload, signature: sign(secret, payload), secret })).toBe(true);
  });

  it('noto\'g\'ri signature → false', () => {
    expect(verifyCallbackSignature({ payload, signature: 'deadbeef', secret })).toBe(false);
  });

  it('secret yo\'q → false', () => {
    expect(verifyCallbackSignature({ payload, signature: sign(secret, payload), secret: '' })).toBe(false);
  });
});

describe('AUTH A-16 — createStart + consumeByCode', () => {
  it('createStart → 6-kod + start havolasi; record\'da plaintext kod YO\'Q', async () => {
    const { code, previewLink } = await createStart({ phone: '+998901234567' });
    expect(/^\d{6}$/.test(code)).toBe(true);
    expect(previewLink).toContain('start=');

    // Record lookupKey = hashOtp(code, '') — code orqali topish
    const rec = await fb.get(`telegram_auth/${hashOtp(code, '')}`);
    expect(rec.exists()).toBe(true);
    const r = rec.val();
    expect(r.phone).toBe('+998901234567');
    expect(r.codeHash).not.toContain(code); // plaintext YO'Q
    expect(r.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.used).toBe(false);
    expect(r.expiresAt).toBeGreaterThan(Date.now());
  });

  it('consumeByCode — to\'g\'ri kod → ok; replay → 410 already_used', async () => {
    const { code } = await createStart({ phone: '+998900000001' });
    const first = await consumeByCode({ code });
    expect(first.ok).toBe(true);
    expect(first.record.used).toBe(true);
    const replay = await consumeByCode({ code });
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe('already_used');
    expect(replay.httpStatus).toBe(410);
  });

  it('noto\'g\'ri kod → 401 invalid_code; format noto\'g\'ri → 400', async () => {
    const r1 = await consumeByCode({ code: '999999' });
    expect(r1.ok).toBe(false);
    expect(r1.httpStatus).toBe(401);
    const r2 = await consumeByCode({ code: '12ab' });
    expect(r2.httpStatus).toBe(400);
  });

  it('muddati o\'tgan kod → 410 expired', async () => {
    const { code, lookupKey } = await createStart({ phone: '+998900000002' });
    await fb.update(`telegram_auth/${lookupKey}`, { expiresAt: Date.now() - 1000 });
    const r = await consumeByCode({ code });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expired');
    expect(r.httpStatus).toBe(410);
  });
});

describe('AUTH A-16 — bot callback + hijack guard', () => {
  it('attachTelegramId — noma\'lum token → error; to\'g\'ri token → telegramId biriktiriladi', async () => {
    const bad = await attachTelegramId({ token: 'no-such-token', telegramId: '1' });
    expect(bad.ok).toBe(false);

    const { code, previewLink } = await createStart({ phone: '+998900000003' });
    const token = previewLink.split('start=')[1];
    const ok = await attachTelegramId({ token, telegramId: '777001' });
    expect(ok.ok).toBe(true);
    // Hijack guard: callback id (777001) ≠ verify id (888) → 409
    const mismatch = await consumeByCode({ code, telegramId: '888' });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toBe('telegram_mismatch');
    expect(mismatch.httpStatus).toBe(409);
  });

  it('phone guard — kod faqat o\'sha phone bilan ishlaydi; boshqa phone → 409', async () => {
    const { code, previewLink } = await createStart({ phone: '+998900000031' });
    const token = previewLink.split('start=')[1];
    await attachTelegramId({ token, telegramId: '777031' });
    // To'g'ri phone → ok
    const good = await consumeByCode({ code, telegramId: '777031', phone: '+998900000031' });
    expect(good.ok).toBe(true);
  });

  it('phone guard — noto\'g\'ri phone → 409 phone_mismatch', async () => {
    const { code, previewLink } = await createStart({ phone: '+998900000032' });
    const token = previewLink.split('start=')[1];
    await attachTelegramId({ token, telegramId: '777032' });
    const wrong = await consumeByCode({ code, telegramId: '777032', phone: '+998999999999' });
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toBe('phone_mismatch');
    expect(wrong.httpStatus).toBe(409);
  });

  it('collision guard — band lookupKey (tirik record) → yangi kod generatsiya qilinadi', async () => {
    // crypto.randomInt mock: birinchi start '111111', ikkinchi start'da
    // avval '111111' (band!) keyin qayta generatsiya '222222'.
    // Ketma-ketlik closure TASHQARISIDA — har chaqiruvda yangilanib qolmasligi uchun
    const seq = ['111111', '111111', '222222'];
    const spied = vi.spyOn(crypto, 'randomInt').mockImplementation(() => {
      const v = seq.shift() ?? '333333';
      return Number(v);
    });
    try {
      const a = await createStart({ phone: '+998900000033' });
      const b = await createStart({ phone: '+998900000034' });
      // Birinchi kod 111111; ikkinchisi ham 111111 chiqdi lekin band —
      // guard yangi 222222 generatsiya qildi (record ustiga yozilmadi).
      expect(a.code).toBe('111111');
      expect(b.code).toBe('222222');
      // Ikkala record ham alohida saqlangan
      const ra = await fb.get(`telegram_auth/${hashOtp('111111', '')}`);
      const rb = await fb.get(`telegram_auth/${hashOtp('222222', '')}`);
      expect(ra.exists()).toBe(true);
      expect(rb.exists()).toBe(true);
    } finally {
      spied.mockRestore();
    }
  });
});

describe('AUTH A-16 — linkTelegram UNIQUE', () => {
  it('bitta telegram_id bitta user\'ga; ikkinchisi → 409', async () => {
    const ok1 = await linkTelegram('user_alpha', 'tg_1001');
    expect(ok1.ok).toBe(true);
    const ok2 = await linkTelegram('user_beta', 'tg_1001');
    expect(ok2.ok).toBe(false);
    expect(ok2.error).toBe('telegram_already_linked');
    expect(ok2.httpStatus).toBe(409);
    // Xuddi shu user qayta link — idempotent
    const again = await linkTelegram('user_alpha', 'tg_1001');
    expect(again.ok).toBe(true);
    // Unlink → mapping yo'qoladi
    const un = await unlinkTelegram('user_alpha');
    expect(un.ok).toBe(true);
    expect(un.removed).toBe(true);
    const idx = await fb.get('users_telegram_index/tg_1001');
    expect(idx.exists()).toBe(false);
  });
});

describe('AUTH A-16 — rate limits', () => {
  it('start 5/15 daqiqa → 6-chisi 429', () => {
    let r;
    for (let i = 0; i < 6; i++) r = checkStartLimit('203.0.113.71', '+998900000004');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('verify 5/15 daqiqa → 6-chisi 429', () => {
    let r;
    for (let i = 0; i < 6; i++) r = checkVerifyLimit('203.0.113.72', '+998900000005');
    expect(r.allowed).toBe(false);
  });
});

describe('AUTH A-16 — gating', () => {
  it('bot token yo\'q bo\'lsa isTelegramEnabled false', async () => {
    // Yangi modul graph yaratamiz, lekin firebase/admin.js ni MOCK qilamiz —
    // aks holda qayta import yangi LocalDB instance ochib, o'z writeLock
    // zanjiri bilan data fayliga seed-merge yozadi (ikkita mustaqil writer →
    // fayl buzilishi/dirty bo'lishi). Mock: hech qanday fayl I/O bo'lmaydi.
    // vi.doMock — hoisted EMAS (vi.mock'dan farqli): faqat shu test ichida,
    // resetModules + qayta import paytida qo'llanadi; boshqa testlarga ta'sir qilmaydi.
    vi.resetModules();
    vi.doMock('../../firebase/admin.js', () => ({
      fb: {
        get: async () => ({ exists: () => false, val: () => null }),
        set: async () => true,
        update: async () => true,
        remove: async () => true,
        transaction: async () => ({ committed: false, value: null, previous: null }),
      },
      app: null,
      USE_REAL_FIREBASE: false,
      default: {},
    }));
    const prevToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      const mod = await import('../../src/modules/auth/telegram-otp.js?gate-a16=2');
      expect(mod.isTelegramEnabled()).toBe(false);
    } finally {
      // Env mutation qaytariladi — keyingi testlar/importlar token ko'rmasdan qolmasligi uchun
      if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    }
    vi.doUnmock('../../firebase/admin.js');
    vi.resetModules();
  });
});
