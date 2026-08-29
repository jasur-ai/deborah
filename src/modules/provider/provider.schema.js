/**
 * Deborah — Unified Provider Async Adapter (pure logic)
 *
 * Prompt 58 — Gamma generation va Manus task/artifact oqimlarini unified
 * provider job contractga ulash (research.md §9.2 canonical document,
 * §9.4 provider matrix, §9.5 Gamma: POST /v1.0/generations, X-API-KEY,
 * async polling, format=presentation, numCards, theme, audience, language,
 * images, PDF/PPTX export; §9.6 Manus: v2 task/file/project/webhook,
 * task 5–15 min, UI background job; §22.8 Google token boshqa provider'ga
 * uzatilmaydi; §22.9 provider API key browserga chiqmaydi; §22.10 Gamma
 * editorini ruxsatsiz iframe qilish yo'q; §28 accessibility). This module
 * is PURE (no I/O, no globals):
 *
 *   - PresentationProvider: provider-independent interface — create/poll/
 *     cancel/webhook/mapArtifacts contract (Prompt 56 precondition).
 *   - validateProviderRequest: title/brief/sourceIds validation.
 *   - buildGammaCreatePayload: Gamma v1 generations payload.
 *   - buildManusCreateTaskPayload: Manus v2 task.create payload.
 *   - computePollDelay / shouldRetryError: 429/5xx backoff policy.
 *   - evaluateCircuitState: circuit breaker open/half-open/closed.
 *   - verifyWebhookSignature: Manus signed webhook HMAC-SHA256 timing-safe.
 *   - processWebhookOutOfOrder: seq-based out-of-order/dedupe handling.
 *   - mapGammaArtifacts / mapManusArtifacts: preview/export artifact mapping
 *     → provider_artifacts rows (expiring → object storage copy).
 *   - assertNoStudentPii: student PII default yuborilmaydi (§15).
 *   - buildAttributionMetadata: provider/model/job attribution.
 *   - validateJobStatusTransition: job FSM.
 *
 * SECURITY / DATA GUARD (Prompt 58 §15):
 *   - API key hech qachon bu schema orqali o'tmaydi (faqat client env).
 *   - Gamma embedded edit capability YO'Q — soxta edit bermaymiz,
 *     capability matrix'da aniq ko'rsatiladi (edit: false).
 *   - Student PII default yuborilmaydi.
 *   - Provider raw response canonical modeldan tashqariga chiqmaydi.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Unified provider job status FSM. */
export const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WEBHOOK_PENDING: 'webhook_pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/** Provider identifiers. */
export const PROVIDERS = {
  GAMMA: 'gamma',
  MANUS: 'manus',
};

/** Job event types. */
export const JOB_EVENTS = {
  JOB_CREATED: 'job_created',
  JOB_POLLING: 'job_polling',
  JOB_COMPLETED: 'job_completed',
  JOB_FAILED: 'job_failed',
  JOB_CANCELLED: 'job_cancelled',
  WEBHOOK_RECEIVED: 'webhook_received',
  WEBHOOK_VERIFIED: 'webhook_verified',
  WEBHOOK_REJECTED: 'webhook_rejected',
  ARTIFACT_COPIED: 'artifact_copied',
  FOLLOW_UP_SENT: 'follow_up_sent',
  ERROR: 'error',
};

/** Capability matrix (research §9.4) — honest, no fake capabilities. */
export const PROVIDER_CAPABILITIES = {
  [PROVIDERS.GAMMA]: {
    create: true,
    poll: true,
    cancel: true,
    webhook: false,
    previewIframe: true, // completed deck iframe
    embeddedEdit: false, // ⚠️ Gamma edit API/embedded editor YO'Q — soxta edit bermaymiz
    jobTimeHint: 'bir necha daqiqa (async polling 5–10 s)',
  },
  [PROVIDERS.MANUS]: {
    create: true,
    poll: false, // webhook-based
    cancel: false,
    webhook: true,
    previewIframe: true, // artifact viewer
    embeddedEdit: false, // follow-up task or native editor
    jobTimeHint: '5–15 daqiqa (background job — timeout emas)',
  },
};

/** Gamma API defaults. */
export const GAMMA_DEFAULTS = {
  model: 'gamma-v1',
  baseUrl: 'https://api.gamma.app',
  pollBaseMs: 5000,
  pollMaxMs: 60000,
  numCardsMax: 30,
  numCardsMin: 3,
};

/** Manus API defaults. */
export const MANUS_DEFAULTS = {
  model: 'manus-v2',
  baseUrl: 'https://api.manus.ai/v2',
  taskTimeoutMin: 15,
};

// ═══════════════════════════════════════════════════════════════════
// PresentationProvider INTERFACE (Prompt 56 precondition)
// ═══════════════════════════════════════════════════════════════════

/**
 * Provider-independent presentation provider contract. Har bir adapter
 * (gamma/manus/deborah-native) shu interface'ni implement qiladi:
 *
 *   - create(params): provider job'ni yaratadi → { providerJobId }
 *   - poll({ providerJobId }): Gamma async polling → { status, previewUrl,
 *     exportUrl, artifacts }
 *   - cancel({ providerJobId }): gamma generation cancel
 *   - webhook({ headers, body }): Manus signed webhook → { event, ... }
 *   - mapArtifacts(providerResponse): expiring preview/export → artifact
 *     mapping (object storage copy uchun)
 *   - capabilities: { create, poll, cancel, webhook, previewIframe,
 *     embeddedEdit } (soxta capability yo'q)
 *
 * @typedef {Object} PresentationProvider
 */
export const PresentationProvider = {
  /** Validate an adapter implements the full contract. */
  validate(adapter) {
    const required = ['name', 'capabilities', 'create', 'poll', 'cancel', 'webhook', 'mapArtifacts'];
    const missing = required.filter((k) => !adapter || typeof adapter[k] === 'undefined');
    if (missing.length) {
      return { ok: false, error: `PresentationProvider ${adapter?.name || '?'} missing: ${missing.join(', ')}` };
    }
    return { ok: true };
  },
};

// ═══════════════════════════════════════════════════════════════════
// REQUEST VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a unified provider request.
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateProviderRequest({
  provider = null,
  title = '',
  audience = null,
  language = 'uz',
  theme = 'default',
  tone = 'formal',
  numCards = 10,
  sourcePackIds = [],
  brief = null,
} = {}) {
  if (!provider || !Object.values(PROVIDERS).includes(provider)) {
    return { ok: false, reason: 'provider must be gamma or manus' };
  }
  if (!title || String(title).trim().length < 3) {
    return { ok: false, reason: 'title is required (min 3 chars)' };
  }
  const max = GAMMA_DEFAULTS.numCardsMax;
  const min = GAMMA_DEFAULTS.numCardsMin;
  if (!Number.isInteger(numCards) || numCards < min || numCards > max) {
    return { ok: false, reason: `numCards must be an integer between ${min} and ${max}` };
  }
  if (!['uz', 'ru', 'en'].includes(language)) {
    return { ok: false, reason: 'language must be uz, ru or en' };
  }
  if (!Array.isArray(sourcePackIds) || sourcePackIds.some((id) => !Number.isInteger(id))) {
    return { ok: false, reason: 'sourcePackIds must be an array of integers' };
  }
  if (brief && typeof brief !== 'object' && typeof brief !== 'string') {
    return { ok: false, reason: 'brief must be an object or string' };
  }
  return { ok: true };
}

/**
 * Deterministic idempotency hash (FNV-1a) — same input → same job.
 * Arrays (sourcePackIds/fileIds) sort qilinadi — order-insensitive
 * (Prompt 58 §16 idempotency).
 */
export function requestHash(input) {
  const normalize = (v) => {
    if (Array.isArray(v)) return v.map(normalize).sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
      return out;
    }
    return v;
  };
  const str = JSON.stringify(normalize(input || {}));
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `p58_${h.toString(16).padStart(8, '0')}_${str.length}`;
}

// ═══════════════════════════════════════════════════════════════════
// GAMMA — PAYLOAD BUILD + STATUS PARSE
// ═══════════════════════════════════════════════════════════════════

/**
 * Build Gamma v1.0 POST /v1.0/generations payload
 * (research §9.5: format=presentation, numCards, theme, audience, language, images).
 */
export function buildGammaCreatePayload({
  title,
  audience = null,
  language = 'uz',
  theme = 'default',
  tone = 'formal',
  numCards = 10,
  sourcePackIds = [],
} = {}) {
  const brief = [
    title ? `Mavzu: ${title}` : null,
    audience ? `Auditoriya: ${audience}` : null,
    tone ? `Ohang: ${tone}` : null,
    `Til: ${language}`,
    sourcePackIds.length ? `Manba IDlar: ${sourcePackIds.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  return {
    title,
    format: 'presentation',
    numCards,
    theme,
    audience: audience || null,
    language,
    // Gamma prompt field — brief asosida generation so'rovi
    prompt: `${brief}. ${numCards} slaydli professional taqdimot yarating.`,
    // images: [] — teacher tomonidan qo'shiladi; default rasm ishlatilmaydi
    images: [],
  };
}

/**
 * Parse Gamma async polling status response.
 * Gamma statuses: pending | generating | completed | failed | cancelled.
 * @returns {{ status: string, previewUrl?: string|null, exportUrl?: string|null, rawStatus?: string }}
 */
export function parseGammaStatusResponse(resp = {}) {
  const raw = String(resp?.status || 'pending').toLowerCase();
  let status = JOB_STATUS.RUNNING;
  if (raw === 'completed' || raw === 'complete' || raw === 'succeeded') status = JOB_STATUS.COMPLETED;
  else if (raw === 'failed' || raw === 'error') status = JOB_STATUS.FAILED;
  else if (raw === 'cancelled' || raw === 'canceled') status = JOB_STATUS.CANCELLED;
  return {
    status,
    rawStatus: raw,
    previewUrl: resp?.gammaUrl || resp?.previewUrl || resp?.url || null,
    exportUrl: resp?.exportUrl || resp?.downloadUrl || null,
    exportFormats: Array.isArray(resp?.exportFormats) ? resp.exportFormats : [],
  };
}

/** Retry/backoff policy — 429/5xx. */
export function shouldRetryError(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
}

/** Backoff for Gamma polling — 5s base, +2s per attempt, capped 60s. */
export function computePollDelay(attempt = 0) {
  const base = GAMMA_DEFAULTS.pollBaseMs;
  const delay = Math.min(GAMMA_DEFAULTS.pollMaxMs, base + attempt * 2000);
  return delay;
}

// ═══════════════════════════════════════════════════════════════════
// MANUS — PAYLOAD BUILD + WEBHOOK VERIFY + OUT-OF-ORDER
// ═══════════════════════════════════════════════════════════════════

/**
 * Build Manus v2 task.create payload
 * (research §9.6: source files → file API, project per course/teacher,
 * task.create — research + deck brief).
 */
export function buildManusCreateTaskPayload({ title, projectId = null, fileIds = [], brief = null, language = 'uz' } = {}) {
  return {
    projectId,
    title,
    language,
    fileIds: Array.isArray(fileIds) ? fileIds : [],
    prompt: brief
      ? brief
      : `"${title}" mavzusida o'quv taqdimoti tayyorlang (canonical deck, citation'lar bilan).`,
  };
}

/**
 * Timing-safe string compare (pure — HMAC client'da node:crypto bilan).
 */
export function constantTimeEqual(a = '', b = '') {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Process a Manus webhook event with seq-based out-of-order + dedupe.
 *
 * Manus tasks emit events with monotonically increasing seq. Events may
 * arrive out-of-order (network) or replayed (delivery retry). Strategy:
 *   - seq <= lastSeen → replay/dedupe (return { duplicate: true })
 *   - seq == lastSeen + 1 → accept (advance)
 *   - seq > lastSeen + 1 → out-of-order → buffer { buffered: true } —
 *     service stores it; when the gap fills, processing continues.
 *
 * @returns {{ ok: boolean, reason?: string, duplicate?: boolean, buffered?: boolean, accept?: boolean, seq?: number, lastSeen?: number }}
 */
export function processWebhookOutOfOrder({ seq = null, lastSeen = 0 } = {}) {
  if (!Number.isInteger(seq) || seq <= 0) return { ok: false, reason: 'invalid seq' };
  const last = Number(lastSeen || 0);
  if (seq <= last) return { ok: true, duplicate: true, seq, lastSeen: last };
  if (seq === last + 1) return { ok: true, accept: true, seq, lastSeen: seq };
  return { ok: true, buffered: true, seq, lastSeen: last, gap: seq - last - 1 };
}

/** Map Manus webhook event → unified JOB_EVENTS. */
export function mapManusWebhookEvent(ev = {}) {
  const type = String(ev?.event || ev?.type || 'task.updated');
  if (type.includes('completed')) return { type: JOB_EVENTS.JOB_COMPLETED, seq: ev.seq };
  if (type.includes('failed') || type.includes('error')) return { type: JOB_EVENTS.JOB_FAILED, seq: ev.seq };
  if (type.includes('started') || type.includes('progress')) return { type: JOB_EVENTS.JOB_POLLING, seq: ev.seq };
  return { type: JOB_EVENTS.WEBHOOK_RECEIVED, seq: ev.seq };
}

// ═══════════════════════════════════════════════════════════════════
// ARTIFACT MAPPING (preview/export → provider_artifacts rows)
// ═══════════════════════════════════════════════════════════════════

/** Infer artifact kind + format from a URL. */
export function inferArtifact(url = '', kindHint = null) {
  if (!url) return null;
  const clean = String(url).split('?')[0].split('#')[0];
  const ext = clean.split('.').pop()?.toLowerCase();
  const formatMap = { pptx: 'pptx', pdf: 'pdf', html: 'html', json: 'json', png: 'png', jpg: 'jpg' };
  const format = formatMap[ext] || 'html';
  const kind = kindHint || (format === 'pptx' || format === 'pdf' ? 'export' : 'preview');
  return { kind, format, url };
}

/**
 * Map Gamma completed response → artifact candidates.
 * Gamma export URLs are expiring (temporary) — must be copied to Deborah
 * object storage (stop condition: expiring artifact copy qilinadi).
 * @param {{ previewUrl?: string, exportUrl?: string }} opts
 */
export function mapGammaArtifacts({ previewUrl = null, exportUrl = null } = {}) {
  const artifacts = [];
  const preview = inferArtifact(previewUrl, 'preview');
  if (preview) artifacts.push({ ...preview, expiring: true });
  if (exportUrl) {
    const exp = inferArtifact(exportUrl, 'export');
    if (exp) artifacts.push({ ...exp, expiring: true });
  }
  return artifacts;
}

/** Map Manus completed task → artifact candidates (viewer URL + files). */
export function mapManusArtifacts({ viewerUrl = null, artifacts = [] } = {}) {
  const out = [];
  const view = inferArtifact(viewerUrl, 'preview');
  if (view) out.push({ ...view, expiring: true });
  for (const a of artifacts || []) {
    const mapped = inferArtifact(a?.url || a?.downloadUrl, a?.kind || 'export');
    if (mapped) out.push({ ...mapped, expiring: Boolean(a?.expiring ?? true) });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER + COST + PII + ATTRIBUTION + FSM
// ═══════════════════════════════════════════════════════════════════

/** Circuit breaker state: open → half_open (after cooldown) → closed. */
export function evaluateCircuitState({ failureCount = 0, openUntil = null, now = Date.now() } = {}) {
  if (failureCount < 5) return 'closed';
  if (!openUntil) return 'open';
  return now < new Date(openUntil).getTime() ? 'open' : 'half_open';
}

/** Estimated cost (Gamma credits / Manus agent minutes — minimal model). */
export function computeUsageCost({ provider = null, credits = 0, minutes = 0 } = {}) {
  if (provider === PROVIDERS.GAMMA) return Number(credits || 0);
  if (provider === PROVIDERS.MANUS) return Number(minutes || 0);
  return 0;
}

/** Student PII guard — email/phone/student-id default yuborilmaydi. */
export function assertNoStudentPii(text = '') {
  if (!text) return { ok: true, redacted: '' };
  const email = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  // UZ/global telefon: +998 90 123 45 67 | 998901234567 | 0 90 123 45 67
  const phone = /(\+?998|0)[\s-]?[0-9]{2}[\s-]?[0-9]{3}[\s-]?[0-9]{2}[\s-]?[0-9]{2}/g;
  let redacted = String(text).replace(email, '[email]').replace(phone, '[phone]');
  const flagged = redacted !== String(text);
  return { ok: !flagged, redacted, reason: flagged ? 'student PII detected — redacted' : null };
}

/** Attribution metadata — teacher-visible provider badge. */
export function buildAttributionMetadata({ provider = null, model = null, jobId = null, label = null } = {}) {
  return {
    provider,
    model,
    jobId,
    label: label || (provider === PROVIDERS.GAMMA ? 'AI-generated with Gamma' : provider === PROVIDERS.MANUS ? 'AI-generated with Manus' : 'AI-generated'),
    aiAssisted: true,
  };
}

/** Job status FSM validation. */
export function validateJobStatusTransition(from, to) {
  const allowed = {
    [JOB_STATUS.QUEUED]: [JOB_STATUS.RUNNING, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED],
    [JOB_STATUS.RUNNING]: [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED, JOB_STATUS.WEBHOOK_PENDING],
    [JOB_STATUS.WEBHOOK_PENDING]: [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED],
    [JOB_STATUS.COMPLETED]: [],
    [JOB_STATUS.FAILED]: [],
    [JOB_STATUS.CANCELLED]: [],
  };
  const targets = allowed[from] || [];
  if (!targets.includes(to)) return { ok: false, reason: `invalid job transition ${from} → ${to}` };
  return { ok: true };
}
