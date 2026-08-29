/**
 * Deborah — Source Pack & Secure RAG Ingestion (pure logic)
 *
 * Prompt 50 — teacher-approved source'larni provenance/citation bilan safe
 * corpusga aylantirish (research.md §20 Phase 4 "source pack/RAG", §22.11
 * "AI referencesni real database'dan tekshirmasdan ko'rsatma", §27.4
 * "savollar submission/source/rubricga grounded"). This module is PURE
 * (no I/O, no globals):
 *
 *   - SSRF validation: validateSourceUrl — private/link-local/metadata IP
 *     blok, DNS rebinding eslatmasi, faqat http/https.
 *   - Safe upload: validateSourceUpload — MIME + extension + magic-byte
 *     allowlist, size chegarasi, binar fayl tekshiruvi.
 *   - Extraction: planExtraction + chunkText — deterministic chunking
 *     (maxChars + overlap), page/char provenance.
 *   - HTML/instruction isolation: isolateHtmlContent — script/iframe/style/
 *     event-handler/javascript: URL olib tashlash; detectInstructionMarkers
 *     — prompt-injection markerlar (document text system instruction EMAS).
 *   - Provenance: buildChunkProvenance — source/page/chunk/char/quote.
 *   - Embedding: buildEmbeddingNamespace — tenant-scoped namespace
 *     (tenant:{id}:model:{model}:v:{version}); assertTenantVectorScope —
 *     cross-tenant retrieval TAQIQLANADI.
 *   - Citation contract: validateCitationClaim — claim ↔ chunk quote
 *     integrity (AI reference real DB'dagi chunk'ga bog'lanadi).
 *   - Approval: validateSourceApprovalTransition + buildApprovalEntry —
 *     teacher qarori append-only.
 *
 * SECURITY / DATA GUARD (Prompt 50 §15-17):
 *   - Document text hech qachon system instruction sifatida qabul
 *     qilinmaydi — instruction markerlar topilsa chunk corpusga kirmaydi.
 *   - Cross-tenant vector retrieval fail-closed (namespace ACL).
 *   - Purity: deterministic, side-effect-free (faqat string/URL parse).
 */

import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const SOURCE_KINDS = ['pdf', 'docx', 'pptx', 'url', 'text'];
export const PACK_STATUS = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  ARCHIVED: 'archived',
};
export const SOURCE_EXTRACTION_STATUS = {
  PENDING: 'pending',
  EXTRACTING: 'extracting',
  EXTRACTED: 'extracted',
  FAILED: 'failed',
};
export const SOURCE_APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_VERSION = 'v1';

/** Upload size cap: 25 MB. */
export const SOURCE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** MIME allowlist (kind → allowed mime types + extensions). */
export const SOURCE_MIME_ALLOWLIST = {
  pdf: {
    mimes: ['application/pdf'],
    extensions: ['.pdf'],
    magic: [['%PDF-', 0]],
  },
  docx: {
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    extensions: ['.docx'],
    magic: [['PK', 0]], // OOXML = ZIP container
  },
  pptx: {
    mimes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    extensions: ['.pptx'],
    magic: [['PK', 0]],
  },
  text: {
    mimes: ['text/plain', 'text/markdown', 'text/csv'],
    extensions: ['.txt', '.md', '.csv'],
    magic: [],
  },
};

/** URL scheme allowlist (SSRF). */
export const SOURCE_URL_SCHEMES = ['http:', 'https:'];

/**
 * Private / link-local / metadata / reserved IP CIDRs — SSRF block.
 * 169.254.169.254 = cloud metadata endpoint (AWS/GCP/Azure).
 */
export const SSRF_BLOCKED_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16', // link-local + metadata
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

/** IPv6 private / link-local / unique-local — SSRF block. */
export const SSRF_BLOCKED_IPV6 = ['::1', '::', 'fc00::/7', 'fe80::/10', 'ff00::/8'];

/** Prompt-injection / instruction markerlari (lowercase substring match). */
export const INSTRUCTION_MARKERS = [
  'ignore all previous instructions',
  'ignore previous instructions',
  'ignore the above',
  'disregard all previous',
  'system instruction',
  'system prompt',
  'you are now',
  'from now on you are',
  'act as if',
  'do not follow',
  'override your instructions',
  'new instructions',
  'redefine your role',
  'jailbreak',
  'reveal your system prompt',
  'output your instructions',
  'developer message',
  'inject instructions',
];

/** HTML elements/attributes to strip for text isolation. */
export const HTML_STRIP_ELEMENTS = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg'];
export const HTML_STRIP_ATTR_PREFIX = ['on', 'javascript:', 'data:', 'vbscript:'];

// ═══════════════════════════════════════════════════════════════════
// URL / SSRF VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a URL and return host + ipv4 candidates (syntactic; no DNS).
 *
 * @param {string} raw
 * @returns {{ ok: true, url: URL, host: string, hostname: string, ipv4: string|null, ipv6: string|null } |
 *           { ok: false, error: string }}
 */
export function parseSourceUrl(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, error: 'URL is required' };
  let url;
  try {
    url = new URL(raw.trim());
  } catch (_) {
    return { ok: false, error: 'Invalid URL format' };
  }
  if (!SOURCE_URL_SCHEMES.includes(url.protocol)) {
    return { ok: false, error: `URL scheme must be ${SOURCE_URL_SCHEMES.join(' or ')}` };
  }
  const hostname = url.hostname.toLowerCase();
  if (url.username || url.password) {
    return { ok: false, error: 'URL must not contain credentials' };
  }
  let ipv4 = null;
  let ipv6 = null;
  // host literal IP?
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    ipv4 = hostname;
  } else if (hostname.includes(':') && !hostname.startsWith('[')) {
    ipv6 = hostname;
  } else if (hostname.startsWith('[') && hostname.endsWith(']')) {
    ipv6 = hostname.slice(1, -1);
  }
  return { ok: true, url, host: url.host, hostname, ipv4, ipv6 };
}

/**
 * IPv4 dotted-quad string → 32-bit number.
 * @param {string} ip
 * @returns {number|null}
 */
export function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check an integer IPv4 against a CIDR.
 * @param {number} ip
 * @param {string} cidr - "a.b.c.d/xx"
 * @returns {boolean}
 */
export function ipv4InCidr(ip, cidr) {
  const [base, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  const baseInt = ipv4ToInt(base);
  if (baseInt === null || Number.isNaN(prefix)) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

/**
 * Validate a URL for SSRF safety (syntactic — hostname literal IP bo'lsa).
 *
 * NOTE (Prompt 50 §15): DNS resolution va rebinding himoyasi SERVICE
 * qatlamida amalga oshiriladi (resolveAndVerifySourceHost) — pure funksiya
 * sintaktik xavflarni (literal private IP, localhost nomi, metadata) bloklaydi.
 *
 * @param {string} raw
 * @returns {{ ok: boolean, error?: string, hostname?: string, ipv4?: string|null, ipv6?: string|null }}
 */
export function validateSourceUrl(raw) {
  const parsed = parseSourceUrl(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { hostname, ipv4, ipv6 } = parsed;

  // Localhost / literal private name — instant reject
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') {
    return { ok: false, error: `SSRF blocked: hostname "${hostname}" is reserved` };
  }

  if (ipv4) {
    const int = ipv4ToInt(ipv4);
    if (int === null) return { ok: false, error: 'Invalid IPv4 literal' };
    const hit = SSRF_BLOCKED_CIDRS.find((cidr) => ipv4InCidr(int, cidr));
    if (hit) return { ok: false, error: `SSRF blocked: IP ${ipv4} is in reserved range ${hit}` };
  }
  if (ipv6) {
    const hit = SSRF_BLOCKED_IPV6.find((c) => ipv6 === c || ipv6.startsWith(c.replace('::/', ':')));
    if (hit || ipv6.startsWith('fe8') || ipv6.startsWith('fc') || ipv6.startsWith('fd')) {
      return { ok: false, error: `SSRF blocked: IPv6 ${ipv6} is reserved` };
    }
  }
  return { ok: true, hostname, ipv4, ipv6 };
}

// ═══════════════════════════════════════════════════════════════════
// SAFE UPLOAD
// ═══════════════════════════════════════════════════════════════════

/**
 * Magic-byte sniffing — aynan MIME'ga mos prefixni tekshiradi.
 *
 * @param {Buffer} buf
 * @param {Array<[string, number]>} magic - [[hexOrAscii, offset], ...]
 * @returns {boolean}
 */
export function sniffMagic(buf, magic = []) {
  if (!buf || !Buffer.isBuffer(buf)) return false;
  for (const [needle, offset] of magic) {
    const start = Number(offset) || 0;
    if (buf.length < start + Buffer.byteLength(needle)) return false;
    const slice = buf.subarray(start, start + Buffer.byteLength(needle)).toString('latin1');
    if (slice !== needle) return false;
  }
  return magic.length > 0;
}

/**
 * Validate a source file upload before it touches storage.
 *
 * @param {Object} params
 * @param {string} params.kind - pdf|docx|pptx|text
 * @param {string} params.originalName
 * @param {string} params.mimeType
 * @param {number} params.size - bytes
 * @param {Buffer} [params.buffer]
 * @returns {{ ok: boolean, error?: string, normalized?: { kind: string, mime: string, ext: string } }}
 */
export function validateSourceUpload({ kind, originalName = '', mimeType = '', size = 0, buffer } = {}) {
  if (!SOURCE_KINDS.includes(kind)) {
    return { ok: false, error: `Invalid source kind "${kind}" — use ${SOURCE_KINDS.join(', ')}` };
  }
  if (kind === 'url') {
    return { ok: false, error: 'URL source is uploaded via URL field, not file upload' };
  }
  const cfg = SOURCE_MIME_ALLOWLIST[kind];
  if (!cfg) return { ok: false, error: `Unsupported upload kind "${kind}"` };

  const ext = originalName.toLowerCase().slice(originalName.lastIndexOf('.'));
  if (!cfg.extensions.includes(ext)) {
    return { ok: false, error: `Extension "${ext}" not allowed for ${kind} — use ${cfg.extensions.join(', ')}` };
  }
  const mime = mimeType.toLowerCase().split(';')[0].trim();
  if (!cfg.mimes.includes(mime)) {
    return { ok: false, error: `MIME "${mimeType}" not allowed for ${kind}` };
  }
  if (size <= 0) return { ok: false, error: 'File is empty' };
  if (size > SOURCE_UPLOAD_MAX_BYTES) {
    return { ok: false, error: `File exceeds ${Math.round(SOURCE_UPLOAD_MAX_BYTES / 1024 / 1024)} MB limit` };
  }
  // Magic-byte tekshiruvi — MIME header'i yolg'on bo'lsa ham binar mos kelishi shart
  if (buffer && cfg.magic.length > 0 && !sniffMagic(buffer, cfg.magic)) {
    return { ok: false, error: `Content does not match expected ${kind} magic bytes` };
  }
  return { ok: true, normalized: { kind, mime, ext } };
}

// ═══════════════════════════════════════════════════════════════════
// HTML / INSTRUCTION ISOLATION
// ═══════════════════════════════════════════════════════════════════

/**
 * HTML'dan executable/format content olib tashlab, faqat text izolyatsiya.
 * Script/iframe/style/event-handler/javascript: URL — hammasi tashlanadi.
 *
 * @param {string} html
 * @returns {{ ok: boolean, text: string, removedElements: string[], removedAttrs: string[] }}
 */
export function isolateHtmlContent(html = '') {
  if (!html || typeof html !== 'string') return { ok: true, text: '', removedElements: [], removedAttrs: [] };
  let text = html;
  const removedElements = [];
  const removedAttrs = [];

  for (const el of HTML_STRIP_ELEMENTS) {
    const re = new RegExp(`<${el}[\\s\\S]*?<\\/${el}>|<${el}[^>]*\\/?>`, 'gi');
    const before = text;
    text = text.replace(re, () => ' ');
    if (text !== before) removedElements.push(el);
  }

  // Event-handler va xavfli attribute'lar
  text = text.replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, attr) => {
    removedAttrs.push(attr);
    return ' ';
  });
  text = text.replace(/\s(href|src|action)\s*=\s*("|')(javascript|vbscript|data:text\/html):[^"']*\2/gi, (m, attr) => {
    removedAttrs.push(attr);
    return ' ';
  });

  // < > ichidagi qolgan tag'larni strip
  text = text.replace(/<[^>]*>/g, ' ');
  // Entities
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  text = text.replace(/\s+/g, ' ').trim();

  return { ok: true, text, removedElements: [...new Set(removedElements)], removedAttrs: [...new Set(removedAttrs)] };
}

/**
 * Detect prompt-injection / instruction markerlari. Document text hech
 * qachon system instruction sifatida qabul qilinmaydi — marker topilsa
 * chunk corpusga kirmaydi.
 *
 * @param {string} content
 * @returns {{ ok: boolean, markers: string[] }}
 */
export function detectInstructionMarkers(content = '') {
  if (!content || typeof content !== 'string') return { ok: true, markers: [] };
  const lower = content.toLowerCase();
  const markers = INSTRUCTION_MARKERS.filter((m) => lower.includes(m));
  return { ok: markers.length === 0, markers };
}

// ═══════════════════════════════════════════════════════════════════
// EXTRACTION PLAN & CHUNKING
// ═══════════════════════════════════════════════════════════════════

/**
 * Plan extraction for a source (worker input — deterministic estimate).
 *
 * @param {Object} params
 * @param {string} params.kind
 * @param {number} params.byteSize
 * @returns {{ ok: boolean, error?: string, strategy: string, pageEstimate: number, chunkTarget: number }}
 */
export function planExtraction({ kind, byteSize = 0 } = {}) {
  if (!SOURCE_KINDS.includes(kind)) return { ok: false, error: `Invalid kind "${kind}"` };
  let pageEstimate = 1;
  if (kind === 'pdf' || kind === 'docx' || kind === 'pptx') {
    // ~30KB/page taxmin (rasm/format bo'yicha o'zgaradi — worker aniq hisoblaydi)
    pageEstimate = Math.max(1, Math.ceil(byteSize / (30 * 1024)));
  }
  return { ok: true, strategy: kind, pageEstimate, chunkTarget: Math.max(1, Math.ceil(pageEstimate * 2)) };
}

/**
 * Deterministic text chunking with provenance.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {string} params.sourceId
 * @param {number} [params.pageIndex]
 * @param {number} [params.maxChars]
 * @param {number} [params.overlap]
 * @param {string} [params.quoteMax]
 * @returns {{ ok: boolean, error?: string, chunks: Array<Object> }}
 */
export function chunkText({
  text = '',
  sourceId,
  pageIndex = 0,
  maxChars = 1200,
  overlap = 120,
  quoteMax = 400,
} = {}) {
  if (!text || typeof text !== 'string') return { ok: false, error: 'text is required' };
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return { ok: false, error: 'text is empty after normalization' };
  const max = Math.max(64, Number(maxChars) || 1200);
  const ov = Math.min(overlap, Math.floor(max / 2));

  const chunks = [];
  let i = 0;
  let chunkIndex = 0;
  while (i < clean.length) {
    let end = Math.min(i + max, clean.length);
    // So'z chegarasida kesish (agar uzunlik ortib ketsa, majburiy kesish)
    if (end < clean.length) {
      const space = clean.lastIndexOf(' ', end);
      if (space > i + max * 0.5) end = space;
    }
    const content = clean.slice(i, end).trim();
    if (content) {
      chunks.push(buildChunkProvenance({
        sourceId, pageIndex, chunkIndex,
        content,
        charStart: i,
        charEnd: end,
        quoteMax,
      }));
      chunkIndex += 1;
    }
    if (end >= clean.length) break;
    i = Math.max(end - ov, i + 1);
  }
  return { ok: true, chunks };
}

// ═══════════════════════════════════════════════════════════════════
// PROVENANCE
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a chunk record with full provenance + content hash + quote.
 *
 * @param {Object} params
 * @returns {Object} chunk record (tenant namespace beriladi service'da)
 */
export function buildChunkProvenance({
  sourceId, pageIndex = 0, chunkIndex = 0,
  content, charStart = null, charEnd = null, quoteMax = 400,
} = {}) {
  const text = String(content ?? '');
  const hash = createHash('sha256').update(text).digest('hex');
  const quote = text.slice(0, Math.max(10, Number(quoteMax) || 400)).trim();
  return {
    sourceId: String(sourceId ?? ''),
    pageIndex: Number(pageIndex) || 0,
    chunkIndex: Number(chunkIndex) || 0,
    content: text,
    charStart: charStart == null ? null : Number(charStart),
    charEnd: charEnd == null ? null : Number(charEnd),
    charCount: text.length,
    contentHash: hash,
    quote,
  };
}

// ═══════════════════════════════════════════════════════════════════
// EMBEDDING NAMESPACE & TENANT ACL
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a tenant-scoped embedding namespace.
 * Format: tenant:{tenantId}:model:{model}:v:{version}
 *
 * @param {Object} params
 * @returns {string}
 */
export function buildEmbeddingNamespace({ tenantId, model = EMBEDDING_MODEL, version = EMBEDDING_VERSION } = {}) {
  return `tenant:${String(tenantId ?? 0)}:model:${model}:v:${version}`;
}

/**
 * Extract tenantId from a namespace.
 * @param {string} namespace
 * @returns {number|null}
 */
export function namespaceTenantId(namespace = '') {
  const m = String(namespace).match(/^tenant:(\d+):/);
  return m ? Number(m[1]) : null;
}

/**
 * Assert retrieval is tenant-scoped — cross-tenant vector retrieval
 * TAQIQLANADI (fail-closed).
 *
 * @param {Object} params
 * @param {string} params.namespace
 * @param {number} params.requestTenantId
 * @returns {{ ok: boolean, error?: string }}
 */
export function assertTenantVectorScope({ namespace = '', requestTenantId } = {}) {
  const nsTenant = namespaceTenantId(namespace);
  if (nsTenant === null) return { ok: false, error: 'Invalid embedding namespace' };
  if (Number(requestTenantId) !== nsTenant) {
    return { ok: false, error: `Cross-tenant vector retrieval denied: namespace tenant ${nsTenant} != requester ${requestTenantId}` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// CITATION CLAIM CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize text for quote containment check (whitespace + case).
 * @param {string} s
 * @returns {string}
 */
export function normalizeForQuote(s = '') {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Validate a citation claim against a real chunk (quote integrity).
 * AI reference faqat REAL DB'dagi chunk'ga bog'lanishi mumkin (§22.11).
 *
 * @param {Object} params
 * @param {Object} params.claim - { sourceId, chunkId, quote, claimText }
 * @param {Object} params.chunk - { id, sourceId, content }
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateCitationClaim({ claim = {}, chunk = null } = {}) {
  if (!claim || typeof claim !== 'object') return { ok: false, error: 'claim is required' };
  if (!claim.sourceId) return { ok: false, error: 'claim.sourceId is required' };
  if (!claim.quote || typeof claim.quote !== 'string') return { ok: false, error: 'claim.quote is required' };
  if (claim.quote.length > 600) return { ok: false, error: 'claim.quote exceeds 600 chars' };
  if (!chunk) return { ok: false, error: 'chunk must reference a real DB record' };
  if (String(chunk.sourceId) !== String(claim.sourceId)) {
    return { ok: false, error: 'claim.sourceId does not match chunk.sourceId' };
  }
  if (claim.chunkId && String(claim.chunkId) !== String(chunk.id)) {
    return { ok: false, error: 'claim.chunkId does not match chunk.id' };
  }
  const q = normalizeForQuote(claim.quote);
  const c = normalizeForQuote(chunk.content);
  if (q.length < 10) return { ok: false, error: 'claim.quote too short (min 10 chars)' };
  if (!c.includes(q)) {
    return { ok: false, error: 'claim.quote is not contained in chunk content (fabricated citation)' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// APPROVAL WORKFLOW
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a source approval transition.
 * @param {Object} params
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateSourceApprovalTransition({ from, to } = {}) {
  const allowed = {
    [SOURCE_APPROVAL_STATUS.PENDING]: [SOURCE_APPROVAL_STATUS.APPROVED, SOURCE_APPROVAL_STATUS.REJECTED],
    [SOURCE_APPROVAL_STATUS.REJECTED]: [SOURCE_APPROVAL_STATUS.APPROVED],
    [SOURCE_APPROVAL_STATUS.APPROVED]: [],
  };
  const targets = allowed[from] || [];
  if (!targets.includes(to)) {
    return { ok: false, error: `Invalid source approval transition: ${from} → ${to}` };
  }
  return { ok: true };
}

/**
 * Validate a pack status transition.
 * @param {Object} params
 * @returns {{ ok: boolean, error?: string }}
 */
export function validatePackTransition({ from, to } = {}) {
  const allowed = {
    [PACK_STATUS.DRAFT]: [PACK_STATUS.IN_REVIEW, PACK_STATUS.ARCHIVED],
    [PACK_STATUS.IN_REVIEW]: [PACK_STATUS.APPROVED, PACK_STATUS.DRAFT, PACK_STATUS.ARCHIVED],
    [PACK_STATUS.APPROVED]: [PACK_STATUS.ARCHIVED],
    [PACK_STATUS.ARCHIVED]: [],
  };
  const targets = allowed[from] || [];
  if (!targets.includes(to)) {
    return { ok: false, error: `Invalid pack transition: ${from} → ${to}` };
  }
  return { ok: true };
}

/**
 * Build an append-only approval entry.
 *
 * @param {Object} params
 * @returns {{ ok: boolean, error?: string, entry?: Object }}
 */
export function buildApprovalEntry({ sourceId, decision, note = '', decidedBy } = {}) {
  const t = validateSourceApprovalTransition({ from: SOURCE_APPROVAL_STATUS.PENDING, to: decision });
  if (!t.ok) return { ok: false, error: t.error };
  if (!decidedBy) return { ok: false, error: 'decidedBy is required (human teacher)' };
  return {
    ok: true,
    entry: {
      sourceId,
      decision,
      note: String(note || '').slice(0, 500),
      decidedBy,
      decidedAt: new Date().toISOString(),
    },
  };
}
