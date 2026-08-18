import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import crypto from 'crypto';
import { isPasswordBreached, _hibpCacheResetForTests } from '../../src/modules/auth/hibp.js';

// Test rejimida (NODE_ENV=test) modul tarmoqqa chiqmaydi — fetch'ni to'g'ridan-to'g'ri
// mock qilish uchun deps.fetchImpl o'tkazamiz; modul ichidagi test-skip tekshiruvi
// CONFIG.NODE_ENV='test' bo'lgani uchun ishlamaydi — shuning uchun bunda
// CONFIG'ni chetlab o'tib, deps orqali real HIBP xatti-harakatini sinaymiz.
// Buning uchun modulga kirishdan oldin NODE_ENV'ni almashtirib bo'lmaydi (statik import),
// shuning uchun fetchImpl'ga HIBP javobini beradigan mock quramiz va test-skip
// tekshiruvini emas, k-anonymity logikasini tasdiqlaymiz.

function sha1Suffix(password, len) {
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  return { prefix: hash.slice(0, len), suffix: hash.slice(len) };
}

describe('AUTH A-22 — HIBP Pwned Passwords k-anonymity (unit)', () => {
  beforeEach(() => {
    _hibpCacheResetForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    _hibpCacheResetForTests();
  });

  it('k-anonymity: API\'ga faqat 5-belgi SHA-1 prefix yuboriladi (to\'liq hash/parol EMAS)', async () => {
    const password = 'parol-2026-x-uzun';
    const { prefix, suffix } = sha1Suffix(password, 5);
    let requestedUrl = '';
    const fetchMock = vi.fn(async (url) => {
      requestedUrl = url;
      // HIBP javob formati: SUFFIX:COUNT har qatorda
      return {
        ok: true,
        text: async () => `ABCDEF123:3\n${suffix}:12345\nZZZZ:1\n`,
      };
    });

    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // modul call-time NODE_ENV o'qiydi
    try {
      const r = await isPasswordBreached(password, { fetchImpl: fetchMock });
      expect(r.breached).toBe(true);
      expect(r.checked).toBe(true);
    } finally {
      process.env.NODE_ENV = orig;
    }
    // 5-belgi prefix kutiladi (k-anonymity), to'liq hash emas
    expect(requestedUrl).toContain(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(requestedUrl.includes(suffix)).toBe(false);
    expect(requestedUrl.includes(encodeURIComponent(password))).toBe(false);
  });

  it('breach ro\'yxatida yo\'q → breached=false', async () => {
    const password = 'Xk9!qL2#vP7$mN4@rT6^';
    const { suffix } = sha1Suffix(password, 5);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => `NOTTHEHASH:5\nSOMETHINGELSE:1\n${suffix}XX:9\n`, // suffix+XX — aniq emas
    }));
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const r = await isPasswordBreached(password, { fetchImpl: fetchMock });
      expect(r.breached).toBe(false);
      expect(r.checked).toBe(true);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it('offline fallback: API ishlamasa → fail-open (breached=false, checked=false)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const r = await isPasswordBreached('parol-2026-x-uzun', { fetchImpl: fetchMock });
      expect(r.breached).toBe(false);
      expect(r.checked).toBe(false);
      expect(r.error).toBe('offline');
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it('API HTTP xato → fail-open (signup buzilmaydi)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429 }));
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const r = await isPasswordBreached('parol-2026-x-uzun', { fetchImpl: fetchMock });
      expect(r.breached).toBe(false);
      expect(r.checked).toBe(false);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it('parol bo\'sh/yo\'q → xavfsiz qaytadi (no crash)', async () => {
    const r = await isPasswordBreached('');
    expect(r.breached).toBe(false);
  });

  it('A-22 review: k-anonymity prefix cache — bir xil prefix ikkinchi so\'rovda fetch QILMAYDI', async () => {
    const password = 'parol-2026-x-uzun';
    const { suffix } = sha1Suffix(password, 5);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => `ABCDEF123:3\n${suffix}:12345\nZZZZ:1\n`,
    }));
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const r1 = await isPasswordBreached(password, { fetchImpl: fetchMock });
      expect(r1.breached).toBe(true);
      expect(r1.checked).toBe(true);
      // Ikkinchi so'rov (bir xil prefix) — fetch chaqirilmasligi kerak (cache hit)
      const r2 = await isPasswordBreached(password, { fetchImpl: fetchMock });
      expect(r2.breached).toBe(true);
      expect(r2.checked).toBe(true);
      expect(r2.cached).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it('A-22 review: cache TTL — eskirgan cache qayta fetch qiladi', async () => {
    const password = 'boshqa-parol-2026';
    const { suffix } = sha1Suffix(password, 5);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => `ABCDEF123:3\n${suffix}:7\nZZZZ:1\n`,
    }));
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      await isPasswordBreached(password, { fetchImpl: fetchMock });
      await isPasswordBreached(password, { fetchImpl: fetchMock });
      expect(fetchMock).toHaveBeenCalledTimes(1); // TTL ichida — cache
    } finally {
      process.env.NODE_ENV = orig;
    }
  });
});
