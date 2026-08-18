/**
 * Edikit — AUTH A-15: HEMIS adapter unit testlari
 *
 * Covers:
 * 1. normalizeAccountMe — A-14 da live olingan real shape → xavfsiz profil
 *    (PII: passport_pin/address KIRMAYDI)
 * 2. normalizeOAuthUser — hemis-oauth fields
 * 3. restLogin — muvaffaqiyat (JWT), 401, 451 geofence, tarmoq xatosi
 * 4. SSRF guard — https shart, private-host/not-allowed rad, fetch chaqirilmaydi
 * 5. checkLinkLimit — per-IP 10/15 daqiqa
 * 6. OAuth gating — env yo'q bo'lsa o'chiq; env bilan authorize URL to'g'ri
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeAccountMe,
  normalizeOAuthUser,
  restLogin,
  fetchAccountMe,
  linkAccount,
  assertSafeBaseUrl,
  checkLinkLimit,
  isOAuthConfigured,
  buildOAuthAuthorizeUrl,
} from '../../src/modules/auth/providers/hemis.js';

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// A-14 da live olingan REAL account/me shape (TSUE test akkaunt)
const REAL_ACCOUNT_ME = {
  id: 12345,
  first_name: 'SHOHJAHON',
  second_name: 'URISHBOYEV',
  third_name: 'JASUR O‘G‘LI',
  full_name: 'URISHBOYEV SHOHJAHON JASUR O‘G‘LI',
  short_name: 'U.Sh.',
  student_id_number: '324251103717',
  passport_pin: 'PASS_LEAK_SHOULD_NOT_MAP',
  image: 'https://cdn.hemis.uz/img/123.png',
  birth_date: '2004-05-12',
  email: 's.urishboyev@tsue.uz',
  phone: '+998901234567',
  gender: '1',
  university: 'Toshkent davlat iqtisodiyot universiteti',
  universityOwnership: 'public',
  specialty: { id: 525, name: 'Axborot xavfsizligi' },
  studentStatus: 'active',
  educationForm: 'kunduzgi',
  educationType: 'bakalavriat',
  paymentForm: 'grant',
  group: { id: 8551, name: 'AT-85/25', educationLang: 'uz' },
  faculty: { id: 7, name: 'Axborot texnologiyalari' },
  educationLang: 'uz',
  level: 1,
  semester: 2,
  avg_gpa: 4.5,
  password_valid: true,
  address: 'ADDRESS_LEAK_SHOULD_NOT_MAP',
  country: 'UZ',
};

const FAKE_JWT =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJoZW1pcy4zMjQiLCJhdWQiOiJzdHVkZW50IiwianRpIjoiMSJ9.sig';

describe('AUTH A-15 — normalizeAccountMe', () => {
  it("A-14 real shape'dan xavfsiz profil yaratadi (PII kirmaydi)", () => {
    const p = normalizeAccountMe(REAL_ACCOUNT_ME, FAKE_JWT);
    expect(p.hemisId).toBe('324251103717');
    expect(p.fullName).toBe('URISHBOYEV SHOHJAHON JASUR O‘G‘LI');
    expect(p.firstName).toBe('SHOHJAHON');
    expect(p.lastName).toBe('URISHBOYEV');
    expect(p.patronymic).toBe('JASUR O‘G‘LI');
    expect(p.university).toBe('Toshkent davlat iqtisodiyot universiteti');
    // JWT iss=hemis.324 → universityId 324
    expect(p.universityId).toBe('324');
    expect(p.group).toBe('AT-85/25');
    expect(p.specialty).toBe('Axborot xavfsizligi');
    expect(p.faculty).toBe('Axborot texnologiyalari');
    expect(p.semester).toBe('2');
    // PII chiquvchi profilga KIRMAYDI
    expect(p.passport_pin).toBeUndefined();
    expect(p.address).toBeUndefined();
    expect(p.avg_gpa).toBeUndefined();
  });

  it('bo\'sh/noto\'g\'ri inputda xatolik tashlamaydi', () => {
    const p = normalizeAccountMe(null, null);
    expect(p.hemisId).toBe('');
    expect(p.fullName).toBe('');
  });
});

describe('AUTH A-15 — normalizeOAuthUser', () => {
  it('hemis-oauth fields map qilinadi', () => {
    const p = normalizeOAuthUser({
      id: 987,
      uuid: 'abc-123',
      university_id: 18,
      type: 'student',
      firstname: 'Jasur',
      surname: 'Aliyev',
      patronymic: 'Olimovich',
      login: 'jaliyev',
      email: 'j@mail.uz',
      phone: '+998',
    });
    expect(p.hemisId).toBe('987');
    expect(p.universityId).toBe('18');
    expect(p.fullName).toBe('Aliyev Jasur Olimovich');
    expect(p.login).toBe('jaliyev');
  });
});

describe('AUTH A-15 — restLogin', () => {
  it('muvaffaqiyatli login → JWT qaytaradi', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, error: null, data: { token: FAKE_JWT } })
    );
    const { token } = await restLogin({ login: '324251103717', password: 'secret' }, { fetchFn });
    expect(token).toBe(FAKE_JWT);
    // Parol body'da bor, lekin fetchFn argumenti orqali — log'ga chiqmaydi
    const sent = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(sent.password).toBe('secret');
  });

  it('401 → invalid_credentials kodi', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { success: false, error: 'Login yoki parol xato', code: 401 }));
    await expect(
      restLogin({ login: 'x', password: 'y' }, { fetchFn })
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('451 → geofence kodi', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(451, { success: false }));
    await expect(restLogin({ login: 'x', password: 'y' }, { fetchFn })).rejects.toMatchObject({
      code: 'geofence',
    });
  });

  it('tarmoq xatosi → unreachable kodi (parol xabar ichida YOQ)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      restLogin({ login: 'x', password: 'supersecret' }, { fetchFn })
    ).rejects.toMatchObject({ code: 'unreachable' });
  });
});

describe('AUTH A-15 — SSRF guard', () => {
  it('https bo\'lmagan base rad etiladi', () => {
    expect(assertSafeBaseUrl('http://student.hemis.uz')).toMatchObject({ ok: false, reason: 'https_required' });
  });

  it('private/localhost host rad etiladi', () => {
    expect(assertSafeBaseUrl('https://127.0.0.1/rest')).toMatchObject({ ok: false, reason: 'private_host' });
    expect(assertSafeBaseUrl('https://localhost/rest')).toMatchObject({ ok: false, reason: 'private_host' });
    expect(assertSafeBaseUrl('https://10.0.0.5/rest')).toMatchObject({ ok: false, reason: 'private_host' });
  });

  it('ruxsat etilmagan domen rad etiladi', () => {
    expect(assertSafeBaseUrl('https://evil.example.com/x')).toMatchObject({ ok: false, reason: 'host_not_allowed' });
  });

  it('hemis.uz va .uz OTM domenlari ruxsat etiladi', () => {
    expect(assertSafeBaseUrl('https://student.hemis.uz')).toMatchObject({ ok: true });
    expect(assertSafeBaseUrl('https://talaba.tsue.uz')).toMatchObject({ ok: true });
  });

  it('xavfsiz emas base → fetch umuman chaqirilmaydi', async () => {
    const fetchFn = vi.fn();
    await expect(
      restLogin({ login: 'x', password: 'y' }, { fetchFn, baseUrl: 'https://evil.example.com' })
    ).rejects.toMatchObject({ code: 'misconfigured' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('AUTH A-15 — fetchAccountMe + linkAccount', () => {
  it('account/me → normalize qilingan profil', async () => {
    const fetchFn = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes('/rest/v1/auth/login')) {
        return jsonResponse(200, { success: true, data: { token: FAKE_JWT } });
      }
      return jsonResponse(200, { success: true, data: REAL_ACCOUNT_ME });
    });
    const profile = await linkAccount({ login: 'x', password: 'y' }, { fetchFn });
    expect(profile.hemisId).toBe('324251103717');
    expect(profile.universityId).toBe('324');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('AUTH A-15 — checkLinkLimit', () => {
  it('per-IP limit: 10 dan ortiq → 429 retryAfter', () => {
    const ip = '203.0.113.7';
    let r;
    for (let i = 0; i < 11; i++) r = checkLinkLimit(ip, 'user1'); // 11-chisi bloklanadi
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('per-user limit ham ishlaydi (boshqa IP, shu user)', () => {
    for (let i = 0; i < 11; i++) checkLinkLimit('198.51.100.1', 'userA');
    const r = checkLinkLimit('198.51.100.1', 'userA');
    expect(r.allowed).toBe(false);
  });

  it('boshqa IP va user uchun limit mustaqil', () => {
    expect(checkLinkLimit('203.0.113.99', 'freshUser').allowed).toBe(true);
  });
});

describe('AUTH A-15 — OAuth gating', () => {
  beforeEach(() => {
    delete process.env.HEMIS_OAUTH_CLIENT_ID;
    delete process.env.HEMIS_OAUTH_CLIENT_SECRET;
    delete process.env.HEMIS_OAUTH_REDIRECT_URI;
  });
  afterEach(() => {
    vi.resetModules();
    delete process.env.HEMIS_OAUTH_CLIENT_ID;
    delete process.env.HEMIS_OAUTH_CLIENT_SECRET;
    delete process.env.HEMIS_OAUTH_REDIRECT_URI;
  });

  it('env yo\'q bo\'lsa OAuth o\'chiq (default)', () => {
    expect(isOAuthConfigured()).toBe(false);
    expect(buildOAuthAuthorizeUrl('s1')).toBeNull();
  });

  it('env bo\'lsa authorize URL to\'g\'ri va secret kirmaydi', async () => {
    process.env.HEMIS_OAUTH_CLIENT_ID = 'otm-client-1';
    process.env.HEMIS_OAUTH_CLIENT_SECRET = 'otm-secret-x';
    process.env.HEMIS_OAUTH_REDIRECT_URI = 'https://edikit.uz/auth/hemis/callback';
    const mod = await import('../../src/modules/auth/providers/hemis.js?oauth-gated=1');
    expect(mod.isOAuthConfigured()).toBe(true);
    const url = mod.buildOAuthAuthorizeUrl('state-123');
    expect(url).toContain('client_id=otm-client-1');
    expect(url).toContain('state=state-123');
    expect(url).toContain(encodeURIComponent('https://edikit.uz/auth/hemis/callback'));
    expect(url).not.toContain('otm-secret-x');
    await mod.exchangeOAuthCode('code-x', {
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(200, { access_token: 'at' })),
    });
  });
});
