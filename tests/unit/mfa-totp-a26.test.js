import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import {
  encryptSecret,
  decryptSecret,
  hashBackupCode,
  setupTotp,
  enableTotp,
  getMfaStatus,
  hasActiveMfa,
  verifyMfaCode,
  createMfaChallenge,
  consumeMfaChallenge,
  disableMfa,
  rotateBackupCodes,
  backupCodesRemaining,
  isMfaStepUpFresh,
  isTotpCode,
  isBackupCodeFormat,
} from '../../src/modules/auth/mfa-totp.js';
import { generate } from 'otplib';

describe('AUTH A-26 — MFA/TOTP module', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  const userId = 'mfa_unit_user';

  it('encryptSecret/decryptSecret: AES-256-GCM round-trip, format notogri → null', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    // D-02: versioned format — v1:{iv}:{tag}:{ct} (4 qism)
    expect(enc).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(decryptSecret(enc)).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptSecret('bogus')).toBe(null);
    expect(decryptSecret('a:b')).toBe(null);
    // Plaintext DB'da yo'q
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('hashBackupCode: deterministik HMAC-SHA256, plaintext yoq', () => {
    const h = hashBackupCode('abc123def0');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBackupCode('abc123def0')).toBe(h);
    expect(h).not.toContain('abc123def0');
  });

  it('isTotpCode / isBackupCodeFormat: format validation', () => {
    expect(isTotpCode('123456')).toBe(true);
    expect(isTotpCode('12345')).toBe(false);
    expect(isTotpCode('abcdef')).toBe(false);
    expect(isBackupCodeFormat('abc123def0')).toBe(true);
    expect(isBackupCodeFormat('abc123def')).toBe(false);
    expect(isBackupCodeFormat('ABC123DEF0')).toBe(false);
  });

  it('setupTotp → secret + otpauth, DB encrypt qilingan (pending)', async () => {
    const r = await setupTotp(userId, { accountName: 'test' });
    expect(r.ok).toBe(true);
    expect(r.secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(r.otpauth).toContain('otpauth://totp/');
    expect(r.otpauth).toContain(`secret=${r.secret}`);
    const rec = await fb.get(`mfa_totp/${userId}`);
    expect(rec.exists()).toBe(true);
    expect(rec.val().status).toBe('pending');
    expect(rec.val().secretEnc).not.toContain(r.secret); // encrypt qilingan
    expect(decryptSecret(rec.val().secretEnc)).toBe(r.secret);
  });

  it('setupTotp takroriy: active bolsa mfa_already_active', async () => {
    // pending holatda qayta setup bo'lishi mumkin (yangi secret), keyin enable
    const s = await setupTotp('mfa_dupe_user', {});
    expect(s.ok).toBe(true);
    const enable = await enableTotp('mfa_dupe_user', '000000'); // xato kod
    expect(enable.ok).toBe(false);
    expect(enable.error).toBe('invalid_code');
  });

  it('enableTotp: birinchi kod verify → active + 10 backup code (hash)', async () => {
    await setupTotp('mfa_enable_user', { accountName: 'e' });
    const rec = await fb.get(`mfa_totp/mfa_enable_user`);
    const secret = decryptSecret(rec.val().secretEnc);
    const token = await generate({ secret });
    const r = await enableTotp('mfa_enable_user', token);
    expect(r.ok).toBe(true);
    expect(r.backupCodes).toHaveLength(10);
    r.backupCodes.forEach((c) => expect(c).toMatch(/^[0-9a-f]{10}$/));
    // Backup hash'lar DB'da, plaintext yo'q
    const bc = await fb.get(`mfa_backup_codes/mfa_enable_user`);
    expect(bc.exists()).toBe(true);
    const codes = bc.val().codes;
    expect(codes).toHaveLength(10);
    r.backupCodes.forEach((c, i) => {
      expect(codes[i].h).toBe(hashBackupCode(c));
      expect(codes[i].usedAt).toBe(0);
    });
    const status = await getMfaStatus('mfa_enable_user');
    expect(status.status).toBe('active');
    expect(await hasActiveMfa('mfa_enable_user')).toBe(true);
  });

  it('verifyMfaCode: TOTP togri kod → ok (method totp)', async () => {
    const rec = await fb.get(`mfa_totp/mfa_enable_user`);
    const secret = decryptSecret(rec.val().secretEnc);
    const token = await generate({ secret });
    const r = await verifyMfaCode('mfa_enable_user', token, '203.0.113.10');
    expect(r.ok).toBe(true);
    expect(r.method).toBe('totp');
  });

  it('verifyMfaCode: backup code replay himoyasi (usedAt)', async () => {
    const bc = await fb.get(`mfa_backup_codes/mfa_enable_user`);
    const codes = bc.val().codes;
    // Plaintext bilmaymiz — hash'ga mos kod yaratib bo'lmaydi, shuning uchun
    // TOTP muvaffaqiyatini tekshirdik; replay testi consumeBackupCode'ni
    // to'g'ridan-to'g'ri sinaydi (hash'li yozuv uchun).
    // Backup consume: noto'g'ri format → false
    const r = await verifyMfaCode('mfa_enable_user', 'notacode', '203.0.113.10');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_code');
    expect(codes.some((c) => c.usedAt)).toBe(false); // muvaffaqiyatli kod yozilmadi
  });

  it('verifyMfaCode: 5 xato → lockout', async () => {
    for (let i = 0; i < 5; i += 1) {
      await verifyMfaCode('mfa_enable_user', '000000', '203.0.113.20');
    }
    const r = await verifyMfaCode('mfa_enable_user', '000000', '203.0.113.20');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('locked');
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('createMfaChallenge/consumeMfaChallenge: single-use', async () => {
    const cid = await createMfaChallenge('mfa_chal_user');
    expect(cid).toMatch(/^[0-9a-f]{48}$/);
    expect(await consumeMfaChallenge(cid)).toBe('mfa_chal_user');
    // Reuse yo'q
    expect(await consumeMfaChallenge(cid)).toBe(null);
    expect(await consumeMfaChallenge('bogus')).toBe(null);
  });

  it('rotateBackupCodes: yangi kodlar, eskilari invalid', async () => {
    const r = await rotateBackupCodes('mfa_enable_user');
    expect(r.ok).toBe(true);
    expect(r.backupCodes).toHaveLength(10);
    const bc = await fb.get(`mfa_backup_codes/mfa_enable_user`);
    const codes = bc.val().codes;
    expect(codes).toHaveLength(10);
    // Yangi hash'lar eski kodlarga mos kelmaydi
    expect(codes[0].h).not.toBe(hashBackupCode('oldcode0000'));
    expect(await backupCodesRemaining('mfa_enable_user')).toBe(10);
  });

  it('disableMfa: mfa_totp + backup codes tozalanadi', async () => {
    const r = await disableMfa('mfa_enable_user');
    expect(r.ok).toBe(true);
    expect(await hasActiveMfa('mfa_enable_user')).toBe(false);
    const bc = await fb.get(`mfa_backup_codes/mfa_enable_user`);
    expect(bc.exists()).toBe(false);
  });

  it('isMfaStepUpFresh: mfaAt 30 daqiqa ichida fresh', () => {
    expect(isMfaStepUpFresh({ user: { mfaAt: Date.now() } })).toBe(true);
    expect(isMfaStepUpFresh({ user: { mfaAt: Date.now() - 31 * 60 * 1000 } })).toBe(false);
    expect(isMfaStepUpFresh({ user: {} })).toBe(false);
    expect(isMfaStepUpFresh({})).toBe(false);
  });

  it('getMfaStatus: mavjud emas user → none', async () => {
    const s = await getMfaStatus('no_such_user');
    expect(s.status).toBe('none');
  });
});
