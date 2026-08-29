/**
 * AUTH E-06 — Cloud KMS adapter (kms-provider + kms.js v2) unit testlari.
 * ---------------------------------------------------------------------------
 *  - kmsConfigured: ARN + shifrlangan key bo'lsa true
 *  - decryptMasterKey: mock KMS client → 32-bayt key, cache TTL, audit
 *  - KMS down → null + fail-soft (kms.js v1 env bilan davom etadi)
 *  - kms.js: v2 round-trip (KMS key bilan), v1 legacy hali ochiladi,
 *    KMS yo'q bo'lsa v1 yoziladi, KMS down bo'lsa yangi yozuvlar v1
 *  - rotateMasterKey v1 → v2 migratsiya (KMS bo'lsa)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import CONFIG from '../../../src/config/env.js';

// audit modulini mock qilamiz (kms-provider + kms.js audit chaqiruvlari)
vi.mock('../../../src/modules/auth/audit.js', () => ({
  logAuthEvent: vi.fn(async () => true),
  audit: vi.fn(async () => true),
  AUDIT_ACTIONS: {
    SECRET_ROTATED: 'secret:rotated',
    SECRET_DECRYPT_FAILED: 'secret:decrypt:failed',
    KMS_DECRYPT: 'kms:decrypt',
    KMS_DECRYPT_FAILED: 'kms:decrypt:failed',
  },
}));

import * as provider from '../../../src/modules/auth/kms-provider.js';
import {
  encryptSecret,
  decryptSecret,
  reEncryptSecret,
  rotateMasterKey,
  activeKeyVersion,
  kmsConfigured,
  _clearKmsForTests,
} from '../../../src/modules/auth/kms.js';

const OLD_ENV = { ...process.env };

// KMS bilan "shifrlangan" test key: raw='test-kms-master' dan derivatsiya
const RAW = 'test-kms-master-2026';
const WRAPPED = provider._makeTestWrappedKey(RAW);
const PLAIN_KEY = provider._unwrapTestWrappedKey(WRAPPED, RAW);

function mockKmsClient({ success = true } = {}) {
  const client = {
    send: vi.fn(async (cmd) => {
      if (!success) {
        const err = new Error('KMS throttling');
        err.name = 'ThrottlingException';
        throw err;
      }
      // cmd.name === 'DecryptCommand' — Plaintext qaytaramiz
      return { Plaintext: new Uint8Array(PLAIN_KEY) };
    }),
  };
  provider._setKmsClient(client);
  return client;
}

beforeEach(() => {
  Object.keys(process.env).forEach((k) => {
    if (k.startsWith('KMS_')) delete process.env[k];
  });
  delete process.env.MFA_ENCRYPTION_KEY;
  provider.resetKmsCache();
  provider._setKmsClient(null);
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  provider.resetKmsCache();
  provider._setKmsClient(null);
});

describe('kmsConfigured / activeKeyVersion', () => {
  it('ARN + shifrlangan key bolsa configured', () => {
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    expect(kmsConfigured()).toBe(true);
  });

  it('key yoq bolsa configured emas', () => {
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    expect(kmsConfigured()).toBe(false);
  });

  it('KMS sozlangan + cache bor → active v2; cache yoq → v1 (fail-soft)', async () => {
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    expect(activeKeyVersion()).toBe(1); // cache yo'q → hali v1
    mockKmsClient({ success: true });
    await provider.decryptMasterKey(); // prefetch
    expect(activeKeyVersion()).toBe(2);
  });

  it('KMS sozlanmagan → active v1', () => {
    expect(activeKeyVersion()).toBe(1);
  });
});

describe('decryptMasterKey (KMS Decrypt)', () => {
  it('success → 32-bayt key qaytaradi + cache (TTL)', async () => {
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    const client = mockKmsClient({ success: true });

    const key1 = await provider.decryptMasterKey();
    expect(key1).toBeTruthy();
    expect(key1.length).toBe(32);
    // Ikkinchi chaqiruv cache'dan (KMS'ga bormaydi)
    await provider.decryptMasterKey();
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('KMS down → null + cache tozalanadi (fail-soft)', async () => {
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    mockKmsClient({ success: false });
    const key = await provider.decryptMasterKey();
    expect(key).toBeNull();
    expect(provider.getKmsKey()).toBeNull();
  });

  it('notogri Plaintext uzunligi → null', async () => {
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    const client = { send: vi.fn(async () => ({ Plaintext: new Uint8Array([1, 2, 3]) })) };
    provider._setKmsClient(client);
    expect(await provider.decryptMasterKey()).toBeNull();
  });
});

describe('kms.js v2 round-trip (KMS yoqilgan)', () => {
  it('KMS key bilan encrypt → v2 payload; decrypt qaytaradi', async () => {
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    mockKmsClient({ success: true });
    await provider.decryptMasterKey(); // prefetch

    const enc = encryptSecret('super-secret-totp', 'mfa_totp');
    expect(enc).toBeTruthy();
    expect(enc.startsWith('v2:')).toBe(true);
    expect(decryptSecret(enc, 'mfa_totp')).toBe('super-secret-totp');
  });

  it('v1 (env) legacy payload KMS yoqilganida ham ochiladi', async () => {
    // v1 payloadni yozamiz (KMS yo'q paytida yozilgan eski secret)
    expect(activeKeyVersion()).toBe(1);
    const v1enc = encryptSecret('old-secret', 't');
    expect(v1enc.startsWith('v1:')).toBe(true);

    // KMS yoqiladi
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    mockKmsClient({ success: true });
    await provider.decryptMasterKey();

    expect(decryptSecret(v1enc, 't')).toBe('old-secret'); // legacy hali ochiladi
  });

  it('KMS down → yangi yozuvlar v1 (fail-soft), v2 payload ochilmaydi (fail-closed)', async () => {
    // KMS sozlangan lekin down
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    mockKmsClient({ success: false });
    await provider.decryptMasterKey(); // null

    // Yangi yozuv → v1 (hech narsa buzilmaydi)
    const enc = encryptSecret('new-write', 't');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc, 't')).toBe('new-write');

    // v2 payload (KMS kaliti bilan yozilgan) → cache yo'q → ochilmaydi (fail-closed)
    provider._seedKmsKeyForTests(PLAIN_KEY);
    const v2enc = encryptSecret('kms-only', 't');
    expect(v2enc.startsWith('v2:')).toBe(true);
    _clearKmsForTests(); // KMS down → cache tozalandi
    expect(decryptSecret(v2enc, 't')).toBeNull();
  });
});

describe('rotateMasterKey — v1 → v2 migratsiya (KMS yoqilganda)', () => {
  it('barcha v1 secretlar v2 ga re-encrypt boladi va ochiladi', async () => {
    // KMS yo'q — v1 yozamiz
    const store = new Map();
    for (let i = 0; i < 3; i++) store.set(`u${i}`, encryptSecret(`s${i}`, 'batch'));

    // KMS yoqiladi
    process.env.KMS_KEY_ARN = 'arn:aws:kms:me-central-1:123456789012:key/abc';
    process.env.KMS_ENCRYPTED_MASTER_KEY = WRAPPED;
    mockKmsClient({ success: true });
    await provider.decryptMasterKey();

    const res = await rotateMasterKey(
      { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
      async () => [...store.keys()],
      (p) => decryptSecret(p, 'batch'),
      (p) => encryptSecret(p, 'batch'),
      'batch',
    );
    expect(res.rotated).toBe(3);
    expect(res.failed).toBe(0);
    for (let i = 0; i < 3; i++) {
      const enc = store.get(`u${i}`);
      expect(enc.startsWith('v2:')).toBe(true); // migratsiya v2 ga
      expect(decryptSecret(enc, 'batch')).toBe(`s${i}`); // ochiladi
    }
  });
});
