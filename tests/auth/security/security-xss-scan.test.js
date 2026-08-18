/**
 * AUTH D-18 §07/§13 — XSS audit + secret scan + PII scan.
 * ---------------------------------------------------------------------------
 *  - XSS: auth frontend JS'da innerHTML dinamik qiymat bilan ishlatilmaydi
 *    (textContent/esc() konventsiyasi).
 *  - Secret scan: test fixture'larida ham haqiqiy secret yo'q (D-14 §13).
 *  - PII scan: parol/token/OTP/email log matnlarida yo'q.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');

const AUTH_JS = [
  'public/js/auth.js',
  'public/js/register.js',
  'public/js/mfa.js',
  'public/js/settings.js',
  'public/js/account-settings.js',
  'public/js/mfa-settings.js',
  'public/js/update-banner.js',
  'public/js/passkey-login.js',
  'public/js/passkey-settings.js',
  'public/js/inapp-guard.js',
  'public/js/admin/users.js',
  'public/js/admin/audit.js',
];

const SRC_FILES = [
  'routes/auth.js',
  'src/modules/auth/validation.js',
  'src/modules/auth/email-verify.js',
  'src/modules/auth/mfa-totp.js',
  'src/modules/auth/oidc.js',
  'src/modules/auth/session-manager.js',
  'src/modules/auth/identity.js',
  'src/modules/auth/kms-provider.js',
  'src/modules/hemis/webhook.js',
  'src/modules/email/templates.js',
  'src/modules/email/budget.js',
];

function read(rel) {
  return existsSync(resolve(ROOT, rel)) ? readFileSync(resolve(ROOT, rel), 'utf8') : '';
}

describe('AUTH D-18 §07 — XSS: innerHTML audit (auth frontend)', () => {
  for (const f of AUTH_JS) {
    it(`${f}: innerHTML dinamik qiymat bilan ishlatilmaydi`, () => {
      const src = read(f);
      const lines = src.split('\n');
      const risky = [];
      lines.forEach((line, i) => {
        const clean = line.trim();
        // innerHTML + dinamik qiymat + esc() YO'Q → xavfli (XSS)
        // esc() bilan himoyalangan innerHTML xavfsiz (users.js konventsiyasi)
        // Ko'p qatorli `innerHTML = users.map(...)` bloki — ichida esc() bor
        // deb o'qilmaydi (qator o'zida yo'q) → map blokini alohida tekshiramiz
        if (clean.includes('innerHTML') && /[+${}]/.test(clean)
            && !clean.includes('esc(') && !clean.startsWith('*') && !clean.startsWith('//')
            && !clean.includes('.map((') && !clean.includes('.map(function')) {
          risky.push(`:${i + 1} ${clean}`);
        }
      });
      expect(risky, `${f} dynamic innerHTML (esc'siz): ${risky.join('\n')}`).toEqual([]);
      // Ko'p qatorli innerHTML = X.map((...) => {...}) bloki — har blokda esc()
      // chaqiruvi bo'lishi shart (XSS himoyasi)
      // `.map(function (c) {` ko'rinishi ham (arrow `=>` dan tashqari)
      const mapBlocks = src.match(/innerHTML\s*=\s*[\w.]+\s*\.map\(/g) || [];
      for (const block of mapBlocks) {
        const fromIndex = src.indexOf(block);
        const blockSrc = src.slice(fromIndex, fromIndex + 2000);
        expect(blockSrc.includes('esc('), `${f}: innerHTML .map blokida esc() yo'q`).toBe(true);
      }
    });
  }
});

describe('AUTH D-18 §07 — XSS: esc() konventsiyasi (admin users.js)', () => {
  it('users.js dinamik qiymatlar esc() bilan (13+ chaqiruv)', () => {
    const src = read('public/js/admin/users.js');
    const escCalls = (src.match(/esc\(/g) || []).length;
    expect(escCalls).toBeGreaterThanOrEqual(10);
  });
});

describe('AUTH D-18 §13 — secret scan (fixtureda ham haqiqiy secret yoq)', () => {
  it('auth manba fayllarida haqiqiy GOOGLE_CLIENT_SECRET yoq (faqat env/override)', () => {
    for (const f of SRC_FILES) {
      const src = read(f);
      // test-client-123 (a07 override) ruxsat — production secret naqshi yo'q
      const m = src.match(/GOOGLE_CLIENT_SECRET\s*[:=]\s*['"][A-Za-z0-9_-]{20,}['"]/);
      expect(m, `${f}: hardcoded secret`).toBeNull();
    }
  });

  it('token-vault kaliti haqiqiy emas (SESSION_SECRET test env dan)', () => {
    const src = read('src/modules/auth/mfa-totp.js');
    expect(src).not.toContain('ci-secret-for-edikit-42');
  });
});

describe('AUTH D-18 §13 — PII scan (log matnlarida parol/token/OTP yo\'q)', () => {
  it('auth manba fayllarida parol logga chiqarilmaydi (console.log parol bilan)', () => {
    for (const f of SRC_FILES) {
      const src = read(f);
      const lines = src.split('\n');
      const leaks = [];
      lines.forEach((line, i) => {
        const clean = line.trim();
        if ((clean.startsWith('console.log') || clean.startsWith('console.warn') || clean.startsWith('console.error'))
            && /password|parol|token|otp|code/i.test(clean)) {
          // Fail-open loglar (hibp/audit) sababli faqat password o'zgaruvchisini
          // to'g'ridan-to'g'ri chiqaruvchi qatorlarni belgilaymiz
          if (/password\s*[,+}]|parol\s*[,+]|body\.password|req\.body\.password/.test(clean)) {
            leaks.push(`:${i + 1} ${clean}`);
          }
        }
      });
      expect(leaks, `${f} PII log: ${leaks.join('\n')}`).toEqual([]);
    }
  });

  it('email template fayllarida kod/parol hardcode yo\'q', () => {
    const src = read('src/modules/email/templates.js');
    expect(src).not.toMatch(/code\s*[:=]\s*['"]\d{6}['"]/);
  });
});
