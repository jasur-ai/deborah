/**
 * Deborah — Shared Token Vault (AES-256-GCM)
 *
 * Prompt 59 — Canva va Google Slides adapter'larining OAuth tokenlarini
 * DB'da saqlash uchun bitta umumiy vault (duplikatsiya yo'q, §22.9 —
 * provider API key/token browserga va log'larga chiqmaydi).
 *
 *   - encryptToken: v1:iv:tag:data (base64) — AES-256-GCM.
 *   - decryptToken: encrypted string → plaintext (yoki null).
 *
 * Key: ENCRYPTION_KEY env yoki SESSION_SECRET — hech qachon DB'da emas.
 */

import crypto from 'crypto';

function getVaultKey() {
  const k = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'deborah-dev-secret';
  return crypto.createHash('sha256').update(String(k)).digest();
}

/** Encrypt a token for the vault. */
export function encryptToken(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getVaultKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Decrypt a token from the vault. */
export function decryptToken(enc) {
  if (!enc) return null;
  const [v, ivB64, tagB64, dataB64] = String(enc).split(':');
  if (v !== 'v1') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getVaultKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) {
    return null;
  }
}
