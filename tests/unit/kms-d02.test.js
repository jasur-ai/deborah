/**
 * AUTH D-02 — Secrets management (KMS) unit tests
 *
 * Versioned AES-256-GCM: round-trip, format, IV uniqueness, legacy compat,
 * rotation re-encrypt, tamper detection.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import CONFIG from '../../src/config/env.js';
import {
  encryptSecret,
  decryptSecret,
  reEncryptSecret,
  rotateMasterKey,
  activeKeyVersion,
} from '../../src/modules/auth/kms.js';

describe('AUTH D-02 — kms encrypt/decrypt', () => {
  it('round-trip: encrypt → decrypt asl qiymat', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const enc = encryptSecret(secret, 'mfa_totp');
    expect(enc).not.toBe(secret);
    expect(decryptSecret(enc, 'mfa_totp')).toBe(secret);
  });

  it('IV uniqueness: bir xil plaintext → har safar boshqa ciphertext', () => {
    const a = encryptSecret('same-value', 't');
    const b = encryptSecret('same-value', 't');
    expect(a).not.toBe(b);
  });

  it('format: versioned prefix v{ver} + 4 qism', () => {
    const enc = encryptSecret('x', 't');
    const parts = enc.split(':');
    expect(parts).toHaveLength(4);
    // E-06: aktiv version KMS sozlanganda 2, aks holda 1 (env) — payload prefix
    // har doim HAQIQATDA ishlatilgan version bilan mos bo'ladi.
    expect(parts[0]).toBe(`v${activeKeyVersion()}`);
    expect(['v1', 'v2']).toContain(parts[0]);
  });

  it('notogri payload → null', () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret('')).toBeNull();
    expect(decryptSecret('a:b')).toBeNull();
    expect(decryptSecret('v99:x:y:z')).toBeNull(); // noma'lum version
  });

  it('tamper detection: ciphertext o\'zgartirilsa → null (GCM auth tag)', () => {
    const enc = encryptSecret('top-secret', 't');
    const parts = enc.split(':');
    // ciphertext'ning oxirgi bytini buzamiz
    const ct = Buffer.from(parts[3], 'base64url');
    ct[ct.length - 1] ^= 0xff;
    parts[3] = ct.toString('base64url');
    expect(decryptSecret(parts.join(':'), 't')).toBeNull();
  });
});

describe('AUTH D-02 — legacy compat (A-26 3-qismli format)', () => {
  it('legacy iv:tag:ct payload ham decrypt bo\'ladi', () => {
    // Eski (A-26) mfa-totp formatini simulyatsiya qilamiz: sha256(raw) key,
    // 3 qism `iv:tag:ct` (version'siz). KMS legacy-branch ochishi kerak.
    const raw = CONFIG.MFA_ENCRYPTION_KEY || CONFIG.SESSION_SECRET;
    const key = crypto.createHash('sha256').update(String(raw)).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update('LEGACY-SECRET', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacy = [iv, tag, enc].map((b) => b.toString('base64url')).join(':');

    expect(decryptSecret(legacy, 'mfa_totp')).toBe('LEGACY-SECRET');
  });
});

describe('AUTH D-02 — rotation re-encrypt', () => {
  it('reEncryptSecret: decrypt+encrypt round-trip', () => {
    const enc = encryptSecret('rotate-me', 'r');
    const re = reEncryptSecret(enc, 'r');
    expect(re).not.toBe(enc);
    expect(decryptSecret(re, 'r')).toBe('rotate-me');
  });

  it('rotateMasterKey: store-dagi barcha secret\'lar re-encrypt bo\'ladi', async () => {
    const store = new Map();
    for (let i = 0; i < 3; i++) store.set(`u${i}`, encryptSecret(`s${i}`, 'batch'));
    const res = await rotateMasterKey(
      { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
      async () => [...store.keys()],
      (p) => decryptSecret(p, 'batch'),
      (p) => encryptSecret(p, 'batch'),
      'batch',
    );
    expect(res.rotated).toBe(3);
    expect(res.failed).toBe(0);
    // Barcha yozuvlar hali decrypt bo'laveradi (ma'lumot yo'qolmaydi)
    for (let i = 0; i < 3; i++) {
      expect(decryptSecret(store.get(`u${i}`), 'batch')).toBe(`s${i}`);
    }
  });
});


