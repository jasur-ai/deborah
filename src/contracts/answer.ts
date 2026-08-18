/**
 * Deborah — Answer Command Contract
 *
 * Typed schemas for answer submission and ACK protocol.
 * Answer processing is server-authoritative:
 *   - Server calculates elapsed time (client timeMs is IGNORED)
 *   - First answer is final (duplicates are rejected)
 *   - Late/stale epoch answers are rejected
 *   - Every answer gets a deterministic ACK
 */

// ── Client → Server: Submit answer ──
export interface AnswerCommand {
  /** Game code (5 digits) */
  code: string;
  /** Question index */
  qIndex: number;
  /** Selected option index (0-based) */
  optionIndex: number;
  /** Idempotency key — unique per answer attempt (prevents double-submit) */
  idempotencyKey: string;
}

// ── Server → Client: Answer ACK ──
export type AnswerAckStatus = 'accepted' | 'rejected_duplicate' | 'rejected_late' | 'rejected_epoch' | 'rejected_ownership' | 'rejected_invalid';

export interface AnswerAck {
  status: AnswerAckStatus;
  qIndex: number;
  /** Server-calculated elapsed time in ms */
  serverTimeMs: number;
  /** Only on 'accepted': idempotency key that was accepted */
  idempotencyKey?: string;
  /** Only on 'rejected_*': human-readable reason */
  reason?: string;
}

// ── Server-authoritative elapsed time calculation ──
export function calculateServerTimeMs(questionStartedAt: number, now: number = Date.now()): number {
  return Math.max(0, now - questionStartedAt);
}

// ── Idempotency key generation (client-side helper) ──
export function generateIdempotencyKey(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── Answer validation ──
export interface ServerSideAnswer {
  option: number;
  server_time_ms: number;
  idempotencyKey: string;
  accepted_at: number;
}
