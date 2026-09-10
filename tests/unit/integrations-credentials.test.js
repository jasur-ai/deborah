/**
 * Deborah — C4-10 rev.4: integratsiya kalitlarini saqlash (unit)
 *
 * Tekshiriladi:
 *   · env ustuvorligi (deploy sozlamalari admin formani yengadi);
 *   · admin panelidan saqlash → shifrlangan fayl, plaintext YO'Q;
 *   · maskalash (secret hech qachon to'liq chiqmaydi);
 *   · majburiy maydonlar va tozalash;
 *   · diskda kalit (SESSION_SECRET) yo'q bo'lsa — saqlash rad etiladi.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = join(ROOT, 'data', 'integration-credentials.json.enc');

const SECRET = 'integration-test-secret-value-1234567890';
const SECRET2 = 'cnvcaTESTsecretVALUE1234567890abcdef';

async function load() {
  return import('../../src/modules/integrations/credentials.js');
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.CREDENTIALS_KEY;
  delete process.env.CANVA_CLIENT_ID;
  delete process.env.CANVA_CLIENT_SECRET;
  delete process.env.CANVA_REDIRECT_URI;
});

afterAll(() => {
  if (existsSync(STORE)) rmSync(STORE, { force: true });
  delete process.env.SESSION_SECRET;
});

describe('credentials — mask()', () => {
  it('oxirgi 4 belgidan boshqasini yashiradi', async () => {
    const { mask } = await load();
    expect(mask('OC-AaCGOvUSxTUN')).toBe('••••xTUN');
    expect(mask('')).toBe('');
    expect(mask('abc')).toBe('••••');
  });
});

describe('credentials — saqlash va o‘qish', () => {
  it('admin panelidan saqlangan kalitlar ishlaydi (source=admin)', async () => {
    const mod = await load();
    mod.clearProviderConfig('canva');
    const r = mod.saveProviderConfig('canva', { clientId: 'OC-TEST', clientSecret: SECRET2, redirectUri: 'https://x.test/api/admin/canva/callback' });
    expect(r.ok).toBe(true);

    const cfg = mod.getProviderConfig('canva');
    expect(cfg.clientId).toBe('OC-TEST');
    expect(cfg.clientSecret).toBe(SECRET2);
    expect(cfg.source).toBe('admin');
    expect(mod.isProviderConfigured('canva')).toBe(true);
    mod.clearProviderConfig('canva');
  });

  it('diskda plaintext secret YO‘Q (AES-256-GCM)', async () => {
    const mod = await load();
    mod.clearProviderConfig('canva');
    mod.saveProviderConfig('canva', { clientId: 'OC-TEST', clientSecret: SECRET2, redirectUri: 'https://x.test/cb' });
    const raw = readFileSync(STORE, 'utf8');
    expect(raw).not.toContain(SECRET2);
    expect(raw).not.toContain('OC-TEST');
    expect(raw.length).toBeGreaterThan(20); // base64 shifrmatn
    mod.clearProviderConfig('canva');
  });

  it('env bo‘lsa u ustuvor (source=env)', async () => {
    const mod = await load();
    mod.saveProviderConfig('canva', { clientId: 'OC-ADMIN', clientSecret: SECRET2, redirectUri: 'https://x.test/cb' });
    process.env.CANVA_CLIENT_ID = 'OC-ENV';
    process.env.CANVA_CLIENT_SECRET = 'env-secret-value';
    process.env.CANVA_REDIRECT_URI = 'https://env.test/cb';
    const cfg = mod.getProviderConfig('canva');
    expect(cfg.clientId).toBe('OC-ENV');
    expect(cfg.source).toBe('env');
    delete process.env.CANVA_CLIENT_ID;
    delete process.env.CANVA_CLIENT_SECRET;
    delete process.env.CANVA_REDIRECT_URI;
    mod.clearProviderConfig('canva');
  });

  it('Client ID/Secret majburiy', async () => {
    const mod = await load();
    expect(mod.saveProviderConfig('canva', { clientId: '', clientSecret: '' }).ok).toBe(false);
    expect(mod.saveProviderConfig('nomalum', { clientId: 'a', clientSecret: 'b' }).ok).toBe(false);
  });

  it('bo‘sh maydon — mavjud qiymat saqlanadi (secret qayta yozilmaydi)', async () => {
    const mod = await load();
    mod.clearProviderConfig('canva');
    mod.saveProviderConfig('canva', { clientId: 'OC-TEST', clientSecret: SECRET2, redirectUri: 'https://x.test/cb' });
    mod.saveProviderConfig('canva', { clientId: 'OC-TEST2' }); // secret bo'sh
    const cfg = mod.getProviderConfig('canva');
    expect(cfg.clientId).toBe('OC-TEST2');
    expect(cfg.clientSecret).toBe(SECRET2);
    mod.clearProviderConfig('canva');
  });

  it('status faqat maskalangan Client ID beradi', async () => {
    const mod = await load();
    mod.clearProviderConfig('canva');
    mod.saveProviderConfig('canva', { clientId: 'OC-AaCGOvUSxTUN', clientSecret: SECRET2, redirectUri: 'https://x.test/cb' });
    const st = mod.getProviderStatus('canva');
    expect(st.configured).toBe(true);
    expect(st.clientIdMasked).toBe('••••xTUN');
    expect(JSON.stringify(st)).not.toContain(SECRET2);
    expect(JSON.stringify(st)).not.toContain('OC-AaCGOvUSxTUN');
    mod.clearProviderConfig('canva');
  });

  it('kalit yoq bolsa saqlash rad etiladi', async () => {
    const mod = await load();
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    delete process.env.CREDENTIALS_KEY;
    const r = mod.saveProviderConfig('canva', { clientId: 'OC-X', clientSecret: 'sec' });
    process.env.SESSION_SECRET = saved;
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/SESSION_SECRET|CREDENTIALS_KEY/);
  });
});
