/**
 * AUTH D-16 §07/§11/§27 — Email core unit testlari (B-06/B-20/B-24)
 * ---------------------------------------------------------------------------
 *  - Template 4 til render bir xil struktur (subject/html/text/preheader).
 *  - Kod preheader'da, HTML blokda, text'da — barcha formatlar bir xil kod.
 *  - XSS: renderEmailChange newEmailMasked esc qilinadi.
 *  - Til fallback: noma'lum lang → default (uz).
 */

import { describe, it, expect } from 'vitest';
import { renderVerify, renderEmailChange, renderReset, renderWelcome } from '../../../src/modules/email/templates.js';

const LANGS = ['uz', 'uz-cyrl', 'ru', 'en'];

describe('AUTH D-16 §27 — template 4 til bir xil struktur', () => {
  it('renderVerify: 4 tilda subject/html/text/preheader bir xil struktur', () => {
    for (const lang of LANGS) {
      const r = renderVerify({ code: '123456', lang });
      expect(r.subject).toBeTruthy();
      expect(r.html).toContain('<h1'); // sarlavha
      expect(r.html).toContain('123456'); // kod HTML blokda
      expect(r.text).toContain('123456'); // kod text'da
      expect(r.preheader).toContain('123456'); // kod preheader'da
    }
  });

  it('4 til matnlari har xil (haqiqiy tarjima)', () => {
    const subjects = LANGS.map((l) => renderVerify({ code: '123456', lang: l }).subject);
    expect(new Set(subjects).size).toBeGreaterThan(1);
  });

  it('noma\'lum lang → fallback (default uz) — buzilmaydi', () => {
    const r = renderVerify({ code: '123456', lang: 'xx' });
    expect(r.subject).toBeTruthy();
    expect(r.html).toContain('123456');
  });

  it('renderWelcome: username text formatda 4 tilda (html CTA href bir xil)', () => {
    for (const lang of LANGS) {
      const r = renderWelcome({ username: 'student42', lang });
      expect(r.text).toContain('student42');
      // CTA struktur — onboarding havolasi 4 tilda bir xil
      expect(r.html).toContain('https://edikit.uz/user/onboarding');
      expect(r.subject).toBeTruthy();
    }
  });

  it('renderReset: resetUrl 4 tilda', () => {
    for (const lang of LANGS) {
      const r = renderReset({ resetUrl: 'https://edikit.uz/user/reset?token=abc', lang });
      expect(r.html).toContain('https://edikit.uz/user/reset?token=abc');
    }
  });
});

describe('AUTH D-16 §24 — email change XSS (B-24)', () => {
  it('newEmailMasked HTML sifatida talqin qilinmaydi (esc)', () => {
    const r = renderEmailChange({ code: 'CODE1', kind: 'new', newEmailMasked: '<script>alert(1)</script>', lang: 'uz' });
    expect(r.html).not.toContain('<script>alert(1)</script>');
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('kod HTML blokda xavfsiz ko\'rinadi', () => {
    const r = renderEmailChange({ code: 'ABC-DEF', kind: 'new', newEmailMasked: 'a***@test.uz', lang: 'en' });
    expect(r.html).toContain('ABC-DEF');
  });
});
