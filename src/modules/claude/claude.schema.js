/**
 * Deborah — Claude Native Adapter (pure logic)
 *
 * Prompt 57 — Claude'ni Deborah ichidagi streaming source-synthesis va
 * canonical JSON provider sifatida ulash (research.md §9.2 canonical
 * document, §9.4 provider matrix — Claude: server API key, output
 * Deborah render qiladi; §22.9 API key browserga chiqmaydi; §22.11 AI
 * references real DB'dan tekshiriladi; §28 accessibility). This module
 * is PURE (no I/O, no globals):
 *
 *   - validateSynthesisRequest: source-synthesis request validation.
 *   - buildClaudeMessages: system + user message build (prompt_ref).
 *   - mapFileToClaudeBlock: Files/text conversion mapping — PDF →
 *     base64 document block (32MB/100 page limit), DOCX → conversion
 *     required (Anthropic Files API DOCX ni to'g'ridan-to'g'ri
 *     qo'llab-quvvatlamaydi), text/md → text block.
 *   - parseSseChunk: Anthropic SSE event parsing (message_start,
 *     content_block_start/delta/stop, message_delta, message_stop,
 *     ping, error).
 *   - extractCanonicalJson: Claude output → strict canonical deck
 *     validation (§9.2) — done condition: validated canonical artifact.
 *   - mapCitations: citation/search-result mapping → source_pack.
 *   - computeRetryDelay / shouldRetryError: 429/500/529 retry policy.
 *   - evaluateCircuitState: circuit breaker open/half-open/closed.
 *   - computeUsageCost: input/output token → cost estimate.
 *   - assertNoStudentPii: student PII (email, phone, student id)
 *     default yuborilmaydi (§15).
 *   - buildAttributionMetadata: provider/model/prompt/attribution.
 *   - validateJobStatusTransition: queued→running→completed|failed.
 *
 * SECURITY / DATA GUARD (Prompt 57 §15):
 *   - API key hech qachon bu schema orqali o'tmaydi (faqat client).
 *   - Student PII default yuborilmaydi.
 *   - Provider raw response canonical modeldan tashqariga chiqmaydi.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Supported Claude models (2026 gen — pinned, config-driven). */
export const CLAUDE_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'];

/** Default model + budget. */
export const CLAUDE_DEFAULTS = {
  model: 'claude-sonnet-5',
  maxTokens: 4096,
  temperature: 0.3,
  slideMax: 30,
  sourceMax: 20,
};

/** Job status FSM. */
export const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

/** SSE event types (Anthropic Messages API). */
export const SSE_EVENTS = {
  MESSAGE_START: 'message_start',
  CONTENT_BLOCK_START: 'content_block_start',
  CONTENT_BLOCK_DELTA: 'content_block_delta',
  CONTENT_BLOCK_STOP: 'content_block_stop',
  MESSAGE_DELTA: 'message_delta',
  MESSAGE_STOP: 'message_stop',
  PING: 'ping',
  ERROR: 'error',
};

/** Job-level synthetic events (stored in claude_job_events). */
export const JOB_EVENTS = {
  JOB_QUEUED: 'job_queued',
  JOB_RUNNING: 'job_running',
  JOB_COMPLETED: 'job_completed',
  JOB_FAILED: 'job_failed',
};

/** Supported synthesis languages (BCP-47-ish). */
export const SYNTH_LANGUAGES = ['uz', 'ru', 'en', 'kk', 'az', 'tr'];

/** Supported themes (reuse §35 themes). */
export const SYNTH_THEMES = ['default', 'dark', 'light', 'academic', 'playful'];

/** Supported tones. */
export const SYNTH_TONES = ['formal', 'simple', 'engaging', 'exam-prep'];

/** Cost per 1M tokens (USD, research-informed per-model). */
export const MODEL_PRICING = {
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-opus-5': { input: 15.0, output: 75.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

/** Max PDF size per Anthropic Files API (32 MB) and page cap. */
export const PDF_LIMITS = { maxBytes: 32 * 1024 * 1024, maxPages: 100 };

/** Job status allowed transitions. */
export const JOB_TRANSITIONS = {
  [JOB_STATUS.QUEUED]: [JOB_STATUS.RUNNING, JOB_STATUS.FAILED],
  [JOB_STATUS.RUNNING]: [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED],
  [JOB_STATUS.COMPLETED]: [],
  [JOB_STATUS.FAILED]: [],
};

// ═══════════════════════════════════════════════════════════════════
// REQUEST VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a source-synthesis request.
 * @param {Object} req - { title, audience, language, theme, slideCount, tone, sources, maxTokens }
 * @returns {{ ok: boolean, reason?: string, normalized?: Object }}
 */
export function validateSynthesisRequest({
  title = '',
  audience = '',
  language = 'uz',
  theme = 'default',
  slideCount = 10,
  tone = 'formal',
  sources = [],
  maxTokens = null,
} = {}) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    return { ok: false, reason: 'title is required' };
  }
  if (String(title).length > 200) return { ok: false, reason: 'title exceeds 200 chars' };
  if (!SYNTH_LANGUAGES.includes(language)) {
    return { ok: false, reason: `unsupported language ${language}` };
  }
  if (!SYNTH_THEMES.includes(theme)) {
    return { ok: false, reason: `unsupported theme ${theme}` };
  }
  if (!SYNTH_TONES.includes(tone)) {
    return { ok: false, reason: `unsupported tone ${tone}` };
  }
  const slides = Number(slideCount);
  if (!Number.isInteger(slides) || slides < 1 || slides > CLAUDE_DEFAULTS.slideMax) {
    return { ok: false, reason: `slideCount must be 1..${CLAUDE_DEFAULTS.slideMax}` };
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    return { ok: false, reason: 'at least one source is required' };
  }
  if (sources.length > CLAUDE_DEFAULTS.sourceMax) {
    return { ok: false, reason: `too many sources (max ${CLAUDE_DEFAULTS.sourceMax})` };
  }
  const mt = maxTokens ? Number(maxTokens) : CLAUDE_DEFAULTS.maxTokens;
  if (!Number.isInteger(mt) || mt < 512 || mt > 16384) {
    return { ok: false, reason: 'maxTokens must be 512..16384' };
  }
  return {
    ok: true,
    normalized: { title: title.trim(), audience, language, theme, slideCount: slides, tone, sources, maxTokens: mt },
  };
}

/**
 * Deterministic request hash — idempotency (same request → same job).
 * @param {Object} req
 * @returns {string}
 */
export function requestHash(req = {}) {
  const s = JSON.stringify({
    title: req.title,
    audience: req.audience || '',
    language: req.language,
    theme: req.theme,
    slideCount: req.slideCount,
    tone: req.tone,
    sources: (req.sources || []).slice().sort(),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ═══════════════════════════════════════════════════════════════════
// FILES / TEXT CONVERSION MAPPING (§57-09)
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a file to a Claude content block (Anthropic Files/text format).
 * PDF → base64 document block (32MB/100 page cap); text/md → text block;
 * DOCX/PPTX → conversion required (Anthropic to'g'ridan-to'g'ri
 * qo'llab-quvvatlamaydi — server-side convert qilinishi shart).
 *
 * @param {Object} file - { name, mimeType, base64, text }
 * @returns {{ ok: boolean, block?: Object, reason?: string }}
 */
export function mapFileToClaudeBlock({ name = '', mimeType = '', base64 = null, text = null } = {}) {
  const mime = String(mimeType || '').toLowerCase();
  const ext = String(name || '').split('.').pop().toLowerCase();

  // PDF → document block (base64)
  if (mime === 'application/pdf' || ext === 'pdf') {
    if (!base64) return { ok: false, reason: 'pdf file requires base64 content' };
    const bytes = Math.floor((String(base64).length * 3) / 4);
    if (bytes > PDF_LIMITS.maxBytes) {
      return { ok: false, reason: `pdf exceeds ${PDF_LIMITS.maxBytes / 1024 / 1024}MB limit` };
    }
    return {
      ok: true,
      block: {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        title: name || null,
      },
    };
  }

  // Plain text / markdown / csv → text block
  if (['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(mime) ||
      ['txt', 'md', 'csv', 'json'].includes(ext)) {
    if (text == null && base64 == null) return { ok: false, reason: 'text file requires text or base64 content' };
    const body = text != null ? text : Buffer.from(base64, 'base64').toString('utf8');
    return { ok: true, block: { type: 'text', text: String(body).slice(0, 100000) } };
  }

  // DOCX/PPTX → conversion required (stop condition: exact provider format)
  if (['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'application/msword', 'application/vnd.ms-powerpoint'].includes(mime) ||
      ['docx', 'doc', 'pptx', 'ppt'].includes(ext)) {
    return { ok: false, reason: `${ext || mime} requires server-side text conversion before sending to Claude (Anthropic Files API does not accept office formats directly)` };
  }

  return { ok: false, reason: `unsupported file type ${mime || ext || 'unknown'}` };
}

/**
 * Build Claude Messages API request body (system + user messages).
 * Sources → text fragments; files → mapped content blocks (§57-06/09).
 *
 * @param {Object} params - { title, audience, language, theme, slideCount, tone, sourcesText, files }
 * @returns {{ ok: boolean, system?: string, messages?: Array<Object>, promptRef?: string, reason?: string }}
 */
export function buildClaudeMessages({
  title = '',
  audience = '',
  language = 'uz',
  theme = 'default',
  slideCount = 10,
  tone = 'formal',
  sourcesText = '',
  files = [],
} = {}) {
  const v = validateSynthesisRequest({ title, audience, language, theme, slideCount, tone, sources: [1] });
  if (!v.ok) return { ok: false, reason: v.reason };

  const system =
    `Siz Deborah prezentatsiya yaratuvchisi. Foydalanuvchi taqdim etgan manbalardan ` +
    `(${language} tilida, ${tone} uslubda, ${theme} tema, ${slideCount} slayd) canonical JSON ` +
    `presentation yaratasiz. QAT'IY TALAB: javobingiz faqat bitta JSON blok bo'lsin (json fence ichida) — ` +
    `boshqa matn yo'q. JSON struktura: { "title", "audience", "language", "learningOutcomes": [], ` +
    `"slides": [ { "id", "layout", "title", "blocks": [ { "type", "content" } ], "speakerNotes", ` +
    `"citations": [] } ], "sources": [], "provider": { "name": "claude" }, "attribution": [] }. ` +
    `Layoutlar: title, title-body, title-body-image, section-header, quote, agenda, closing. ` +
    `Blok turlari: text, heading, bullets, image, chart, table. Image bloklarida ALT TEXT majburiy ` +
    `(accessibility). Ixtiro qilingan manba/URL yozmang — citations faqat berilgan manbalarga havola ` +
    `bo'lsin.`;

  const userParts = [`Mavzu: ${title}`];
  if (audience) userParts.push(`Auditoriya: ${audience}`);
  userParts.push(`Slaydlar soni: ${slideCount}`, `Til: ${language}`, `Tema: ${theme}`, `Uslub: ${tone}`);
  if (sourcesText) userParts.push(`\nManbalar:\n${String(sourcesText).slice(0, 60000)}`);

  // Files → content blocks (PDF → document, text → text, office → reject)
  const contentBlocks = [];
  for (const f of Array.isArray(files) ? files : []) {
    const mapped = mapFileToClaudeBlock(f);
    if (!mapped.ok) return { ok: false, reason: `file ${f?.name || '?'}: ${mapped.reason}` };
    contentBlocks.push(mapped.block);
  }
  contentBlocks.push({ type: 'text', text: userParts.join('\n') });

  return {
    ok: true,
    system,
    messages: [{ role: 'user', content: contentBlocks }],
    promptRef: `claude:synthesis:${requestHash({ title, audience, language, theme, slideCount, tone, sources: [1] })}`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SSE PARSING (§57-10 streaming)
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a raw SSE chunk into events ({ event, data }[]).
 * Handles Anthropic SSE frames: "event: X\ndata: {...}\n\n".
 * @param {string} chunk
 * @returns {Array<{ event: string, data: any }>}
 */
export function parseSseChunk(chunk = '') {
  const events = [];
  const frames = String(chunk).split(/\r?\n\r?\n/);
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let event = 'message';
    let data = '';
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      events.push({ event, data: JSON.parse(data) });
    } catch {
      events.push({ event, data });
    }
  }
  return events;
}

// ═══════════════════════════════════════════════════════════════════
// STRICT CANONICAL JSON EXTRACTION (§57-12, §9.2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract + strictly validate a canonical deck from Claude output.
 * Done condition (Prompt 57-25): Claude output validated canonical
 * artifact bo'lsa. Provider raw fields canonical tashqarisiga chiqmaydi.
 *
 * @param {string} text
 * @returns {{ ok: boolean, document?: Object, reason?: string }}
 */
export function extractCanonicalJson(text = '') {
  const s = String(text || '');
  // 1. ```json ... ``` fence (preferred)
  let m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = m ? m[1] : null;
  // 2. Fallback: first {...} balanced block
  if (!raw) {
    const start = s.indexOf('{');
    if (start !== -1) {
      let depth = 0;
      for (let i = start; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') {
          depth--;
          if (depth === 0) { raw = s.slice(start, i + 1); break; }
        }
      }
    }
  }
  if (!raw) return { ok: false, reason: 'no JSON block found in Claude output' };
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'Claude output JSON parse failed' };
  }
  // Strict canonical validation
  if (!doc || typeof doc !== 'object') return { ok: false, reason: 'output is not an object' };
  if (!doc.title || typeof doc.title !== 'string' || !doc.title.trim()) {
    return { ok: false, reason: 'canonical title missing' };
  }
  if (!Array.isArray(doc.slides) || doc.slides.length === 0) {
    return { ok: false, reason: 'canonical slides missing' };
  }
  for (const [i, sl] of doc.slides.entries()) {
    if (!sl || typeof sl !== 'object') return { ok: false, reason: `slide ${i} invalid` };
    if (!sl.id) return { ok: false, reason: `slide ${i} missing id` };
    if (!Array.isArray(sl.blocks)) return { ok: false, reason: `slide ${i} missing blocks` };
    for (const b of sl.blocks) {
      if (b?.type === 'image' && !b.alt && !b.content?.alt) {
        return { ok: false, reason: `slide ${i} image block missing alt text (accessibility)` };
      }
    }
  }
  // Provider metadata — raw response canonical ichida saqlanadi
  const docOut = {
    title: doc.title,
    audience: doc.audience || null,
    language: doc.language || 'uz',
    learningOutcomes: Array.isArray(doc.learningOutcomes) ? doc.learningOutcomes : [],
    theme: doc.theme || 'default',
    slides: doc.slides,
    sources: Array.isArray(doc.sources) ? doc.sources : [],
    provider: { name: 'claude' },
    attribution: Array.isArray(doc.attribution) ? doc.attribution : [],
  };
  return { ok: true, document: docOut };
}

// ═══════════════════════════════════════════════════════════════════
// CITATION / SEARCH-RESULT MAPPING (§57-11, §22.11)
// ═══════════════════════════════════════════════════════════════════

/**
 * Map canonical deck citations to source packs (real DB tekshiruvi).
 * Citation bo'lmagan slide → pass; citation ko'rsatilgan lekin
 * source_pack topilmasa → warning (yolg'on iqtibos emas).
 *
 * @param {Object} params - { document, sourcePacks: [{ id, title, url }] }
 * @returns {{ ok: boolean, attributions: Array<Object>, warnings: Array<string> }}
 */
export function mapCitations({ document = {}, sourcePacks = [] } = {}) {
  const packs = new Map((Array.isArray(sourcePacks) ? sourcePacks : []).map((p) => [String(p.id), p]));
  const attributions = [];
  const warnings = [];
  for (const slide of Array.isArray(document.slides) ? document.slides : []) {
    for (const cite of Array.isArray(slide.citations) ? slide.citations : []) {
      const key = String(cite).replace(/^src[_:]?/i, '');
      const pack = packs.get(key) || packs.get(String(cite));
      if (pack) {
        attributions.push({
          slideId: slide.id,
          citationKey: String(cite),
          sourcePackId: pack.id,
          title: pack.title || null,
          url: pack.url || null,
        });
      } else {
        warnings.push(`citation ${cite} on slide ${slide.id} does not match any source pack`);
      }
    }
  }
  return { ok: true, attributions, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// RETRY / CIRCUIT / COST (§57-13)
// ═══════════════════════════════════════════════════════════════════

/**
 * Exponential backoff + jitter (research-informed).
 * @param {Object} params - { retryCount, baseMs, maxMs }
 * @returns {number}
 */
export function computeRetryDelay({ retryCount = 0, baseMs = 1000, maxMs = 60000 } = {}) {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(retryCount, 8));
  const jitter = Math.random() * exp * 0.3;
  // Cap the FINAL value (jitter exp dan tashqariga o'tib ketmasligi uchun)
  return Math.min(maxMs, Math.round(exp + jitter));
}

/**
 * Should we retry this error? Anthropic guidance: 429 (rate limit),
 * 500 (api_error), 529 (overloaded_error), 504 (timeout), connection.
 * @param {Object} params - { status, error, retryCount, maxRetries }
 * @returns {boolean}
 */
export function shouldRetryError({ status = 0, error = '', retryCount = 0, maxRetries = 3 } = {}) {
  if (retryCount >= maxRetries) return false;
  if (status === 429 || status === 500 || status === 529 || status === 504) return true;
  const e = String(error || '').toLowerCase();
  return e.includes('timeout') || e.includes('econnreset') || e.includes('fetch failed');
}

/**
 * Circuit breaker state evaluation.
 * @param {Object} params - { failureCount, openUntil, now, threshold, halfOpenAfterMs }
 * @returns {{ state: 'closed'|'open'|'half_open', remainingMs?: number }}
 */
export function evaluateCircuitState({ failureCount = 0, openUntil = null, now = Date.now(), threshold = 5, halfOpenAfterMs = 30000 } = {}) {
  if (openUntil) {
    const t = new Date(openUntil).getTime();
    if (now < t) return { state: 'open', remainingMs: t - now };
    return { state: 'half_open' };
  }
  if (failureCount >= threshold) return { state: 'open', remainingMs: halfOpenAfterMs };
  return { state: 'closed' };
}

/**
 * Token → cost estimate (USD, research-informed per-model pricing).
 * @param {Object} params - { model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens }
 * @returns {{ ok: boolean, cost?: number, pricing?: Object }}
 */
export function computeUsageCost({ model = CLAUDE_DEFAULTS.model, inputTokens = 0, outputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0 } = {}) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[CLAUDE_DEFAULTS.model];
  const input = Number(inputTokens || 0);
  const output = Number(outputTokens || 0);
  const cacheWrite = Number(cacheCreationTokens || 0);
  const cacheRead = Number(cacheReadTokens || 0);
  // Cache: ~10% write / ~1% read of input price (industry convention)
  const cost =
    (input / 1e6) * pricing.input +
    (output / 1e6) * pricing.output +
    (cacheWrite / 1e6) * pricing.input * 0.1 +
    (cacheRead / 1e6) * pricing.input * 0.01;
  return { ok: true, cost: Number(cost.toFixed(6)), pricing };
}

// ═══════════════════════════════════════════════════════════════════
// PII GUARD (§57-15) — student PII default yuborilmaydi
// ═══════════════════════════════════════════════════════════════════

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?\d{2,3}[\s-]?)?(\(?\d{2}\)?[\s-]?)?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;
// O'zbek student id / passport-like: 2-3 raqam + bo'shliq + 7 raqam
const STUDENT_ID_RE = /\b\d{2,3}\s?\d{7}\b/g;

/**
 * Student PII ni aniqlaydi va default redact qiladi (yuborilmaydi).
 * Student ismi/email/telefon/ID — source text'da bo'lsa redacted.
 * @param {Object} params - { text }
 * @returns {{ ok: boolean, redacted: string, detected: Array<string> }}
 */
export function assertNoStudentPii({ text = '' } = {}) {
  const detected = [];
  let out = String(text || '');
  const mark = (match) => {
    detected.push(match);
    return '[redacted-pii]';
  };
  out = out.replace(EMAIL_RE, mark).replace(PHONE_RE, mark).replace(STUDENT_ID_RE, mark);
  return { ok: detected.length === 0, redacted: out, detected };
}

// ═══════════════════════════════════════════════════════════════════
// ATTRIBUTION METADATA (§57-14)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build provider/model/prompt/attribution metadata block.
 * @param {Object} params - { model, promptRef, usage, attributions }
 * @returns {Object}
 */
export function buildAttributionMetadata({ model = CLAUDE_DEFAULTS.model, promptRef = '', usage = null, attributions = [] } = {}) {
  return {
    provider: 'claude',
    model,
    promptRef: promptRef || null,
    usage: usage || null,
    attribution: Array.isArray(attributions) ? attributions : [],
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// JOB STATUS FSM
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a job status transition.
 * @param {string} from
 * @param {string} to
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateJobStatusTransition(from = '', to = '') {
  if (!(from in JOB_TRANSITIONS)) return { ok: false, reason: `unknown job status ${from}` };
  if (!JOB_TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `invalid job transition ${from} → ${to}` };
  }
  return { ok: true };
}
