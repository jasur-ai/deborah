/**
 * AUTH B-36 — Bulk teacher invite + shared role-invite creator
 * ---------------------------------------------------------------------------
 *  §06: Roster'dan ko'p teacher — CSV/XLSX yuklash → batch invite, har biri
 *       individual bir martalik link (7 kun expiry, B-11 kontrakti).
 *  §07: 100 ta/partiya; duplicate email skip; invalid skip + xato ro'yxati;
 *       qisman muvaffaqiyat (muvaffaqiyatlilar saqlanadi, xatolar qaytariladi).
 *  §08: Invite bir martalik; revoked invite qayta yuborilmaydi.
 *  §15: Har item uchun idempotency — email user/index'da yoki pending
 *       invite'da bo'lsa skip.
 *  §16: audit bulk_invite_created + metric.
 *
 * `createRoleInvite` — bulk (teacher) va co-teacher (B-36 §09) uchun yagona
 * invite yaratish helper'i: single-use token (SHA-256 hash saqlanadi),
 * role + scope (co_teacher uchun courseCode/owner).
 */
import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';
import { normalizeEmail, normalizeName } from './parser.js';

const INVITES_PATH = 'invites';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 kun — B-11 kontrakti bilan bir xil
export const BULK_MAX_PER_BATCH = 100; // §07: 100 ta/partiya
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function tokenHashOf(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Yagona role-invite yaratuvchi (B-36 §08: bir martalik, 7 kun).
 * Idempotent: bir xil email uchun TIRIK (pending) invite bo'lsa skip.
 *
 * @param {{ email: string, name?: string, role: 'teacher'|'co_teacher', scope?: object, lang?: string }} opts
 * @returns {Promise<{ok: boolean, invite?: object, token?: string, error?: string, duplicate?: boolean}>}
 */
export async function createRoleInvite({ email, name = '', role, scope = null, lang = 'uz' }) {
  const cleanEmail = normalizeEmail(email);
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: 'invalid_email' };
  if (role !== 'teacher' && role !== 'co_teacher') return { ok: false, error: 'invalid_role' };

  try {
    // User allaqachon bormi (email index)?
    const idxSnap = await fb.get(`users_email_index/${safeKey(cleanEmail)}`);
    if (idxSnap.exists()) return { ok: false, error: 'already_registered' };

    // Duplicate: TIRIK pending invite (revoked/expired emas) — §08
    const invitesSnap = await fb.get(INVITES_PATH);
    const all = invitesSnap.exists() ? invitesSnap.val() : {};
    const dup = Object.values(all).find((inv) =>
      inv && inv.email === cleanEmail && inv.status === 'pending');
    if (dup) return { ok: false, error: 'duplicate_invite', duplicate: true };

    const token = crypto.randomBytes(48).toString('hex');
    const invite = {
      tokenHash: tokenHashOf(token),
      email: cleanEmail,
      display_name: normalizeName(name),
      role,
      scope: scope || null, // co_teacher: { courseCode, owner }
      source: role === 'co_teacher' ? 'co_teacher' : 'bulk_teacher',
      lang: ['uz', 'uz-cyrl', 'ru', 'en'].includes(lang) ? lang : 'uz',
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + INVITE_TTL_MS,
      usedBy: null,
      usedAt: null,
      revokedAt: null,
      deliveredAt: null,
    };
    await fb.set(`${INVITES_PATH}/${invite.tokenHash}`, invite);
    return {
      ok: true,
      invite,
      // Token faqat dev/test'da qaytariladi (produksion security)
      ...(process.env.NODE_ENV !== 'production' ? { token } : {}),
    };
  } catch (_) {
    return { ok: false, error: 'store_error' };
  }
}

/**
 * CSV/XLSX faylni parse qiladi — teacher qatorlari: email + (ixtiyoriy) ism.
 * Kolonka nomlari: email/elektron pochta/pochta + ism/name/fish.
 * @param {string} filePath — yuklangan fayl (multer temp)
 * @returns {Promise<{rows: Array<{email, name}>, invalid: Array<{row: number, reason: string}>}>}
 */
export async function parseBulkTeacherFile(filePath) {
  const { parseCsv, parseXlsx, normalizeValue } = await import('./parser.js');
  let records = [];
  try {
    const res = /\.(xlsx|xls)$/i.test(filePath)
      ? await parseXlsx(filePath)
      : await parseCsv(filePath, { columns: true });
    // Parser kontrakti: { sheets: [{ rows: [{ data: {...} }] }] }
    records = (res && res.sheets && res.sheets[0] && res.sheets[0].rows) || [];
  } catch (_) {
    return { rows: [], invalid: [{ row: 0, reason: 'parse_error' }] };
  }

  const rows = [];
  const invalid = [];
  records.forEach((rec, i) => {
    // rec = { data: { email: ..., ism: ... } } — normalize qilingan kalitlar
    const map = (rec && rec.data && typeof rec.data === 'object') ? rec.data : (rec || {});
    const emailRaw = normalizeValue(
      map.email || map.Email || map.elektron_pochta || map.pochta || map.mail || '',
    );
    const nameRaw = normalizeValue(map.ism || map.name || map.Name || map.fish || map.FISH || '');
    const email = normalizeEmail(emailRaw);
    if (!EMAIL_RE.test(email)) {
      invalid.push({ row: i + 2, reason: 'invalid_email', value: String(emailRaw).slice(0, 60) });
      return;
    }
    rows.push({ email, name: nameRaw });
  });
  return { rows, invalid };
}

/**
 * §07: batch yaratish — 100 ta/partiya; duplicate/invalid skip + xato ro'yxati;
 * qisman muvaffaqiyat (muvaffaqiyatlilar saqlanadi, xatolar qaytariladi).
 *
 * @param {{ rows: Array<{email, name}>, by: string, lang?: string, limit?: number }} opts
 * @returns {Promise<{ok: boolean, created: number, skipped: number, errors: Array<{email, error}>, invites: Array<object>}>}
 */
export async function createBulkTeacherInvites({ rows = [], by = null, lang = 'uz', limit = BULK_MAX_PER_BATCH }) {
  const result = { ok: true, created: 0, skipped: 0, errors: [], invites: [] };
  const batch = Array.isArray(rows) ? rows.slice(0, limit) : [];
  if (batch.length > limit) {
    result.errors.push({ email: '', error: `limit: max ${limit} ta/partiya` });
  }

  for (const row of batch) {
    if (!row || !row.email) { result.skipped++; continue; }
    const r = await createRoleInvite({ email: row.email, name: row.name, role: 'teacher', lang });
    if (!r.ok) {
      if (r.error === 'already_registered' || r.error === 'duplicate_invite') result.skipped++;
      else result.errors.push({ email: row.email, error: r.error });
      continue;
    }
    result.created++;
    result.invites.push(r.invite);
  }

  // §16: audit + metric
  await logAuthEvent({
    action: AUDIT_ACTIONS.BULK_INVITE_CREATED,
    outcome: 'success',
    method: 'admin',
    actorId: by || null,
    details: { created: result.created, skipped: result.skipped, errors: result.errors.length, role: 'teacher' },
  }).catch(() => {});
  try {
    recordMetric('auth.bulk_invite_created', result.created, { type: 'counter' });
  } catch (_) { /* fail-soft */ }

  return result;
}
