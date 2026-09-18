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

// ═══════════════════════════════════════════════════════════════════
// Kutilayotgan OAuth (state → verifier) — BUG-CANVA-02
// ───────────────────────────────────────────────────────────────────
// Muammo: admin sessiya cookie'si SameSite=Strict. Canva/Google'dan
// qaytgan cross-site redirect'da cookie YUBORILMAYDI → requireAdmin
// callback'da har doim yiqiladi va code yo'qoladi.
// Yechim (standart OAuth pattern): state→verifier juftligi sessiyada
// EMAS, server-side pending store'da (10 daqiqa TTL, bir martalik)
// saqlanadi. GET callback public — himoya taxminlab bo'lmas state'da.
// ═══════════════════════════════════════════════════════════════════

const PENDING_TTL_MS = 10 * 60 * 1000;

function pendingPath(provider, state) {
  const s = String(state || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  return `integrations/${provider}/pending/${s}`;
}

/** Pending OAuth boshlash: state → { verifier, actorId, expiresAt }. */
export async function savePendingOAuth(provider, { state = '', verifier = '', actorId = 'admin' } = {}) {
  if (!state || !verifier) return { ok: false };
  await fb.set(pendingPath(provider, state), {
    verifier,
    actorId,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
  return { ok: true };
}

/**
 * Pending OAuth'ni bir martalik ishlatish: topilsa va muddati o'tmagan
 * bo'lsa { verifier, actorId } qaytarib O'CHIRADI (replay yo'q).
 */
export async function consumePendingOAuth(provider, state) {
  if (!state) return { ok: false };
  try {
    const snap = await fb.get(pendingPath(provider, state));
    if (!snap || !snap.exists()) return { ok: false };
    const v = snap.val() || {};
    await fb.remove(pendingPath(provider, state)).catch(() => {});
    if (!v.verifier || (v.expiresAt && Date.now() > v.expiresAt)) return { ok: false, expired: true };
    return { ok: true, verifier: v.verifier, actorId: v.actorId ?? 'admin' };
  } catch {
    return { ok: false };
  }
}
