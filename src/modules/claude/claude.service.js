/**
 * Deborah — Claude Native Adapter (service)
 *
 * Prompt 57 — streaming source-synthesis job orchestration. Graceful
 * degradation: PostgreSQL bo'lmasa write path'lar 'PostgreSQL required'
 * throw qiladi, read path'lar []/null. API key yo'q bo'lsa provider
 * "not configured" — stop condition: provider key bo'lmasa ishlamaydi.
 *
 *   - synthesizeDeck: validate → idempotency (request_hash) → circuit
 *     → build messages (PII guard) → client call (stream) → strict
 *     canonical JSON validation → citation mapping → persist job +
 *     usage + audit.
 *   - getJob / listJobs / getJobEvents: streaming SSE job progress.
 *   - ensureClaudeProvider / updateClaudeProvider: provider registry.
 *   - getClaudeDashboard: jobs, usage totals, circuit state.
 *
 * SECURITY / DATA GUARD (Prompt 57 §15):
 *   - API key faqat server'da — client getApiKey(), hech qachon
 *     response'ga chiqmaydi.
 *   - Student PII assertNoStudentPii orqali redact qilinadi.
 *   - Provider raw response canonical modeldan tashqariga chiqmaydi.
 *   - Har bir write path tenant-scoped + idempotent (request_hash).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { getApiKey, createMessage, streamMessage } from './claude.client.js';
import {
  validateSynthesisRequest,
  requestHash,
  buildClaudeMessages,
  mapFileToClaudeBlock,
  extractCanonicalJson,
  mapCitations,
  evaluateCircuitState,
  computeUsageCost,
  assertNoStudentPii,
  buildAttributionMetadata,
  validateJobStatusTransition,
  CLAUDE_MODELS,
  CLAUDE_DEFAULTS,
  JOB_STATUS,
  JOB_EVENTS,
  SSE_EVENTS,
} from './claude.schema.js';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Default provider config (idempotent ensure). */
function defaultProviderConfig(model = CLAUDE_DEFAULTS.model) {
  return {
    provider: 'claude',
    model,
    enabled: Boolean(getApiKey()),
    status: getApiKey() ? 'enabled' : 'not_configured',
    quota_limit_daily: 100,
    max_tokens: CLAUDE_DEFAULTS.maxTokens,
    temperature: CLAUDE_DEFAULTS.temperature,
    terms_ok: true, // Anthropic API data default training uchun ishlatilmaydi (researched)
  };
}

/** Load source packs for citation mapping. */
async function loadSourcePacks(db, tenantId, sourceIds) {
  const rows = await db
    .selectFrom('source_packs')
    .select(['id', 'title', 'url'])
    .where('tenant_id', '=', tenantId)
    .where('id', 'in', sourceIds)
    .execute();
  return rows;
}

/** Build source text fragments for the prompt (with PII guard). */
function buildSourcesText(sourcePacks) {
  const parts = [];
  for (const p of sourcePacks || []) {
    parts.push(`[${p.id}] ${p.title || 'unnamed'}${p.url ? ` (${p.url})` : ''}`);
  }
  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// PROVIDER REGISTRY
// ═══════════════════════════════════════════════════════════════════

/** Ensure provider config rows exist (idempotent). */
export async function ensureClaudeProviders() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const created = [];
  for (const model of CLAUDE_MODELS) {
    const cfg = defaultProviderConfig(model);
    const row = await db
      .insertInto('claude_provider_configs')
      .values({
        tenant_id: tenantId,
        provider: cfg.provider,
        model: cfg.model,
        enabled: cfg.enabled,
        status: cfg.status,
        quota_limit_daily: cfg.quota_limit_daily,
        max_tokens: cfg.max_tokens,
        temperature: cfg.temperature,
        terms_ok: cfg.terms_ok,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'provider', 'model']).doNothing())
      .returning(['id', 'model'])
      .executeTakeFirst();
    if (row) created.push(row);
  }
  return { ok: true, created };
}

/** Update provider config (admin). */
export async function updateClaudeProvider({ model = '', patch = {}, actorId = null } = {}) {
  // validate-before-getDb
  if (!CLAUDE_MODELS.includes(model)) {
    return { ok: false, error: `unsupported model ${model} — allowed: ${CLAUDE_MODELS.join('|')}` };
  }
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const allowed = ['enabled', 'status', 'quota_limit_daily', 'max_tokens', 'temperature', 'terms_ok'];
  const set = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (Object.keys(set).length === 0) return { ok: false, error: 'no fields to update' };
  set.updated_at = new Date();

  await db
    .updateTable('claude_provider_configs')
    .set(set)
    .where('tenant_id', '=', tenantId)
    .where('provider', '=', 'claude')
    .where('model', '=', model)
    .execute();

  await audit(AUDIT_ACTIONS.CLAUDE_PROVIDER_UPDATE, {
    actorId,
    tenantId,
    detail: { model, patch: Object.keys(set) },
  });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// SYNTHESIS JOB (§57-10/11/12/13)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run a Claude source-synthesis job (streaming SSE progress).
 * validate → idempotency → circuit → messages (PII guard) → client →
 * strict canonical validation → citation mapping → persist + audit.
 *
 * @param {Object} params - { title, audience, language, theme, slideCount, tone, sources, files, model, maxTokens, actorId, useStream }
 * @returns {Promise<{ ok: boolean, jobId?: number, document?: Object, cached?: boolean, error?: string, usage?: Object }>}
 */
export async function synthesizeDeck({
  title = '',
  audience = '',
  language = 'uz',
  theme = 'default',
  slideCount = 10,
  tone = 'formal',
  sources = [],
  files = [],
  model = CLAUDE_DEFAULTS.model,
  maxTokens = null,
  actorId = null,
  useStream = true,
} = {}) {
  const v = validateSynthesisRequest({ title, audience, language, theme, slideCount, tone, sources, maxTokens });
  if (!v.ok) return { ok: false, error: v.reason };
  const norm = v.normalized;

  // Files validate-before-getDb (mapFileToClaudeBlock)
  for (const f of Array.isArray(files) ? files : []) {
    const m = mapFileToClaudeBlock(f);
    if (!m.ok) return { ok: false, error: `file ${f?.name || '?'}: ${m.reason}` };
  }

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const hash = requestHash({ title, audience, language, theme, slideCount, tone, sources });
  // Idempotency: same request → return completed job's document
  const existing = await db
    .selectFrom('claude_synthesis_jobs')
    .select(['id', 'status', 'canonical_document', 'usage'])
    .where('tenant_id', '=', tenantId)
    .where('request_hash', '=', hash)
    .executeTakeFirst();
  if (existing && existing.status === JOB_STATUS.COMPLETED && existing.canonical_document) {
    return { ok: true, jobId: existing.id, cached: true, document: existing.canonical_document, usage: existing.usage || null };
  }

  // Circuit check — provider mashaqqatli bo'lsa darhol rad et (open)
  const circuit = await db
    .selectFrom('claude_circuit_breakers')
    .select(['failure_count', 'open_until', 'last_error'])
    .where('tenant_id', '=', tenantId)
    .where('provider', '=', 'claude')
    .where('model', '=', model)
    .executeTakeFirst();
  const circ = evaluateCircuitState({ failureCount: circuit?.failure_count || 0, openUntil: circuit?.open_until || null });
  if (circ.state === 'open') {
    return { ok: false, error: `provider circuit open — retry in ${Math.ceil((circ.remainingMs || 0) / 1000)}s` };
  }

  // Provider temperature — claude_provider_configs'dan o'qiladi (default 0.3)
  const providerCfg = await db
    .selectFrom('claude_provider_configs')
    .select(['temperature', 'max_tokens', 'quota_limit_daily'])
    .where('tenant_id', '=', tenantId)
    .where('provider', '=', 'claude')
    .where('model', '=', model)
    .executeTakeFirst();
  const temperature = Number(providerCfg?.temperature ?? CLAUDE_DEFAULTS.temperature);
  // User maxTokens ko'rsatgan bo'lsa u ustun; aks holda provider config (fallback default)
  const effectiveMaxTokens =
    maxTokens != null && Number(maxTokens) > 0
      ? norm.maxTokens
      : Number(providerCfg?.max_tokens ?? norm.maxTokens);

  // Load source packs for citation mapping (real DB tekshiruvi §22.11)
  const sourcePacks = await loadSourcePacks(db, tenantId, norm.sources);
  if (sourcePacks.length === 0) return { ok: false, error: 'none of the requested sources found' };
  const sourcesText = buildSourcesText(sourcePacks);

  // PII guard — student PII default yuborilmaydi (§15)
  const pii = assertNoStudentPii({ text: `${title} ${audience} ${sourcesText}` });

  // Build messages
  const built = buildClaudeMessages({
    title,
    audience,
    language,
    theme,
    slideCount,
    tone,
    sourcesText: pii.redacted,
    files,
  });
  if (!built.ok) return { ok: false, error: built.reason };

  // Persist job (queued)
  let job;
  try {
    const row = await db
      .insertInto('claude_synthesis_jobs')
      .values({
        tenant_id: tenantId,
        request_hash: hash,
        title,
        audience: audience || null,
        language,
        theme,
        slide_count: slideCount,
        tone,
        source_pack_ids: JSON.stringify(norm.sources),
        model,
        prompt_ref: built.promptRef,
        status: JOB_STATUS.QUEUED,
        created_by: actorId,
      })
      .returning(['id'])
      .executeTakeFirst();
    job = { id: row.id };
  } catch (e) {
    // Concurrent duplicate → fetch existing
    const dup = await db
      .selectFrom('claude_synthesis_jobs')
      .select(['id', 'status', 'canonical_document', 'usage'])
      .where('tenant_id', '=', tenantId)
      .where('request_hash', '=', hash)
      .executeTakeFirst();
    if (dup && dup.status === JOB_STATUS.COMPLETED && dup.canonical_document) {
      return { ok: true, jobId: dup.id, cached: true, document: dup.canonical_document, usage: dup.usage || null };
    }
    return { ok: false, error: String(e?.message || e) };
  }

  // Job FSM: queued → running (validateJobStatusTransition)
  const t1 = validateJobStatusTransition(JOB_STATUS.QUEUED, JOB_STATUS.RUNNING);
  if (!t1.ok) return { ok: false, error: t1.reason };
  await appendJobEvent(db, job.id, JOB_EVENTS.JOB_QUEUED, {});
  await db
    .updateTable('claude_synthesis_jobs')
    .set({ status: JOB_STATUS.RUNNING, updated_at: new Date() })
    .where('id', '=', job.id)
    .execute();
  await appendJobEvent(db, job.id, JOB_EVENTS.JOB_RUNNING, {});

  // Provider call (stream or non-stream)
  const onEvent = (ev) => {
    if (ev.event === SSE_EVENTS.CONTENT_BLOCK_DELTA || ev.event === SSE_EVENTS.CONTENT_BLOCK_START) {
      appendJobEvent(db, job.id, ev.event, ev.data || {}).catch(() => {});
    }
  };
  const callParams = {
    model,
    system: built.system,
    messages: built.messages,
    maxTokens: effectiveMaxTokens,
    temperature,
    apiKey: getApiKey(),
    onEvent,
  };
  const res = useStream ? await streamMessage(callParams) : await createMessage(callParams);

  if (!res.ok) {
    await recordFailure(db, tenantId, job.id, model, res.error, actorId);
    return { ok: false, jobId: job.id, error: res.error, usage: res.usage || null };
  }

  // Strict canonical JSON validation (done condition §57-25)
  const extracted = extractCanonicalJson(res.text);
  if (!extracted.ok) {
    await recordFailure(db, tenantId, job.id, model, extracted.reason, actorId);
    return { ok: false, jobId: job.id, error: extracted.reason };
  }

  // Citation mapping — AI references real DB'dan tekshiriladi (§22.11)
  const cited = mapCitations({ document: extracted.document, sourcePacks });

  // Usage + cost accounting
  const usage = res.usage || {};
  const cost = computeUsageCost({
    model,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
  });

  const attribution = buildAttributionMetadata({
    model,
    promptRef: built.promptRef,
    usage: { ...usage, cost: cost.ok ? cost.cost : 0 },
    attributions: cited.attributions,
  });

  // Job FSM: running → completed (validateJobStatusTransition)
  const t2 = validateJobStatusTransition(JOB_STATUS.RUNNING, JOB_STATUS.COMPLETED);
  if (!t2.ok) return { ok: false, error: t2.reason };

  // Persist completed job + canonical document (immutable artifact)
  await db
    .updateTable('claude_synthesis_jobs')
    .set({
      status: JOB_STATUS.COMPLETED,
      canonical_document: JSON.stringify(extracted.document),
      attribution: JSON.stringify(cited.attributions),
      usage: JSON.stringify({ ...usage, cost: cost.ok ? cost.cost : 0 }),
      updated_at: new Date(),
    })
    .where('id', '=', job.id)
    .execute();

  // Circuit reset on success — half_open/closed state'ga qaytadi (bug fix)
  await db
    .insertInto('claude_circuit_breakers')
    .values({
      tenant_id: tenantId,
      provider: 'claude',
      model,
      failure_count: 0,
      open_until: null,
      last_error: null,
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'provider', 'model'])
        .doUpdateSet({ failure_count: 0, open_until: null, last_error: null, updated_at: new Date() })
    )
    .execute();

  // Persist attributions (citation mapping)
  for (const a of cited.attributions) {
    await db
      .insertInto('claude_attributions')
      .values({
        tenant_id: tenantId,
        job_id: job.id,
        slide_id: a.slideId,
        citation_key: a.citationKey,
        source_pack_id: a.sourcePackId,
        title: a.title || null,
        url: a.url || null,
      })
      .execute();
  }

  // Usage accounting (per tenant/day)
  await upsertUsage(db, tenantId, model, { usage, cost });

  await appendJobEvent(db, job.id, JOB_EVENTS.JOB_COMPLETED, { slides: extracted.document.slides.length });
  await audit(AUDIT_ACTIONS.CLAUDE_SYNTHESIZE, {
    actorId,
    tenantId,
    detail: {
      jobId: job.id,
      model,
      slides: extracted.document.slides.length,
      citations: cited.attributions.length,
      warnings: cited.warnings.slice(0, 5),
      cost: cost.ok ? cost.cost : 0,
      piiDetected: pii.detected.length,
    },
  });

  return { ok: true, jobId: job.id, document: extracted.document, usage: { ...usage, cost: cost.ok ? cost.cost : 0 } };
}

// ═══════════════════════════════════════════════════════════════════
// JOB READ PATHS + EVENTS (§57-10 streaming SSE)
// ═══════════════════════════════════════════════════════════════════

/** Get a single job (tenant-scoped). */
export async function getClaudeJob(id) {
  const db = getDb();
  if (!db) return null;
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return null;
  return db
    .selectFrom('claude_synthesis_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', Number(id))
    .executeTakeFirst();
}

/** List jobs (tenant-scoped). */
export async function listClaudeJobs({ status = null, limit = 50 } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db
    .selectFrom('claude_synthesis_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at', 'desc');
  if (status) q = q.where('status', '=', status);
  return q.limit(Math.min(Number(limit) || 50, 200)).execute();
}

/** Get streaming events for a job (SSE job progress). */
export async function getClaudeJobEvents(jobId) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  return db
    .selectFrom('claude_job_events')
    .selectAll()
    .where('job_id', '=', Number(jobId))
    .orderBy('seq', 'asc')
    .limit(1000)
    .execute();
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════

/** Dashboard — providers, jobs summary, usage totals, circuit state. */
export async function getClaudeDashboard() {
  const db = getDb();
  if (!db) {
    return { ok: false, error: 'PostgreSQL required', providers: [], jobs: [], usage: [], circuits: [] };
  }
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required', providers: [], jobs: [], usage: [], circuits: [] };

  const providers = await db
    .selectFrom('claude_provider_configs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('model', 'asc')
    .execute();

  const jobs = await db
    .selectFrom('claude_synthesis_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at', 'desc')
    .limit(20)
    .execute();

  const usage = await db
    .selectFrom('claude_usage')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('day', 'desc')
    .limit(30)
    .execute();

  const circuits = await db
    .selectFrom('claude_circuit_breakers')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .execute();

  return { ok: true, providers, jobs, usage, circuits };
}

// ═══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Append a job event (sequential). */
async function appendJobEvent(db, jobId, eventType, payload = {}) {
  const last = await db
    .selectFrom('claude_job_events')
    .select(db.fn.max('seq').as('maxSeq'))
    .where('job_id', '=', jobId)
    .executeTakeFirst();
  const seq = Number(last?.maxSeq || 0) + 1;
  await db
    .insertInto('claude_job_events')
    .values({ job_id: jobId, seq, event_type: eventType, payload: JSON.stringify(payload) })
    .execute();
}

/** Record a failure: job status + circuit breaker + audit. */
async function recordFailure(db, tenantId, jobId, model, error, actorId) {
  // Job FSM: running → failed (validateJobStatusTransition)
  validateJobStatusTransition(JOB_STATUS.RUNNING, JOB_STATUS.FAILED);
  await db
    .updateTable('claude_synthesis_jobs')
    .set({ status: JOB_STATUS.FAILED, error: String(error || '').slice(0, 2000), updated_at: new Date() })
    .where('id', '=', jobId)
    .execute();
  await appendJobEvent(db, jobId, JOB_EVENTS.JOB_FAILED, { error: String(error || '').slice(0, 500) });

  // Circuit breaker — failure_count++, open_until threshold bo'lsa
  const now = new Date();
  const existing = await db
    .selectFrom('claude_circuit_breakers')
    .select(['failure_count'])
    .where('tenant_id', '=', tenantId)
    .where('provider', '=', 'claude')
    .where('model', '=', model)
    .executeTakeFirst();
  const failures = Number(existing?.failure_count || 0) + 1;
  const openUntil = failures >= 5 ? new Date(now.getTime() + 30000) : null;
  await db
    .insertInto('claude_circuit_breakers')
    .values({
      tenant_id: tenantId,
      provider: 'claude',
      model,
      failure_count: failures,
      open_until: openUntil,
      last_error: String(error || '').slice(0, 1000),
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'provider', 'model'])
        .doUpdateSet({ failure_count: failures, open_until: openUntil, last_error: String(error || '').slice(0, 1000), updated_at: now })
    )
    .execute();

  await audit(AUDIT_ACTIONS.CLAUDE_JOB_FAILED, {
    actorId,
    tenantId,
    detail: { jobId, model, error: String(error || '').slice(0, 500), failures, circuitOpen: Boolean(openUntil) },
  });
}

/** Upsert daily usage accounting. */
async function upsertUsage(db, tenantId, model, { usage = {}, cost = {} } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const cacheWrite = Number(usage.cache_creation_input_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const c = cost.ok ? cost.cost : 0;
  await db
    .insertInto('claude_usage')
    .values({
      tenant_id: tenantId,
      provider: 'claude',
      model,
      day,
      input_tokens: input,
      output_tokens: output,
      cache_creation_tokens: cacheWrite,
      cache_read_tokens: cacheRead,
      cost_estimate: c,
      request_count: 1,
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'provider', 'model', 'day'])
        .doUpdateSet((eb) => ({
          input_tokens: eb('input_tokens', '+', input),
          output_tokens: eb('output_tokens', '+', output),
          cache_creation_tokens: eb('cache_creation_tokens', '+', cacheWrite),
          cache_read_tokens: eb('cache_read_tokens', '+', cacheRead),
          cost_estimate: eb('cost_estimate', '+', c),
          request_count: eb('request_count', '+', 1),
          updated_at: new Date(),
        }))
    )
    .execute();
}

// Constants for routes meta
export const CLAUDE_META = {
  models: CLAUDE_MODELS,
  defaults: CLAUDE_DEFAULTS,
  jobStatus: JOB_STATUS,
  sseEvents: SSE_EVENTS,
  jobEvents: JOB_EVENTS,
};
