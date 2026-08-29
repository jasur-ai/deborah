/**
 * AUTH B-36 §09/§10 — Co-teacher (P2)
 * ---------------------------------------------------------------------------
 * Asosiy teacher o'zi qo'shadi (invite + rol `co_teacher`); kurs (courseCode)
 * scope'ida ishlaydi.
 *  §10 Chegaralar:
 *    - Kursda ≤3 co-teacher
 *    - Co-teacher roli faqat O'Z kursida amal qiladi (boshqa kurs — yo'q)
 *    - Asosiy teacher (owner) co-teacher'ni olib tashlay oladi
 *  §14 Security: invite bir martalik; rol admin emas (privilege escalation
 *    yo'q — co_teacher workspace'ga kira olmaydi, faqat o'z kursi).
 *  §16 audit co_teacher_added / co_teacher_removed + metric.
 */
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';
import { createRoleInvite } from '../roster/bulk-invite.js';

const CO_TEACHER_PATH = 'co_teacher_records';
export const CO_TEACHER_MAX_PER_COURSE = 3;

/** Kurs kodini normalizatsiya qiladi (slug-ish: kichik, alfanumerik + -_). */
export function normalizeCourseCode(code) {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/**
 * User kursning asosiy o'qituvchisimi yoki co-teacher'i?
 * (scope tekshiruvi — boshqa kursda co_teacher rol amal qilmaydi)
 * @returns {Promise<boolean>}
 */
export async function isCourseTeacher(userKey, courseCode) {
  const code = normalizeCourseCode(courseCode);
  if (!code || !userKey) return false;
  try {
    const recSnap = await fb.get(`${CO_TEACHER_PATH}/${code}`);
    if (recSnap.exists()) {
      const rec = recSnap.val();
      if (rec.owner === userKey) return true;
      if (rec.coTeachers && rec.coTeachers[userKey]) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/** Kursning barcha co-teacher'larini o'qiydi (owner + list). */
export async function listCoTeachers(courseCode) {
  const code = normalizeCourseCode(courseCode);
  if (!code) return { ok: false, error: 'invalid_course' };
  try {
    const snap = await fb.get(`${CO_TEACHER_PATH}/${code}`);
    if (!snap.exists()) return { ok: true, owner: null, coTeachers: [] };
    const rec = snap.val();
    return {
      ok: true,
      owner: rec.owner || null,
      coTeachers: Object.entries(rec.coTeachers || {})
        .map(([key, v]) => ({ userKey: key, ...v }))
        .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)),
    };
  } catch (_) {
    return { ok: false, error: 'store_error' };
  }
}

/**
 * §09: co-teacher qo'shish — owner faqat. Kursni birinchi da'vo qilgan teacher
 * owner bo'ladi; boshqa teacher kursga tegishi mumkin emas (tenant/guruh scope).
 *
 * @param {{ ownerKey: string, courseCode: string, email: string, name?: string, lang?: string }} opts
 * @returns {Promise<{ok: boolean, error?: string, invite?: object, token?: string}>}
 */
export async function addCoTeacher({ ownerKey, courseCode, email, name = '', lang = 'uz' }) {
  if (!ownerKey) return { ok: false, error: 'no_owner' };
  const code = normalizeCourseCode(courseCode);
  if (!code) return { ok: false, error: 'invalid_course' };

  try {
    const recSnap = await fb.get(`${CO_TEACHER_PATH}/${code}`);
    let rec = recSnap.exists() ? recSnap.val() : null;

    // Kurs boshqa teacher'ga tegishli — 403 (owner scope)
    if (rec && rec.owner && rec.owner !== ownerKey) {
      return { ok: false, error: 'course_owned' };
    }
    const coTeachers = rec?.coTeachers || {};

    // §10: ≤3 co-teacher — amaldagi co-teacherlar + ushbu kurs uchun
    // TIRIK (pending) co_teacher invite'lar hisoblanadi (limit'ni chetlab
    // o'tish yo'q: invite'lar ham limitga kiradi).
    let pendingInvites = 0;
    try {
      const invitesSnap = await fb.get('invites');
      if (invitesSnap.exists()) {
        pendingInvites = Object.values(invitesSnap.val()).filter((inv) =>
          inv && inv.status === 'pending' && inv.role === 'co_teacher'
          && inv.scope && inv.scope.courseCode === code).length;
      }
    } catch (_) { /* fail-open */ }
    if (Object.keys(coTeachers).length + pendingInvites >= CO_TEACHER_MAX_PER_COURSE) {
      return { ok: false, error: 'co_teacher_limit' };
    }

    const invite = await createRoleInvite({
      email,
      name,
      role: 'co_teacher',
      scope: { courseCode: code, owner: ownerKey },
      lang,
    });
    if (!invite.ok) return { ok: false, error: invite.error };

    // Owner + co-teacherlar ro'yxati (accept'da to'ldiriladi)
    const next = rec || { owner: ownerKey, createdAt: Date.now(), coTeachers: {} };
    next.owner = ownerKey;
    await fb.set(`${CO_TEACHER_PATH}/${code}`, next);

    await logAuthEvent({
      action: AUDIT_ACTIONS.CO_TEACHER_ADDED,
      outcome: 'success',
      method: 'teacher',
      actorId: ownerKey,
      details: { courseCode: code, inviteHash: invite.invite.tokenHash.slice(0, 12) },
    }).catch(() => {});
    try {
      recordMetric('auth.co_teacher_added', 1, { type: 'counter' });
    } catch (_) { /* fail-soft */ }

    return { ok: true, invite: invite.invite, ...(invite.token ? { token: invite.token } : {}) };
  } catch (_) {
    return { ok: false, error: 'store_error' };
  }
}

/**
 * §10: co-teacher olib tashlash — owner faqat. Rol + record o'chiriladi.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function removeCoTeacher({ ownerKey, courseCode, coTeacherKey }) {
  if (!ownerKey) return { ok: false, error: 'no_owner' };
  const code = normalizeCourseCode(courseCode);
  const target = safeKey(coTeacherKey);
  if (!code || !target) return { ok: false, error: 'invalid_input' };

  try {
    const recSnap = await fb.get(`${CO_TEACHER_PATH}/${code}`);
    if (!recSnap.exists()) return { ok: false, error: 'not_found' };
    const rec = recSnap.val();
    if (!rec.owner || rec.owner !== ownerKey) return { ok: false, error: 'forbidden' };
    if (!rec.coTeachers || !rec.coTeachers[target]) return { ok: false, error: 'not_found' };

    await fb.remove(`${CO_TEACHER_PATH}/${code}/coTeachers/${target}`);
    // Rol'ni ham teacher'ga tushirmaymiz (user boshqa kurslarda bo'lishi mumkin),
    // faqat scope record'i o'chadi — co_teacher endi bu kursga kira olmaydi.
    await logAuthEvent({
      action: AUDIT_ACTIONS.CO_TEACHER_REMOVED,
      outcome: 'success',
      method: 'teacher',
      actorId: ownerKey,
      details: { courseCode: code, coTeacherKey: target },
    }).catch(() => {});
    try {
      recordMetric('auth.co_teacher_removed', 1, { type: 'counter' });
    } catch (_) { /* fail-soft */ }
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'store_error' };
  }
}

/**
 * Invite accept paytida co_teacher'ni record'ga yozadi (limit qayta tekshiriladi).
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function bindCoTeacher({ userKey, courseCode, owner }) {
  const code = normalizeCourseCode(courseCode);
  if (!code || !userKey) return { ok: false, error: 'invalid_input' };
  try {
    const recSnap = await fb.get(`${CO_TEACHER_PATH}/${code}`);
    const rec = recSnap.exists() ? recSnap.val() : null;
    if (!rec || rec.owner !== owner) return { ok: false, error: 'course_owned' };
    const coTeachers = rec.coTeachers || {};
    if (Object.keys(coTeachers).length >= CO_TEACHER_MAX_PER_COURSE) {
      return { ok: false, error: 'co_teacher_limit' };
    }
    coTeachers[userKey] = { addedAt: Date.now(), inviteAcceptedAt: Date.now() };
    await fb.set(`${CO_TEACHER_PATH}/${code}/coTeachers`, coTeachers);
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'store_error' };
  }
}
