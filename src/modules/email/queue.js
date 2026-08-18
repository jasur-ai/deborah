/**
 * AUTH B-31 — Email queue: retry, dead-letter, priority, idempotency, throttle
 * ---------------------------------------------------------------------------
 * DB-backed navbat (Firebase/local-db — BullMQ emas: ioredis faqat sessiya
 * uchun opsional; mavjud job infratuzilmasi (welcome, teacher-SLA) ham
 * DB + setInterval worker pattern'ida).
 *
 * PII xavfsizligi (§13/§16):
 *   - Job'da plaintext email YO'Q. User-bog'liq template'lar uchun `userKey`,
 *     invite uchun `inviteTokenHash` saqlanadi — recipient send paytida
 *     DB'dan o'qiladi (email o'zgarsa ham eng yangi manzilga boradi).
 *   - Job data minimal; OTP/parol YO'Q. Faqat 'reset' template'ida `resetUrl`
 *     saqlanadi — bu single-use 30 daqiqalik capability havola (OTP emas),
 *     va job ishlovdan keyin o'chiriladi.
 *
 * Retry (§08): faqat transient error uchun — 3 urinish, backoff 1m/5m/15m.
 *   Provider'ning o'z inline retry'idan keyingi IKINCHI qatlam.
 * Dead-letter (§09): 3 marta fail → status='deadletter' (ops review + alert log).
 * Idempotency (§12): email_idempotency/{key} — bir xil key ikki marta
 *   navbatga qo'shilmaydi (Redis SETNX ekvivalenti, DB store'da).
 * Throttle (§10): har sikl limit (batch) + yuborishlar orasida pauza.
 * Worker down (§24): job'lar DB'da qoladi; stale-processing (lease) recovery.
 */
import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../../src/telemetry/index.js';
import { sendEmail } from './provider.js';
import { logEmailRecord } from './log.js';
import * as templates from './templates.js';

export const EMAIL_QUEUE_PATH = 'email_queue';
export const EMAIL_IDEMPOTENCY_PATH = 'email_idempotency';

/** §08: retry backoff — 1m / 5m / 15m (transient xatolar uchun). */
export const EMAIL_RETRY_BACKOFFS_MS = [60_000, 300_000, 900_000];
export const EMAIL_MAX_ATTEMPTS = 3;
export const EMAIL_QUEUE_BATCH = 10;
export const EMAIL_QUEUE_INTER_MS = 100; // §10: per-provider rate throttle (burst qarshi)
export const EMAIL_LEASE_STALE_MS = 60_000; // processing'da qotib qolgan job'ni qayta olish

/** §07: priority — urgent (reset/verify/security) birinchi. */
export const EMAIL_PRIORITY = { urgent: 0, normal: 1 };

/** Template → render funksiya xaritasi (server-side render, preview'da ehtiyot). */
const RENDERERS = {
  verify: (d) => templates.renderVerify(d),
  reset: (d) => templates.renderReset(d),
  welcome: (d) => templates.renderWelcome(d),
  invite: (d) => templates.renderInvite(d),
  teacher_approved: (d) => templates.renderTeacherApproved(d),
  teacher_rejected: (d) => templates.renderTeacherRejected(d),
  security: (d) => templates.renderSecurity(d),
  breach: (d) => templates.renderBreach(d),
};
export const QUEUE_TEMPLATES = Object.keys(RENDERERS);

/** Audit channel — queue/email uchun. */
const EMAIL_CHANNEL = 'email';

/**
 * Email'ni navbatga qo'shadi.
 *
 * @param {object} opts
 * @param {string} opts.template — QUEUE_TEMPLATES'dan biri
 * @param {object} [opts.data] — template o'zgaruvchilari (minimal; userKey/inviteTokenHash shu yerda)
 * @param {'urgent'|'normal'} [opts.priority]
 * @param {string|null} [opts.idempotencyKey] — bir xil key takroriy enqueue qilinmaydi (§12)
 * @param {string|null} [opts.tag] — email_log tag (default template)
 * @returns {Promise<{ok: boolean, jobId?: string, duplicate?: boolean, error?: string}>}
 */
export async function enqueueEmail({
  template,
  data = {},
  priority = 'normal',
  idempotencyKey = null,
  tag = null,
}) {
  if (!RENDERERS[template]) {
    return { ok: false, error: 'unknown-template' };
  }
  if (!data.userKey && !data.inviteTokenHash) {
    return { ok: false, error: 'no-recipient-ref' }; // PII: email emas, referans kerak
  }

  // §12 Idempotency: bir xil key ikkinchi marta navbatga qo'shilmaydi
  if (idempotencyKey) {
    try {
      const seen = await fb.get(`${EMAIL_IDEMPOTENCY_PATH}/${safeKey(idempotencyKey)}`);
      if (seen.exists()) return { ok: true, duplicate: true };
      await fb.set(`${EMAIL_IDEMPOTENCY_PATH}/${safeKey(idempotencyKey)}`, { at: Date.now() });
    } catch (_) { /* fail-open — idempotency yozilmasa ham navbat ishlaydi */ }
  }

  const jobId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const job = {
    template,
    data, // minimal; plaintext email/OTP/parol YO'Q
    priority: EMAIL_PRIORITY[priority] ?? EMAIL_PRIORITY.normal,
    idempotencyKey: idempotencyKey || null,
    tag: tag || template,
    status: 'queued',
    attempts: 0,
    createdAt: Date.now(),
    nextRetryAt: Date.now(),
  };
  await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}`, job);

  recordMetric('email.queued', 1, { type: 'counter' })?.catch?.(() => {});
  logAuthEvent({
    action: AUDIT_ACTIONS.EMAIL_QUEUED,
    outcome: 'success',
    method: 'queue',
    actorId: data.userKey || null,
    channel: EMAIL_CHANNEL,
    details: { template, priority },
  }).catch(() => {});

  return { ok: true, jobId };
}

/** Recipient manzilini send paytida DB'dan o'qiydi (PII queue'da yo'q). */
async function resolveRecipient(job) {
  if (job.data?.userKey) {
    const snap = await fb.get(`users/${safeKey(job.data.userKey)}/email`).catch(() => null);
    return snap?.exists() ? snap.val() : null;
  }
  if (job.data?.inviteTokenHash) {
    const snap = await fb.get(`invites/${job.data.inviteTokenHash}`).catch(() => null);
    return snap?.exists() ? snap.val()?.email || null : null;
  }
  return null;
}

/**
 * Navbatni to'kadi — server interval'da chaqiriladi (server.js).
 * Qat'iy tartib: priority (urgent→normal) → createdAt.
 *
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {number} [opts.limit] — har sikl maksimum job
 * @param {object} [opts.deps] — { sendEmail, log } (test injeksiyasi)
 * @returns {Promise<{sent: number, retried: number, deadletter: number, failed: number}>}
 */
export async function processEmailQueue({ now = Date.now(), limit = EMAIL_QUEUE_BATCH, deps = {} } = {}) {
  const result = { sent: 0, retried: 0, deadletter: 0, failed: 0 };
  const send = deps.sendEmail || ((msg) => sendEmail(msg));

  let snapshot;
  try {
    snapshot = await fb.get(EMAIL_QUEUE_PATH);
  } catch (_) {
    return result; // fail-open — worker xatosi server'ni buzmaydi
  }
  if (!snapshot || !snapshot.exists()) return result;

  const all = snapshot.val() || {};
  const nowTime = now;

  // Stale processing recovery (§24): 60s dan ortiq 'processing'da qolgan
  // job'lar (worker crash) → qayta navbatga.
  for (const [id, j] of Object.entries(all)) {
    if (j?.status === 'processing' && j?.leasedAt && nowTime - j.leasedAt > EMAIL_LEASE_STALE_MS) {
      await fb.set(`${EMAIL_QUEUE_PATH}/${id}/status`, 'queued').catch(() => {});
      await fb.set(`${EMAIL_QUEUE_PATH}/${id}/nextRetryAt`, nowTime).catch(() => {});
      j.status = 'queued';
      j.nextRetryAt = nowTime;
    }
  }

  const due = Object.entries(all)
    .filter(([, j]) => j && j.status === 'queued' && (j.nextRetryAt || 0) <= nowTime)
    .sort((a, b) => (a[1].priority - b[1].priority) || (a[1].createdAt - b[1].createdAt))
    .slice(0, limit);

  for (const [jobId, job] of due) {
    if (result.sent + result.retried + result.deadletter >= limit) break;

    // Lease — ikki worker bir job'ni olmasin
    await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/status`, 'processing').catch(() => {});
    await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/leasedAt`, nowTime).catch(() => {});

    const email = await resolveRecipient(job);
    if (!email) {
      // Recipient topilmaydi — permanent (retry foyda bermaydi) → DLQ
      await markDeadletter(jobId, job, 'no-recipient');
      result.deadletter++;
      continue;
    }

    try {
      const tpl = RENDERERS[job.template](job.data || {});
      const sentRes = await send({
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        tag: job.tag || job.template,
      });

      if (sentRes?.ok || sentRes?.messageId) {
        await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/status`, 'sent').catch(() => {});
        await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/providerMsgId`, sentRes.messageId || null).catch(() => {});
        // email_log 'sent' — queue o'zi yozadi (transport'dan mustaqil);
        // provider ham yozsa messageId bilan dedupe bo'ladi.
        await logEmailRecord({
          email,
          template: job.template,
          status: 'sent',
          providerMsgId: sentRes.messageId || null,
          id: sentRes.messageId || null,
        }).catch(() => {});
        result.sent++;
        recordMetric('email.sent', 1, { type: 'counter' })?.catch?.(() => {});
        // AUTH D-06 §06: auth_email_delivery_total{status} (bounce alert uchun)
        recordMetric('auth_email_delivery_total', 1, { type: 'counter', labels: { status: 'sent', template: job.template } })?.catch?.(() => {});
        logAuthEvent({
          action: AUDIT_ACTIONS.EMAIL_SENT,
          outcome: 'success',
          method: 'queue',
          actorId: job.data?.userKey || null,
          channel: EMAIL_CHANNEL,
          details: { template: job.template, attempts: job.attempts + 1 },
        }).catch(() => {});
      } else {
        // Transient emas (suppressed/invalid) → retry foyda bermaydi → DLQ
        await markDeadletter(jobId, job, sentRes?.error || 'send-failed');
        result.deadletter++;
      }
    } catch (err) {
      // Transient (timeout/5xx/throttle) → retry backoff (§08)
      const attempts = (job.attempts || 0) + 1;
      if (attempts >= EMAIL_MAX_ATTEMPTS) {
        await markDeadletter(jobId, job, err?.message || 'transient-failed');
        result.deadletter++;
      } else {
        const backoff = EMAIL_RETRY_BACKOFFS_MS[attempts - 1] ?? EMAIL_RETRY_BACKOFFS_MS[0];
        await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/status`, 'queued').catch(() => {});
        await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/attempts`, attempts).catch(() => {});
        await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/nextRetryAt`, nowTime + backoff).catch(() => {});
        await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/lastError`, String(err?.message || err).slice(0, 300)).catch(() => {});
        result.retried++;
        recordMetric('email.retried', 1, { type: 'counter' })?.catch?.(() => {});
        logAuthEvent({
          action: AUDIT_ACTIONS.EMAIL_RETRIED,
          outcome: 'success',
          method: 'queue',
          actorId: job.data?.userKey || null,
          channel: EMAIL_CHANNEL,
          details: { template: job.template, attempts, nextBackoffMs: backoff },
        }).catch(() => {});
      }
    }

    // §10: burst qarshi — yuborishlar orasida kichik pauza
    await new Promise((r) => setTimeout(r, EMAIL_QUEUE_INTER_MS));
  }

  return result;
}

/** 3 marta fail (yoki permanent) → dead-letter (ops review + alert). */
async function markDeadletter(jobId, job, reason) {
  await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/status`, 'deadletter').catch(() => {});
  await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/deadletterAt`, Date.now()).catch(() => {});
  await fb.set(`${EMAIL_QUEUE_PATH}/${jobId}/deadletterReason`, String(reason || 'unknown').slice(0, 300)).catch(() => {});
  console.warn(`[email:queue] DEADLETTER job=${jobId} template=${job.template} reason=${reason || 'unknown'}`);
  recordMetric('email.deadletter', 1, { type: 'counter' })?.catch?.(() => {});
  // AUTH D-06 §06: delivery status 'deadletter' (bounce >5% alert)
  recordMetric('auth_email_delivery_total', 1, { type: 'counter', labels: { status: 'deadletter', template: job.template } })?.catch?.(() => {});
  logAuthEvent({
    action: AUDIT_ACTIONS.EMAIL_DEADLETTER,
    outcome: 'failure',
    method: 'queue',
    actorId: job.data?.userKey || null,
    channel: EMAIL_CHANNEL,
    details: { template: job.template, reason: String(reason || 'unknown').slice(0, 200) },
  }).catch(() => {});
}

/** §23: queue depth gauge (observability). */
export async function queueDepth() {
  try {
    const snap = await fb.get(EMAIL_QUEUE_PATH);
    if (!snap || !snap.exists()) return 0;
    return Object.values(snap.val()).filter((j) => j?.status === 'queued').length;
  } catch (_) {
    return -1;
  }
}

/** Ops/alert uchun DLQ hajmi (§23). */
export async function deadLetterDepth() {
  try {
    const snap = await fb.get(EMAIL_QUEUE_PATH);
    if (!snap || !snap.exists()) return 0;
    return Object.values(snap.val()).filter((j) => j?.status === 'deadletter').length;
  } catch (_) {
    return -1;
  }
}
