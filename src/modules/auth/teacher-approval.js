/**
 * AUTH B-14 — Teacher approval: state machine + schema (Entra PIM patterni)
 * -------------------------------------------------------------------
 * Role state machine (B-14 §06/§09):
 *   registered ──(ariza)──▶ teacher_pending ──(approve)──▶ teacher
 *                                │
 *                                └──(reject)──▶ teacher_rejected
 *                                                   │
 *                                      (cooldown 30 kun o'tdi) ──(qayta ariza)──▶ teacher_pending
 *
 * `teacher_applications/{appId}` — canonical ariza record (B-14 §07):
 *   id, user_id, username, email, full_name, university, subject, experience,
 *   reason, status, reviewed_by, reviewed_at, justification, reject_reason,
 *   cooldown_until, created_at.
 *
 * Transition qoidalari (B-14 §09):
 *   - pending→approved  : admin, justification majburiy (route'da)
 *   - pending→rejected  : admin, reason majburiy (route'da)
 *   - rejected→pending  : FAQAT cooldown o'tgach (30 kun, CONFIG)
 *   - approved→rejected : admin revoke (sabab bilan)
 *
 * Security (B-14 §13/§15): transition faqat admin (route middleware);
 * cooldown gate service'da ham (defense in depth); har bir qaror audit + metric.
 */

import CONFIG from '../../config/env.js';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from './audit.js';
import { recordMetric } from '../../telemetry/index.js';

/** B-14 §26: cooldown config'da (30 kun default). */
export const TEACHER_COOLDOWN_MS = CONFIG.TEACHER_REJECT_COOLDOWN_MS || 30 * 24 * 60 * 60 * 1000;

/** B-14 §09: ruxsat etilgan role o'tishlar. */
export const TEACHER_TRANSITIONS = {
  teacher_pending: ['teacher', 'teacher_rejected'], // approve | reject
  teacher_rejected: ['teacher_pending'],            // qayta ariza (cooldown'dan keyin)
  teacher: ['teacher_rejected'],                    // revoke (admin, sabab)
};

/**
 * B-14 §09: transition validatsiyasi — cooldown qoidasi bilan.
 * @param {string} from - joriy role
 * @param {string} to - maqsadli role
 * @param {object} [opts] - { now, decidedAt } (rejected→pending cooldown uchun)
 * @returns {{ok: true} | {ok: false, error: string, remainingMs?: number, cooldownUntil?: number}}
 */
export function validateTeacherTransition(from, to, { now = Date.now(), decidedAt = 0 } = {}) {
  if (from === to) return { ok: false, error: 'no_op' };
  const allowed = TEACHER_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return { ok: false, error: 'invalid_transition', from, to };
  }
  if (from === 'teacher_rejected' && to === 'teacher_pending') {
    const cooldownUntil = (decidedAt || 0) + TEACHER_COOLDOWN_MS;
    if (now < cooldownUntil) {
      return { ok: false, error: 'cooldown_active', remainingMs: cooldownUntil - now, cooldownUntil };
    }
  }
  return { ok: true };
}

/** B-14 §07: reject qilingan arizaning cooldown tugash vaqti. */
export function getCooldownUntil(decidedAt) {
  return decidedAt ? decidedAt + TEACHER_COOLDOWN_MS : 0;
}

/**
 * B-14 §07: canonical ariza record'ini quradi (teacher_applications/{appId}).
 */
export function buildApplicationRecord({
  userKey, username = '', email = '', name = '', university = '',
  subject = '', experience = '', reason = '', appId, appliedAt = Date.now(), lang = 'uz',
}) {
  return {
    id: appId,
    user_id: safeKey(userKey),
    username,
    email: String(email || ''),
    full_name: String(name || ''),
    university: String(university || '').trim().slice(0, 200),
    subject: String(subject || '').trim().slice(0, 100),
    experience: String(experience || '').trim().slice(0, 1000),
    reason: String(reason || '').trim().slice(0, 500),
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    justification: null,
    reject_reason: null,
    cooldown_until: null,
    created_at: appliedAt,
    lang,
  };
}

/**
 * B-14 §06/§08: ariza topshirish (register / appeal / Google teacher).
 * - cooldown gate: teacher_rejected → pending faqat cooldown o'tgach
 * - canonical `teacher_applications/{appId}` + inline `users/{key}/teacher_application`
 * - audit TEACHER_APPLICATION + metric teacher_application_submitted
 *
 * @returns {Promise<{ok: true, appId: string, app: object} | {ok: false, error: string, remainingMs?: number}>}
 */
export async function submitTeacherApplication({
  userKey, username = '', email = '', name = '', university = '',
  subject = '', experience = '', reason = '', lang = 'uz', appeal = false,
}) {
  const key = safeKey(userKey);

  // Cooldown gate (defense in depth — register'da ham A-25 §14 tekshiruvi bor)
  const userSnap = await fb.get(`users/${key}`).catch(() => null);
  let isAppeal = false;
  if (userSnap && userSnap.exists()) {
    const prevRole = userSnap.val().role;
    // B-29 §14: duplicate — canonical `teacher_applications` da TIRIK
    // (pending/approved) ariza mavjud bo'lsa yangi yaratilmaydi.
    // (Register oqimi user'ni teacher_pending qilib yaratadi, keyin bu
    //  funksiyani chaqiradi — role'ga emas, canonical record'ga qaraymiz.)
    const appsSnap = await fb.get('teacher_applications').catch(() => null);
    let activeApp = null;
    if (appsSnap && appsSnap.exists()) {
      for (const app of Object.values(appsSnap.val())) {
        if (app && app.user_id === key && (app.status === 'pending' || app.status === 'approved')) {
          activeApp = app;
          break;
        }
      }
    }
    if (activeApp) {
      await logAuthEvent({
        action: AUDIT_ACTIONS.DUPLICATE_ATTEMPT,
        outcome: 'blocked',
        method: 'register',
        actorId: key,
        details: { reason: 'teacher_application_exists', appId: activeApp.id, status: activeApp.status },
      }).catch(() => {});
      return { ok: false, error: 'duplicate_application' };
    }
    if (prevRole === 'teacher_rejected') {
      const check = validateTeacherTransition('teacher_rejected', 'teacher_pending', {
        decidedAt: userSnap.val().teacher_decision_at || 0,
      });
      if (!check.ok) {
        await logAuthEvent({
          action: AUDIT_ACTIONS.TEACHER_COOLDOWN_BLOCK,
          outcome: 'blocked',
          method: 'register',
          actorId: key,
          details: { remainingMs: check.remainingMs, cooldownUntil: check.cooldownUntil },
        }).catch(() => {});
        return { ok: false, error: 'cooldown_active', remainingMs: check.remainingMs };
      }
      // Cooldown o'tgan — bu qayta ariza (appeal), B-16 §14
      isAppeal = true;
    }
  }
  // Caller (register) appeal holatini aniq biladi — user record overwrite
  // bo'lgani uchun role tekshiruvi yetarli emas (B-16 review fix)
  isAppeal = isAppeal || Boolean(appeal);

  const appliedAt = Date.now();
  const appId = `ta_${key}_${appliedAt}`;
  const record = buildApplicationRecord({
    userKey: key, username, email, name, university, subject, experience, reason,
    appId, appliedAt, lang,
  });

  await fb.set(`teacher_applications/${appId}`, record);
  // Inline (B-01 users schema bilan mos; eski o'quvchi admin UI uchun)
  await fb.set(`users/${key}/teacher_application`, {
    university: record.university,
    subject: record.subject,
    experience: record.experience,
    reason: record.reason,
    appliedAt,
    status: 'pending',
    appId,
  });

  await logAuthEvent({
    action: AUDIT_ACTIONS.TEACHER_APPLICATION,
    outcome: 'success',
    method: 'register',
    actorId: key,
    details: { appId, university: record.university, subject: record.subject, ...(isAppeal ? { appeal: true } : {}) },
  }).catch(() => {});

  // B-16 §14: rad etilgan → qayta ariza (cooldown o'tdi) alohida audit
  if (isAppeal) {
    await logAuthEvent({
      action: AUDIT_ACTIONS.TEACHER_APPEAL,
      outcome: 'success',
      method: 'register',
      actorId: key,
      details: { appId, previousCooldown: record.cooldown_until },
    }).catch(() => {});
  }

  try {
    recordMetric('auth.teacher_application_submitted', 1, { type: 'counter', labels: { lang, ...(isAppeal ? { appeal: '1' } : {}) } });
  } catch (_) { /* telemetry fail-soft */ }

  return { ok: true, appId, app: record };
}

/**
 * B-14 §09/§11/§15: admin qarori (approve | reject).
 * Transition validatsiya + role/role_version/decision field'lar + canonical
 * record status + cooldown_until (reject) + audit. Route'da qo'shimcha
 * himoya (recent-admin-auth, MFA step-up, self-approve, eskalatsiya) turibdi.
 *
 * @param {object} params - { userKey, decision: 'approve'|'reject', by, justification, ipAddress?, userAgent?, ageMs? }
 * @returns {Promise<{ok: true, role: string} | {ok: false, error: string, role?: string}>}
 */
export async function decideTeacherApplication({
  userKey, decision, by, justification, ipAddress = null, userAgent = null, ageMs = 0,
}) {
  const key = safeKey(userKey);
  const snap = await fb.get(`users/${key}`);
  if (!snap.exists()) return { ok: false, error: 'not_found' };
  const u = snap.val();
  const from = u.role;
  const to = decision === 'approve' ? 'teacher' : 'teacher_rejected';

  const check = validateTeacherTransition(from, to);
  if (!check.ok) return { ok: false, error: check.error, role: from };

  const now = Date.now();
  // role + role_version atomik yoziladi (A-02: eski sessiyalar bekor)
  await fb.set(`users/${key}/role`, to);
  await fb.set(`users/${key}/role_version`, now);
  await fb.set(`users/${key}/teacher_decision_at`, now);
  await fb.set(`users/${key}/teacher_decision_by`, by);
  if (to === 'teacher_rejected') {
    await fb.set(`users/${key}/teacher_rejection_reason`, justification);
    // B-14 §26: cooldown_until — qayta ariza oynasi (30 kun)
    await fb.set(`users/${key}/teacher_cooldown_until`, getCooldownUntil(now));
  }
  await fb.set(`users/${key}/teacher_application/status`, to === 'teacher' ? 'approved' : 'rejected');

  // Canonical record'ni yangilash (agar mavjud bo'lsa)
  const appId = u.teacher_application?.appId
    || (u.teacher_application?.appliedAt ? `ta_${key}_${u.teacher_application.appliedAt}` : null);
  if (appId) {
    const appSnap = await fb.get(`teacher_applications/${appId}`);
    if (appSnap.exists()) {
      await fb.set(`teacher_applications/${appId}`, {
        ...appSnap.val(),
        status: to === 'teacher' ? 'approved' : 'rejected',
        reviewed_by: by,
        reviewed_at: now,
        justification: to === 'teacher' ? justification : null,
        reject_reason: to === 'teacher_rejected' ? justification : null,
        cooldown_until: to === 'teacher_rejected' ? getCooldownUntil(now) : null,
      });
    }
  }

  // Yagona audit (route'da dublikat yo'q — B-14 §15)
  await logAuthEvent({
    action: to === 'teacher' ? AUDIT_ACTIONS.TEACHER_APPROVED : AUDIT_ACTIONS.TEACHER_REJECTED,
    outcome: to === 'teacher' ? 'success' : 'rejected',
    method: 'admin',
    actorId: key,
    ipAddress,
    userAgent,
    details: { by, justification, ts: now, ...(ageMs ? { ageMs } : {}) },
  }).catch(() => {});

  return { ok: true, role: to };
}
