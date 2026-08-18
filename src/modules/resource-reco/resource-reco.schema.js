/**
 * Deborah — Resource Recommendation Connectors (pure logic)
 *
 * Prompt 54 — maqola, paper, video, news va institutional materialni
 * verified metadata bilan tavsiya qilish (research.md §11 manba tavsiyasi,
 * §11.2 ranking weights, §11.4 hallucination guard). This module is PURE
 * (no I/O, no globals):
 *
 *   - normalizeProviderRecord: har bir provider raw JSON'ini canonical
 *     record'ga aylantiradi (openalex | semantic_scholar | crossref |
 *     core | youtube | rss).
 *   - dedupeRecords: DOI / URL / normalized-title hash bo'yicha dublikat
 *     olib tashlash.
 *   - computeRecommendationScore: §11.2 weighted ranking — 0.35 relevance,
 *     0.18 authority, 0.12 recency, 0.10 citations, 0.10 pedagogy,
 *     0.05 language, 0.05 license, 0.05 preference.
 *   - applyQuota / computeBackoff: provider quota hisobi + exponential
 *     backoff (jitter bilan).
 *   - assertLlmOnlyRanksRecords: LLM hech qachon bibliographic record
 *     yaratmaydi — faqat retrieved recordlarni rank/summarize qiladi (§11.4).
 *   - formatCitation: APA-uslubidagi citation.
 *   - validateFeedback: teacher trust | hide | save | source_pack.
 *   - checkProviderTerms: ToS compliance — YouTube transcript scraping
 *     taqiqlangan; OA/attribution talablari.
 *   - detectTranscriptScrapeIntent: transcript endpoint'larga yo'naltirilgan
 *     so'rovlarni bloklaydi (security guard).
 *
 * SECURITY / DATA GUARD (Prompt 54 §15-17):
 *   - LLM output retrieved recordlar bilan cheklangan (subset guard).
 *   - YouTube transcript scraping qilinmaydi.
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Supported connector providers (§11.1). */
export const RESOURCE_PROVIDERS = [
  'openalex',
  'semantic_scholar',
  'crossref',
  'core',
  'youtube',
  'rss',
];

/** Record types. */
export const RESOURCE_TYPES = ['paper', 'article', 'video', 'news', 'institutional'];

/** Source-type badges (§11.3 teacher UI). */
export const SOURCE_BADGES = {
  verified_academic: 'Verified academic',
  oer: 'OER',
  popular_video: 'Popular video',
  recent_news: 'Recent news',
};

/** Provider status. */
export const PROVIDER_STATUS = {
  ACTIVE: 'active',
  DEGRADED: 'degraded',
  DISABLED: 'disabled',
};

/** Connector log kinds. */
export const CONNECTOR_KIND = {
  SEARCH: 'search',
  RESOLVE: 'resolve',
  CACHE: 'cache',
};

/** Connector log statuses. */
export const CONNECTOR_STATUS = {
  OK: 'ok',
  QUOTA: 'quota',
  BACKOFF: 'backoff',
  OUTAGE: 'outage',
  ERROR: 'error',
};

/** §11.2 ranking weights (jami 1.00). */
export const RANKING_WEIGHTS = {
  relevance: 0.35,
  authority: 0.18,
  recency: 0.12,
  citations: 0.10,
  pedagogy: 0.10,
  language: 0.05,
  license: 0.05,
  preference: 0.05,
};

/** Teacher feedback actions (§11.3). */
export const FEEDBACK_ACTIONS = ['trust', 'hide', 'save', 'source_pack'];

/** Provider ToS / data guards (§11.1, §11.2). */
export const PROVIDER_TERMS = {
  openalex: {
    requiresAttribution: true,
    fullText: 'metadata only',
    transcriptScraping: false,
  },
  semantic_scholar: {
    requiresAttribution: true,
    fullText: 'metadata + abstract',
    transcriptScraping: false,
  },
  crossref: {
    requiresAttribution: true,
    fullText: 'metadata only (no full text)',
    transcriptScraping: false,
  },
  core: {
    requiresAttribution: true,
    fullText: 'metadata + OA full text',
    transcriptScraping: false,
  },
  youtube: {
    requiresAttribution: true,
    fullText: 'metadata only',
    transcriptScraping: true, // TAHQIQLANGAN — arbitrary transcript yo'q
    quotaNote: 'search.list 100 quota / 10,000 daily — cache + batch shart',
  },
  rss: {
    requiresAttribution: false,
    fullText: 'feed metadata',
    transcriptScraping: false,
  },
};

/** Transcript endpoint patternlari — blocklanadi (security guard). */
export const TRANSCRIPT_SCRAPE_PATTERNS = [
  /youtube.*timedtext/i,
  /youtube.*transcript/i,
  /\/transcript/i,
  /\/api\/timedtext/i,
  /video\.google\.com.*timedtext/i,
];

/** Normalize title for dedupe: lowercase, punctuation strip, whitespace collapse. */
export function normalizeTitleForDedupe(title = '') {
  return String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable dedupe hash (sha256 of normalized title). */
export function titleDedupeHash(title = '') {
  return createHash('sha256').update(normalizeTitleForDedupe(title)).digest('hex').slice(0, 32);
}

// ═══════════════════════════════════════════════════════════════════
// PROVIDER NORMALIZATION (§11.1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a provider raw response item to the canonical record shape.
 * Provider-specific raw response canonical shape'dan tashqariga chiqmaydi.
 *
 * @param {string} provider
 * @param {Object} raw
 * @returns {{ ok: boolean, record?: Object, reason?: string }}
 */
export function normalizeProviderRecord(provider, raw = {}) {
  if (!provider) return { ok: false, reason: 'provider is required' };
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'raw record is required' };

  const normAuthors = (list = []) =>
    (Array.isArray(list) ? list : [])
      .map((a) => {
        if (typeof a === 'string') return a;
        const d =
          a?.display_name ||
          a?.name ||
          [a?.given, a?.family].filter(Boolean).join(' ') ||
          '';
        return String(d).trim();
      })
      .filter(Boolean);

  switch (provider) {
    case 'openalex': {
      const record = {
        provider,
        external_id: String(raw.id || raw.openalex_id || raw.title || ''),
        title: String(raw.title || ''),
        authors: normAuthors(raw.authorships?.map((a) => a?.author) || raw.authors || []),
        url: raw.doi ? `https://doi.org/${raw.doi}` : raw.landing_page_url || raw.url || null,
        doi: raw.doi || null,
        type: 'paper',
        language: raw.language || 'en',
        license: raw.license || (raw.is_oa ? 'oa' : 'closed'),
        is_open_access: Boolean(raw.open_access?.is_oa ?? raw.is_oa ?? false),
        publication_date: raw.publication_date || null,
        citations: Number(raw.cited_by_count || 0),
        description: raw.abstract_inverted_index
          ? Object.entries(raw.abstract_inverted_index)
              .sort((a, b) => a[1][0] - b[1][0])
              .map(([w]) => w)
              .join(' ')
          : raw.abstract || '',
        metadata: { source: 'openalex', topics: raw.topics?.map((t) => t.display_name) || [] },
      };
      return record.title ? { ok: true, record } : { ok: false, reason: 'openalex record missing title' };
    }
    case 'semantic_scholar': {
      const record = {
        provider,
        external_id: String(raw.paperId || raw.title || ''),
        title: String(raw.title || ''),
        authors: normAuthors(raw.authors || []),
        url: raw.url || (raw.externalIds?.DOI ? `https://doi.org/${raw.externalIds.DOI}` : null),
        doi: raw.externalIds?.DOI || raw.doi || null,
        type: 'paper',
        language: raw.language || 'en',
        license: raw.openAccessPdf?.url ? 'oa' : 'unknown',
        is_open_access: Boolean(raw.openAccessPdf?.url),
        publication_date: raw.publicationDate || raw.year ? `${raw.year}-01-01` : null,
        citations: Number(raw.citationCount || 0),
        description: raw.abstract || '',
        metadata: { source: 'semantic_scholar', fields: raw.fieldsOfStudy || [] },
      };
      return record.title ? { ok: true, record } : { ok: false, reason: 'semantic_scholar record missing title' };
    }
    case 'crossref': {
      const record = {
        provider,
        external_id: String(raw.DOI || raw.title?.[0] || ''),
        title: String(raw.title?.[0] || ''),
        authors: normAuthors(
          (raw.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim())
        ),
        url: raw.DOI ? `https://doi.org/${raw.DOI}` : raw.URL || null,
        doi: raw.DOI || null,
        type: raw.type === 'journal-article' ? 'article' : 'paper',
        language: raw.language || 'en',
        license: raw.license?.[0]?.URL ? 'oa-license' : 'unknown',
        is_open_access: Boolean(raw['is-referenced-by-count'] !== undefined && raw.license?.[0]),
        publication_date: raw.issued?.['date-parts']?.[0]
          ? `${raw.issued['date-parts'][0].join('-')}` : null,
        citations: Number(raw['is-referenced-by-count'] || 0),
        description: raw.abstract
          ? String(raw.abstract).replace(/<[^>]+>/g, '').slice(0, 800)
          : '',
        metadata: { source: 'crossref', container: raw['container-title']?.[0] || null },
      };
      return record.title ? { ok: true, record } : { ok: false, reason: 'crossref record missing title' };
    }
    case 'core': {
      const record = {
        provider,
        external_id: String(raw.id || raw.title || ''),
        title: String(raw.title || ''),
        authors: normAuthors(raw.authors || []),
        url: raw.downloadUrl || raw.fullTextUrl || raw.link || null,
        doi: raw.doi || null,
        type: raw.contentType?.includes('video') ? 'video' : 'paper',
        language: raw.language?.code || 'en',
        license: raw.oaState === 'oa' ? 'oa' : 'unknown',
        is_open_access: raw.oaState === 'oa',
        publication_date: raw.yearPublished ? `${raw.yearPublished}-01-01` : null,
        citations: 0,
        description: raw.abstract || '',
        metadata: { source: 'core', oaState: raw.oaState || null },
      };
      return record.title ? { ok: true, record } : { ok: false, reason: 'core record missing title' };
    }
    case 'youtube': {
      const record = {
        provider,
        external_id: String(raw.id?.videoId || raw.id || ''),
        title: String(raw.snippet?.title || raw.title || ''),
        authors: raw.snippet?.channelTitle ? [raw.snippet.channelTitle] : [],
        url: raw.id?.videoId ? `https://www.youtube.com/watch?v=${raw.id.videoId}` : null,
        doi: null,
        type: 'video',
        language: raw.snippet?.defaultAudioLanguage || raw.snippet?.defaultLanguage || 'en',
        license: 'youtube-standard',
        is_open_access: true,
        publication_date: raw.snippet?.publishedAt || null,
        citations: 0, // view count alohida — §11.2 video signal
        description: raw.snippet?.description || '',
        metadata: {
          source: 'youtube',
          channelId: raw.snippet?.channelId || null,
          duration: raw.contentDetails?.duration || null,
          viewCount: Number(raw.statistics?.viewCount || 0),
          educationIntent: detectEducationIntent(raw.snippet?.description || '', raw.snippet?.title || ''),
        },
      };
      return record.title ? { ok: true, record } : { ok: false, reason: 'youtube record missing title' };
    }
    case 'rss': {
      const record = {
        provider,
        external_id: String(raw.guid || raw.link || raw.title || ''),
        title: String(raw.title || ''),
        authors: raw.creator ? [raw.creator] : raw.author ? [raw.author] : [],
        url: raw.link || null,
        doi: null,
        type: 'news',
        language: raw.language || 'en',
        license: 'rss-feed',
        is_open_access: true,
        publication_date: raw.pubDate || raw.published || raw.isoDate || null,
        citations: 0,
        description: raw.contentSnippet || raw.summary || raw.content || '',
        metadata: { source: 'rss', feedTitle: raw.feedTitle || null },
      };
      return record.title ? { ok: true, record } : { ok: false, reason: 'rss record missing title' };
    }
    default:
      return { ok: false, reason: `unsupported provider ${provider}` };
  }
}

/** Education-intent heuristic for YouTube (§11.2 — raw view count yetarli emas). */
export function detectEducationIntent(...texts) {
  const all = texts.join(' ').toLowerCase();
  const signals = [
    'dars', 'sabab', 'lesson', 'tutorial', 'explainer', 'lecture', 'course',
    'talim', 'education', 'how to', 'what is', 'explained', 'просто',
    'урок', 'лекция',
  ];
  // o'quv / o‘quv / o’quv — apostrof variantlari (U+0027, U+2018, U+2019)
  const apostropheQuv = /o['\u2018\u2019]quv/.test(all);
  return signals.some((s) => all.includes(s)) || apostropheQuv;
}

// ═══════════════════════════════════════════════════════════════════
// DEDUPE (§11.2 DOI/URL/title)
// ═══════════════════════════════════════════════════════════════════

/**
 * Deduplicate canonical records by DOI → URL → normalized-title hash.
 * First occurrence wins; duplicates reported.
 *
 * @param {Array<Object>} records
 * @returns {{ ok: boolean, unique: Array<Object>, duplicates: Array<Object>, byKey: Object }}
 */
export function dedupeRecords(records = []) {
  if (!Array.isArray(records)) return { ok: false, reason: 'records must be an array' };
  const byKey = {};
  const unique = [];
  const duplicates = [];
  const doiNorm = (d) => String(d || '').toLowerCase().replace(/^https?:\/\/doi\.org\//, '').trim();

  for (const rec of records) {
    if (!rec || !rec.title) continue;
    const key =
      (rec.doi && `doi:${doiNorm(rec.doi)}`) ||
      (rec.url && `url:${String(rec.url).toLowerCase()}`) ||
      `title:${titleDedupeHash(rec.title)}`;
    if (byKey[key]) {
      duplicates.push(rec);
    } else {
      byKey[key] = rec;
      unique.push(rec);
    }
  }
  return { ok: true, unique, duplicates, byKey };
}

// ═══════════════════════════════════════════════════════════════════
// RANKING (§11.2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Weighted recommendation score (§11.2). Har bir component 0..1 oralig'ida.
 *
 * @param {Object} components - { relevance, authority, recency, citations, pedagogy, language, license, preference }
 * @param {Object} [weights] - override weights (jami ~1.00)
 * @returns {{ ok: boolean, score: number, weighted: Object, weights: Object }}
 */
export function computeRecommendationScore(components = {}, weights = RANKING_WEIGHTS) {
  const comp = {
    relevance: Number(components.relevance ?? 0),
    authority: Number(components.authority ?? 0),
    recency: Number(components.recency ?? 0),
    citations: Number(components.citations ?? 0),
    pedagogy: Number(components.pedagogy ?? 0),
    language: Number(components.language ?? 0),
    license: Number(components.license ?? 0),
    preference: Number(components.preference ?? 0),
  };
  const w = {
    ...RANKING_WEIGHTS,
    ...(weights && typeof weights === 'object' ? weights : {}),
  };
  for (const k of Object.keys(RANKING_WEIGHTS)) {
    if (!Number.isFinite(comp[k])) return { ok: false, reason: `component ${k} must be finite` };
  }
  const weighted = {};
  let score = 0;
  for (const k of Object.keys(RANKING_WEIGHTS)) {
    const v = Math.min(1, Math.max(0, comp[k]));
    weighted[k] = Number((v * (w[k] ?? 0)).toFixed(4));
    score += v * (w[k] ?? 0);
  }
  return { ok: true, score: Number(score.toFixed(4)), weighted, weights: w };
}

// ═══════════════════════════════════════════════════════════════════
// QUOTA / BACKOFF (§11.2 cache va batch shart)
// ═══════════════════════════════════════════════════════════════════

/**
 * Provider quota check — daily window.
 * @param {Object} params - { used, limit, windowStart, now }
 * @returns {{ ok: boolean, remaining: number, resetInMs: number, reason?: string }}
 */
export function applyQuota({ used = 0, limit = 0, windowStart = null, now = Date.now() } = {}) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const start = windowStart ? new Date(windowStart).getTime() : now;
  if (now - start >= DAY_MS) {
    // Window expired — reset
    return { ok: true, remaining: Math.max(0, limit - 0), resetInMs: 0, reset: true };
  }
  if (limit <= 0) {
    return { ok: false, remaining: 0, resetInMs: start + DAY_MS - now, reason: 'provider has no daily quota configured' };
  }
  const usedN = Number(used) || 0;
  const remaining = Math.max(0, limit - usedN);
  return {
    ok: remaining > 0,
    remaining,
    resetInMs: start + DAY_MS - now,
    reason: remaining > 0 ? undefined : 'daily quota exhausted',
  };
}

/**
 * Exponential backoff with jitter.
 * @param {Object} params - { retryCount, baseMs, maxMs }
 * @returns {number} delay in ms
 */
export function computeBackoff({ retryCount = 0, baseMs = 1000, maxMs = 60000 } = {}) {
  const n = Math.max(0, Number(retryCount) || 0);
  const exp = Math.min(maxMs, baseMs * 2 ** n);
  const jitter = exp * 0.2 * Math.random();
  return Math.round(exp + jitter);
}

// ═══════════════════════════════════════════════════════════════════
// LLM HALLUCINATION GUARD (§11.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * LLM faqat retrieved recordlarni rank/summarize qila oladi — boshqa
 * hech qanday record'ni kiritish mumkin emas. Candidate'lar retrieved
 * recordlar subset'i bo'lishi shart (DOI/URL/title hash bo'yicha).
 *
 * @param {Object} params - { retrieved, candidates }
 * @returns {{ ok: boolean, reason?: string, allowed: Array<Object> }}
 */
export function assertLlmOnlyRanksRecords({ retrieved = [], candidates = [] } = {}) {
  const known = new Set();
  const deduped = dedupeRecords(retrieved);
  for (const rec of deduped.unique) {
    if (rec.doi) known.add(`doi:${String(rec.doi).toLowerCase()}`);
    if (rec.url) known.add(`url:${String(rec.url).toLowerCase()}`);
    if (rec.title) known.add(`title:${titleDedupeHash(rec.title)}`);
  }
  const allowed = [];
  for (const cand of candidates) {
    if (!cand || !cand.title) continue; // LLM yaratgan title'siz record — tashlab ket
    const key =
      (cand.doi && `doi:${String(cand.doi).toLowerCase()}`) ||
      (cand.url && `url:${String(cand.url).toLowerCase()}`) ||
      `title:${titleDedupeHash(cand.title)}`;
    if (known.has(key)) allowed.push(cand);
  }
  return {
    ok: allowed.length === candidates.length,
    allowed,
    reason: allowed.length === candidates.length
      ? undefined
      : 'LLM candidate exceeds retrieved records — hallucinated reference blocked',
  };
}

// ═══════════════════════════════════════════════════════════════════
// CITATION & FEEDBACK
// ═══════════════════════════════════════════════════════════════════

/**
 * APA-ish citation from a canonical record.
 * @param {Object} record
 * @returns {string}
 */
export function formatCitation(record = {}) {
  if (!record?.title) return '';
  const authors = (Array.isArray(record.authors) ? record.authors : [])
    .slice(0, 3)
    .join(', ');
  const year = record.publication_date
    ? new Date(record.publication_date).getUTCFullYear()
    : 'n.d.';
  const base = `${authors ? `${authors} (${year}). ` : ''}${record.title}.`;
  return record.doi ? `${base} https://doi.org/${record.doi}` : base;
}

/**
 * Validate teacher feedback action.
 * @param {Object} params - { action, sourcePackId }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateFeedback({ action = '', sourcePackId = null } = {}) {
  if (!FEEDBACK_ACTIONS.includes(action)) {
    return { ok: false, reason: `invalid feedback action ${action} — allowed: ${FEEDBACK_ACTIONS.join('|')}` };
  }
  if (action === 'source_pack' && !sourcePackId) {
    return { ok: false, reason: 'source_pack action requires sourcePackId' };
  }
  return { ok: true };
}

/**
 * Provider ToS compliance check (§11.1 stop condition).
 * @param {string} provider
 * @param {Object} [config]
 * @returns {{ ok: boolean, reason?: string, terms: Object }}
 */
export function checkProviderTerms(provider, config = {}) {
  const terms = PROVIDER_TERMS[provider];
  if (!terms) return { ok: false, reason: `unknown provider ${provider}` };
  if (terms.transcriptScraping && !config.allowTranscript) {
    return {
      ok: false,
      reason: `${provider}: transcript scraping is PROHIBITED by research.md §11.2 — metadata only`,
      terms,
    };
  }
  return { ok: true, terms };
}

/**
 * Transcript scrape intent detection — bloklanadigan URL patternlari.
 * @param {string} url
 * @returns {{ ok: boolean, blocked?: boolean, reason?: string }}
 */
export function detectTranscriptScrapeIntent(url = '') {
  if (!url) return { ok: true };
  if (TRANSCRIPT_SCRAPE_PATTERNS.some((re) => re.test(url))) {
    return { ok: false, blocked: true, reason: 'transcript scraping endpoint blocked (Prompt 54 §15)' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH INPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a search request.
 * @param {Object} params - { query, limit, providers }
 * @returns {{ ok: boolean, reason?: string, normalized?: Object }}
 */
export function validateSearchRequest({ query = '', limit = 10, providers = [] } = {}) {
  const q = String(query || '').trim();
  if (!q || q.length < 3) return { ok: false, reason: 'query must be at least 3 characters' };
  if (q.length > 300) return { ok: false, reason: 'query exceeds 300 chars' };
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    return { ok: false, reason: 'limit must be an integer 1..50' };
  }
  const prov = Array.isArray(providers) && providers.length > 0 ? providers : RESOURCE_PROVIDERS;
  const unknown = prov.filter((p) => !RESOURCE_PROVIDERS.includes(p));
  if (unknown.length > 0) {
    return { ok: false, reason: `unsupported providers: ${unknown.join(', ')}` };
  }
  return {
    ok: true,
    normalized: { query: q, limit: n, providers: prov },
  };
}

/** Stable search query hash (idempotency). */
export function searchQueryHash(query = '', providers = []) {
  return createHash('sha256')
    .update(`${String(query).trim().toLowerCase()}|${[...providers].sort().join(',')}`)
    .digest('hex');
}
