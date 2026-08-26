/**
 * AUTH C-09 §10 — Fail spike alert (admin email)
 * -------------------------------------------------------------------
 * Scheduled check (server.js'da soatlik): so'nggi WINDOW_MS ichida
 * auth.login.failed + auth.lockout.triggered + auth.abuse.* hodisalari
 * AUDIT_FAIL_SPIKE_THRESHOLD'dan oshsa → admin email + audit + metric.
 *
 * Idempotent (C-09 §10/§28): email COOLDOWN_MS ichida BIR marta —
 * `audit_alert_state/{windowKey}` state'ida oxirgi alert vaqti saqlanadi;
 * takroriy yugurishlar o'sha window'da qayta email yubormaydi.
 *
 * Fail-open: barcha xatoliklar yutiladi — server ishini buzmaydi.
 */
import CONFIG from '../../config/env.js';
import { fb } from '../../../firebase/admin.js';
import { logAuthEvent, AUDIT_ACTIONS } from './audit.js';
import { recordMetric } from '../../telemetry/index.js';

const AUDIT_PREFIX = 'auth_audit';

// Alert threshold config (C-09 §28 — env orqali)
const ALERT_WINDOW_MS = Number(process.env.AUDIT_ALERT_WINDOW_MS || 60 * 60 * 1000); // 1 soat
const FAIL_SPIKE_THRESHOLD = Number(process.env.AUDIT_FAIL_SPIKE_THRESHOLD || 10);  // 10 fail / soat
const ALERT_COOLDOWN_MS = Number(process.env.AUDIT_ALERT_COOLDOWN_MS || 6 * 60 * 60 * 1000); // 6 soat
const ALERT_NOTIFY_EMAIL = process.env.AUDIT_ALERT_NOTIFY_EMAIL || 'support@deborah.uz';

/** Fail spike signal'lariga kiruvchi action'lar (suffix mosligi). */
const SPIKE_ACTIONS = ['login.failed', 'lockout', 'abuse'];

/** Signal'ga mos keladimi (auth.login.failed, auth.lockout.triggered, auth.abuse.stuffing ...). */
function isSpikeAction(action) {
  const a = String(action || '');
  return SPIKE_ACTIONS.some((s) => a.includes(s));
}

/**
 * C-09 §10: fail spike'ni aniqlaydi va (cooldown yetgan bo'lsa) admin email
 * yuboradi. Idempotent — `audit_alert_state/{windowKey}` saqlanadi.
 *
 * @param {{ now?: number, threshold?: number, windowMs?: number, cooldownMs?: number, send?: Function }} [opts]
 * @returns {Promise<{ failCount: number, alerted: boolean, windowKey: string }>}
 */
export async function runFailSpikeAlert({
  now = Date.now(),
  threshold = FAIL_SPIKE_THRESHOLD,
  windowMs = ALERT_WINDOW_MS,
  cooldownMs = ALERT_COOLDOWN_MS,
  send = null,
  windowKey: windowKeyOpt = null,
} = {}) {
  const from = now - windowMs;
  // Soatlik window (UTC). Test'lar aniq kalit uzatishi mumkin — aks holda
  // soat chegarasiga yaqin run'da now+Δ keyingi soatga o'tib, idempotent
  // cooldown testi flaky bo'ladi (C-09 §10).
  const windowKey = windowKeyOpt || new Date(now).toISOString().slice(0, 13);

  // 1) So'nggi window ichidagi fail/lockout/abuse hodisalarini sanaymiz
  let failCount = 0;
  try {
    const snap = await fb.get(AUDIT_PREFIX);
    if (snap.exists()) {
      for (const day of Object.values(snap.val())) {
        if (!day || typeof day !== 'object') continue;
        for (const e of Object.values(day)) {
          if (!e || typeof e !== 'object') continue;
          const ts = typeof e.ts === 'number' ? e.ts : 0;
          if (ts < from || ts > now) continue;
          if (isSpikeAction(e.action)) failCount += 1;
        }
      }
    }
  } catch (_) { /* fail-open */ }

  const result = { failCount, alerted: false, windowKey };

  // 2) Threshold oshmagan bo'lsa — hech narsa
  if (failCount < threshold) return result;

  // 3) Cooldown tekshiruvi (idempotent — takroriy email yo'q)
  try {
    const stateSnap = await fb.get(`audit_alert_state/${windowKey}`);
    const state = stateSnap.exists() ? stateSnap.val() : {};
    if (state.alerted_at && now - state.alerted_at < cooldownMs) {
      return result; // hali cooldown — qayta yubormaymiz
    }
  } catch (_) { /* fail-open */ }

  // 4) Email (best-effort; test'da send injekt qilinadi)
  const subject = `[Xavfsizlik] Fail spike aniqlangan: ${failCount} hodisa / soat`;
  const text = `So'nggi ${Math.round(windowMs / 60000)} daqiqada ${failCount} ta xavfsizlik hodisasi (login fail / lockout / abuse) aniqlandi — me'yor ${threshold}. Admin panel: /admin/audit`;
  try {
    if (typeof send === 'function') {
      await send({ to: ALERT_NOTIFY_EMAIL, subject, text, tag: 'audit_fail_spike' });
    } else {
      const { sendEmail } = await import('../../email/provider.js');
      await sendEmail({
        to: ALERT_NOTIFY_EMAIL,
        subject,
        html: `<p>${text.replace(/\n/g, '<br>')}</p>`,
        text,
        tag: 'audit_fail_spike',
      });
    }
  } catch (_) { /* fail-open — audit hali yoziladi */ }

  // 5) State + audit + metric
  try {
    await fb.set(`audit_alert_state/${windowKey}`, { alerted_at: now, fail_count: failCount });
  } catch (_) {}
  await logAuthEvent({
    action: 'auth.audit.fail_spike',
    outcome: 'flagged',
    method: 'scheduled',
    details: { windowKey, failCount, threshold },
  }).catch(() => {});
  try { recordMetric('auth.audit.fail_spike_alert', 1, { type: 'counter' }); } catch (_) {}

  result.alerted = true;
  return result;
}

// Re-export — admin on-demand trigger uchun (agar kerak bo'lsa)
export { ALERT_NOTIFY_EMAIL, FAIL_SPIKE_THRESHOLD, ALERT_WINDOW_MS, ALERT_COOLDOWN_MS };
