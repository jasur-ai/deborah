/**
 * Edikit — Unified Provider Async Adapter (service)
 *
 * Prompt 58 — Gamma generation va Manus task/artifact oqimlarini unified
 * provider job contractga ulash. Graceful degradation: PostgreSQL bo'lmasa
 * write path'lar 'PostgreSQL required' throw qiladi, read path'lar []/null.
 *
 *   - createProviderJob: validate → idempotency (request_hash) → circuit
 *     → provider create (Gamma: generations, Manus: files+project+task)
 *     → persist job + event + audit.
 *   - pollGammaJob: async polling with backoff → completed'da artifacts'
 *     ni map qilib expiring export'ni Edikit object storage'ga copy qiladi.
 *   - cancelProviderJob: Gamma cancel (idempotent).
 *   - handleManusWebhook: signed webhook verify → out-of-order seq handling
 *     → task completed'da artifacts fetch + object storage copy.
 *   - sendManusFollowUp: teacher feedback → task.sendMessage.
 *   - getProviderDashboard / listProviderJobs / getProviderJobEvents.
 *   - ensureProviderConfigs / updateProviderConfig: provider registry
 *     (API key HECH QACHON DB'da saqlanmaydi).
 *
 * SECURITY / DATA GUARD (Prompt 58 §15-17):
 *   - API key faqat client env'da — response'ga chiqmaydi.
 *   - Gamma embedded edit capability yo'q — soxta edit bermaymiz.
 *   - Har bir write path tenant-scoped + idempotent (request_hash).
 *   - Privileged actions (create/cancel/follow-up/artifact-copy) audit.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import storage from '../../infrastructure/storage.js';
import { createHash } from 'crypto';
import {
  gammaCreate,
  gammaPoll,
  gammaCancel,
  manusUploadFile,
  manusCreateProject,
  manusCreateTask,
  manusSendFollowUp,
  downloadArtifact,
  verifyManusWebhook,
  getGammaApiKey,
  getManusApiKey,
  getManusWebhookSecret,
} from './provider.client.js';
import {
  validateProviderRequest,
  requestHash,
  buildGammaCreatePayload,
  buildManusCreateTaskPayload,
  parseGammaStatusResponse,
  computePollDelay,
  evaluateCircuitState,
  validateJobStatusTransition,
  processWebhookOutOfOrder,
  mapManusWebhookEvent,
  mapGammaArtifacts,
  mapManusArtifacts,
  assertNoStudentPii,
  buildAttributionMetadata,
  computeUsageCost,
  JOB_STATUS,
  JOB_EVENTS,
  PROVIDERS,
  PROVIDER_CAPABILITIES,
  GAMMA_DEFAULTS,
  MANUS_DEFAULTS,
  PresentationProvider,
} from './provider.schema.js';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Ensure provider config rows (idempotent). */
export async function ensureProviderConfigs() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const defaults = [
    {
      provider: PROVIDERS.GAMMA,
      model: GAMMA_DEFAULTS.model,
      enabled: Boolean(getGammaApiKey()),
      status: getGammaApiKey() ? 'enabled' : 'not_configured',
      terms_ok: true,
      capabilities: PROVIDER_CAPABILITIES[PROVIDERS.GAMMA],
    },
    {
      provider: PROVIDERS.MANUS,
      model: MANUS_DEFAULTS.model,
      enabled: Boolean(getManusApiKey()),
      status: getManusApiKey() ? 'enabled' : 'not_configured',
      terms_ok: true,
      capabilities: PROVIDER_CAPABILITIES[PROVIDERS.MANUS],
    },
  ];

  let created = 0;
  for (const cfg of defaults) {
    const row = await db
      .insertInto('provider_configs')
      .values({ tenant_id: tenantId, ...cfg, capabilities: JSON.stringify(cfg.capabilities) })
      .onConflict((oc) => oc.columns(['tenant_id', 'provider', 'model']).doNothing())
      .returning(['id'])
      .executeTakeFirst();
    if (row) created++;
  }
  return { ok: true, created };
}

/** Update provider config (non-sensitive fields only). */
export async function updateProviderConfig({ provider = null, patch = {}, actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  if (!Object.values(PROVIDERS).includes(provider)) return { ok: false, error: 'invalid provider' };

  const allowed = ['enabled', 'status', 'quota_limit_daily', 'terms_ok'];
  const clean = {};
  for (const k of allowed) if (typeof patch[k] !== 'undefined') clean[k] = patch[k];

  await db
    .updateTable('provider_configs')
    .set({ ...clean, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('provider', '=', provider)
    .execute();

  await audit(AUDIT_ACTIONS.PROVIDER_CONFIG_UPDATE, {
    actorId,
    tenantId,
    detail: { provider, patch: clean },
  });
  return { ok: true };
}

/** Parse JSON column safely (jsonb string | object). */
function parseJson(v, fallback = {}) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}

/** Append a job event (seq-managed). */
async function appendJobEvent(db, jobId, eventType, payload = {}) {
  const last = await db
    .selectFrom('provider_job_events')
    .select(db.fn.max('seq').as('maxSeq'))
    .where('job_id', '=', jobId)
    .executeTakeFirst();
  const seq = Number(last?.maxSeq || 0) + 1;
  await db
    .insertInto('provider_job_events')
    .values({ job_id: jobId, seq, event_type: eventType, payload: JSON.stringify(payload) })
    .execute();
  return seq;
}

/** Update job status with FSM validation. */
async function transitionJob(db, jobId, to, { error = null } = {}) {
  const job = await db
    .selectFrom('provider_jobs')
    .select(['id', 'status'])
    .where('id', '=', jobId)
    .executeTakeFirst();
  if (!job) return { ok: false, error: 'job not found' };
  if (job.status === to) return { ok: true, duplicate: true };
  const v = validateJobStatusTransition(job.status, to);
  if (!v.ok) return { ok: false, error: v.reason };
  await db
    .updateTable('provider_jobs')
    .set({ status: to, error: error || null, updated_at: new Date() })
    .where('id', '=', jobId)
    .execute();
  return { ok: true };
}

/** Copy an expiring provider artifact to Edikit object storage. */
async function copyArtifactToStorage({ db, tenantId, provider, jobId, artifact, fetchImpl = null }) {
  if (!artifact?.url) return { ok: false, error: 'artifact has no url' };
  const dl = await downloadArtifact({ url: artifact.url, fetchImpl });
  if (!dl.ok) return { ok: false, error: dl.error };
  if (!dl.buffer || dl.buffer.length === 0) return { ok: false, error: 'artifact empty' };

  const ext = artifact.format || 'html';
  const storageKey = `provider/${provider}/${jobId}/${Date.now()}.${ext}`;
  await storage.put(storageKey, dl.buffer, dl.contentType || 'application/octet-stream');

  const sha256 = createHash('sha256').update(dl.buffer).digest('hex');

  await db
    .insertInto('provider_artifacts')
    .values({
      tenant_id: tenantId,
      provider,
      job_id: jobId,
      kind: artifact.kind || 'export',
      format: artifact.format || ext,
      storage_key: storageKey,
      size: dl.size || dl.buffer.length,
      sha256,
      expiring: Boolean(artifact.expiring),
      source_url: artifact.url,
      copied_at: new Date(),
    })
    // provider_artifacts jadvalida updated_at kolonkasi yo'q — copied_at ishlatiladi
    .onConflict((oc) => oc.columns(['provider', 'job_id', 'kind']).doUpdateSet({
      storage_key: storageKey,
      size: dl.size || dl.buffer.length,
      sha256,
      copied_at: new Date(),
      source_url: artifact.url,
    }))
    .execute();

  return { ok: true, storageKey, size: dl.size || dl.buffer.length, sha256, kind: artifact.kind };
}

/** Record dead-letter on terminal failure. */
async function recordDeadLetter({ db, tenantId, provider, jobId, attempt = 1, error = '', payload = {} }) {
  await db
    .insertInto('provider_dead_letters')
    .values({ tenant_id: tenantId, provider, job_id: jobId, attempt, error: String(error).slice(0, 1000), payload: JSON.stringify(payload) })
    .execute();
}

// ═══════════════════════════════════════════════════════════════════
// CREATE — unified provider job entry point
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a provider job (Gamma: generation | Manus: file+project+task).
 * Idempotent: bir xil request → cached job qaytaradi.
 *
 * @param {Object} params - { provider, title, audience, language, theme,
 *   tone, numCards, sourcePackIds, brief, projectId, fileIds, files, actorId }
 */
export async function createProviderJob({
  provider = null,
  title = '',
  audience = null,
  language = 'uz',
  theme = 'default',
  tone = 'formal',
  numCards = 10,
  sourcePackIds = [],
  brief = null,
  projectId = null,
  fileIds = [],
  files = [],
  actorId = null,
  fetchImpl = null,
} = {}) {
  const v = validateProviderRequest({ provider, title, audience, language, theme, tone, numCards, sourcePackIds, brief });
  if (!v.ok) return { ok: false, error: v.reason };

  // PII guard — brief'da student PII bo'lmasin
  if (brief) {
    const pii = assertNoStudentPii(brief);
    if (!pii.ok) return { ok: false, error: pii.reason || 'PII detected in brief' };
    brief = pii.redacted;
  }

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const hashInput = { provider, title, audience, language, theme, tone, numCards, sourcePackIds, brief, projectId, fileIds };
  const hash = requestHash(hashInput);

  // Idempotency — mavjud job qaytariladi
  const existing = await db
    .selectFrom('provider_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('request_hash', '=', hash)
    .executeTakeFirst();
  if (existing) return { ok: true, jobId: existing.id, cached: true, status: existing.status };

  // Circuit check per provider
  const breaker = await db
    .selectFrom('provider_circuit_breakers')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('provider', '=', provider)
    .where('model', '=', provider === PROVIDERS.GAMMA ? GAMMA_DEFAULTS.model : MANUS_DEFAULTS.model)
    .executeTakeFirst();
  if (breaker && evaluateCircuitState({ failureCount: breaker.failure_count, openUntil: breaker.open_until }) === 'open') {
    return { ok: false, error: `provider ${provider} circuit open — retry later`, circuit: 'open' };
  }

  const model = provider === PROVIDERS.GAMMA ? GAMMA_DEFAULTS.model : MANUS_DEFAULTS.model;

  // ── Provider call ──
  let providerJobId = null;
  let providerProjectId = projectId || null;
  let createError = null;

  if (provider === PROVIDERS.GAMMA) {
    const payload = buildGammaCreatePayload({ title, audience, language, theme, tone, numCards, sourcePackIds });
    const r = await gammaCreate({ payload, fetchImpl });
    if (!r.ok) createError = r.error;
    else providerJobId = r.providerJobId;
  } else if (provider === PROVIDERS.MANUS) {
    // Step 1: upload files
    let uploadedFileIds = [...(fileIds || [])];
    for (const f of files || []) {
      const up = await manusUploadFile({ name: f.name || 'source.md', content: f.content, fetchImpl });
      if (!up.ok) { createError = up.error; break; }
      uploadedFileIds.push(up.fileId);
    }
    if (!createError) {
      // Step 2: project per course/teacher
      if (!providerProjectId) {
        const proj = await manusCreateProject({ name: title ? `${title} — course` : 'Edikit', fetchImpl });
        if (!proj.ok) createError = proj.error;
        else providerProjectId = proj.projectId;
      }
    }
    if (!createError) {
      // Step 3: task.create
      const payload = buildManusCreateTaskPayload({ title, projectId: providerProjectId, fileIds: uploadedFileIds, brief, language });
      const t = await manusCreateTask({ payload, fetchImpl });
      if (!t.ok) createError = t.error;
      else providerJobId = t.providerJobId;
    }
  } else {
    createError = 'invalid provider';
  }

  if (createError) {
    // Circuit record — eb('+') expression real Kysely va fake DB'da bir xil ishlaydi
    await db
      .insertInto('provider_circuit_breakers')
      .values({ tenant_id: tenantId, provider, model, failure_count: 1, last_error: String(createError).slice(0, 500) })
      .onConflict((oc) => oc.columns(['tenant_id', 'provider', 'model']).doUpdateSet((eb) => ({
        failure_count: eb('failure_count', '+', 1),
        last_error: String(createError).slice(0, 500),
        updated_at: new Date(),
      })))
      .execute();
    return { ok: false, error: createError, provider };
  }

  // ── Persist job ──
  const finalStatus = provider === PROVIDERS.MANUS ? JOB_STATUS.WEBHOOK_PENDING : JOB_STATUS.RUNNING;
  const row = await db
    .insertInto('provider_jobs')
    .values({
      tenant_id: tenantId,
      request_hash: hash,
      provider,
      kind: 'presentation',
      title,
      brief: JSON.stringify({ audience, language, theme, tone, numCards, sourcePackIds, projectId: providerProjectId, fileIds: fileIds || [] }),
      provider_job_id: providerJobId,
      provider_project_id: providerProjectId || null,
      status: finalStatus,
      attribution: JSON.stringify([buildAttributionMetadata({ provider, model, jobId: providerJobId })]),
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await appendJobEvent(db, row.id, JOB_EVENTS.JOB_CREATED, { provider, providerJobId, model, title });

  // Gamma: sync poll loop with backoff (done in pollGammaJob — here we
  // return immediately; the client triggers polling). Manus: awaits webhook.

  await audit(AUDIT_ACTIONS.PROVIDER_JOB_CREATE, {
    actorId,
    tenantId,
    detail: { provider, providerJobId, jobId: row.id, title, model },
  });

  return { ok: true, jobId: row.id, cached: false, status: finalStatus, providerJobId, providerProjectId, provider, model };
}

// ═══════════════════════════════════════════════════════════════════
// GAMMA — POLL (async polling with backoff)
// ═══════════════════════════════════════════════════════════════════

/**
 * Poll a Gamma generation until completion (with backoff).
 * Completed → artifacts map + expiring export copy to object storage.
 *
 * @param {Object} params - { jobId, maxAttempts, fetchImpl, persistOnly }
 */
export async function pollGammaJob({ jobId = null, maxAttempts = 60, fetchImpl = null, persistOnly = false } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const job = await db
    .selectFrom('provider_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', jobId)
    .executeTakeFirst();
  if (!job) return { ok: false, error: 'job not found' };
  if (job.provider !== PROVIDERS.GAMMA) return { ok: false, error: 'not a gamma job' };
  if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.CANCELLED) {
    return { ok: true, status: job.status, cached: true, jobId: job.id };
  }

  let status = job.status;
  let lastRaw = null;
  let attempt = 0;

  while (attempt < maxAttempts && status !== JOB_STATUS.COMPLETED && status !== JOB_STATUS.FAILED && status !== JOB_STATUS.CANCELLED) {
    const delay = computePollDelay(attempt);
    await new Promise((r) => setTimeout(r, persistOnly ? 0 : delay));
    const r = await gammaPoll({ providerJobId: job.provider_job_id, fetchImpl });
    if (!r.ok) {
      await appendJobEvent(db, job.id, JOB_EVENTS.JOB_POLLING, { attempt, error: r.error });
      attempt++;
      if (attempt >= maxAttempts) {
        await recordDeadLetter({ db, tenantId, provider: 'gamma', jobId: job.id, attempt, error: r.error });
        await transitionJob(db, job.id, JOB_STATUS.FAILED, { error: r.error });
        await audit(AUDIT_ACTIONS.PROVIDER_JOB_FAILED, { tenantId, detail: { provider: 'gamma', jobId: job.id, error: r.error } });
        return { ok: false, error: r.error, deadLetter: true };
      }
      continue;
    }
    lastRaw = r.raw || {};
    const parsed = parseGammaStatusResponse(lastRaw);
    status = parsed.status;
    await appendJobEvent(db, job.id, JOB_EVENTS.JOB_POLLING, { attempt, rawStatus: parsed.rawStatus, status });
    attempt++;
  }

  if (status === JOB_STATUS.COMPLETED) {
    await transitionJob(db, job.id, JOB_STATUS.COMPLETED);

    // Artifact mapping — expiring preview/export → object storage copy
    const artifacts = mapGammaArtifacts({
      previewUrl: parsedPreview(lastRaw),
      exportUrl: parsedExport(lastRaw),
    });
    const copied = [];
    for (const art of artifacts) {
      const c = await copyArtifactToStorage({ db, tenantId, provider: 'gamma', jobId: job.id, artifact: art, fetchImpl });
      if (c.ok) copied.push({ kind: art.kind, storageKey: c.storageKey, size: c.size });
      await appendJobEvent(db, job.id, JOB_EVENTS.ARTIFACT_COPIED, { kind: art.kind, ok: c.ok, error: c.error || null });
    }

    // Save export/preview URLs + artifact key on job
    const firstExport = copied[0];
    await db
      .updateTable('provider_jobs')
      .set({
        preview_url: parsedPreview(lastRaw) || null,
        export_url: parsedExport(lastRaw) || null,
        artifact_key: firstExport?.storageKey || null,
        artifact_meta: JSON.stringify({ copied, formats: lastRaw?.exportFormats || [], sourceUrl: parsedExport(lastRaw) || null }),
        usage: JSON.stringify({ credits: computeUsageCost({ provider: 'gamma', credits: lastRaw?.credits || 0 }) }),
        updated_at: new Date(),
      })
      .where('id', '=', job.id)
      .execute();

    await appendJobEvent(db, job.id, JOB_EVENTS.JOB_COMPLETED, { copied: copied.length });
    await audit(AUDIT_ACTIONS.PROVIDER_ARTIFACT_COPY, {
      tenantId,
      detail: { provider: 'gamma', jobId: job.id, copied: copied.length, storageKeys: copied.map((c) => c.storageKey) },
    });
    return { ok: true, status: JOB_STATUS.COMPLETED, jobId: job.id, artifacts: copied };
  }

  if (status === JOB_STATUS.FAILED) {
    const msg = lastRaw?.error || 'gamma generation failed';
    await recordDeadLetter({ db, tenantId, provider: 'gamma', jobId: job.id, attempt, error: msg, payload: { raw: lastRaw } });
    await transitionJob(db, job.id, JOB_STATUS.FAILED, { error: msg });
    await audit(AUDIT_ACTIONS.PROVIDER_JOB_FAILED, { tenantId, detail: { provider: 'gamma', jobId: job.id, error: msg } });
    return { ok: false, error: msg, deadLetter: true };
  }

  return { ok: true, status, jobId: job.id, pending: true };
}

function parsedPreview(raw) {
  return raw?.gammaUrl || raw?.previewUrl || raw?.url || null;
}
function parsedExport(raw) {
  return raw?.exportUrl || raw?.downloadUrl || null;
}

// ═══════════════════════════════════════════════════════════════════
// CANCEL (Gamma — idempotent)
// ═══════════════════════════════════════════════════════════════════

/** Cancel a Gamma job (idempotent). */
export async function cancelProviderJob({ jobId = null, actorId = null, fetchImpl = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const job = await db
    .selectFrom('provider_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', jobId)
    .executeTakeFirst();
  if (!job) return { ok: false, error: 'job not found' };
  if (job.status === JOB_STATUS.CANCELLED) return { ok: true, cached: true, status: JOB_STATUS.CANCELLED };
  if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED) {
    return { ok: false, error: `cannot cancel ${job.status} job` };
  }

  if (job.provider === PROVIDERS.GAMMA && job.provider_job_id) {
    const r = await gammaCancel({ providerJobId: job.provider_job_id, fetchImpl });
    if (!r.ok) return { ok: false, error: r.error };
  }
  // Manus: cancel qo'llab-quvvatlanmaydi (capability false) — follow-up orqali

  await transitionJob(db, job.id, JOB_STATUS.CANCELLED);
  await appendJobEvent(db, job.id, JOB_EVENTS.JOB_CANCELLED, { by: actorId });
  await audit(AUDIT_ACTIONS.PROVIDER_JOB_CANCEL, { actorId, tenantId, detail: { provider: job.provider, jobId: job.id } });
  return { ok: true, status: JOB_STATUS.CANCELLED };
}

// ═══════════════════════════════════════════════════════════════════
// MANUS — SIGNED WEBHOOK + FOLLOW-UP
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a Manus signed webhook.
 *   - Signature verify (HMAC-SHA256, timing-safe).
 *   - Out-of-order seq handling (buffer/dedupe) — replay/out-of-order testi.
 *   - task completed → artifacts fetch + object storage copy.
 *
 * @param {Object} params - { signature, body (raw string), bodyObj, fetchImpl }
 */
export async function handleManusWebhook({ signature = null, body = '', bodyObj = null, fetchImpl = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };

  // 1. Signature verify (secret mock'lar uchun parametr orqali injeksiya qilinadi)
  const ver = verifyManusWebhook({ signature, body, secret: getManusWebhookSecret() });
  if (!ver.ok) return { ok: false, error: ver.reason, rejected: true };

  // 2. Parse payload
  let ev = bodyObj;
  if (!ev) {
    try { ev = JSON.parse(body); } catch (_) { return { ok: false, error: 'invalid webhook JSON', rejected: true }; }
  }

  const taskId = String(ev?.taskId || ev?.task?.id || ev?.data?.taskId || '');
  const seq = Number(ev?.seq || ev?.eventSeq || 0);
  if (!taskId) return { ok: false, error: 'webhook missing taskId', rejected: true };

  const job = await db
    .selectFrom('provider_jobs')
    .selectAll()
    .where('provider', '=', PROVIDERS.MANUS)
    .where('provider_job_id', '=', taskId)
    .executeTakeFirst();
  if (!job) {
    // Unknown task — reject silently (no data leak)
    return { ok: false, error: 'unknown task', rejected: true };
  }
  const tenantId = job.tenant_id;

  // 3. Out-of-order seq handling (artifact_meta jsonb — string|object parse)
  const meta = parseJson(job.artifact_meta);
  const lastSeq = Number(meta.webhookLastSeq || 0);
  const ordered = processWebhookOutOfOrder({ seq, lastSeen: lastSeq });
  if (!ordered.ok) return { ok: false, error: ordered.reason };

  await appendJobEvent(db, job.id, JOB_EVENTS.WEBHOOK_RECEIVED, { seq, taskId, duplicate: ordered.duplicate || false, buffered: ordered.buffered || false });
  if (ordered.duplicate) {
    return { ok: true, duplicate: true, status: job.status, jobId: job.id };
  }
  if (ordered.buffered) {
    // Out-of-order — buffer, keyingi event gap'ni to'ldirsa davom etadi
    await db.updateTable('provider_jobs').set({
      artifact_meta: JSON.stringify({ ...meta, webhookLastSeq: lastSeq, webhookBuffer: { seq } }),
      updated_at: new Date(),
    }).where('id', '=', job.id).execute();
    await audit(AUDIT_ACTIONS.PROVIDER_WEBHOOK_RECEIVED, { tenantId, detail: { provider: 'manus', jobId: job.id, seq, buffered: true } });
    return { ok: true, buffered: true, status: job.status, jobId: job.id };
  }

  // 4. Advance seq + update status
  await db.updateTable('provider_jobs').set({
    artifact_meta: JSON.stringify({ ...meta, webhookLastSeq: seq }),
    updated_at: new Date(),
  }).where('id', '=', job.id).execute();

  const mapped = mapManusWebhookEvent(ev);
  await appendJobEvent(db, job.id, JOB_EVENTS.WEBHOOK_VERIFIED, { seq, eventType: mapped.type });

  if (mapped.type === JOB_EVENTS.JOB_COMPLETED) {
    await transitionJob(db, job.id, JOB_STATUS.COMPLETED);
    // Artifact fetch + copy
    const artifacts = mapManusArtifacts({ viewerUrl: ev?.viewerUrl || ev?.artifactUrl || null, artifacts: ev?.artifacts || [] });
    const copied = [];
    for (const art of artifacts) {
      const c = await copyArtifactToStorage({ db, tenantId, provider: 'manus', jobId: job.id, artifact: art, fetchImpl });
      if (c.ok) copied.push({ kind: art.kind, storageKey: c.storageKey, size: c.size });
      await appendJobEvent(db, job.id, JOB_EVENTS.ARTIFACT_COPIED, { kind: art.kind, ok: c.ok, error: c.error || null });
    }
    const first = copied[0];
    await db.updateTable('provider_jobs').set({
      preview_url: ev?.viewerUrl || null,
      artifact_key: first?.storageKey || null,
      artifact_meta: JSON.stringify({ ...meta, webhookLastSeq: seq, copied }),
      updated_at: new Date(),
    }).where('id', '=', job.id).execute();
    await appendJobEvent(db, job.id, JOB_EVENTS.JOB_COMPLETED, { copied: copied.length });
    await audit(AUDIT_ACTIONS.PROVIDER_ARTIFACT_COPY, {
      tenantId,
      detail: { provider: 'manus', jobId: job.id, copied: copied.length, storageKeys: copied.map((c) => c.storageKey) },
    });
    return { ok: true, status: JOB_STATUS.COMPLETED, jobId: job.id, copied: copied.length };
  }

  if (mapped.type === JOB_EVENTS.JOB_FAILED) {
    const msg = ev?.error || 'manus task failed';
    await recordDeadLetter({ db, tenantId, provider: 'manus', jobId: job.id, attempt: 1, error: msg, payload: { ev } });
    await transitionJob(db, job.id, JOB_STATUS.FAILED, { error: msg });
    await appendJobEvent(db, job.id, JOB_EVENTS.JOB_FAILED, { error: msg });
    await audit(AUDIT_ACTIONS.PROVIDER_JOB_FAILED, { tenantId, detail: { provider: 'manus', jobId: job.id, error: msg } });
    return { ok: false, error: msg, deadLetter: true };
  }

  // Progress event — job stays in webhook_pending
  return { ok: true, status: job.status, jobId: job.id, event: mapped.type };
}

/** Send teacher follow-up to a Manus task (research §9.6 step 8). */
export async function sendManusFollowUp({ jobId = null, message = '', actorId = null, fetchImpl = null } = {}) {
  if (!message || String(message).trim().length < 3) return { ok: false, error: 'message is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const job = await db
    .selectFrom('provider_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', jobId)
    .executeTakeFirst();
  if (!job) return { ok: false, error: 'job not found' };
  if (job.provider !== PROVIDERS.MANUS || !job.provider_job_id) return { ok: false, error: 'not a manus task job' };

  const pii = assertNoStudentPii(message);
  if (!pii.ok) return { ok: false, error: pii.reason || 'PII detected in message' };

  const r = await manusSendFollowUp({ providerJobId: job.provider_job_id, message: pii.redacted, fetchImpl });
  if (!r.ok) return { ok: false, error: r.error };

  await appendJobEvent(db, job.id, JOB_EVENTS.FOLLOW_UP_SENT, { by: actorId, messageLen: message.length });
  await audit(AUDIT_ACTIONS.PROVIDER_FOLLOW_UP, { actorId, tenantId, detail: { provider: 'manus', jobId: job.id, messageLen: message.length } });
  return { ok: true, jobId: job.id };
}

// ═══════════════════════════════════════════════════════════════════
// READ + DASHBOARD
// ═══════════════════════════════════════════════════════════════════

/** List provider jobs (tenant-scoped, optional status/provider filter). */
export async function listProviderJobs({ status = null, provider = null, limit = 50 } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db.selectFrom('provider_jobs').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  if (provider) q = q.where('provider', '=', provider);
  return q.orderBy('created_at', 'desc').limit(limit).execute();
}

/** Get a provider job (tenant-scoped). */
export async function getProviderJob(jobId) {
  const db = getDb();
  if (!db) return null;
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return null;
  return db
    .selectFrom('provider_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', jobId)
    .executeTakeFirst();
}

/** Get job events (tenant-scoped). */
export async function getProviderJobEvents(jobId) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  const job = await getProviderJob(jobId);
  if (!job) return [];
  return db
    .selectFrom('provider_job_events')
    .selectAll()
    .where('job_id', '=', job.id)
    .orderBy('seq', 'asc')
    .execute();
}

/** Get artifacts (tenant-scoped). */
export async function getProviderArtifacts(jobId) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  const job = await getProviderJob(jobId);
  if (!job) return [];
  return db
    .selectFrom('provider_artifacts')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('job_id', '=', job.id)
    .orderBy('created_at', 'desc')
    .execute();
}

/** Dashboard — configs, jobs, dead letters, circuit state. */
export async function getProviderDashboard() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required', configs: [], jobs: [], deadLetters: [], breakers: [] };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required', configs: [], jobs: [], deadLetters: [], breakers: [] };

  const [configs, jobs, deadLetters, breakers] = await Promise.all([
    db.selectFrom('provider_configs').selectAll().where('tenant_id', '=', tenantId).orderBy('provider').execute(),
    db.selectFrom('provider_jobs').selectAll().where('tenant_id', '=', tenantId).orderBy('created_at', 'desc').limit(50).execute(),
    db.selectFrom('provider_dead_letters').selectAll().where('tenant_id', '=', tenantId).orderBy('created_at', 'desc').limit(20).execute(),
    db.selectFrom('provider_circuit_breakers').selectAll().where('tenant_id', '=', tenantId).orderBy('provider').execute(),
  ]);

  return {
    ok: true,
    configs,
    jobs,
    deadLetters,
    breakers,
    capabilities: PROVIDER_CAPABILITIES,
    storage: storage.getInfo(),
  };
}

// Meta for admin UI
export const PROVIDER_META = {
  providers: PROVIDERS,
  jobStatus: JOB_STATUS,
  jobEvents: JOB_EVENTS,
  capabilities: PROVIDER_CAPABILITIES,
  gammaDefaults: { model: GAMMA_DEFAULTS.model, pollBaseMs: GAMMA_DEFAULTS.pollBaseMs, numCardsMax: GAMMA_DEFAULTS.numCardsMax },
  manusDefaults: { model: MANUS_DEFAULTS.model, taskTimeoutMin: MANUS_DEFAULTS.taskTimeoutMin },
  interfaceValid: PresentationProvider.validate({ name: 'gamma', capabilities: PROVIDER_CAPABILITIES.gamma, create: () => {}, poll: () => {}, cancel: () => {}, webhook: () => {}, mapArtifacts: () => {} }).ok,
};
