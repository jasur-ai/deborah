/**
 * AUTH B-06 — Email verify send (6-kod): 4 til template + lang pass-through
 * -------------------------------------------------------------------------
 * - renderVerify: 4 til (uz / uz-cyrl / ru / en) — subject + body + codeLabel
 * - sendVerifyCode: lang parametri qabul qiladi (template tilini tanlaydi),
 *   delivery email_log'ga template='verify' sifatida yoziladi (PII minimal)
 * - Noto'g'ri lang → default 'uz' (resolveTemplateLang)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { renderVerify } from '../../src/modules/email/templates.js';
import { sendVerifyCode } from '../../src/modules/auth/email-verify.js';

const LANGS = ['uz', 'uz-cyrl', 'ru', 'en'];

describe('AUTH B-06 — verify template 4 til', () => {
  it('har til uchun subject + codeLabel + kod bor', () => {
    for (const lang of LANGS) {
      const tpl = renderVerify({ code: '123456', lang });
      expect(tpl.subject.length).toBeGreaterThan(0);
      expect(tpl.html).toContain('123456');
      expect(tpl.text).toContain('123456');
      expect(tpl.subject).toContain('Edikit');
    }
  });

  it('tilga qarab subject farqlanadi (en ≠ uz)', () => {
    const uz = renderVerify({ code: '123456', lang: 'uz' });
    const en = renderVerify({ code: '123456', lang: 'en' });
    expect(uz.subject).not.toBe(en.subject);
    expect(en.subject.toLowerCase()).toContain('verification');
    expect(uz.subject.toLowerCase()).toContain('tasdiqlash');
  });

  it("noto'g'ri lang → default uz (resolveTemplateLang fallback)", () => {
    const tpl = renderVerify({ code: '111111', lang: 'zz' });
    expect(tpl.subject.toLowerCase()).toContain('tasdiqlash');
  });

  it('uz-cyrl template: kirillcha codeLabel, kod ham bor', () => {
    const tpl = renderVerify({ code: '654321', lang: 'uz-cyrl' });
    expect(tpl.text).toContain('654321');
    expect(tpl.text).toMatch(/[а-яА-ЯЁё]/);
  });
});

describe('AUTH B-06 — sendVerifyCode lang pass-through + delivery', () => {
  beforeAll(async () => {
    await snapshotDb();
  });

  afterAll(async () => {
    await restoreDb();
  });

  it("lang=en → ok + email_log'da verify entry (delivery natijasi)", async () => {
    const email = `b06en_${Date.now() % 1000000}@test.uz`;
    const res = await sendVerifyCode({ userKey: 'b06enuser', email, lang: 'en' });
    expect(res.ok).toBe(true);
    expect(res.delivery).toMatch(/^(sent|queued)$/);

    // email_log'da eng so'nggi verify yozuvi — template='verify', status yozilgan
    const logSnap = await fb.get('email_log');
    const log = logSnap.val() || {};
    const entries = Object.values(log).filter((e) => e.template === 'verify');
    const last = entries[entries.length - 1];
    expect(last).toBeTruthy();
    expect(last.status).toMatch(/^(sent|queued|failed)$/);
    expect(typeof last.emailHash).toBe('string');
    // plaintext email email_log'da YO'Q (PII minimal)
    expect(JSON.stringify(last)).not.toContain(email);
  });

  it("lang=ru → ok (template til xatosi yo'q)", async () => {
    const email = `b06ru_${Date.now() % 1000000}@test.uz`;
    const res = await sendVerifyCode({ userKey: 'b06ruuser', email, lang: 'ru' });
    expect(res.ok).toBe(true);
    expect(res.code).toMatch(/^\d{6}$/); // dev/test preview
  });

  it('lang=uz-cyrl → ok', async () => {
    const email = `b06cyrl_${Date.now() % 1000000}@test.uz`;
    const res = await sendVerifyCode({ userKey: 'b06cyrluser', email, lang: 'uz-cyrl' });
    expect(res.ok).toBe(true);
  });
});
