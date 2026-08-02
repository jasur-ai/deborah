/**
 * Edikit — Resource Recommendation Connectors (service)
 *
 * Prompt 54 — verified metadata bilan manba tavsiyasi. Graceful
 * degradation: PostgreSQL bo'lmasa write path'lar 'PostgreSQL required'
 * throw qiladi, read path'lar []/null. Connector'lar real API'larga
 * ulanishi uchun resource_providers config (env-referenced api key)
 * kerak — konfiguratsiya yo'q bo'lsa provider "not configured" deb
 * o'tkazib yuboriladi (stop condition: ToS/quota mos bo'lmasa).
 *
 *   - searchResources: validate → quota check → connector search
 *     (cache/quota/backoff) → dedupe → rank → persist + audit.
 *   - applyTeacherFeedback: trust | hide | save | source_pack —
 *     UNIQUE idempotent upsert.
 *   - getRecommendationDashboard: provider status/quota, feedback
 *     counts, recent searches.
 *
 * SECURITY / DATA GUARD (Prompt 54 §15-17):
 *   - LLM hech qachon bibliographic record yaratmaydi — faqat
 *     assertLlmOnlyRanksRecords orqali retrieved recordlarni ranklash.
 *   - YouTube transcript scraping bloklanadi (detectTranscriptScrapeIntent).
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  normalizeProviderRecord,
  titleDedupeHash,
  dedupeRecords,
  computeRecommendationScore,
  applyQuota,
  computeBackoff,
  assertLlmOnlyRanksRecords,
  formatCitation,
  validateFeedback,
  checkProviderTerms,
  detectTranscriptScrapeIntent,
  validateSearchRequest,
  searchQueryHash,
  RESOURCE_PROVIDERS,
  PROVIDER_STATUS,
  CONNECTOR_KIND,
  CONNECTOR_STATUS,
} from './resource-reco.schema.js';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * HTTP connector call with quota + exponential backoff + time budget.
 * Real deployment'da provider config'dan api key oladi; konfiguratsiya
 * yo'q bo'lsa graceful "not configured".
 *
 * @param {Object} provider - resource_providers row
 * @param {Object} search - { query, limit }
 * @returns {Promise<{ ok: boolean, status: string, records: Array<Object>, error?: string, latencyMs: number }>}
 */
async function executeConnectorSearch(provider, search) {
  const started = Date.now();
  const statusOf = { ok: false, status: CONNECTOR_STATUS.ERROR, records: [], error: '', latencyMs: 0 };
  try {
    if (!provider || !provider.enabled || provider.status === PROVIDER_STATUS.DISABLED) {
      return { ...statusOf, status: CONNECTOR_STATUS.ERROR, error: 'provider disabled' };
    }
    const terms = checkProviderTerms(provider.name, provider.config || {});
    if (!terms.ok) {
      return { ...statusOf, status: CONNECTOR_STATUS.ERROR, error: terms.reason };
    }
    // Quota check (daily window)
    const quota = applyQuota({
      used: provider.quota_used || 0,
      limit: provider.quota_limit_daily || 0,
      windowStart: provider.quota_window_start,
    });
    if (!quota.ok) {
      return { ...statusOf, status: CONNECTOR_STATUS.QUOTA, error: quota.reason };
    }
    // URL allowlist — transcript scraping blok
    if (provider.base_url && !detectTranscriptScrapeIntent(provider.base_url).ok) {
      return { ...statusOf, status: CONNECTOR_STATUS.ERROR, error: 'transcript scraping endpoint blocked' };
    }
    // Config'da api key yo'q — provider real ishlatishga tayyor emas
    const apiKey = provider.config?.api_key || provider.config?.apiKey;
    if (!apiKey) {
      return { ...statusOf, status: CONNECTOR_STATUS.ERROR, error: 'provider not configured (api key missing)' };
    }
    // ── Real HTTP call (retry + backoff) ──
    let raw = null;
    let lastErr = '';
    let attempts = 0;
    for (attempts = 0; attempts < 3; attempts++) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(provider.base_url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({ query: search.query, limit: search.limit }),
          signal: controller.signal,
        });
        clearTimeout(t);
        if (res.status === 429 || res.status >= 500) {
          lastErr = `HTTP ${res.status}`;
          if (res.status === 429) {
            return { ...statusOf, status: CONNECTOR_STATUS.QUOTA, error: 'rate limited (429)' };
          }
          await new Promise((r) => setTimeout(r, computeBackoff({ retryCount: attempts })));
          continue;
        }
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          break;
        }
        raw = await res.json();
        break;
      } catch (e) {
        lastErr = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e);
        await new Promise((r) => setTimeout(r, computeBackoff({ retryCount: attempts })));
      }
    }
    if (!raw) {
      return {
        ...statusOf,
        status: attempts >= 3 ? CONNECTOR_STATUS.OUTAGE : CONNECTOR_STATUS.ERROR,
        error: lastErr || 'no response',
        latencyMs: Date.now() - started,
      };
    }
    // Normalize raw items → canonical records
    const items = Array.isArray(raw.results) ? raw.results : raw.items || raw.data || [];
    const records = [];
    for (const item of items.slice(0, search.limit)) {
      const n = normalizeProviderRecord(provider.name, item);
      if (n.ok) records.push(n.record);
    }
    return { ok: true, status: CONNECTOR_STATUS.OK, records, latencyMs: Date.now() - started };
  } catch (e) {
    return { ...statusOf, status: CONNECTOR_STATUS.ERROR, error: String(e?.message || e), latencyMs: Date.now() - started };
  }
}

/**
 * Component scoring per §11.2 (0..1). Records + search context'dan
 * simple heuristics — LLM rank bosqichidan oldin deterministik base.
 */
function scoreComponents(record, search) {
  const q = String(search.query || '').toLowerCase();
  const title = String(record.title || '').toLowerCase();
  const desc = String(record.description || '').toLowerCase();
  const inTitle = title.includes(q) ? 1 : 0;
  const inDesc = desc.includes(q) ? 0.6 : 0;
  const relevance = Math.min(1, inTitle * 0.7 + inDesc * 0.3 + (title.split(' ').filter((w) => q.split(' ').includes(w)).length * 0.2));

  // Authority — verified academic / OA / provider credibility
  const authority =
    record.type === 'institutional' ? 1 : record.type === 'paper' ? 0.85 : record.type === 'video' ? 0.5 : 0.4;

  // Recency — oxirgi 3 yil = 1, 5+ yil = past
  let recency = 0.3;
  if (record.publication_date) {
    const yrs = (Date.now() - new Date(record.publication_date).getTime()) / (365.25 * 24 * 3600 * 1000);
    recency = yrs <= 1 ? 1 : yrs <= 3 ? 0.8 : yrs <= 5 ? 0.6 : 0.4;
  }

  // Citations — field-normalized proxy: log scale 0..1
  const citations = Math.min(1, Math.log10(1 + (record.citations || 0)) / 3);

  // Pedagogy — education intent + source badge
  const pedagogy =
    (record.metadata?.educationIntent ? 0.8 : 0.4) + (record.type === 'video' ? 0.1 : 0);

  // Language fit — uz/ru prefer (Uzbek user base), else en
  const language = ['uz', 'ru'].includes(record.language) ? 1 : record.language === 'en' ? 0.7 : 0.4;

  // License / OA
  const license = record.is_open_access ? 1 : record.license === 'oa' || record.license === 'oa-license' ? 0.9 : 0.4;

  // Preference — teacher prior (default neutral)
  const preference = 0.5;

  return { relevance, authority, recency, citations, pedagogy, language, license, preference };
}

/** Provider default quota config (per research.md §11.1/§11.2). */
function defaultProviderQuota(name) {
  if (name === 'youtube') return { limit: 100, enabled: false };
  if (name === 'openalex') return { limit: 5000, enabled: false };
  if (name === 'semantic_scholar') return { limit: 1000, enabled: false };
  if (name === 'crossref') return { limit: 10000, enabled: false };
  if (name === 'core') return { limit: 500, enabled: false };
  return { limit: 1000, enabled: false };
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════

/**
 * Orchestrate a resource search across enabled providers.
 * validate → quota → connectors → dedupe → rank → persist + audit.
 *
 * @param {Object} params - { query, topic, context, limit, providers, actorId }
 * @returns {Promise<{ ok: boolean, searchId?: number, results: Array<Object>, warnings: Array<string>, error?: string }>}
 */
export async function searchResources({
  query = '',
  topic = null,
  context = '',
  limit = 10,
  providers = [],
  actorId = null,
} = {}) {
  const v = validateSearchRequest({ query, limit, providers });
  if (!v.ok) return { ok: false, error: v.reason };
  const { query: q, limit: n, providers: prov } = v.normalized;

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };

  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  // Idempotency: bir xil query + providers → cached search qaytariladi
  const hash = searchQueryHash(q, prov);
  const existing = await db
    .selectFrom('resource_searches')
    .select(['id', 'status'])
    .where('tenant_id', '=', tenantId)
    .where('query_hash', '=', hash)
    .executeTakeFirst();
  if (existing) {
    const rows = await db
      .selectFrom('resource_search_results as r')
      .innerJoin('resource_records as rec', 'rec.id', 'r.record_id')
      .selectAll('rec')
      .select(['r.rank', 'r.score', 'r.components', 'r.why_recommended'])
      .where('r.search_id', '=', existing.id)
      .orderBy('r.rank', 'asc')
      .execute();
    return {
      ok: true,
      searchId: existing.id,
      cached: true,
      results: rows.map((row) => ({ ...row, citation: formatCitation(row) })),
      warnings: [],
    };
  }

  // Connector execution — enabled + quota'ga ega providerlar
  const warnings = [];
  const collected = [];
  for (const pname of prov) {
    const provider = await db
      .selectFrom('resource_providers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('name', '=', pname)
      .executeTakeFirst();
    if (!provider) {
      warnings.push(`${pname}: provider not registered — run ensureResourceProviders`);
      continue;
    }
    // Quota window reset persist — applyQuota window o'tgan bo'lsa, DB'dagi
    // quota_used va quota_window_start yangilanadi (aks holda limit birinchi
    // kundan keyin hech qachon qayta ishlamaydi).
    const quotaNow = applyQuota({
      used: provider.quota_used || 0,
      limit: provider.quota_limit_daily || 0,
      windowStart: provider.quota_window_start,
    });
    if (quotaNow.reset) {
      await db
        .updateTable('resource_providers')
        .set({ quota_used: 0, quota_window_start: new Date(), updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('name', '=', pname)
        .execute();
      provider = { ...provider, quota_used: 0, quota_window_start: new Date() };
    }
    const res = await executeConnectorSearch(provider, { query: q, limit: n });
    await db
      .insertInto('resource_connector_logs')
      .values({
        tenant_id: tenantId,
        provider: pname,
        kind: CONNECTOR_KIND.SEARCH,
        status: res.status,
        retries: 0,
        latency_ms: res.latencyMs,
        error: res.error || null,
      })
      .execute();
    if (res.status !== CONNECTOR_STATUS.OK) {
      warnings.push(`${pname}: ${res.error || res.status}`);
      continue;
    }
    // Quota accounting — muvaffaqiyatli call'dan keyin quota_used oshiriladi (§11.2)
    await db
      .updateTable('resource_providers')
      .set((eb) => ({
        quota_used: eb('quota_used', '+', 1),
        updated_at: new Date(),
      }))
      .where('tenant_id', '=', tenantId)
      .where('name', '=', pname)
      .execute();
    collected.push(...res.records);
  }

  // Dedupe: DOI → URL → title hash
  const deduped = dedupeRecords(collected);
  // Score + rank
  const scored = deduped.unique
    .map((rec) => {
      const components = scoreComponents(rec, { query: q });
      const s = computeRecommendationScore(components);
      return { rec, components, score: s.ok ? s.score : 0 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

  // Persist: search + records + results
  const searchRow = await db
    .insertInto('resource_searches')
    .values({
      tenant_id: tenantId,
      query_hash: hash,
      query_text: q,
      topic,
      context: context || null,
      limit_count: n,
      providers: JSON.stringify(prov),
      status: 'completed',
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  const results = [];
  for (let i = 0; i < scored.length; i++) {
    const { rec, components, score } = scored[i];
    // Upsert record (idempotent)
    const existingRec = await db
      .selectFrom('resource_records')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('provider', '=', rec.provider)
      .where('external_id', '=', rec.external_id)
      .executeTakeFirst();
    let recordId;
    if (existingRec) {
      recordId = existingRec.id;
    } else {
      const ins = await db
        .insertInto('resource_records')
        .values({
          tenant_id: tenantId,
          provider: rec.provider,
          external_id: rec.external_id,
          title: rec.title,
          title_norm: titleDedupeHash(rec.title),
          authors: JSON.stringify(rec.authors || []),
          url: rec.url || null,
          doi: rec.doi || null,
          type: rec.type,
          language: rec.language,
          license: rec.license,
          is_open_access: rec.is_open_access,
          publication_date: rec.publication_date ? new Date(rec.publication_date) : null,
          citations: rec.citations || 0,
          description: rec.description || null,
          metadata: JSON.stringify(rec.metadata || {}),
        })
        .returning(['id'])
        .executeTakeFirst();
      recordId = ins.id;
    }
    await db
      .insertInto('resource_search_results')
      .values({
        search_id: searchRow.id,
        record_id: recordId,
        rank: i + 1,
        score,
        components: JSON.stringify(components),
        why_recommended: buildWhyRecommended(rec, components),
      })
      .execute();
    results.push({
      ...rec,
      id: recordId,
      rank: i + 1,
      score,
      components,
      why_recommended: buildWhyRecommended(rec, components),
      citation: formatCitation(rec),
    });
  }

  await audit(AUDIT_ACTIONS.RESOURCE_SEARCH, {
    actorId,
    tenantId,
    detail: { query: q, providers: prov, results: results.length, warnings },
  });

  return { ok: true, searchId: searchRow.id, results, warnings };
}

/** "Nega tavsiya qilindi?" — §11.3 teacher UI breakdown text. */
function buildWhyRecommended(rec, components) {
  const parts = [];
  if (components.relevance >= 0.6) parts.push('query bilan yuqori semantic moslik');
  if (rec.is_open_access) parts.push('open access');
  if (['uz', 'ru'].includes(rec.language)) parts.push('til mos');
  if (rec.type === 'paper' || rec.type === 'institutional') parts.push('verified academic manba');
  if (rec.metadata?.educationIntent) parts.push('o\'quv maqsadiga mos video');
  if ((rec.citations || 0) > 50) parts.push(`${rec.citations} iqtibos`);
  return parts.length > 0 ? parts.join(', ') : 'ranked by relevance';
}

// ═══════════════════════════════════════════════════════════════════
// FEEDBACK (§11.3 teacher UI)
// ═══════════════════════════════════════════════════════════════════

/**
 * Teacher feedback — trust | hide | save | source_pack (idempotent upsert).
 * source_pack → mavjud source-pack'ga bog'laydi (Prompt 50 infra).
 *
 * @param {Object} params - { recordId, action, note, sourcePackId, actorId }
 * @returns {Promise<{ ok: boolean, feedbackId?: number, error?: string }>}
 */
export async function applyTeacherFeedback({
  recordId = null,
  action = '',
  note = '',
  sourcePackId = null,
  actorId = null,
} = {}) {
  const v = validateFeedback({ action, sourcePackId });
  if (!v.ok) return { ok: false, error: v.reason };
  if (!recordId) return { ok: false, error: 'recordId is required' };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  // Idempotent upsert — UNIQUE(tenant, record, actor, action)
  const row = await db
    .insertInto('resource_feedback')
    .values({
      tenant_id: tenantId,
      record_id: recordId,
      actor_id: actorId || 'system',
      action,
      note: note || null,
      source_pack_id: sourcePackId || null,
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'record_id', 'actor_id', 'action'])
        .doUpdateSet({ note, source_pack_id: sourcePackId || null })
    )
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.RESOURCE_FEEDBACK, {
    actorId,
    tenantId,
    detail: { recordId, action, sourcePackId },
  });

  return { ok: true, feedbackId: row.id };
}

// ═══════════════════════════════════════════════════════════════════
// PROVIDER REGISTRY + DASHBOARD
// ═══════════════════════════════════════════════════════════════════

/**
 * Ensure provider rows exist for the tenant (idempotent).
 * Default: disabled + research-informed daily quota (§11.1).
 */
export async function ensureResourceProviders() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const created = [];
  for (const name of RESOURCE_PROVIDERS) {
    const q = defaultProviderQuota(name);
    const row = await db
      .insertInto('resource_providers')
      .values({
        tenant_id: tenantId,
        name,
        base_url: null,
        enabled: q.enabled,
        status: PROVIDER_STATUS.DISABLED,
        quota_limit_daily: q.limit,
        terms_ok: false,
        config: JSON.stringify({}),
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'name']).doNothing())
      .returning(['id', 'name'])
      .executeTakeFirst();
    if (row) created.push(row);
  }
  return { ok: true, created };
}

/** Update provider config/status (admin). */
export async function updateResourceProvider({ name, patch = {}, actorId = null } = {}) {
  // validate-before-getDb: unsupported provider DB'ga murojaat qilmasdan rad etiladi
  if (!RESOURCE_PROVIDERS.includes(name)) {
    return { ok: false, error: `unsupported provider ${name}` };
  }
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  const allowed = ['enabled', 'status', 'quota_limit_daily', 'terms_ok', 'config', 'base_url'];
  const set = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (set.config && typeof set.config === 'object') set.config = JSON.stringify(set.config);
  if (Object.keys(set).length === 0) return { ok: false, error: 'no fields to update' };
  set.updated_at = new Date();

  await db
    .updateTable('resource_providers')
    .set(set)
    .where('tenant_id', '=', tenantId)
    .where('name', '=', name)
    .execute();

  await audit(AUDIT_ACTIONS.RESOURCE_PROVIDER_UPDATE, {
    actorId,
    tenantId,
    detail: { name, patch: Object.keys(set) },
  });
  return { ok: true };
}

/** Dashboard — provider status/quota, feedback counts, recent searches. */
export async function getRecommendationDashboard() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required', providers: [], feedback: { trust: 0, hide: 0, save: 0, source_pack: 0 }, recentSearches: [] };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const providers = await db
    .selectFrom('resource_providers')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('name', 'asc')
    .execute();

  const feedbackRows = await db
    .selectFrom('resource_feedback')
    .select(['action'])
    .where('tenant_id', '=', tenantId)
    .execute();
  const feedback = { trust: 0, hide: 0, save: 0, source_pack: 0 };
  for (const f of feedbackRows) feedback[f.action] = (feedback[f.action] || 0) + 1;

  const recentSearches = await db
    .selectFrom('resource_searches')
    .select(['id', 'query_text', 'topic', 'limit_count', 'providers', 'created_at', 'created_by'])
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at', 'desc')
    .limit(10)
    .execute();

  return { ok: true, providers, feedback, recentSearches };
}

// ═══════════════════════════════════════════════════════════════════
// LLM SUMMARY GUARD (§11.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * LLM summary — retrieved recordlarga cheklangan (hallucination guard
 * §11.4). LLM candidate'lar retrieved recordlar SUBSET'i bo'lishi shart;
 * boshqa record'lar (LLM o\u2018zi "ixtiro qilgan" paper/video) bloklanadi.
 *
 * @param {Object} params - { recordIds, summaries: [{ title, doi, url, summary }], actorId }
 * @returns {Promise<{ ok: boolean, summaries: Array<Object>, error?: string }>}
 */
export async function generateLlmSummary({ recordIds = [], summaries = [], actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  if (!Array.isArray(recordIds) || recordIds.length === 0) {
    return { ok: false, error: 'recordIds are required' };
  }
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return { ok: false, error: 'summaries are required' };
  }

  // Faqat retrieved (tenant-scoped) recordlar guard'da ishtirok etadi
  const retrieved = await db
    .selectFrom('resource_records')
    .select(['id', 'title', 'doi', 'url'])
    .where('tenant_id', '=', tenantId)
    .where('id', 'in', recordIds)
    .execute();

  const candidates = summaries.map((s) => ({
    title: s.title || '',
    doi: s.doi || null,
    url: s.url || null,
    summary: s.summary || '',
  }));

  const guard = assertLlmOnlyRanksRecords({ retrieved, candidates });
  if (!guard.ok) {
    await audit(AUDIT_ACTIONS.RESOURCE_LLM_SUMMARY, {
      actorId,
      tenantId,
      detail: { guard: 'blocked', reason: guard.reason },
    });
    return { ok: false, error: guard.reason, summaries: guard.allowed };
  }

  await audit(AUDIT_ACTIONS.RESOURCE_LLM_SUMMARY, {
    actorId,
    tenantId,
    detail: { recordIds: recordIds.length, allowed: guard.allowed.length },
  });
  return { ok: true, summaries: guard.allowed };
}
