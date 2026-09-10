/**
 * Deborah — Integratsiya kalitlarini xavfsiz saqlash (C4-10 rev.4)
 * ──────────────────────────────────────────────────────────────────
 * Muammo: Render/CI kabi muhitlarda `.env` faylini tahrirlash qiyin, ammo
 * Canva/Google Slides rasmiy ulanishi uchun CLIENT_ID/SECRET kerak.
 * Yechim: admin panelidan kiritilgan kalitlar server diskida SHIFRLANGAN
 * holda saqlanadi (AES-256-GCM, kalit SESSION_SECRET'dan hosil qilinadi) va
 * env qiymatlari bo'lmaganda ishlatiladi.
 *
 * Qoidalar:
 *   · env HAR DOIM ustuvor (deploy sozlamalari admin formani yengadi);
 *   · fayl `data/` ichida (git'ga kirmaydi);
 *   · response'ga faqat MASKALANGAN ko'rinish chiqadi (••••1234);
 *   · kalit yo'q bo'lsa — shifrlab bo'lmaydi, saqlash rad etiladi.
 */

import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const STORE_DIR = join(ROOT, 'data');
const STORE_FILE = join(STORE_DIR, 'integration-credentials.json.enc');

/** Qo'llab-quvvatlanadigan provayderlar va ularning env kalitlari. */
export const PROVIDERS = {
  canva: {
    label: 'Canva',
    env: { clientId: 'CANVA_CLIENT_ID', clientSecret: 'CANVA_CLIENT_SECRET', redirectUri: 'CANVA_REDIRECT_URI' },
  },
  'google-slides': {
    label: 'Google Slides',
    env: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET', redirectUri: 'GOOGLE_REDIRECT_URI' },
  },
};

/** Shifrlash kaliti — SESSION_SECRET'dan scrypt bilan hosil qilinadi. */
function encryptionKey() {
  const secret = process.env.CREDENTIALS_KEY || process.env.SESSION_SECRET || '';
  if (!secret) return null;
  return crypto.scryptSync(secret, 'deborah-integrations-v1', 32);
}

function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload, key) {
  try {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Diskdan shifrlangan store'ni o'qish (yo'q bo'lsa — bo'sh obyekt). */
function readStore() {
  const key = encryptionKey();
  if (!key || !existsSync(STORE_FILE)) return {};
  const plain = decrypt(readFileSync(STORE_FILE, 'utf8').trim(), key);
  if (!plain) return {};
  try { return JSON.parse(plain); } catch { return {}; }
}

function writeStore(obj) {
  const key = encryptionKey();
  if (!key) return { ok: false, error: 'CREDENTIALS_KEY/SESSION_SECRET yo‘q — shifrlab bo‘lmaydi' };
  try {
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(STORE_FILE, encrypt(JSON.stringify(obj), key), { mode: 0o600 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Maskalangan ko'rinish — maxfiy qism hech qachon chiqmaydi. */
export function mask(value = '') {
  const v = String(value || '');
  if (!v) return '';
  if (v.length <= 4) return '••••';
  return `••••${v.slice(-4)}`;
}

/**
 * Provayder sozlamalarini olish: env ustuvor, keyin shifrlangan store.
 * @returns {{ clientId: string, clientSecret: string, redirectUri: string, source: string }}
 */
export function getProviderConfig(provider, envReader = process.env) {
  const meta = PROVIDERS[provider];
  if (!meta) return { clientId: '', clientSecret: '', redirectUri: '', source: 'unknown' };
  const fromEnv = {
    clientId: envReader[meta.env.clientId] || '',
    clientSecret: envReader[meta.env.clientSecret] || '',
    redirectUri: envReader[meta.env.redirectUri] || '',
  };
  if (fromEnv.clientId && fromEnv.clientSecret) return { ...fromEnv, source: 'env' };

  const stored = readStore()[provider] || {};
  const merged = {
    clientId: fromEnv.clientId || stored.clientId || '',
    clientSecret: fromEnv.clientSecret || stored.clientSecret || '',
    redirectUri: fromEnv.redirectUri || stored.redirectUri || '',
  };
  const anyStored = Boolean(merged.clientId && merged.clientSecret);
  return { ...merged, source: anyStored ? 'admin' : 'none' };
}

/** Provayder tayyor (ulanish mumkin)mi. */
export function isProviderConfigured(provider, envReader = process.env) {
  const c = getProviderConfig(provider, envReader);
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

/**
 * Admin panelidan kalitlarni saqlash (bo'sh maydon — mavjud qiymat saqlanadi).
 * @returns {{ ok: boolean, error?: string }}
 */
export function saveProviderConfig(provider, { clientId = '', clientSecret = '', redirectUri = '' } = {}) {
  const meta = PROVIDERS[provider];
  if (!meta) return { ok: false, error: `noma’lum provayder: ${provider}` };
  const store = readStore();
  const prev = store[provider] || {};
  const next = {
    clientId: String(clientId || prev.clientId || '').trim(),
    clientSecret: String(clientSecret || prev.clientSecret || '').trim(),
    redirectUri: String(redirectUri || prev.redirectUri || '').trim(),
  };
  if (!next.clientId || !next.clientSecret) return { ok: false, error: 'Client ID va Client Secret majburiy' };
  store[provider] = next;
  return writeStore(store);
}

/** Status (parolsiz) — UI uchun. */
export function getProviderStatus(provider, envReader = process.env) {
  const meta = PROVIDERS[provider];
  const c = getProviderConfig(provider, envReader);
  return {
    provider,
    label: meta ? meta.label : provider,
    configured: Boolean(c.clientId && c.clientSecret && c.redirectUri),
    source: c.source,
    clientIdMasked: mask(c.clientId),
    hasSecret: Boolean(c.clientSecret),
    redirectUri: c.redirectUri || '',
    envKeys: meta ? Object.values(meta.env) : [],
  };
}

/** Test/ops uchun: saqlangan kalitlarni tozalash. */
export function clearProviderConfig(provider) {
  const store = readStore();
  if (!(provider in store)) return { ok: true };
  delete store[provider];
  return writeStore(store);
}
