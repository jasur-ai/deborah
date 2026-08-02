/**
 * Edikit — Uch-strike Client Collector & Server Classifier (pure logic)
 *
 * Prompt 34 — visibility/fullscreen incidentlarini dedupe qilib THIRD strike'da
 * server termination (research.md §31 — Proctor evidence engine). This module
 * is PURE (no I/O): the browser collector and the server service both rely on
 * the SAME contracts here.
 *
 * Three-layer model (§31.1) — kept strictly separated:
 *   1. Raw event:  { visibility_hidden 4.1 sec }  — client evidence only
 *   2. Policy classification: confirmed focus-loss strike — THIS module
 *   3. Academic decision: teacher/institution review — human layer
 *
 * Key rules (Prompt 34 §15 security/data guard):
 *   - blur O'ZI strike EMAS (clicking away is normal);
 *   - network offline / camera failure strike EMAS (technical events);
 *   - incident faqat duration >= threshold (2000ms) bo'lsa confirmed;
 *   - overlap / 5000ms window ichidagi blur+hidden+fullscreen dedupe qilinadi
 *     (bitta incident = bitta strike, uchta event emas);
 *   - warning 1 → warning 2 → terminate 3 (server-side transitions).
 *   - Reopen yangi epoch — old-epoch events reject (Prompt 32 §12 bilan bir xil
 *     tamoyil, attempt epoch).
 *   - Hash chain: hash_i = H(hash_{i-1} || canonical_event_i) (§31.5 evidence
 *     integrity — append-only, tamper-evident timeline).
 *
 * Purity: deterministic, side-effect-free (sha256 only).
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Server-side strike threshold — incident < 2000ms is NOT a strike (§10). */
export const STRIKE_THRESHOLD_MS = 2000;

/** Dedupe window — events within 5000ms of a confirmed incident are the same incident (§11). */
export const DEDUPE_WINDOW_MS = 5000;

/** Strike lifecycle: warning 1 → warning 2 → terminate on the 3rd confirmed incident (§13). */
export const STRIKE_LIMIT = 3;

export const PROCTOR_EVENT_TYPES = {
  VISIBILITY_HIDDEN: 'visibility_hidden',
  FULLSCREEN_EXIT: 'fullscreen_exit',
  BLUR: 'blur',
  NETWORK_OFFLINE: 'network_offline',
  CAMERA_FAILURE: 'camera_failure',
};

/**
 * Event types that are NEVER strikes (technical/accommodation exclusions §12/§15):
 *   - blur — clicking away is normal browser behaviour;
 *   - network_offline / camera_failure — technical failures, not misconduct.
 */
export const TECHNICAL_EVENT_TYPES = new Set([
  PROCTOR_EVENT_TYPES.BLUR,
  PROCTOR_EVENT_TYPES.NETWORK_OFFLINE,
  PROCTOR_EVENT_TYPES.CAMERA_FAILURE,
]);

/** Focus-loss events that CAN escalate to a strike (after threshold + dedupe). */
export const FOCUS_LOSS_TYPES = new Set([
  PROCTOR_EVENT_TYPES.VISIBILITY_HIDDEN,
  PROCTOR_EVENT_TYPES.FULLSCREEN_EXIT,
]);

export const STRIKE_LEVELS = {
  WARNING_1: 'warning_1',
  WARNING_2: 'warning_2',
  TERMINATED: 'terminated',
};

// ═══════════════════════════════════════════════════════════════════
// RAW EVENT VALIDATION (layer 1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a raw proctor event shape from the browser collector.
 *
 * @param {Object} event
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateProctorEvent(event = {}) {
  if (!event || typeof event !== 'object') return { ok: false, reason: 'not_object' };
  if (!Number.isInteger(event.clientSeq) || event.clientSeq <= 0) return { ok: false, reason: 'invalid_client_seq' };
  if (!Object.values(PROCTOR_EVENT_TYPES).includes(event.eventType)) return { ok: false, reason: 'unknown_event_type' };
  if (!Number.isFinite(event.startedAt)) return { ok: false, reason: 'invalid_started_at' };
  if (!Number.isInteger(event.durationMs) || event.durationMs < 0) return { ok: false, reason: 'invalid_duration' };
  if (typeof event.deviceId !== 'string' || !event.deviceId) return { ok: false, reason: 'invalid_device' };
  if (!Number.isFinite(event.epoch)) return { ok: false, reason: 'invalid_epoch' };
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// POLICY CLASSIFICATION (layer 2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Classify a single raw event into a strike candidate.
 *   - technical types (blur/network/camera) → never a strike;
 *   - focus-loss types → strike ONLY if duration >= threshold (2000ms);
 *   - server receive time is authoritative; client claims are evidence only.
 *
 * @param {Object} params
 * @param {string} params.eventType
 * @param {number} params.durationMs
 * @param {number} [params.thresholdMs]
 * @returns {{ confirmed: boolean, reason: string, technical: boolean }}
 */
export function classifyProctorEvent({ eventType = '', durationMs = 0, thresholdMs = STRIKE_THRESHOLD_MS } = {}) {
  if (TECHNICAL_EVENT_TYPES.has(eventType)) {
    return { confirmed: false, reason: 'technical_event', technical: true };
  }
  if (!FOCUS_LOSS_TYPES.has(eventType)) {
    return { confirmed: false, reason: 'unknown_type', technical: false };
  }
  if (durationMs < thresholdMs) {
    return { confirmed: false, reason: 'below_threshold', technical: false };
  }
  return { confirmed: true, reason: 'focus_loss_strike', technical: false };
}

/**
 * Dedupe: does this event OVERLAP a previously confirmed incident?
 * Two events are the same incident when their [startedAt, startedAt+duration)
 * intervals overlap AND the gap is within the 5000ms dedupe window (§11).
 *
 * @param {Object} params
 * @param {Object} params.event - { startedAt, durationMs }
 * @param {Array<Object>} params.confirmed - [{ startedAt, durationMs }]
 * @param {number} [params.windowMs]
 * @returns {{ deduped: boolean, withSeq: number|null, reason: string|null }}
 */
export function dedupeEvent({ event, confirmed = [], windowMs = DEDUPE_WINDOW_MS } = {}) {
  const start = event.startedAt;
  const end = start + (event.durationMs || 0);
  for (const c of confirmed) {
    const cStart = c.startedAt;
    const cEnd = cStart + (c.durationMs || 0);
    const overlap = Math.min(end, cEnd) - Math.max(start, cStart) > 0;
    const withinWindow = Math.abs(start - cStart) <= windowMs;
    // OR semantics: same incident when the intervals OVERLAP or the event
    // starts within the 5000ms dedupe window of a confirmed incident (the
    // blur+hidden+fullscreen episode is ONE focus-loss, not three strikes).
    if (overlap || withinWindow) {
      return { deduped: true, withSeq: c.clientSeq, reason: 'overlap_dedupe' };
    }
  }
  return { deduped: false, withSeq: null, reason: null };
}

/**
 * Compute the strike level for a confirmed incident count (1-based).
 * warning_1 → warning_2 → terminated (3rd confirmed incident).
 *
 * @param {number} confirmedCount - 1-based count AFTER this incident
 * @returns {string|null} STRIKE_LEVELS or null when below warning
 */
export function strikeLevelFor(confirmedCount = 0) {
  if (confirmedCount >= STRIKE_LIMIT) return STRIKE_LEVELS.TERMINATED;
  if (confirmedCount === 2) return STRIKE_LEVELS.WARNING_2;
  if (confirmedCount === 1) return STRIKE_LEVELS.WARNING_1;
  return null;
}

/**
 * Hash-chain an event: hash_i = H(hash_{i-1} || canonical_event_i) (§31.5).
 * Append-only, tamper-evident timeline for the attempt.
 *
 * @param {Object} params
 * @param {string|null} params.prevHash
 * @param {Object} params.canonicalEvent - { clientSeq, eventType, startedAt, durationMs, deviceId, epoch, serverReceivedAt }
 * @returns {string} 64-char sha256 hex
 */
export function hashChainEvent({ prevHash = null, canonicalEvent = {} } = {}) {
  const canonical = JSON.stringify({ prev: prevHash || '', event: canonicalEvent });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════
// EPOCH / REOPEN (Prompt 34 §14, Prompt 32 §12 tamoyili)
// ═══════════════════════════════════════════════════════════════════

/**
 * Old-epoch events (written before a teacher reopen) must be rejected — they
 * belong to the previous attempt epoch and are not misconduct evidence for the
 * new one.
 *
 * @param {number} eventEpoch
 * @param {number} currentEpoch
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function evaluateProctorEpoch({ eventEpoch, currentEpoch } = {}) {
  if (!Number.isFinite(eventEpoch) || !Number.isFinite(currentEpoch)) {
    return { allowed: false, reason: 'invalid_epoch' };
  }
  if (eventEpoch !== currentEpoch) return { allowed: false, reason: 'stale_epoch' };
  return { allowed: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// COMPLETENESS / TIMELINE CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the explainable timeline entry for the teacher (research.md §31.2 —
 * no "cheat probability", just facts):
 *
 *   10:03:12 Fullscreen exited — 4.1s — Strike 1
 *   10:19:44 Network offline — 38s — Technical event (no strike)
 *
 * @param {Object} params
 * @param {Object} params.event - raw event
 * @param {Object} params.classification - from classifyProctorEvent
 * @param {string|null} params.strikeLevel
 * @returns {Object} explainable timeline entry
 */
export function buildTimelineEntry({ event, classification = {}, strikeLevel = null } = {}) {
  return {
    seq: event.clientSeq,
    time: new Date(event.startedAt).toISOString(),
    type: event.eventType,
    durationMs: event.durationMs,
    summary: classification.technical
      ? 'Technical event (no strike)'
      : (classification.confirmed ? `Focus-loss strike${strikeLevel ? ` — ${strikeLevel}` : ''}` : 'Below threshold (no strike)'),
    reason: classification.reason,
    strikeLevel,
  };
}
