/**
 * Deborah — OAuth ulanishlar vault'i (Firebase)
 * ─────────────────────────────────────────────
 * 09/2026 (BUG-CANVA-01): Canva/Google-Slides service'lari token vault
 * sifatida PostgreSQL (Kysely) ishlatardi — lekin production'da Postgres
 * yo'q (app Firebase'da), getDb() await'siz chaqirilgan (Promise qaytadi)
 * va tenant context hech qachon o'rnatilmasdi. Natija: OAuth callback,
 * unlink, create/import/export HAQIQATDA hech qachon ishlamagan.
 *
 * Yechim: ulanishlar Firebase RTDB'da saqlanadi:
 *   integrations/{provider}/connections/{actorKey}
 * Tokenlar baribir SHIFRLANGAN (encryptToken — AES-256-GCM); bu modul
 * faqat saqlash/qaytarish bilan shug'ullanadi, plaintext'ga tegmaydi.
 *
 * Xavfsizlik: actorKey — Firebase kalit qoidasiga mos sanitizatsiya
 * qilinadi (`. $ # [ ] /` taqiqlangan).
 */

import { fb } from '../../../firebase/admin.js';

/** Firebase yo'l kaliti uchun xavfsiz identifikator. */
export function vaultActorKey(actorId) {
  return String(actorId ?? 'admin').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'admin';
}

/** Vault yo'li: integrations/{provider}/connections/{actorKey}. */
export function vaultPath(provider, actorId) {
  return `integrations/${provider}/connections/${vaultActorKey(actorId)}`;
}

/** Ulanishni o'qish — yo'q bo'lsa null. */
export async function loadConnection(provider, actorId) {
  try {
    const snap = await fb.get(vaultPath(provider, actorId));
    if (!snap || !snap.exists()) return null;
    return snap.val() || null;
  } catch {
    return null;
  }
}

/** Ulanishni saqlash (upsert — to'liq almashtirish). */
export async function saveConnection(provider, actorId, data) {
  const payload = { ...(data || {}), updated_at: new Date().toISOString() };
  await fb.set(vaultPath(provider, actorId), payload);
  return payload;
}

/** Ulanishni qisman yangilash (mavjud bo'lmasa — yaratadi). */
export async function patchConnection(provider, actorId, patch) {
  const prev = (await loadConnection(provider, actorId)) || {};
  return saveConnection(provider, actorId, { ...prev, ...(patch || {}) });
}

/** Ulanishni o'chirish (unlink). */
export async function deleteConnection(provider, actorId) {
  await fb.remove(vaultPath(provider, actorId));
  return true;
}
