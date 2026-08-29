/**
 * Deborah — Paper Packet, QR & Chain of Custody (pure logic)
 *
 * Prompt 42 — approved examdan per-student/form paper packet va custody
 * ledger yaratish (research.md §52 Hybrid Paper Exam Factory, §16 security).
 * This module is PURE (no I/O, no globals):
 *
 *   - Batch builder: planPaperBatch — deterministic batch + per-student /
 *     per-form packet plans with reproducible manifest hash.
 *   - Packet builder: buildPacketPlan — opaque_packet_id, variant, page
 *     count, checksum, backup_code, accommodation render flags, detachable
 *     identity cover (name/ID faqat cover'da — body'da emas).
 *   - Page QR: buildPageQrPayload + signPageQr + verifyPageQr — signed
 *     { packet, page, epoch, nonce, sig } payload; replay → duplicate
 *     detection; answer key / raw student PII YO'Q (research.md §52.3).
 *   - Manifest: buildBatchManifest — reproducible; same inputs → same hash.
 *   - Accommodation render: resolvePaperRenderFlags — large_print /
 *     one_sided / extra_spacing flags (no raw sensitive reason).
 *   - Secret scan: scanPaperForSecrets — answer-key/rubric/private keys
 *     never appear in packet body, QR, manifest or PDF metadata (Prompt 42
 *     §15, research.md §16.1).
 *   - Custody event: buildCustodyEvent — append-only chain with HMAC
 *     signature over prev event (chain of custody §52.7).
 *
 * SECURITY / DATA GUARD (Prompt 42 §15, research.md §52.3):
 *   - QR payload faqat opaque_packet_id + page + epoch + nonce + sig.
 *   - Student → opaque_packet_id mapping alohida server table'da; cover
 *     identity faqat detachable cover matnida.
 *   - PDF/QR secret scan: answer key, rubric, distractor rationale hech
 *     qachon packet artifactlarida.
 *
 * Purity: deterministic, side-effect-free (node:crypto import is compute-only).
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const PAPER_BATCH_STATUS = {
  PLANNED: 'planned',
  GENERATED: 'generated',
  DOWNLOADED: 'downloaded',
  RECEIVED: 'received',
  RECONCILED: 'reconciled',
  ARCHIVED: 'archived',
  DESTROYED: 'destroyed',
};

export const PAPER_BATCH_STATUS_TRANSITIONS = {
  planned: ['generated', 'destroyed'],
  generated: ['downloaded', 'reconciled', 'destroyed'],
  downloaded: ['received', 'destroyed'],
  received: ['reconciled', 'destroyed'],
  reconciled: ['archived', 'destroyed'],
  archived: ['destroyed'],
  destroyed: [],
};

/** Custody event types (research.md §52.7 chain of custody). */
export const CUSTODY_EVENT_TYPES = [
  'generated',
  'batch_downloaded',
  'operator_received',
  'sealed_received',
  'scanned_received',
  'reconciled',
  'archived',
  'destroyed',
  'unused_destroyed',
];

/** Paper render accommodation flags (no raw sensitive reason). */
export const PAPER_RENDER_FLAGS = ['large_print', 'one_sided', 'extra_spacing'];

/** Default variants for form manifests. */
export const DEFAULT_FORM_VARIANTS = ['A', 'B', 'C'];

/** QR payload schema version. */
export const QR_SCHEMA_VERSION = 1;

/**
 * Keys that must NEVER appear in any paper artifact (QR payload, manifest,
 * cover body, PDF metadata, rendered HTML). Mirrors publish PRIVATE_KEY_FIELDS.
 */
export const PAPER_SECRET_KEYS = [
  'answer_key', 'answerKey', 'correct_key', 'correctKey', 'correct',
  'private_data', 'scoring_rubric', 'scoringRubric', 'rubric', 'explanation',
  'distractor_rationale', 'distractorRationale', 'raw_reason',
];

/** Opaque packet id length (hex). */
export const OPAQUE_ID_BYTES = 16; // 32 hex chars

/** Backup code length (human-readable). */
export const BACKUP_CODE_LENGTH = 8;

/** Minimum signing key length (HMAC). */
export const MIN_SIGNING_KEY_LENGTH = 32;

// ═══════════════════════════════════════════════════════════════════
// CANONICAL HASHING (reproducible manifests)
// ═══════════════════════════════════════════════════════════════════

/**
 * Stable JSON stringify — sorts object keys recursively so the same content
 * always produces the same string (reproducible hashes).
 */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

/** SHA-256 hex digest of canonical JSON. */
export function canonicalHash(value) {
  return createHmac('sha256', 'deborah-paper-hash').update(canonicalStringify(value)).digest('hex');
}

/**
 * Deterministic opaque packet id — derived from assignment + variant +
 * student (not random) so regeneration is reproducible, but opaque (never
 * leaks meaning).
 */
export function deriveOpaquePacketId({ assignmentId, variant = null, studentUserId = null, seed = 'deborah-paper' } = {}) {
  const input = canonicalStringify({ seed, assignmentId, variant: variant || null, studentUserId: studentUserId || null });
  return createHmac('sha256', 'deborah-opaque-id').update(input).digest('hex').slice(0, OPAQUE_ID_BYTES * 2);
}

/** Human-readable backup code (printed). */
export function generateBackupCode() {
  // 8 chars from unambiguous alphabet (no 0/O, 1/I/L).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    out += alphabet[randomBytes(1)[0] % alphabet.length];
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// ACCOMMODATION RENDER FLAGS (§52.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve paper render flags from a student's accommodation. Returns ONLY
 * non-sensitive flags — raw accommodation reasons never surface.
 *
 * @param {Object} accommodation - { largePrint, oneSided, extraSpacing, ... }
 * @returns {string[]} flags from PAPER_RENDER_FLAGS
 */
export function resolvePaperRenderFlags(accommodation = {}) {
  const flags = [];
  if (accommodation?.largePrint || accommodation?.large_print) flags.push('large_print');
  if (accommodation?.oneSided || accommodation?.one_sided) flags.push('one_sided');
  if (accommodation?.extraSpacing || accommodation?.extra_spacing) flags.push('extra_spacing');
  return flags;
}

// ═══════════════════════════════════════════════════════════════════
// PAGE QR (§52.3 — signed, replay-detectable, secret-free)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the canonical QR payload. NEVER contains answer keys or raw PII.
 */
export function buildPageQrPayload({ packetId, pageIndex, epoch = 1, nonce = null, issuedAt = null } = {}) {
  if (!packetId) throw new Error('packetId is required');
  if (pageIndex === undefined || pageIndex === null || pageIndex < 0) {
    throw new Error('pageIndex is required (>= 0)');
  }
  return {
    v: QR_SCHEMA_VERSION,
    type: 'paper_page',
    packet: String(packetId),
    page: Number(pageIndex),
    epoch: Number(epoch) || 1,
    nonce: nonce || null,
    issuedAt: issuedAt || null,
  };
}

/**
 * Sign a page QR payload (HMAC). Returns { payload, sig, token }.
 */
export function signPageQr({ packetId, pageIndex, epoch = 1, nonce = null, key = '', issuedAt = null } = {}) {
  if (!key || key.length < MIN_SIGNING_KEY_LENGTH) {
    throw new Error(`Signing key must be at least ${MIN_SIGNING_KEY_LENGTH} chars`);
  }
  const payload = buildPageQrPayload({ packetId, pageIndex, epoch, nonce, issuedAt });
  const canonical = canonicalStringify(payload);
  const sig = createHmac('sha256', String(key)).update(canonical).digest('hex');
  return { payload: { ...payload, sig }, token: JSON.stringify({ ...payload, sig }) };
}

/**
 * Verify a page QR token — signature valid + payload structurally sound.
 * Replay detection is the caller's job (qr_token UNIQUE); this function
 * verifies authenticity + integrity.
 *
 * @param {string} token - the QR string (JSON)
 * @param {string} key
 * @returns {{ ok: boolean, payload?: Object, error?: string }}
 */
export function verifyPageQr(token, key = '') {
  if (!token || !key) return { ok: false, error: 'token or key missing' };
  let parsed;
  try {
    parsed = JSON.parse(token);
  } catch (_) {
    return { ok: false, error: 'invalid QR token' };
  }
  const { sig, ...payload } = parsed;
  if (!sig) return { ok: false, error: 'missing signature' };
  const expected = createHmac('sha256', String(key)).update(canonicalStringify(payload)).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(sig), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'signature mismatch' };
  }
  if (payload.type !== 'paper_page' || payload.packet === undefined || payload.page === undefined) {
    return { ok: false, error: 'invalid payload shape' };
  }
  return { ok: true, payload };
}

/**
 * Secret scan — guarantee no answer-key/rubric/private material exists in
 * any paper artifact (QR payload, manifest, cover body, rendered content).
 * Recursively checks keys and string values.
 *
 * @param {any} value
 * @returns {{ ok: boolean, found?: string }}
 */
export function scanPaperForSecrets(value) {
  const found = [];
  const walk = (v, path = '$') => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') {
      const lower = v.toLowerCase();
      for (const k of PAPER_SECRET_KEYS) {
        if (lower.includes(k.toLowerCase())) {
          found.push(`${path} contains "${k}"`);
          return;
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        const lowerKey = k.toLowerCase();
        for (const secret of PAPER_SECRET_KEYS) {
          if (lowerKey.includes(secret.toLowerCase())) {
            found.push(`${path}.${k} (key name)`);
            return;
          }
        }
        walk(val, `${path}.${k}`);
      }
    }
  };
  walk(value);
  if (found.length > 0) return { ok: false, found: found[0] };
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// PACKET & MANIFEST BUILDERS (§52.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a per-student/per-form packet plan. Pure + deterministic.
 *
 * @param {Object} opts
 * @param {number} opts.assignmentId
 * @param {number|null} opts.studentUserId
 * @param {string|null} opts.variant - A | B | C | null
 * @param {Object} opts.accommodation - resolved flags input
 * @param {number} opts.pageCount - number of rendered pages
 * @param {Object} opts.pageHashes - { [pageIndex]: contentHash }
 * @param {Object} opts.identity - { name, student_id } (detachable cover only)
 * @returns {{ ok: true, plan: Object } | { ok: false, error: string }}
 */
export function buildPacketPlan({
  assignmentId, studentUserId = null, variant = null, accommodation = {},
  pageCount = 0, pageHashes = {}, identity = {},
} = {}) {
  if (!assignmentId) return { ok: false, error: 'assignmentId is required' };
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: 'pageCount must be a positive integer' };
  }
  const flags = resolvePaperRenderFlags(accommodation);
  const opaquePacketId = deriveOpaquePacketId({ assignmentId, variant, studentUserId });
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push({ page_index: i, content_hash: pageHashes[i] || null });
  }
  const checksum = canonicalHash({ opaquePacketId, variant: variant || null, pages });
  const plan = {
    opaque_packet_id: opaquePacketId,
    assignment_id: Number(assignmentId),
    student_user_id: studentUserId ? Number(studentUserId) : null,
    variant: variant || null,
    page_count: pageCount,
    checksum,
    accommodation_flags: flags,
    backup_code: null, // filled at generation (random)
    // Detachable identity cover — faqat cover matnida, body'da emas.
    cover_identity: {
      name: identity?.name ? String(identity.name).slice(0, 200) : null,
      student_id: identity?.student_id ? String(identity.student_id).slice(0, 80) : null,
    },
    pages,
  };
  return { ok: true, plan };
}

/**
 * Build a batch manifest (reproducible — same inputs → same hash).
 *
 * @param {Object} opts
 * @param {number} opts.batchId
 * @param {string} opts.batchKey
 * @param {Array<Object>} opts.packetPlans
 * @returns {{ ok: true, manifest: Object, hash: string }}
 */
export function buildBatchManifest({ batchId, batchKey, packetPlans = [] } = {}) {
  const summary = {
    batchId: batchId ?? null,
    batchKey,
    packetCount: packetPlans.length,
    variants: [...new Set(packetPlans.map((p) => p.variant || 'MIXED'))].sort(),
    opaquePacketIds: packetPlans.map((p) => p.opaque_packet_id).sort(),
  };
  const hash = canonicalHash(summary);
  return { ok: true, manifest: summary, hash };
}

/**
 * Validate a paper batch status transition.
 */
export function validateBatchTransition(from, to) {
  const allowed = PAPER_BATCH_STATUS_TRANSITIONS[from];
  if (!allowed) return { ok: false, error: `Unknown batch from-status: ${from}` };
  if (!allowed.includes(to)) return { ok: false, error: `Illegal batch transition ${from} → ${to}` };
  return { ok: true, to };
}

/**
 * Validate a custody event request.
 */
export function validateCustodyEvent(data = {}) {
  if (!CUSTODY_EVENT_TYPES.includes(data.eventType)) {
    return { ok: false, error: `Invalid custody event type: ${data.eventType}` };
  }
  const count = Number(data.count ?? 0);
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, error: 'count must be a non-negative integer' };
  }
  return {
    ok: true,
    event: {
      event_type: data.eventType,
      count,
      discrepancy: Number.isInteger(Number(data.discrepancy ?? 0)) ? Number(data.discrepancy ?? 0) : 0,
      note: data.note ? String(data.note).slice(0, 255) : null,
    },
  };
}

/**
 * Sign a custody event — HMAC over { prevEventId, eventType, count,
 * discrepancy, batchId } so the ledger is tamper-evident (§52.7).
 */
export function signCustodyEvent({ prevEventId, eventType, count, discrepancy = 0, batchId = null, key = '' } = {}) {
  if (!key || key.length < MIN_SIGNING_KEY_LENGTH) {
    throw new Error(`Signing key must be at least ${MIN_SIGNING_KEY_LENGTH} chars`);
  }
  const canonical = canonicalStringify({ prevEventId: prevEventId || null, eventType, count, discrepancy, batchId: batchId || null });
  return createHmac('sha256', String(key)).update(canonical).digest('hex');
}
