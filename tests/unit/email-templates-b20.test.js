/**
 * AUTH B-20 — Email templates: 8 tur, 4 til, accessible, spam-safe.
 * ----------------------------------------------------------------
 * 1) Barcha 8 template × 4 til render bo‘ladi (html + text + preheader).
 * 2) Spam-trigger skaner toza (FREE/URGENT/!!!/ALL CAPS yo‘q).
 * 3) XSS: foydalanuvchi kiritgan qiymatlar escapelanadi (html + text).
 * 4) Welcome: CTA “Birinchi amaliyotni boshlang” mavjud.
 * 5) Teacher_rejected: sabab (reason) ko‘rsatiladi.
 * 6) Security: 4 variant (password_changed/email_changed/new_device/suspicious),
 *    vaqt/qurilma/shahar agregatlari mavjud, raw IP/UA yo‘q.
 * 7) Breach: CTA “Parolni o‘zgartirish” mavjud.
 * 8) Token/parol hech qachon (faqat kod/limitli havola).
 */
import { describe, it, expect } from 'vitest';

const { renderTemplate, renderSecurity, renderBreach, renderWelcome, renderTeacherRejected, EMAIL_TEMPLATES, scanSpamTriggers, esc } =
  await import('../../src/modules/email/templates.js');

const LANGS = ['uz', 'uz-cyrl', 'ru', 'en'];

function sampleData(name, lang) {
  if (name === 'verify') return { code: '111111', lang };
  if (name === 'reset') return { resetUrl: 'https://edikit.uz/user/reset?token=abc', lang };
  if (name === 'teacher_rejected') return { username: 'user1', lang, reason: 'Hujjatlar to‘liq emas' };
  if (name === 'security') {
    return { type: 'suspicious', username: 'user1', lang, device: 'Chrome', browser: 'Windows', city: 'Toshkent', time: '12:30' };
  }
  return { username: 'user1', lang };
}

describe('AUTH B-20 email templates', () => {
  it('EMAIL_TEMPLATES 8 turdan iborat', () => {
    expect(EMAIL_TEMPLATES).toHaveLength(8);
    for (const n of ['verify', 'reset', 'welcome', 'invite', 'teacher_approved', 'teacher_rejected', 'security', 'breach']) {
      expect(EMAIL_TEMPLATES).toContain(n);
    }
  });

  it('barcha 8 template × 4 til render bo‘ladi (html + text + preheader + subject)', () => {
    for (const name of EMAIL_TEMPLATES) {
      for (const lang of LANGS) {
        const t = renderTemplate(name, sampleData(name, lang));
        expect(t.html, `${name}/${lang} html`).toContain('</html>');
        expect(t.text.length, `${name}/${lang} text`).toBeGreaterThan(10);
        expect(t.preheader, `${name}/${lang} preheader`).toBeTruthy();
        expect(t.subject, `${name}/${lang} subject`).toBeTruthy();
        // a11y: semantic table + lang attribute
        expect(t.html).toContain('role="presentation"');
        expect(t.html).toMatch(/<html lang="/);
      }
    }
  });

  it('spam-trigger skaner: barcha 8 template × 4 til toza', () => {
    for (const name of EMAIL_TEMPLATES) {
      for (const lang of LANGS) {
        const t = renderTemplate(name, sampleData(name, lang));
        const scan = scanSpamTriggers({ subject: t.subject, html: t.html, text: t.text });
        expect(scan.ok, `${name}/${lang}: ${scan.triggers.join(',')}`).toBe(true);
      }
    }
  });

  it('XSS: foydalanuvchi kiritgan qiymatlar escapelanadi (html + text)', () => {
    const evil = '<script>alert(1)</script>';
    // security — device/city/time
    const sec = renderSecurity({ type: 'suspicious', device: evil, city: 'X"Y', time: evil, lang: 'en' });
    expect(sec.html).not.toContain('<script>');
    expect(sec.text).not.toContain('<script>');
    expect(sec.html).not.toContain('"Y'); // city quote escaped
    // teacher_rejected — reason
    const rej = renderTeacherRejected({ username: 'u', reason: evil, lang: 'en' });
    expect(rej.html).not.toContain('<script>');
    expect(rej.text).not.toContain('<script>');
    // esc() birlik tekshiruvi
    expect(esc(evil)).not.toContain('<script>');
    expect(esc('a\r\nBcc: x')).not.toMatch(/[\r\n]/);
  });

  it('welcome: CTA “Birinchi amaliyotni boshlang” mavjud (barcha tillar)', () => {
    for (const lang of LANGS) {
      const t = renderWelcome({ username: 'user1', lang });
      expect(t.html).toContain('edikit.uz/user/onboarding');
      expect(t.text).toContain('edikit.uz/user/onboarding');
      expect(t.html).toContain('background:#1d4ed8'); // CTA button
    }
  });

  it('teacher_rejected: sabab ko‘rsatiladi', () => {
    for (const lang of LANGS) {
      const t = renderTeacherRejected({ username: 'u', lang, reason: 'Hujjatlar to‘liq emas' });
      expect(t.html).toContain('Hujjatlar to‘liq emas');
      expect(t.text).toContain('Hujjatlar to‘liq emas');
      // sababsiz — sabab bloki yo‘q
      const t2 = renderTeacherRejected({ username: 'u', lang });
      expect(t2.html).not.toContain('Hujjatlar to‘liq emas');
    }
  });

  it('security: 4 variant, agregatlar mavjud, raw IP/UA yo‘q', () => {
    for (const type of ['password_changed', 'email_changed', 'new_device', 'suspicious']) {
      for (const lang of LANGS) {
        const t = renderSecurity({ type, username: 'u', lang, device: 'Chrome', browser: 'Windows', city: 'Toshkent', time: '12:30' });
        expect(t.html).toContain('Chrome');
        expect(t.html).toContain('Windows');
        expect(t.html).toContain('Toshkent');
        expect(t.html).toContain('12:30');
        expect(t.html).toContain('edikit.uz/user/panel#security');
        expect(t.html).not.toContain('ipHash');
        expect(t.html).not.toContain('userAgent');
        expect(t.text).toContain('Toshkent');
      }
    }
    // noma'lum type → new_device
    const t = renderSecurity({ type: 'weird', lang: 'en' });
    expect(t.subject).toContain('New device');
  });

  it('breach: CTA “Parolni o‘zgartirish” va breach xabari', () => {
    for (const lang of LANGS) {
      const t = renderBreach({ username: 'u', lang });
      expect(t.html).toContain('edikit.uz/user/panel#security');
      expect(t.text).toContain('edikit.uz/user/panel#security');
      expect(t.html).toContain('background:#1d4ed8'); // CTA
    }
  });

  it('token/parol hech qachon emailda (verify faqat kod, reset faqat havola)', () => {
    const v = renderTemplate('verify', { code: '123456', lang: 'en' });
    expect(v.html).toContain('123456'); // kod — ruxsat
    const r = renderTemplate('reset', { resetUrl: 'https://edikit.uz/user/reset?token=abc', lang: 'en' });
    expect(r.html).toContain('token=abc'); // havola — ruxsat
    // hech qayerda plaintext parol yo‘q
    const all = EMAIL_TEMPLATES.map((n) => {
      const t = renderTemplate(n, sampleData(n, 'en'));
      return t.html + t.text;
    }).join(' ');
    expect(all).not.toMatch(/password[=:]\S{6,}/i);
  });
});
