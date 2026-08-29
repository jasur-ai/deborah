/**
 * AUTH D-24 — Public legal pages (/privacy /terms /cookies)
 * -----------------------------------------------------------------
 *  - 3 hujjat 4 tilda (content: src/modules/legal/legal-docs.js)
 *  - Lang: ?lang → `lang` cookie (persist) → default 'uz'
 *  - Auth talab YO'Q (public GET); EJS auto-escape (XSS yo'q)
 *  - Har testda FRESH agent — lang cookie'si testlar orasida oqib
 *    ketmasligi uchun (D-11 lang persist cookie'ni yozadi).
 *  - Manba: D-24 spec — legal pages + footer havolalari.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';

let app, httpServer;

function fresh() {
  return supertest.agent(app);
}

beforeAll(async () => {
  await snapshotDb();
  ({ app, httpServer } = await createApp());
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH D-24 — legal sahifalar', () => {
  it('/privacy 200 — sarlavha + bo\'limlar + lang switcher', async () => {
    const res = await fresh().get('/privacy');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Maxfiylik siyosati');
    expect(res.text).toContain('v1.0.0');
    expect(res.text).toContain('Qanday maʼlumotlar yigʼiladi');
    // lang switcher 4 til
    for (const l of ['uz', 'uz-cyrl', 'ru', 'en']) {
      expect(res.text).toContain(`?lang=${l}`);
    }
  });

  it('/privacy?lang=en — inglizcha sarlavha', async () => {
    const res = await fresh().get('/privacy?lang=en');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Privacy Policy');
  });

  it('lang cookie persist ishlaydi (en)', async () => {
    const res = await fresh().set('Cookie', 'lang=en').get('/terms');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Terms of Service');
  });

  it('noma\'lum lang → default uz', async () => {
    const res = await fresh().get('/privacy?lang=zz');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Maxfiylik siyosati');
  });

  it('/terms va /cookies 200 — uz sarlavhalar', async () => {
    const terms = await fresh().get('/terms');
    expect(terms.status).toBe(200);
    expect(terms.text).toContain('Foydalanish shartlari');
    const cookies = await fresh().get('/cookies');
    expect(cookies.status).toBe(200);
    expect(cookies.text).toContain('Cookie siyosati');
  });

  it('/legal ro\'yxat sahifasi — 3 havola', async () => {
    const res = await fresh().get('/legal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/privacy?lang=uz');
    expect(res.text).toContain('/terms?lang=uz');
    expect(res.text).toContain('/cookies?lang=uz');
  });

  it('auth sahifalarida legal footer havolalari (login/register)', async () => {
    const login = await fresh().get('/user/login');
    expect(login.status).toBe(200);
    expect(login.text).toContain('href="/cookies"');
    const register = await fresh().get('/user/register');
    expect(register.status).toBe(200);
    expect(register.text).toContain('href="/cookies"');
  });

  it('content xavfsiz render — kontakt + EJS escape', async () => {
    const res = await fresh().get('/privacy');
    expect(res.status).toBe(200);
    expect(res.text).toContain('support@deborah.uz');
    // Hujjat matnida hech qanday havola atrofida onerror bo'lmasligi kerak —
    // faqat logo (server tomonidan qo'shilgan) onerror ishlatishi mumkin.
    // Toza tekshiruv: kontent bo'limlarida raw `<script` ochilmagan.
    const bodyStart = res.text.indexOf('legal-box');
    const bodySlice = res.text.slice(bodyStart);
    expect(bodySlice).not.toContain('<script');
  });
});
