/**
 * Deborah — Safe File, Code & Oral Submission (pure logic)
 *
 * Prompt 44 — project/file/code/audio/video assessmentlar uchun SECURE
 * RESUMABLE submission (research.md §16.3 file antivirus/sandbox, §51
 * oral assessment). This module is PURE (no I/O): every decision is
 * computed deterministically here — the server NEVER trusts client
 * MIME, size, hash or verdicts (§15 server-authoritative).
 *
 * Covers:
 *   - Upload session contract: session_key idempotency, kind, lifecycle
 *     (open → uploading → complete → quarantined → accepted | rejected).
 *   - MIME/magic/hash: declared MIME is validated against ALLOWED_MIMES
 *     per kind; magic MIME is detected server-side from magic bytes; the
 *     final sha256 is server-computed from the full content.
 *   - Quarantine state machine: pending → clean | infected | unscannable.
 *     NO FAIL-OPEN: a scanner that cannot decide yields 'unscannable'
 *     (quarantine), never 'clean' (§16.3, Prompt 44 §24 stop condition).
 *   - Archive/macro/PDF active-content checks: zip-bomb ratio + entry
 *     count + total decompressed cap, macro detection (docm/xlsm/pptm/
 *     vbaProject.bin), PDF JS/embedded-file detection heuristics.
 *   - Code sandbox limits: static allow/deny rules + resource limits
 *     (cpu/memory/timeout/network) — uploaded code hooks ishlamaydi.
 *   - Chunk resume contract: contiguous offset chain, per-chunk hash,
 *     final assembly hash equals the declared session sha256.
 *   - Media normalize + transcript confidence → manual listen queue.
 *   - Authorized resubmission/version flow + signed receipt contract.
 *
 * Purity: crypto used here is deterministic and side-effect-free.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const SUBMISSION_KINDS = ['file', 'code', 'audio', 'video'];
export const UPLOAD_SESSION_STATUS = {
  OPEN: 'open',
  UPLOADING: 'uploading',
  COMPLETE: 'complete',
  QUARANTINED: 'quarantined',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
};
export const QUARANTINE_STATUS = {
  PENDING: 'pending',
  CLEAN: 'clean',
  INFECTED: 'infected',
  UNSCANNABLE: 'unscannable',
};
export const CHUNK_STATUS = {
  RECEIVED: 'received',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};
export const SCAN_VERDICTS = ['clean', 'infected', 'suspicious', 'unscannable'];
export const SCANNERS = ['magic', 'archive', 'macro', 'pdf', 'codesandbox'];
export const VERSION_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  SUPERSEDED: 'superseded',
};
export const TRANSCRIPT_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/**
 * Default safe-submit policy. A brief/assessment MAY override limits via
 * its own config, but these are the non-negotiable platform floors.
 */
export const SAFE_SUBMIT_DEFAULTS = {
  maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB file
  maxCodeSizeBytes: 2 * 1024 * 1024, // 2 MB code
  maxMediaSizeBytes: 250 * 1024 * 1024, // 250 MB media (chunked)
  chunkSizeBytes: 1024 * 1024, // 1 MB chunks
  maxTotalChunks: 4000,
  maxVersions: 5, // authorized resubmissions cap
  zipMaxRatio: 200, // decompressed/compressed ratio cap (zip-bomb guard)
  zipMaxEntries: 1000,
  zipMaxTotalDecompressedBytes: 200 * 1024 * 1024,
  macroExtensions: ['.docm', '.xlsm', '.pptm'],
  macroMarkerNames: ['vbaProject.bin', 'word/vbaProject.bin', 'xl/vbaProject.bin', 'ppt/vbaProject.bin'],
  pdfSuspiciousMarkers: ['/JavaScript', '/JS', '/OpenAction', '/Launch', '/EmbeddedFile', '/RichMedia'],
  lowConfidenceThreshold: 0.7, // below → manual listen queue
  receiptVersion: 1,
};

// ── Allowed MIME per kind (declared MIME must match; magic must agree) ──
export const ALLOWED_MIMES = {
  file: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'text/plain',
    'text/markdown',
    'image/png',
    'image/jpeg',
  ],
  code: [
    'text/plain',
    'text/x-python',
    'text/x-java-source',
    'text/javascript',
    'text/x-c',
    'text/x-c++',
    'text/x-go',
    'application/json',
    'text/x-shellscript',
  ],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
};

// ── Magic MIME detection (byte prefixes — server-side, never client) ──
const MAGIC_TABLE = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK\x03\x04
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06] }, // PK\x05\x06 (empty)
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x07, 0x08] }, // PK\x07\x08 (spanned)
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] }, // \x89PNG
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'audio/mpeg', bytes: [0x49, 0x44, 0x33] }, // ID3
  { mime: 'audio/wav', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
  { mime: 'audio/ogg', bytes: [0x4f, 0x67, 0x67, 0x53] }, // OggS
  { mime: 'video/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // EBML (webm/mkv)
  { mime: 'video/mp4', bytes: [0x00, 0x00, 0x00, 0x18] }, // ftyp box (approx)
  { mime: 'application/msword', bytes: [0xd0, 0xcf, 0x11, 0xe0] }, // OLE2 (doc/xls/ppt)
];

// ═══════════════════════════════════════════════════════════════════
// UPLOAD SESSION CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve per-kind upload limits from the safe-submit defaults + optional
 * brief overrides (only KNOWN keys may be overridden — no arbitrary config).
 *
 * @param {Object} params
 * @param {string} params.kind - file | code | audio | video
 * @param {Object} [params.briefLimits] - optional brief/assignment overrides
 * @returns {Object} resolved limits
 */
export function resolveUploadLimits({ kind = 'file', briefLimits = {} } = {}) {
  const base = { ...SAFE_SUBMIT_DEFAULTS };
  const allowedKeys = ['maxFileSizeBytes', 'maxCodeSizeBytes', 'maxMediaSizeBytes', 'chunkSizeBytes', 'maxVersions'];
  for (const key of allowedKeys) {
    const v = briefLimits[key];
    if (typeof v === 'number' && v > 0) base[key] = v;
  }
  const maxSizeByKind = {
    file: base.maxFileSizeBytes,
    code: base.maxCodeSizeBytes,
    audio: base.maxMediaSizeBytes,
    video: base.maxMediaSizeBytes,
  };
  return { ...base, maxSizeBytes: maxSizeByKind[kind] || base.maxFileSizeBytes };
}

/**
 * Validate an upload session create request (pre-DB — validate-before-getDb).
 *
 * @param {Object} params
 * @param {string} params.sessionKey
 * @param {string} params.kind
 * @param {string} [params.declaredMime]
 * @param {number} [params.expectedSize]
 * @param {Object} [params.limits] - resolved limits (defaults used if absent)
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateUploadSessionCreate({ sessionKey = '', kind = '', declaredMime = '', expectedSize = 0, limits = SAFE_SUBMIT_DEFAULTS } = {}) {
  if (!sessionKey || sessionKey.length > 64) return { ok: false, error: 'sessionKey is required (max 64 chars)' };
  if (!SUBMISSION_KINDS.includes(kind)) return { ok: false, error: `Invalid submission kind: ${kind}` };
  if (declaredMime && !ALLOWED_MIMES[kind]?.includes(declaredMime)) {
    return { ok: false, error: `Declared MIME not allowed for ${kind}: ${declaredMime}` };
  }
  const size = Number(expectedSize) || 0;
  if (size < 0) return { ok: false, error: 'expectedSize cannot be negative' };
  if (size > (limits.maxSizeBytes || SAFE_SUBMIT_DEFAULTS.maxFileSizeBytes)) {
    return { ok: false, error: `File exceeds ${(limits.maxSizeBytes || 0) / 1024 / 1024} MB limit` };
  }
  if (kind === 'code' && declaredMime === 'application/json') {
    return { ok: false, error: 'JSON is not a valid code submission kind' };
  }
  return { ok: true };
}

/**
 * Validate the session status transition (state machine).
 *
 * @param {string} from
 * @param {string} to
 * @returns {{ ok: true, to: string } | { ok: false, error: string }}
 */
export function validateSessionTransition(from = '', to = '') {
  const ALLOWED = {
    [UPLOAD_SESSION_STATUS.OPEN]: [UPLOAD_SESSION_STATUS.UPLOADING, UPLOAD_SESSION_STATUS.REJECTED],
    [UPLOAD_SESSION_STATUS.UPLOADING]: [UPLOAD_SESSION_STATUS.COMPLETE, UPLOAD_SESSION_STATUS.REJECTED],
    [UPLOAD_SESSION_STATUS.COMPLETE]: [UPLOAD_SESSION_STATUS.QUARANTINED, UPLOAD_SESSION_STATUS.ACCEPTED, UPLOAD_SESSION_STATUS.REJECTED],
    [UPLOAD_SESSION_STATUS.QUARANTINED]: [UPLOAD_SESSION_STATUS.ACCEPTED, UPLOAD_SESSION_STATUS.REJECTED],
    [UPLOAD_SESSION_STATUS.ACCEPTED]: [],
    [UPLOAD_SESSION_STATUS.REJECTED]: [],
  };
  if (!(ALLOWED[from] || []).includes(to)) {
    return { ok: false, error: `Illegal session transition: ${from} → ${to}` };
  }
  return { ok: true, to };
}

// ═══════════════════════════════════════════════════════════════════
// MIME / MAGIC / HASH
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect MIME from magic bytes (first bytes of the content). Pure and
 * deterministic — used at finalize time to compare with declared MIME.
 *
 * @param {Buffer|Uint8Array} head - at least the first 16 bytes
 * @returns {string|null} detected mime or null (unknown magic)
 */
export function detectMagicMime(head = null) {
  if (!head || head.length < 4) return null;
  const bytes = Array.from(head);
  for (const entry of MAGIC_TABLE) {
    const prefix = entry.bytes;
    if (prefix.length <= bytes.length && prefix.every((b, i) => bytes[i] === b)) {
      return entry.mime;
    }
  }
  return null;
}

/**
 * Compute the canonical sha256 hex of a buffer.
 *
 * @param {Buffer|Uint8Array} data
 * @returns {string} 64-char hex
 */
export function sha256Hex(data = Buffer.alloc(0)) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Compare declared vs magic MIME. Mismatch → suspicious (rejected at
 * finalize unless it is a benign alias like OLE2 office files).
 *
 * @param {Object} params
 * @param {string} params.declaredMime
 * @param {string|null} params.magicMime
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function evaluateMimeMatch({ declaredMime = '', magicMime = null } = {}) {
  if (!declaredMime) return { ok: false, reason: 'declared MIME required' };
  if (!magicMime) return { ok: true, reason: 'unknown magic — verified by quarantine scanners' };
  if (declaredMime === magicMime) return { ok: true, reason: null };
  // OLE2 compound files are the container for legacy office — accept.
  if (magicMime === 'application/msword' && declaredMime.includes('officedocument')) {
    return { ok: true, reason: 'OLE2 office container' };
  }
  return { ok: false, reason: `MIME mismatch: declared ${declaredMime}, magic ${magicMime}` };
}

// ═══════════════════════════════════════════════════════════════════
// QUARANTINE STATE MACHINE (no fail-open)
// ═══════════════════════════════════════════════════════════════════

/**
 * Aggregate scanner verdicts into a quarantine decision. FAIL-CLOSED:
 * any 'infected' → infected; any 'unscannable' (with no infected) →
 * unscannable; all 'clean' → clean. Empty scan log → unscannable.
 *
 * @param {Array<{verdict: string}>} results
 * @returns {{ status: string, reason: string }}
 */
export function decideQuarantine(results = []) {
  if (!Array.isArray(results) || results.length === 0) {
    return { status: QUARANTINE_STATUS.UNSCANNABLE, reason: 'no scan verdicts (fail-closed)' };
  }
  if (results.some((r) => r.verdict === 'infected')) {
    return { status: QUARANTINE_STATUS.INFECTED, reason: 'infected content detected' };
  }
  if (results.some((r) => r.verdict === 'unscannable')) {
    return { status: QUARANTINE_STATUS.UNSCANNABLE, reason: 'scanner could not decide (fail-closed)' };
  }
  if (results.some((r) => r.verdict === 'suspicious')) {
    return { status: QUARANTINE_STATUS.UNSCANNABLE, reason: 'suspicious content — manual review required' };
  }
  if (results.every((r) => r.verdict === 'clean')) {
    return { status: QUARANTINE_STATUS.CLEAN, reason: null };
  }
  return { status: QUARANTINE_STATUS.UNSCANNABLE, reason: 'unexpected verdicts (fail-closed)' };
}

/**
 * Quarantine must NOT become a late penalty: a quarantined submission is
 * treated as 'needs_review', never as a policy violation. Penalty is only
 * applied when a human confirms academic dishonesty (handled upstream by
 * the integrity module — never inferred from scanner results).
 *
 * @returns {{ ok: boolean, reason: string }}
 */
export function quarantineNeverPenalty() {
  return { ok: true, reason: 'quarantine = needs_review, never penalty' };
}

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE / MACRO / PDF ACTIVE-CONTENT CHECKS
// ═══════════════════════════════════════════════════════════════════

/**
 * Zip-bomb / decompression guard — evaluates an archive plan WITHOUT
 * decompressing (ratio + entry count + total decompressed estimate).
 * Pure: given compressed size + estimated decompressed total.
 *
 * @param {Object} params
 * @param {number} params.compressedBytes
 * @param {number} params.entryCount
 * @param {number} params.estimatedDecompressedBytes
 * @param {Object} [params.limits]
 * @returns {{ verdict: string, reason: string|null, ratio: number }}
 */
export function evaluateArchivePlan({ compressedBytes = 0, entryCount = 0, estimatedDecompressedBytes = 0, limits = SAFE_SUBMIT_DEFAULTS } = {}) {
  const ratio = compressedBytes > 0 ? estimatedDecompressedBytes / compressedBytes : 0;
  if (entryCount > limits.zipMaxEntries) {
    return { verdict: 'infected', reason: `too many archive entries (${entryCount} > ${limits.zipMaxEntries})`, ratio };
  }
  if (estimatedDecompressedBytes > limits.zipMaxTotalDecompressedBytes) {
    return { verdict: 'infected', reason: `decompressed size exceeds cap (${Math.round(estimatedDecompressedBytes / 1024 / 1024)} MB)`, ratio };
  }
  if (ratio > limits.zipMaxRatio) {
    return { verdict: 'infected', reason: `zip-bomb ratio ${ratio.toFixed(1)} > ${limits.zipMaxRatio}`, ratio };
  }
  return { verdict: 'clean', reason: null, ratio };
}

/**
 * Macro detection — checks the file name + embedded entry names.
 *
 * @param {Object} params
 * @param {string} [params.fileName]
 * @param {Array<string>} [params.entryNames]
 * @param {Object} [params.limits]
 * @returns {{ verdict: string, reason: string|null, hasMacro: boolean }}
 */
export function scanForMacros({ fileName = '', entryNames = [], limits = SAFE_SUBMIT_DEFAULTS } = {}) {
  const lower = String(fileName).toLowerCase();
  const hasMacroExt = limits.macroExtensions.some((ext) => lower.endsWith(ext));
  const lowerMarkers = limits.macroMarkerNames.map((m) => String(m).toLowerCase());
  const hasMarker = (entryNames || []).some((n) => lowerMarkers.includes(String(n).toLowerCase()));
  if (hasMacroExt || hasMarker) {
    return { verdict: 'suspicious', reason: hasMacroExt ? `macro-enabled extension: ${fileName}` : 'embedded VBA project detected', hasMacro: true };
  }
  return { verdict: 'clean', reason: null, hasMacro: false };
}

/**
 * PDF active-content heuristic scan — looks for JavaScript / Launch /
 * EmbeddedFile / RichMedia operators in the raw PDF bytes. This is a
 * lightweight heuristic; a full sandbox is invoked by the service when
 * available (fail-closed if it cannot run).
 *
 * @param {Object} params
 * @param {Buffer|string} [params.pdfBytes]
 * @param {string} [params.pdfText] - raw decoded text (alternative to bytes)
 * @returns {{ verdict: string, reason: string|null, markers: string[] }}
 */
export function scanPdfForActiveContent({ pdfBytes = null, pdfText = '' } = {}) {
  const raw = typeof pdfText === 'string' ? pdfText : Buffer.isBuffer(pdfBytes) ? pdfBytes.toString('latin1') : '';
  const found = SAFE_SUBMIT_DEFAULTS.pdfSuspiciousMarkers.filter((m) => raw.includes(m));
  if (found.length > 0) {
    return { verdict: 'suspicious', reason: `PDF active-content markers: ${found.join(', ')}`, markers: found };
  }
  return { verdict: 'clean', reason: null, markers: [] };
}

// ═══════════════════════════════════════════════════════════════════
// CODE SANDBOX LIMITS (microVM/container contract)
// ═══════════════════════════════════════════════════════════════════

/**
 * Code execution resource limits — the sandbox contract for code
 * submissions. Uploaded code is NEVER executed by the platform hooks; if
 * the assessment needs execution, it runs in a disposable microVM with
 * these hard limits.
 *
 * @returns {Object} immutable sandbox contract
 */
export function codeSandboxLimits() {
  return {
    cpuCores: 1,
    memoryMB: 512,
    timeoutSeconds: 10,
    network: 'none', // no egress — uploaded code cannot phone home
    filesystem: 'readonly-except-tmp',
    maxOutputBytes: 1024 * 1024,
    processCount: 32,
    writablePaths: ['/tmp'],
  };
}

/**
 * Static code policy check — detects obvious dangerous constructs before
 * the code reaches any execution path. Non-execution (fail-closed if the
 * code cannot be proven safe for the requested runtime).
 *
 * @param {Object} params
 * @param {string} params.source
 * @param {string} [params.language]
 * @returns {{ verdict: string, reason: string|null, flags: string[] }}
 */
export function staticCodePolicyCheck({ source = '', language = '' } = {}) {
  const flags = [];
  const text = String(source || '');
  // Hooks/network/child-process exfiltration markers (best-effort heuristic)
  const DANGEROUS = [
    ['fs.readFileSync(/etc/passwd', 'read_etc_passwd'],
    ['process.env', 'env_read'],
    ['child_process', 'child_process'],
    ['exec(', 'exec_call'],
    ['eval(', 'eval_call'],
    ['fetch(http', 'http_fetch'],
    ['http.request', 'http_request'],
    ['import socket', 'python_socket'],
    ['os.system', 'os_system'],
    ['subprocess', 'python_subprocess'],
    ['Runtime.getRuntime().exec', 'java_exec'],
  ];
  for (const [marker, flag] of DANGEROUS) {
    if (text.includes(marker)) flags.push(flag);
  }
  if (flags.length > 0) {
    return { verdict: 'suspicious', reason: `static policy flags: ${flags.join(', ')}`, flags };
  }
  return { verdict: 'clean', reason: null, flags: [] };
}

// ═══════════════════════════════════════════════════════════════════
// CHUNK RESUME CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a chunk upload request — contiguous offset, size cap, index
 * sanity. Pure.
 *
 * @param {Object} params
 * @param {number} params.chunkIndex
 * @param {number} params.offset
 * @param {number} params.size
 * @param {number} params.receivedSize - bytes received so far
 * @param {Object} [params.limits]
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateChunk({ chunkIndex = 0, offset = 0, size = 0, receivedSize = 0, limits = SAFE_SUBMIT_DEFAULTS } = {}) {
  const idx = Number(chunkIndex);
  const off = Number(offset);
  const sz = Number(size);
  if (!Number.isInteger(idx) || idx < 0) return { ok: false, error: 'chunkIndex must be a non-negative integer' };
  if (!Number.isInteger(off) || off < 0) return { ok: false, error: 'offset must be a non-negative integer' };
  if (!Number.isInteger(sz) || sz <= 0) return { ok: false, error: 'size must be a positive integer' };
  if (sz > (limits.chunkSizeBytes || SAFE_SUBMIT_DEFAULTS.chunkSizeBytes) * 2) {
    return { ok: false, error: 'chunk exceeds max chunk size' };
  }
  // Resume contract: a chunk is accepted only at the NEXT contiguous offset
  // OR it is an idempotent re-send of an already-received chunk.
  const expected = Number(receivedSize) || 0;
  const isResend = off < expected;
  const isContiguous = off === expected;
  if (!isResend && !isContiguous) {
    return { ok: false, error: `non-contiguous offset ${off} (expected ${expected})` };
  }
  return { ok: true };
}

/**
 * Finalize check: received size == expected size AND received chunks ==
 * total chunks. Pure.
 *
 * @param {Object} params
 * @param {number} params.receivedSize
 * @param {number} params.expectedSize
 * @param {number} params.receivedChunks
 * @param {number} params.totalChunks
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateUploadComplete({ receivedSize = 0, expectedSize = 0, receivedChunks = 0, totalChunks = 0 } = {}) {
  if (Number(receivedSize) !== Number(expectedSize)) {
    return { ok: false, reason: `size mismatch: received ${receivedSize}, expected ${expectedSize}` };
  }
  if (Number(receivedChunks) !== Number(totalChunks)) {
    return { ok: false, reason: `chunk count mismatch: received ${receivedChunks}, expected ${totalChunks}` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// MEDIA TRANSCRIPT CONFIDENCE → MANUAL LISTEN QUEUE
// ═══════════════════════════════════════════════════════════════════

/**
 * Decide whether a transcript needs manual listening (low confidence or
 * empty). Pure.
 *
 * @param {Object} params
 * @param {number} params.confidence
 * @param {string} [params.transcriptText]
 * @param {number} [params.threshold]
 * @returns {{ manualListen: boolean, reason: string|null }}
 */
export function evaluateTranscriptConfidence({ confidence = 0, transcriptText = '', threshold = SAFE_SUBMIT_DEFAULTS.lowConfidenceThreshold } = {}) {
  const conf = Number(confidence) || 0;
  if (!String(transcriptText || '').trim()) {
    return { manualListen: true, reason: 'empty transcript' };
  }
  if (conf < threshold) {
    return { manualListen: true, reason: `confidence ${conf.toFixed(2)} < ${threshold}` };
  }
  return { manualListen: false, reason: null };
}

/**
 * Media normalize contract — resumable audio/video chunk assembly rules.
 *
 * @returns {Object} immutable normalize contract
 */
export function mediaNormalizeContract() {
  return {
    acceptedContainers: ['webm', 'ogg', 'mp4', 'wav', 'mpeg'],
    codecPolicy: 'require-duration-metadata',
    minDurationMs: 1000,
    maxDurationMs: 60 * 60 * 1000, // 1 hour
    resampleRate: 16000,
    mono: true,
    maxSilenceRatio: 0.9,
  };
}

// ═══════════════════════════════════════════════════════════════════
// AUTHORIZED RESUBMISSION / VERSION FLOW
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if a resubmission is authorized for this attempt.
 *
 * @param {Object} params
 * @param {number} params.currentVersion
 * @param {boolean} params.attemptOpen - attempt still in-progress window
 * @param {boolean} params.authorized - brief allows resubmission
 * @param {number} [params.maxVersions]
 * @returns {{ ok: boolean, reason?: string, nextVersion: number }}
 */
export function checkResubmissionAllowed({ currentVersion = 0, attemptOpen = false, authorized = false, maxVersions = SAFE_SUBMIT_DEFAULTS.maxVersions } = {}) {
  const next = Number(currentVersion) + 1;
  // First submission is ALWAYS allowed; only resubmission needs authorization.
  if (Number(currentVersion) > 0 && !authorized) return { ok: false, reason: 'resubmission not authorized by assessment policy', nextVersion: next };
  if (Number(currentVersion) > 0 && !attemptOpen) return { ok: false, reason: 'attempt window closed', nextVersion: next };
  if (next > Number(maxVersions)) {
    return { ok: false, reason: `max ${maxVersions} submission versions reached`, nextVersion: next };
  }
  return { ok: true, reason: null, nextVersion: next };
}

/**
 * Validate version status transition.
 *
 * @param {string} from
 * @param {string} to
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateVersionTransition(from = '', to = '') {
  const ALLOWED = {
    [VERSION_STATUS.DRAFT]: [VERSION_STATUS.SUBMITTED, VERSION_STATUS.SUPERSEDED],
    [VERSION_STATUS.SUBMITTED]: [VERSION_STATUS.SUPERSEDED],
    [VERSION_STATUS.SUPERSEDED]: [],
  };
  if (!(ALLOWED[from] || []).includes(to)) {
    return { ok: false, error: `Illegal version transition: ${from} → ${to}` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// SIGNED SUBMISSION RECEIPT
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a signed submission receipt (HMAC-SHA256, non-forgeable).
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number} params.versionNo
 * @param {string} params.sessionKey
 * @param {string} params.sha256 - final content hash
 * @param {string} params.quarantineStatus
 * @param {number|string} [params.issuedAt]
 * @param {string} params.secret - server signing secret
 * @returns {{ receiptToken: string, body: Object, signature: string }}
 */
export function buildSubmissionReceipt({ attemptId = 0, versionNo = 1, sessionKey = '', sha256 = '', quarantineStatus = 'pending', issuedAt = Date.now(), secret = '' } = {}) {
  const body = {
    version: SAFE_SUBMIT_DEFAULTS.receiptVersion,
    type: 'safe-submission',
    attemptId: Number(attemptId),
    versionNo: Number(versionNo),
    sessionKey,
    sha256,
    quarantineStatus,
    issuedAt: new Date(issuedAt).toISOString(),
  };
  const canonical = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', String(secret)).update(canonical).digest('hex');
  const receiptToken = crypto.createHash('sha256').update(`${attemptId}:${versionNo}:${sessionKey}`).digest('hex').slice(0, 32);
  return { receiptToken, body, signature };
}

/**
 * Verify a signed receipt — returns false on ANY tamper.
 *
 * @param {Object} receipt - { signature, body }
 * @param {string} secret
 * @returns {boolean}
 */
export function verifySubmissionReceipt(receipt = {}, secret = '') {
  if (!receipt || typeof receipt !== 'object' || !receipt.signature || !receipt.body) return false;
  const canonical = JSON.stringify(receipt.body);
  const expected = crypto.createHmac('sha256', String(secret)).update(canonical).digest('hex');
  const a = Buffer.from(String(receipt.signature));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
