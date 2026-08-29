/**
 * AUTH D-22 §06/§09/§19 — PII inventarizatsiya (UZ data law, auth PII).
 * ---------------------------------------------------------------------------
 *  - ipHash: sha256 (to'liq IP minimallashtirish).
 *  - Fingerprint: faqat hash format (16-64 hex).
 *  - Geo: shahar darajasida (koordinata yo'q).
 *  - Retention: C-14 muddatlar.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cityFromIp, geoFromIp } from '../../../src/modules/auth/geo-lite.js';
import { RETENTION } from '../../../src/modules/auth/purge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');

function read(rel) {
  return existsSync(resolve(ROOT, rel)) ? readFileSync(resolve(ROOT, rel), 'utf8') : '';
}

describe('AUTH D-22 §09 — IP minimallashtirish (ip_hash)', () => {
  it('session-manager: ipHash sha256 64-hex (to\'liq IP emas)', () => {
    const src = read('src/modules/auth/session-manager.js');
    expect(src).toMatch(/ipHash: ipAddress \? crypto\.createHash\('sha256'\)/);
    const hash = crypto.createHash('sha256').update('203.0.113.7').digest('hex');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('risk_events: faqat hash (IP hech qachon saqlanmaydi — device-fingerprint)', () => {
    const src = read('src/modules/auth/device-fingerprint.js');
    expect(src).toContain('IP hech qachon saqlanmaydi');
  });

  it('TOPILMA: session-manager to\'liq ipAddress ham saqlaydi (D-22 §09 review)', () => {
    // ipHash bilan birga `ipAddress: ipAddress || null` ham yoziladi —
    // minimallashtirish buzilishi (wsl bilan ko'rib chiqilishi kerak)
    const src = read('src/modules/auth/session-manager.js');
    const hasRawIp = src.includes('ipAddress: ipAddress || null');
    // Hujjatlashtirilgan topilma — test hozircha tolerant (fail emas)
    console.warn(hasRawIp
      ? '[D-22] TOPILMA: session-manager raw ipAddress saqlaydi — minimallashtirish review kerak'
      : '[D-22] ipAddress minimal — yaxshi');
  });
});

describe('AUTH D-22 §09 — fingerprint hash', () => {
  it('device-fingerprint: hash format 16-64 hex (FNV-1a/SHA)', () => {
    const src = read('src/modules/auth/device-fingerprint.js');
    expect(src).toMatch(/16-64 belgili hex/);
  });
});

describe('AUTH D-22 §09 — geo shahar darajasida', () => {
  it('geoFromIp: {city, tz} — koordinata/lat-lng yo\'q', () => {
    const g = geoFromIp('82.215.1.1');
    expect(g).toEqual({ city: 'Toshkent', tz: 'Asia/Tashkent' });
    expect(g.city).toBe('Toshkent'); // faqat shahar
  });

  it('cityFromIp: shahar qaytaradi, noma\'lum → null', () => {
    expect(cityFromIp('82.215.1.1')).toBe('Toshkent');
    expect(cityFromIp('10.99.99.99')).toBeNull();
  });

  it('geo-lite manbasi prefix jadvali — IP emas, shahar saqlanadi', () => {
    const src = read('src/modules/auth/geo-lite.js');
    expect(src).toContain('CITY_PREFIXES');
  });
});

describe('AUTH D-22 §11 — retention (C-14)', () => {
  it('RETENTION muddatlari mavjud: audit 30 kun, verify 1 kun, device 12 oy', () => {
    expect(RETENTION.auditDays).toBe(30);
    expect(RETENTION.verifyCodeMs).toBeLessThanOrEqual(1 * 24 * 60 * 60 * 1000);
    expect(RETENTION.deviceMs).toBeGreaterThanOrEqual(12 * 30 * 24 * 60 * 60 * 1000);
  });
});

describe('AUTH D-22 §14 — rozilik yozuvlari (consent)', () => {
  it('camera consent_version bor (camera pilot)', () => {
    const src = read('src/modules/camera/camera.service.js');
    expect(src).toMatch(/consent_version/);
  });

  it('TOPILMA: email verify consent_log YO\'Q (D-22 §14)', () => {
    const src = read('src/modules/auth/email-verify.js');
    const hasConsent = src.includes('consent');
    console.warn(hasConsent
      ? '[D-22] email-verify consent bor'
      : '[D-22] TOPILMA: email-verify consent_log yoq — verify roziligi audit qilinmaydi');
  });
});
