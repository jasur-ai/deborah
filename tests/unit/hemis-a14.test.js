/**
 * Edikit — AUTH A-14: HEMIS Live Test Harness xavfsizligi
 *
 * Tests that:
 * 1. REDACT hech qachon secret'ni to'liq ko'rsatmaydi (faqat 4+3 belgi mask)
 * 2. parseEnv .env qatorlarini to'g'ri o'qiydi (quote'larni olib tashlaydi)
 * 3. validateCfg barcha talab qilingan kalitlarni tekshiradi + redirect URI http(s)
 * 4. buildAuthUrl client_id/redirect_uri/state encode qiladi, secret ISHTIROK ETMAYDI
 * 5. Live-test output'ida hech qachon parol/secret ko'rinmaydi (scan guard)
 */

import { describe, it, expect } from 'vitest';
import { REDACT, parseEnv, validateCfg, buildAuthUrl, resolveUrl } from '../../scripts/hemis-live-test.mjs';

const SAMPLE_ENV = [
  'HEMIS_CLIENT_ID=8',
  'HEMIS_CLIENT_SECRET=Vt5dnZtzK-super-secret-value-123',
  "HEMIS_REDIRECT_URI='http://hemis-oauth-test.lc/index.php'",
  'HEMIS_USERNAME=test_student_2026',
  'HEMIS_PASSWORD=p@ssw0rd-TEST-42',
].join('\n');

describe('AUTH A-14 — HEMIS live-test harness', () => {
  it('REDACT secretni to\'liq ko\'rsatmaydi (faqat 4+3 belgi mask)', () => {
    const secret = 'Vt5dnZtzK-super-secret-value-123';
    const out = REDACT(secret);
    expect(out).not.toContain(secret);
    expect(out).toContain('Vt5d'); // boshidagi 4 belgi
    expect(out).toContain('123'); // oxiridagi 3 belgi
    expect(out).toContain('(32 belgi)');
  });

  it('REDACT bo\'sh qiymatda "(bo\'sh)" qaytaradi', () => {
    expect(REDACT(null)).toBe('(bo\'sh)');
    expect(REDACT('')).toBe('(bo\'sh)');
  });

  it('parseEnv .env qatorlarini o\'qiydi va quote olib tashlaydi', () => {
    const cfg = parseEnv(SAMPLE_ENV);
    expect(cfg.HEMIS_CLIENT_ID).toBe('8');
    expect(cfg.HEMIS_CLIENT_SECRET).toContain('Vt5dnZtzK');
    expect(cfg.HEMIS_REDIRECT_URI).toBe('http://hemis-oauth-test.lc/index.php');
    expect(cfg.HEMIS_USERNAME).toBe('test_student_2026');
    expect(cfg.HEMIS_PASSWORD).toBe('p@ssw0rd-TEST-42');
  });

  it('parseEnv Windows CRLF (\r\n) fayllarida ham to\'g\'ri o\'qiydi (qiymat oxiridagi \\r olib tashlanadi)', () => {
    const crlf = SAMPLE_ENV.replace(/\n/g, '\r\n');
    const cfg = parseEnv(crlf);
    expect(cfg.HEMIS_PASSWORD).toBe('p@ssw0rd-TEST-42');
    expect(cfg.HEMIS_CLIENT_SECRET).toContain('Vt5dnZtzK');
    expect(cfg.HEMIS_REDIRECT_URI).toBe('http://hemis-oauth-test.lc/index.php');
    expect(cfg.HEMIS_PASSWORD.endsWith('\r')).toBe(false);
  });

  it('validateCfg barcha kerakli kalitlarni talab qiladi', () => {
    expect(validateCfg(parseEnv(SAMPLE_ENV)).ok).toBe(true);
    const missing = validateCfg({ HEMIS_CLIENT_ID: '8' });
    expect(missing.ok).toBe(false);
    expect(missing.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('validateCfg redirect URI http(s) emasligini rad etadi', () => {
    const bad = validateCfg({ ...parseEnv(SAMPLE_ENV), HEMIS_REDIRECT_URI: 'javascript:alert(1)' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain('HEMIS_REDIRECT_URI http(s) emas');
  });

  it('buildAuthUrl client_id/redirect_uri/state encode qiladi va secret ishtirok etmaydi', () => {
    const url = buildAuthUrl({
      clientId: '8',
      redirectUri: 'http://hemis-oauth-test.lc/index.php?x=1&y=2',
      state: 'edikit_test_123 abc',
    });
    expect(url).toContain('client_id=8');
    expect(url).toContain(encodeURIComponent('http://hemis-oauth-test.lc/index.php?x=1&y=2'));
    expect(url).toContain(encodeURIComponent('edikit_test_123 abc'));
    expect(url).not.toContain('secret');
    expect(url).not.toContain('Vt5dnZtzK');
    expect(url.startsWith('https://student.hemis.uz/oauth/authorize?')).toBe(true);
  });

  it('resolveUrl relative Location\'ni base ga nisbatan absolute qiladi', () => {
    expect(resolveUrl('https://student.hemis.uz/dashboard/login', 'login')).toBe('https://student.hemis.uz/dashboard/login');
    expect(resolveUrl('https://student.hemis.uz/oauth/authorize', '/dashboard/login')).toBe('https://student.hemis.uz/dashboard/login');
    expect(resolveUrl('https://student.hemis.uz/oauth/authorize', 'https://x.example/cb?code=abc')).toBe('https://x.example/cb?code=abc');
    expect(resolveUrl('https://a.uz/x', null)).toBeNull();
    expect(resolveUrl('not-a-url', 'x')).toBeNull();
  });

  it('no-leak guard: secret qiymatlarning hech biri REDACT natijasida to\'liq ko\'rinmaydi', () => {
    const cfg = parseEnv(SAMPLE_ENV);
    for (const key of ['HEMIS_CLIENT_SECRET', 'HEMIS_PASSWORD', 'HEMIS_USERNAME']) {
      const redacted = REDACT(cfg[key]);
      expect(redacted).not.toContain(cfg[key]);
      expect(redacted.length).toBeLessThan(cfg[key].length + 20);
    }
  });
});
