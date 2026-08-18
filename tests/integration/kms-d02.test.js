/**
 * AUTH D-02 — Secrets management (integration)
 *
 * mfa-totp orqali real TOTP secret encrypt/decrypt (A-26 flow), rotation'da
 * data yo'qolmaydi, legacy (eski format) compat.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import {
  setupTotp,
  getMfaStatus,
  encryptSecret as totpEncrypt,
  decryptSecret as totpDecrypt,
} from '../../src/modules/auth/mfa-totp.js';
import {
  encryptSecret as kmsEncrypt,
  decryptSecret as kmsDecrypt,
  reEncryptSecret,
} from '../../src/modules/auth/kms.js';

describe('AUTH D-02 — TOTP secret via KMS (integration)', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('setupTotp → saqlangan secretEnc KMS format (v1:...), decrypt asl secret', async () => {
    const userId = `d02u_${Date.now() % 1000000}`;
    const setup = await setupTotp(userId, { accountName: 'test' });
    expect(setup.ok).toBe(true);
    expect(setup.secret).toBeTruthy();

    const rec = await fb.get(`mfa_totp/${safeKey(userId)}`);
    expect(rec.exists()).toBe(true);
    const secretEnc = rec.val().secretEnc;
    // D-02 versioned format
    expect(secretEnc.startsWith('v1:')).toBe(true);
    expect(secretEnc.split(':')).toHaveLength(4);
    // decrypt asl secret'ni qaytaradi
    expect(totpDecrypt(secretEnc)).toBe(setup.secret);
    expect(kmsDecrypt(secretEnc, 'mfa_totp')).toBe(setup.secret);
  });

  it('re-encrypt (rotation) dan keyin ham decrypt ishlaydi — data yo\'qolmaydi', async () => {
    const userId = `d02r_${Date.now() % 1000000}`;
    const setup = await setupTotp(userId, { accountName: 'test' });
    expect(setup.ok).toBe(true);
    const rec = await fb.get(`mfa_totp/${safeKey(userId)}`);
    const original = rec.val().secretEnc;

    // Rotation: re-encrypt
    const rotated = reEncryptSecret(original, 'mfa_totp');
    expect(rotated).not.toBe(original);
    expect(kmsDecrypt(rotated, 'mfa_totp')).toBe(setup.secret);
    // Hali eski payload ham ochiladi (rotation davomida qisqa oyna)
    expect(kmsDecrypt(original, 'mfa_totp')).toBe(setup.secret);
  });

  it('MFA status flow ishlaydi (secret encrypted saqlanadi)', async () => {
    const userId = `d02s_${Date.now() % 1000000}`;
    await setupTotp(userId, { accountName: 'test' });
    const status = await getMfaStatus(userId);
    expect(status.status).toBe('pending');
    const rec = await fb.get(`mfa_totp/${safeKey(userId)}`);
    // Plaintext secret DB'da hech qachon yo'q
    expect(rec.val().secretEnc).not.toContain('JBSWY');
  });

  it('legacy 3-qismli payload (eski format) mfa-totp decrypt bilan ochiladi', async () => {
    // Eski A-26 format: sha256(raw) key + 3 qism. kms legacy-branch.
    const crypto = await import('node:crypto');
    const CONFIG = (await import('../../src/config/env.js')).default;
    const raw = CONFIG.MFA_ENCRYPTION_KEY || CONFIG.SESSION_SECRET;
    const key = crypto.createHash('sha256').update(String(raw)).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update('LEGACY-TOTP', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacy = [iv, tag, enc].map((b) => b.toString('base64url')).join(':');

    expect(totpDecrypt(legacy)).toBe('LEGACY-TOTP');
    expect(kmsDecrypt(legacy, 'mfa_totp')).toBe('LEGACY-TOTP');
  });

  it('notogri key bilan encrypt qilingan payload decrypt null (downgrade/tamper)', async () => {
    // Boshqa key material bilan encrypt → ochilmasligi kerak
    const other = await import('node:crypto');
    const key = other.default.createHash('sha256').update('completely-different-key-material').digest();
    const iv = other.default.randomBytes(12);
    const cipher = other.default.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update('x', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const bad = ['v1', iv, tag, enc].map((b) => Buffer.isBuffer(b) ? b.toString('base64url') : b).join(':');
    expect(kmsDecrypt(bad, 'mfa_totp')).toBeNull();
  });
});
