import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isSha1Breached, isPasswordBreached, sha1Hex, _hibpCacheResetForTests } from '../../src/modules/auth/hibp.js';

// Test rejimida HIBP skip qiladi — mock fetch uchun vaqtincha env'ni almashtiramiz
const REAL_ENV = process.env.NODE_ENV;

function mockEnv() {
  process.env.NODE_ENV = 'development';
}

describe('B-27 — HIBP inline check (SHA-1 based)', () => {
  beforeEach(() => {
    _hibpCacheResetForTests();
  });
  afterEach(() => {
    process.env.NODE_ENV = REAL_ENV;
  });

  it('sha1Hex: NIST test vector (password123 → SHA-1)', () => {
    // SHA-1("password123") = CBFDAC6008F9CAB4083784CBD1874F76618D2A97
    expect(sha1Hex('password123')).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
  });

  it('isSha1Breached: k-anonymity — faqat prefix API ga yuboriladi', async () => {
    mockEnv();
    // deps.fetchImpl mock
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      // HIBP range javobi: suffix:count qatorlari (CBFDA prefix)
      return {
        ok: true,
        text: async () => 'C6008F9CAB4083784CBD1874F76618D2A97:123\n0000000000000000000000000000000000000:1\n',
      };
    };
    const r = await isSha1Breached('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', { fetchImpl });
    expect(r.breached).toBe(true);
    expect(r.checked).toBe(true);
    // Faqat 5-belgi prefix API'ga boradi — to'liq hash emas
    expect(seen[0]).toBe('https://api.pwnedpasswords.com/range/CBFDA');
    expect(seen[0].includes('C6008F9CAB4083784CBD1874F76618D2A97')).toBe(false);
  });

  it('isSha1Breached: suffix mos kelmasa breached=false', async () => {
    mockEnv();
    const fetchImpl = async () => ({
      ok: true,
      text: async () => '0000000000000000000000000000000000000:1\n',
    });
    const r = await isSha1Breached('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', { fetchImpl });
    expect(r.breached).toBe(false);
    expect(r.checked).toBe(true);
  });

  it('isSha1Breached: yaroqsiz input rad etiladi', async () => {
    const r = await isSha1Breached('not-a-hash', { fetchImpl: async () => { throw new Error('should not call'); } });
    expect(r.breached).toBe(false);
    expect(r.checked).toBe(false);
    expect(r.error).toBe('no-sha1');
  });

  it('isSha1Breached: API xatosi → fail-open (breached=false, checked=false)', async () => {
    mockEnv();
    const fetchImpl = async () => ({ ok: false, status: 503 });
    const r = await isSha1Breached('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', { fetchImpl });
    expect(r.breached).toBe(false);
    expect(r.checked).toBe(false);
  });

  it('isSha1Breached: offline (fetch throw) → fail-open', async () => {
    mockEnv();
    const fetchImpl = async () => { throw new Error('network down'); };
    const r = await isSha1Breached('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', { fetchImpl });
    expect(r.breached).toBe(false);
    expect(r.checked).toBe(false);
    expect(r.error).toBe('offline');
  });

  it('isPasswordBreached: paroldan SHA-1 olinib, k-anonymity ishlaydi', async () => {
    mockEnv();
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return {
        ok: true,
        text: async () => 'C6008F9CAB4083784CBD1874F76618D2A97:123\n',
      };
    };
    const r = await isPasswordBreached('password123', { fetchImpl });
    expect(r.breached).toBe(true);
    expect(seen[0]).toBe('https://api.pwnedpasswords.com/range/CBFDA');
  });

  it('NODE_ENV=test: tarmoqqa chiqmaydi (fail-open skip)', async () => {
    process.env.NODE_ENV = 'test';
    const r = await isSha1Breached('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(r.breached).toBe(false);
    expect(r.checked).toBe(false);
    expect(r.error).toBe('test-mode-skip');
    process.env.NODE_ENV = REAL_ENV;
  });
});
