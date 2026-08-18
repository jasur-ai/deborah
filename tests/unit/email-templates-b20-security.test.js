/**
 * AUTH B-20 §24 — Security: token leak yo'q (grep), XSS (user data escape).
 * ------------------------------------------------------------------------
 * 1) templates.js'da hech qanday real token/secret hardcode yo'q.
 * 2) Template'larda reset token/parol hech qachon chiqmaydi (faqat havola).
 * 3) XSS: barcha user-input interpolatsiyalari escapelanadi.
 * 4) PII: security template'da raw IP/UA yo'q.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_SRC = readFileSync(join(__dirname, '../../src/modules/email/templates.js'), 'utf8');

const { renderTemplate, renderSecurity, renderBreach, EMAIL_TEMPLATES, esc } =
  await import('../../src/modules/email/templates.js');

describe('AUTH B-20 — Email templates security', () => {
  it('templates.js da hech qanday real secret/token hardcode yo‘q', () => {
    // SESSION_SECRET, API kalitlar, uzun base64 tokenlar — yo'q
    expect(TPL_SRC).not.toMatch(/SESSION_SECRET\s*[:=]/);
    expect(TPL_SRC).not.toMatch(/SECRET\s*[:=]\s*['"][A-Za-z0-9+/]{16,}['"]/i);
    expect(TPL_SRC).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/i);
    expect(TPL_SRC).not.toMatch(/sk-[A-Za-z0-9]{16,}/i);
  });

  it('template‘larda parol/token hech qachon — faqat limitli havola yoki 6-kod', () => {
    for (const name of EMAIL_TEMPLATES) {
      const data = name === 'verify' ? { code: '123456', lang: 'en' }
        : name === 'reset' ? { resetUrl: 'https://edikit.uz/user/reset?token=abc', lang: 'en' }
        : { username: 'u', lang: 'en' };
      const t = renderTemplate(name, data);
      // Kod/limitli havola ruxsat — lekin to'liq parol yoki session cookie yo'q
      expect(t.html).not.toMatch(/password=[^\s&]+/i);
      expect(t.html).not.toMatch(/connect\.sid|sessionid|PHPSESSID/i);
    }
  });

  it('XSS: barcha user-input escape qilinadi (HTML + text versiyalar)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const sec = renderSecurity({ type: 'suspicious', device: evil, city: evil, time: evil, lang: 'en' });
    // Raw `<img` hech qachon — esc() uni &lt;img qiladi (brauzer text deb o'qiydi)
    expect(sec.html).not.toContain('<img');
    expect(sec.html).not.toMatch(/<\w+[^>]*onerror/i); // hech qanday raw event-handler tag
    expect(sec.html).toContain('&lt;img'); // escaped — xavfsiz
    expect(sec.text).not.toContain('<img');
    const breach = renderBreach({ username: evil, lang: 'en' });
    expect(breach.html).not.toContain('<img');
    expect(breach.text).not.toContain('<img');
    expect(esc(evil)).toContain('&lt;img');
    expect(esc(evil)).not.toContain('<img');
  });

  it('PII: security template da raw IP/UA/userAgent hech qachon', () => {
    const t = renderSecurity({
      type: 'suspicious',
      device: 'Chrome',
      browser: 'Windows',
      city: 'Toshkent',
      time: '12:30',
      lang: 'en',
    });
    // Agregatlar mavjud
    expect(t.html).toContain('Chrome');
    expect(t.html).toContain('Windows');
    expect(t.html).toContain('Toshkent');
    // PII emas: ipHash, raw UA, ip manzil pattern'lari yo'q
    expect(t.html).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(t.html).not.toMatch(/ipHash|userAgent|ip_address/i);
  });

  it('breach template: CTA to‘g‘ri va xavfsiz havola', () => {
    const t = renderBreach({ lang: 'en' });
    expect(t.html).toContain('https://edikit.uz/user/panel#security');
    expect(t.html).not.toContain('javascript:');
    expect(t.text).toContain('https://edikit.uz/user/panel#security');
  });
});
