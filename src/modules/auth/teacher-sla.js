/**
 * AUTH B-16 — Teacher approval SLA (eslatma + eskalatsiya)
 * -------------------------------------------------------------------
 * Idempotent scheduled job (server.js'da soatlik; admin on-demand ham mumkin).
 *
 * Timeline (B-16 §06):
 *   0h    ariza topshirildi → sla_state: normal
 *   24h   admin'ga email eslatma #1
 *   48h   admin'ga email eslatma #2
 *   72h   approval window tugadi → "qayta ko'rib chiqish" eslatmasi #3
 *   7 kun eskalatsiya → super-admin'ga (email) + audit teacher_escalated
 *
 * Idempotentlik (B-16 §30): email faqat holat o'tishida / 24h ichida BIR
 * marta yuboriladi (reminder_count + last_reminded_at + sla_state tekshiriladi).
 * `teacher_applications/{appId}.sla_state`: normal | reminded | escalated
 */
import CONFIG from '../../config/env.js';
import { fb } from '../../../firebase/admin.js';
import { logAuthEvent, AUDIT_ACTIONS } from './audit.js';
import { recordMetric } from '../../telemetry/index.js';

const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = CONFIG.TEACHER_APPROVAL_WINDOW_MS || 72 * 60 * 60 * 1000;
const ESCALATION_MS = CONFIG.TEACHER_ESCALATION_MS || 7 * 24 * 60 * 60 * 1000;
// Ops xabarnomasi (env orqali; bo'sh bo'lsa audit+metric yetarli)
const SLA_NOTIFY_EMAIL = process.env.TEACHER_SLA_NOTIFY_EMAIL || 'support@edikit.uz';
const MAX_REMINDERS = 3; // 24s + 48s + 72s ("qayta ko'rib chiqish")

/** B-16 §06: ariza yoshiga qarab SLA holati. */
export function slaStateFor(ageMs) {
  if (ageMs >= ESCALATION_MS) return 'escalated';
  if (ageMs >= WINDOW_MS) return 'window-exceeded';
  if (ageMs >= REMIND_EVERY_MS) return 'reminded';
  return 'normal';
}

/** B-16 §06: eslatma email'ini yuborish (best-effort, fail-open). */
async function sendSlaEmail(kind, { appId, username, ageMs, count }) {
  const { sendEmail } = await import('../../email/provider.js');
  const days = Math.max(1, Math.floor(ageMs / 86400000));
  const subject = kind === 'escalated'
    ? `[SLA] Teacher arizasi eskalatsiya: ${username} (${days} kun)`
    : `[SLA] Teacher arizasi eslatma #${count}: ${username}`;
  const text = kind === 'escalated'
    ? `Teacher arizasi ${days} kun davomida ko'rib chiqilmadi (appId: ${appId}). Super-admin qarori talab qilinadi. Admin panel: /admin/teachers`
    : `Teacher arizasi hali ko'rib chiqilmagan (appId: ${appId}, ${days} kun). Admin panel: /admin/teachers`;
  await sendEmail({
    to: SLA_NOTIFY_EMAIL,
    subject,
    html: `<p>${text.replace(/\n/g, '<br>')}</p>`,
    text,
    tag: 'teacher_sla',
  });
}

/**
 * B-16 §06/§07/§30: barcha teacher_pending arizalari uchun SLA progression.
 * Idempotent — har yugurishda email faqat muddati yetganda BIR marta.
 *
 * @param {object} [opts] - { now }
 * @returns {Promise<{reminded: number, escalated: number}>}
 */
export async function runTeacherSla({ now = Date.now() } = {}) {
  const result = { reminded: 0, escalated: 0 };

  const usersSnap = await fb.get('users').catch(() => null);
  if (!usersSnap || !usersSnap.exists()) return result;

  // Canonical application'lar (user_id bo'yicha eng yangi)
  const appsSnap = await fb.get('teacher_applications').catch(() => null);
  const appsByUser = {};
  if (appsSnap && appsSnap.exists()) {
    for (const app of Object.values(appsSnap.val())) {
      const prev = appsByUser[app.user_id];
      if (!prev || app.created_at > prev.created_at) appsByUser[app.user_id] = app;
    }
  }

  for (const [key, u] of Object.entries(usersSnap.val())) {
    if (u.role !== 'teacher_pending') continue;
    const app = appsByUser[key];
    const appId = app?.id || u.teacher_application?.appId;
    if (!appId) continue;
    const appliedAt = u.teacher_application?.appliedAt || app?.created_at || u.created_at || 0;
    if (!appliedAt) continue;
    const ageMs = now - appliedAt;
    const state = slaStateFor(ageMs);

    if (state === 'escalated') {
      // Idempotent: faqat birinchi marta
      if (app.sla_state !== 'escalated') {
        await fb.set(`teacher_applications/${appId}/sla_state`, 'escalated');
        await fb.set(`teacher_applications/${appId}/escalated_at`, now);
        await logAuthEvent({
          action: AUDIT_ACTIONS.TEACHER_ESCALATED,
          outcome: 'escalated',
          method: 'sla',
          actorId: key,
          details: { appId, ageMs },
        }).catch(() => {});
        await sendSlaEmail('escalated', { appId, username: u.username || key, ageMs }).catch(() => {});
        result.escalated++;
      }
      continue;
    }

    if (state === 'window-exceeded' || state === 'reminded') {
      const count = app.reminder_count || 0;
      const last = app.last_reminded_at || 0;
      const due = count < MAX_REMINDERS && now - last >= REMIND_EVERY_MS;
      if (due) {
        const newCount = count + 1;
        await fb.set(`teacher_applications/${appId}/sla_state`, 'reminded');
        await fb.set(`teacher_applications/${appId}/reminder_count`, newCount);
        await fb.set(`teacher_applications/${appId}/last_reminded_at`, now);
        await logAuthEvent({
          action: AUDIT_ACTIONS.TEACHER_SLA_REMINDED,
          outcome: 'reminded',
          method: 'sla',
          actorId: key,
          details: { appId, count: newCount, window: state === 'window-exceeded' },
        }).catch(() => {});
        await sendSlaEmail('reminded', { appId, username: u.username || key, ageMs, count: newCount }).catch(() => {});
        result.reminded++;
      } else if (state === 'window-exceeded' && app.sla_state !== 'reminded') {
        // Window tugagan — holatni belgilaymiz (email etkazish shart emas)
        await fb.set(`teacher_applications/${appId}/sla_state`, 'reminded');
      }
    }
  }

  try {
    if (result.reminded > 0) recordMetric('auth.teacher.sla_reminded', result.reminded, { type: 'counter' });
    if (result.escalated > 0) recordMetric('auth.teacher.sla_escalated', result.escalated, { type: 'counter' });
  } catch (_) { /* telemetry fail-soft */ }

  return result;
}
