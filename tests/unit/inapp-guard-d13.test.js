/**
 * AUTH D-13 — In-app browser guard (public/js/inapp-guard.js) — Unit tests
 * -------------------------------------------------------------------------
 *  - Telegram/WhatsApp/Instagram WebView UA'da → banner ko'rsatiladi,
 *    matn i18n (`__INAPP_COPY__`) dan, "Tashqi brauzerda oching" tugmasi bor.
 *  - Oddiy brauzer UA'da → banner YO'Q.
 *  - XSS: banner matni textContent (innerHTML emas) — i18n matn HTML sifatida
 *    talqin qilinmaydi.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const COPY = JSON.stringify({
  openBrowser: 'Tashqi brauzerda oching',
  realBrowser: 'Xavfsizlik uchun parolni faqat brauzerda kiriting.',
  install: 'Ilovani o\u2018rnatish',
});

async function boot(ua) {
  // Har boot'da module'ni qayta yuklash (import cache'ni tozalash)
  vi.resetModules();
  // userAgent ni almashtirish — jsdom'da navigator.userAgent mock
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  document.body.innerHTML = '<main><h1>Login</h1></main>';
  window.__INAPP_COPY__ = COPY;
  await import('../../public/js/inapp-guard.js');
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.__INAPP_COPY__;
});

describe('AUTH D-13 — in-app browser guard', () => {
  it('Telegram WebView → banner ko\'rinadi + i18n matn + tugma', async () => {
    await boot('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 TelegramBot/2.0');
    const banner = document.querySelector('.inapp-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Xavfsizlik uchun parolni faqat brauzerda kiriting.');
    const btn = banner.querySelector('button');
    expect(btn.textContent).toBe('Tashqi brauzerda oching');
    // XSS: i18n matn HTML sifatida yozilmaydi
    expect(banner.querySelector('span').innerHTML).not.toContain('<');
  });

  it('WhatsApp WebView → banner ko\'rinadi', async () => {
    await boot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 WhatsApp/2.23');
    expect(document.querySelector('.inapp-banner')).toBeTruthy();
  });

  it('Instagram WebView → banner ko\'rinadi', async () => {
    await boot('Mozilla/5.0 (Linux; Android 13) Instagram 300.0.0.0.00 Android');
    expect(document.querySelector('.inapp-banner')).toBeTruthy();
  });

  it('oddiy brauzer → banner YO\'Q', async () => {
    await boot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0');
    expect(document.querySelector('.inapp-banner')).toBeNull();
  });

  it('banner yopish tugmasi banner\'ni olib tashlaydi', async () => {
    await boot('Mozilla/5.0 (Linux; Android 13) TelegramBot/2.0');
    const banner = document.querySelector('.inapp-banner');
    const buttons = banner.querySelectorAll('button');
    // oxirgi tugma — yopish (×)
    buttons[buttons.length - 1].click();
    expect(document.querySelector('.inapp-banner')).toBeNull();
  });
});
