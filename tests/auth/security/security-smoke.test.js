/**
 * AUTH D-14 §18 — Security suite skeleton.
 * ---------------------------------------------------------------------------
 * D-14 §13: test real production data'ga ulanmaydi, secret'lar fixture'da
 * ham haqiqiy emas. Bu fayl security suite'ning asosiy guard'larini
 * tekshiradi — keyingi security testlar shu yerga qo'shiladi.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getApp, createRequest } from '../../helpers/setup.js';

describe('AUTH D-14 §18 — security suite skeleton', () => {
  beforeAll(async () => {
    await getApp();
  });

  it('login sahifasida parol hech qachon value sifatida ko rinmaydi', async () => {
    const req = await createRequest();
    const res = await req.get('/user/login');
    // password input value atributi bo'lmasligi kerak
    expect(res.text).not.toMatch(/type="password"[^>]*value=/);
  });

  it('login sahifasida hech qanday secret/token leak yo q', async () => {
    const req = await createRequest();
    const res = await req.get('/user/login');
    // SESSION_SECRET / haqiqiy API kalitlari render qilinmaydi
    expect(res.text).not.toContain('test-secret-for-deborah-42');
    expect(res.text).not.toContain('TURNSTILE_SECRET_KEY');
    expect(res.text).not.toContain('TELEGRAM_BOT_TOKEN');
  });

  it('security headers mavjud (helmet)', async () => {
    const req = await createRequest();
    const res = await req.get('/user/login');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
