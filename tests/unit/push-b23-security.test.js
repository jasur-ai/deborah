import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd());

describe('B-23 Push — security', () => {
  it('service-worker.js da sensitive payload yo\'q (title/body/url/tag dan boshqa hech narsa render qilinmaydi)', () => {
    const sw = readFileSync(join(root, 'public/service-worker.js'), 'utf8');
    // Payload'da faqat minimal maydonlar ishlatiladi
    const pushSection = sw.slice(sw.indexOf("addEventListener('push'"));
    expect(pushSection).toMatch(/data\.title/);
    expect(pushSection).toMatch(/data\.body/);
    // PII render yo'q — masalan email/telegram_id/parol payload'da yo'q
    expect(pushSection).not.toMatch(/email/);
    expect(pushSection).not.toMatch(/telegram_id/);
    expect(pushSection).not.toMatch(/password/);
  });

  it('push.js da endpoint/keys PII sifatida UI\'ga chiqmaydi', () => {
    const js = readFileSync(join(root, 'public/js/push.js'), 'utf8');
    // Subscription endpoint DOM'ga yozilmaydi (faqat server'ga POST)
    expect(js).not.toMatch(/innerHTML/);
  });

  it('push.ejs da VAPID private key YO\'Q — faqat public', () => {
    const view = readFileSync(join(root, 'views/user/push.ejs'), 'utf8');
    expect(view).toContain('vapidKey');
    expect(view).not.toMatch(/VAPID_PRIVATE|privateKey/i);
  });

  it('routes/push.js da quiet hours va cap tekshiruvlari mavjud modulga ulangan', () => {
    const pushModule = readFileSync(join(root, 'src/modules/student/push.js'), 'utf8');
    // 410 → unsubscribe
    expect(pushModule).toMatch(/410/);
    // quiet hours
    expect(pushModule).toMatch(/isQuietHours/);
    // cap — B-21 checkNotifRate
    expect(pushModule).toMatch(/checkNotifRate/);
    // payload minimal — JSON.stringify({ title, body, url, tag })
    expect(pushModule).toMatch(/title/);
    expect(pushModule).toMatch(/tag/);
  });
});
