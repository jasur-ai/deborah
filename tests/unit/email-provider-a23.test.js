import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('AUTH A-23 — Email provider abstraksiya (unit)', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EMAIL_PROVIDER;
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.SMTP_HOST;
  });

  it('mock transport: hech qaerga yubormaydi, messageId qaytaradi', async () => {
    const { sendEmail } = await import('../../src/modules/email/provider.js');
    const r = await sendEmail(
      { to: 'a@test.uz', subject: 'Test', html: '<p>Hi</p>' },
      { provider: 'mock', checkSuppressed: async () => false },
    );
    expect(r.ok).toBe(true);
    expect(r.provider).toBe('mock');
    expect(r.messageId).toMatch(/^mock-/);
    expect(r.attempts).toBe(1);
  });

  it('suppress qilingan emailga yuborilmaydi (review fix)', async () => {
    const { sendEmail } = await import('../../src/modules/email/provider.js');
    const sendImpl = vi.fn(async () => ({ messageId: 'm1' }));
    const r = await sendEmail(
      { to: 'bounce@test.uz', subject: 'S', html: '<p>Hi</p>' },
      { provider: 'mock', sendImpl, checkSuppressed: async () => true },
    );
    expect(r.ok).toBe(false);
    expect(r.suppressed).toBe(true);
    expect(r.error).toBe('suppressed');
    expect(sendImpl).not.toHaveBeenCalled(); // transport'ga UMUMAN chiqmaydi
  });

  it('sendImpl (test mock) chaqiriladi va xabar to`g`ri keladi', async () => {
    const { sendEmail } = await import('../../src/modules/email/provider.js');
    const sendImpl = vi.fn(async (msg) => ({ messageId: 'm1' }));
    await sendEmail(
      { to: 'a@test.uz', subject: 'S', html: '<b>Hi</b>', tag: 'verify' },
      { provider: 'mock', sendImpl, checkSuppressed: async () => false },
    );
    expect(sendImpl).toHaveBeenCalledTimes(1);
    const msg = sendImpl.mock.calls[0][0];
    expect(msg.to).toBe('a@test.uz');
    expect(msg.tag).toBe('verify');
    expect(msg.text).toContain('Hi'); // plain-text avtomatik stripHtml
  });

  it('retry: 2 ta muvaffaqiyatsiz urinishdan keyin 3-chida muvaffaqiyat', async () => {
    const { sendEmail } = await import('../../src/modules/email/provider.js');
    let calls = 0;
    const sendImpl = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('network');
      return { messageId: 'm-final' };
    });
    const r = await sendEmail(
      { to: 'a@test.uz', subject: 'S', html: '<p>Hi</p>' },
      { provider: 'mock', sendImpl, checkSuppressed: async () => false },
    );
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.messageId).toBe('m-final');
  });

  it('retry: barcha 3 urinish muvaffaqiyatsiz → ok=false', async () => {
    const { sendEmail } = await import('../../src/modules/email/provider.js');
    const sendImpl = vi.fn(async () => {
      throw new Error('always down');
    });
    const r = await sendEmail(
      { to: 'a@test.uz', subject: 'S', html: '<p>Hi</p>' },
      { provider: 'mock', sendImpl, checkSuppressed: async () => false },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe('send-failed');
    expect(r.attempts).toBe(3);
  });

  it('yaroqsiz xabar → error, retry qilmaydi', async () => {
    const { sendEmail } = await import('../../src/modules/email/provider.js');
    const r = await sendEmail({ to: '', subject: '', html: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid-message'); // suppression tekshiruvidan OLDIN (tez rad)
  });

  it('postmark provider: HTTP POST API`ga, token header bilan', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'test-token';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ MessageID: 'pm-123' }),
    }));
    globalThis.fetch = fetchMock;

    const { sendEmail } = await import('../../src/modules/email/provider.js');
    const r = await sendEmail(
      { to: 'a@test.uz', subject: 'S', html: '<p>Hi</p>', tag: 'reset' },
      { provider: 'postmark', checkSuppressed: async () => false },
    );
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('pm-123');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('api.postmarkapp.com');
    expect(opts.headers['X-Postmark-Server-Token']).toBe('test-token');
    const body = JSON.parse(opts.body);
    expect(body.MessageStream).toBe('outbound');
  });

  it('resolveProvider: test rejimida har doim mock', async () => {
    const { resolveProvider } = await import('../../src/modules/email/provider.js');
    expect(resolveProvider({ NODE_ENV: 'test', EMAIL_PROVIDER: 'postmark' })).toBe('mock');
    expect(resolveProvider({ NODE_ENV: 'production', EMAIL_PROVIDER: 'postmark' })).toBe('postmark');
    expect(resolveProvider({ NODE_ENV: 'production', EMAIL_PROVIDER: 'unknown' })).toBe('mock');
  });
});

describe('AUTH A-23 — Email template`lar (4 til + spam-scan) (unit)', () => {
  it('verify template: 4 tilda render, kod mavjud, plain-text mavjud', async () => {
    const { renderVerify } = await import('../../src/modules/email/templates.js');
    for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
      const t = renderVerify({ code: '123456', lang });
      expect(t.subject).toContain('123456' ? 'Deborah' : 'Deborah');
      expect(t.html).toContain('123456');
      expect(t.html).toContain('</html>');
      expect(t.text).toContain('123456');
      expect(t.preheader).toBeTruthy();
    }
  });

  it('reset template: havola mavjud, token hammada bir xil', async () => {
    const { renderReset } = await import('../../src/modules/email/templates.js');
    const url = 'https://deborah.uz/user/reset?token=abc';
    const t = renderReset({ resetUrl: url, lang: 'en' });
    expect(t.html).toContain(url);
    expect(t.text).toContain(url);
  });

  it('barcha template`lar barcha tillarda render bo`ladi', async () => {
    const { renderTemplate, EMAIL_TEMPLATES } = await import('../../src/modules/email/templates.js');
    for (const name of EMAIL_TEMPLATES) {
      for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
        const data = name === 'verify' ? { code: '111111', lang }
          : name === 'reset' ? { resetUrl: 'https://x.uz/r?t=1', lang }
          : { username: 'user1', lang };
        const t = renderTemplate(name, data);
        expect(t.html).toContain('</html>');
        expect(t.text.length).toBeGreaterThan(10);
        expect(t.subject).toBeTruthy();
      }
    }
  });

  it('spam-trigger skaner: barcha template`lar toza (FREE/URGENT/!!!/ALL CAPS yo`q)', async () => {
    const { renderTemplate, EMAIL_TEMPLATES, scanSpamTriggers } = await import('../../src/modules/email/templates.js');
    for (const name of EMAIL_TEMPLATES) {
      for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
        const data = name === 'verify' ? { code: '111111', lang }
          : name === 'reset' ? { resetUrl: 'https://x.uz/r?t=1', lang }
          : { username: 'user1', lang };
        const t = renderTemplate(name, data);
        const scan = scanSpamTriggers({ subject: t.subject, html: t.html, text: t.text });
        expect(scan.ok, `${name}/${lang}: ${scan.triggers.join(',')}`).toBe(true);
      }
    }
  });

  it('noma`lum til → default (uz)', async () => {
    const { renderVerify } = await import('../../src/modules/email/templates.js');
    const t = renderVerify({ code: '123456', lang: 'fr' });
    expect(t.text).toContain('Salom');
  });

  it('esc(): foydalanuvchi kiritgan qiymatlar escapelanadi (review fix)', async () => {
    const { esc, renderWelcome } = await import('../../src/modules/email/templates.js');
    expect(esc('<script>alert(1)</script>')).not.toContain('<script>');
    expect(esc('a\r\nb')).not.toMatch(/[\r\n]/); // header injection
    // Username HTML'ga kirmaydi, lekin text versiyada newline tozalanadi
    const t = renderWelcome({ username: 'u\r\nBcc: evil@x.uz', lang: 'uz' });
    expect(t.text).not.toMatch(/[\r\n]Bcc/);
  });
});
