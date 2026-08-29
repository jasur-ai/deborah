/**
 * AUTH B-01 — Users final schema unit testlari
 * -------------------------------------------------------------------
 * - normalizeUserRecord: idempotent backfill (2x chaqiruv = o'zgarmaydi)
 * - toPublicUser/toPrivateUser: DTO PII strip (password/google_sub/telegram_id)
 * - Enum'lar: USER_ROLES, EMAIL_STATUS
 * - Zod DTO validatsiya (public/private)
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeUserRecord,
  toPublicUser,
  toPrivateUser,
  USER_ROLES,
  EMAIL_STATUS,
  SECRET_KEYS,
  userPublicSchema,
  userPrivateSchema,
} from '../../src/modules/auth/user-schema.js';

const LEGACY = {
  username: 'alisher',
  password: 'argon2-hash-...',
  created_at: 1700000000000,
  isVip: false,
  vipPlainPassword: 'secret-plain', // legacy seed field — strip qilinishi kerak
};

describe('AUTH B-01 — normalizeUserRecord', () => {
  it('legacy user → canonical fieldlar qoshiladi', () => {
    const n = normalizeUserRecord(LEGACY);
    expect(n.email).toBe(null);
    expect(n.email_verified).toBe(false);
    expect(n.email_status).toBe(null); // email yo'q → null
    expect(n.password_updated_at).toBe(0);
    expect(n.role_version).toBe(1);
    expect(n.twofa_enabled).toBe(false);
    expect(n.mfa_totp_status).toBe('disabled');
    expect(n.failed_attempts).toBe(0);
    expect(n.locked_until).toBe(null);
    expect(n.google_sub).toBe(null);
    expect(n.hemis_id).toBe(null);
    expect(n.telegram_id).toBe(null);
    expect(n.invite_code).toBe(null);
    expect(typeof n.updated_at).toBe('number');
    expect(n.created_at).toBe(1700000000000); // mavjud qiymat tegilmaydi
  });

  it('eski isVip migratsiya xulqi saqlanadi: vip* field lar null (B-01 review fix)', () => {
    const n = normalizeUserRecord({ username: 'legacy1' });
    expect(n.isVip).toBe(false);
    expect(n.vipGrantedAt).toBe(null);
    expect(n.vipGrantedBy).toBe(null);
    expect(n.vipRevokedAt).toBe(null);
    expect(n.vipPlainPassword).toBe(null);
  });

  it('email bor + verified → email_status=verified', () => {
    const n = normalizeUserRecord({ username: 'a', email: 'a@x.uz', email_verified: true });
    expect(n.email_status).toBe('verified');
  });

  it('email bor + verified emas → email_status=pending', () => {
    const n = normalizeUserRecord({ username: 'a', email: 'a@x.uz', email_verified: false });
    expect(n.email_status).toBe('pending');
  });

  it("role YOQ bolsa tegilmaydi (admin xavfsizligi)", () => {
    const n = normalizeUserRecord({ username: '__admin__' });
    expect(n.role).toBeUndefined();
    const n2 = normalizeUserRecord({ username: 'student1', role: 'teacher' });
    expect(n2.role).toBe('teacher'); // mavjud role saqlanadi
  });

  it('idempotent: ikki marta chaqirish ozgarmaydi', () => {
    const once = normalizeUserRecord(LEGACY);
    const twice = normalizeUserRecord(once);
    expect(twice).toEqual(once);
  });

  it('null/array/primitive → o\'zgarishsiz', () => {
    expect(normalizeUserRecord(null)).toBe(null);
    expect(normalizeUserRecord([1, 2])).toEqual([1, 2]);
  });
});

describe('AUTH B-01 — DTO', () => {
  const FULL = {
    ...LEGACY,
    safeKey: 'alisher',
    email: 'a@x.uz',
    email_verified: false,
    role: 'teacher',
    google_sub: 'google-123',
    hemis_id: 'HEMIS-99',
    telegram_id: 'tg-77',
    last_login_ip_hash: 'ip-hash',
    last_login_device_hash: 'dev-hash',
    mfa_totp_status: 'enabled',
    failed_attempts: 3,
    locked_until: 999,
    twofa_secret: 'TOTP-SECRET',
    reset_token: 'rt-1',
  };

  it('public DTO: faqat id/username/name/role + non-PII flaglar', () => {
    const pub = toPublicUser(FULL, { key: 'alisher' });
    expect(pub).toEqual({
      id: 'alisher',
      username: 'alisher',
      name: 'alisher',
      role: 'teacher',
      emailVerified: false,
      isVip: false,
    });
  });

  it('public DTO: secret kalitlar HECH QACHON chiqmaydi', () => {
    const pub = toPublicUser(FULL, { key: 'alisher' });
    for (const k of SECRET_KEYS) {
      expect(pub).not.toHaveProperty(k);
    }
    expect(pub.password).toBeUndefined();
    expect(pub.google_sub).toBeUndefined();
    expect(pub.telegram_id).toBeUndefined();
    expect(pub.hemisId).toBeUndefined();
    expect(pub.last_login_ip_hash).toBeUndefined();
    expect(pub.vipPlainPassword).toBeUndefined();
  });

  it('private DTO: email + hemisId + phone qoshiladi, secret lar hali ham yoq', () => {
    const priv = toPrivateUser({ ...FULL, phone: '+99890...' }, { key: 'alisher' });
    expect(priv.email).toBe('a@x.uz');
    expect(priv.emailStatus).toBe('pending');
    expect(priv.hemisId).toBe('HEMIS-99');
    expect(priv.phone).toBe('+99890...');
    // Secret'lar private'da ham yo'q (guide §12, §28)
    expect(priv.password).toBeUndefined();
    expect(priv.google_sub).toBeUndefined();
    expect(priv.telegram_id).toBeUndefined();
    expect(priv.last_login_ip_hash).toBeUndefined();
    expect(priv.mfa_totp_status).toBeUndefined();
    expect(priv.vipPlainPassword).toBeUndefined();
  });

  it("Zod DTO validatsiya: togri obyektlar otadi", () => {
    const pub = { id: 'a', username: 'a', name: null, role: 'student', emailVerified: true, isVip: false };
    expect(userPublicSchema.parse(pub)).toEqual(pub);
    const priv = { ...pub, email: 'a@x.uz', emailStatus: 'pending', hemisId: null, phone: null };
    expect(userPrivateSchema.parse(priv).email).toBe('a@x.uz');
    // emailStatus enum bilan majburiy — xato qiymat o'tmaydi (review fix)
    const bad = { ...pub, email: 'a@x.uz', emailStatus: 'bogus', hemisId: null, phone: null };
    expect(userPrivateSchema.safeParse(bad).success).toBe(false);
  });

  it("Zod DTO: private da password maydoni chiqmaydi (strip)", () => {
    // DTO chiqishi password'ni o'z ichiga olmaydi — parse'da qo'shilsa ham
    const priv = userPrivateSchema.parse({
      id: 'a', username: 'a', name: null, role: 'student',
      emailVerified: false, isVip: false,
      email: 'a@x.uz', emailStatus: 'pending', hemisId: null, phone: null,
      password: 'x', // qo'shimcha maydon — strip qilinmaydi lekin DTO'da yo'q
    });
    expect(priv.password).toBeUndefined();
  });
});

describe('AUTH B-01 — Enum registry', () => {
  it('USER_ROLES guide ro\'yxatini o\'z ichiga oladi', () => {
    for (const r of ['student', 'teacher_pending', 'teacher', 'teacher_rejected', 'admin', 'co_teacher']) {
      expect(USER_ROLES).toContain(r);
    }
  });

  it('EMAIL_STATUS 4 holat', () => {
    expect(EMAIL_STATUS).toEqual(['verified', 'pending', 'bounced', 'suppressed']);
  });

  it('SECRET_KEYS parol va identifikatorlarni qamraydi', () => {
    for (const k of ['password', 'google_sub', 'telegram_id', 'last_login_ip_hash', 'mfa_totp_status', 'vipPlainPassword']) {
      expect(SECRET_KEYS).toContain(k);
    }
  });
});
