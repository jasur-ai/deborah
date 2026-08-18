/**
 * Deborah — Uch-strike Client Collector & Server Classifier Service
 *
 * Prompt 34 — server-side half of the proctor evidence engine (research.md
 * §31). Receives raw browser events, classifies them (threshold + dedupe),
 * maintains the strike lifecycle (warning 1 → warning 2 → terminate 3) and
 * builds a tamper-evident hash chain per attempt.
 *
 * THREE LAYERS (§31.1) kept separate:
 *   1. Raw event — stored append-only with hash chain (evidence).
 *   2. Policy classification — confirmed focus-loss strikes (this service).
 *   3. Academic decision — teacher review (never automated hukm).
 *
 * SECURITY / DATA GUARD (Prompt 34 §15):
 *   - blur o'zi strike EMAS; network/camera failure strike EMAS (technical).
 *   - Incident faqat duration >= 2000ms AND not deduped (overlap / 5000ms).
 *   - Server receive timestamp authoritative; client claims evidence only.
 *   - Third confirmed strike → server-side attempt termination (transition).
 *   - Reopen → yangi epoch; old-epoch events reject.
 *   - Hash chain: hash_i = H(hash_{i-1} || canonical_event_i) (§31.5).
 *
 * Graceful degradation: without PostgreSQL, read paths return null/[] and
 * write paths throw a clear 'PostgreSQL required' error.
 */

import { sql } from 'kysely';
import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { getAttempt, transitionAttempt, ATTEMPT_STATUS } from '../attempt/index.js';
import {
  STRIKE_LEVELS,
  validateProctorEvent,
  classifyProctorEvent,
  dedupeEvent,
  strikeLevelFor,
  hashChainEvent,
  evaluateProctorEpoch,
  buildTimelineEntry,
} from './proctor.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Load the previous event's hash (tail of the chain) for an attempt.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} attemptId
 * @returns {Promise<Object|null>}
 */
async function loadChainTail(db, attemptId) {
  return db.selectFrom('proctor_events')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', attemptId)
    .orderBy('id', 'desc')
    .limit(1)
    .select(['id', 'event_hash', 'client_seq'])
    .executeTakeFirst()
    .catch(() => null);
}

/**
 * Load confirmed strikes for an attempt (server-classified only).
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} attemptId
 * @returns {Promise<Array<Object>>}
 */
async function loadConfirmedStrikes(db, attemptId) {
  const rows = await db.selectFrom('proctor_events')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', attemptId)
    .where(sql`classification->>'confirmed'`, '=', 'true')
    .orderBy('id', 'asc')
    .selectAll()
    .execute()
    .catch(() => []);
  return rows.map((r) => ({
    clientSeq: r.client_seq,
    startedAt: new Date(r.started_at).getTime(),
    durationMs: r.duration_ms,
  }));
}

/**
 * Record a batch of raw proctor events from the browser collector.
 *
 * Flow (server-authoritative):
 *   1. Attempt ownership + epoch check (old-epoch events rejected).
 *   2. Per event: validate shape, classify (threshold + technical exclusions),
 *      dedupe against prior confirmed strikes (overlap / 5000ms window).
 *   3. Persist append-only with hash chain + server_received_at.
 *   4. Count confirmed strikes → strike level (warning_1 → warning_2 → terminated).
 *   5. THIRD confirmed strike → server-side attempt termination (transition) + audit.
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number} params.userId
 * @param {Array<Object>} params.events - [{ clientSeq, eventType, startedAt, durationMs, deviceId, epoch }]
 * @param {Object} [params.opts] - { now }
 * @returns {Promise<Object>} result with per-event classification + timeline
 */
export async function recordProctorEvents({ attemptId, userId, events = [], opts = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const attempt = await getAttempt(attemptId, userId);
  if (!attempt) return { ok: false, code: 'not_found' };

  const currentEpoch = Number(attempt.epoch ?? 1);
  const now = opts.now || Date.now();

  // Idempotency: reject already-stored client_seqs (client retry).
  const stored = await db.selectFrom('proctor_events')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', attemptId)
    .where('user_id', '=', userId)
    .select(['client_seq', 'device_id'])
    .execute()
    .catch(() => []);
  const storedKeys = new Set(stored.map((r) => `${r.device_id}:${r.client_seq}`));

  const confirmedBefore = await loadConfirmedStrikes(db, attemptId);
  const chainTail = await loadChainTail(db, attemptId);
  let prevHash = chainTail?.event_hash ?? null;

  const results = [];
  let confirmedCount = confirmedBefore.length;
  let terminated = false;

  // In-batch dedupe set — grows as confirmed incidents are added, so two
  // overlapping focus-loss events in the SAME batch still dedupe to one strike.
  const confirmedSoFar = [...confirmedBefore];

  for (const event of events) {
    const key = `${event.deviceId}:${event.clientSeq}`;
    if (storedKeys.has(key)) {
      results.push({ seq: event.clientSeq, status: 'duplicate', confirmed: false });
      continue; // idempotent retry
    }

    const shape = validateProctorEvent(event);
    if (!shape.ok) {
      results.push({ seq: event.clientSeq, status: 'rejected', reason: shape.reason, confirmed: false });
      continue;
    }

    const epochCheck = evaluateProctorEpoch({ eventEpoch: event.epoch, currentEpoch });
    if (!epochCheck.allowed) {
      results.push({ seq: event.clientSeq, status: 'rejected', reason: epochCheck.reason, confirmed: false });
      continue;
    }

    const classification = classifyProctorEvent({ eventType: event.eventType, durationMs: event.durationMs });

    // Dedupe against server-confirmed incidents INCLUDING this batch's own
    // newly-confirmed ones (overlap / 5000ms window — one episode, one strike).
    let dedupe = { deduped: false, withSeq: null, reason: null };
    if (classification.confirmed) {
      dedupe = dedupeEvent({ event, confirmed: confirmedSoFar });
      if (dedupe.deduped) {
        results.push({
          seq: event.clientSeq,
          status: 'deduped',
          reason: dedupe.reason,
          withSeq: dedupe.withSeq,
          confirmed: false,
          classification: { ...classification, deduped: true, withSeq: dedupe.withSeq },
        });
        continue; // same incident — not a new strike
      }
    }

    const isConfirmed = classification.confirmed && !dedupe.deduped;
    if (isConfirmed) {
      confirmedCount += 1;
      confirmedSoFar.push({ clientSeq: event.clientSeq, startedAt: event.startedAt, durationMs: event.durationMs });
    }
    const strikeLevel = isConfirmed ? strikeLevelFor(confirmedCount) : null;

    const eventHash = hashChainEvent({
      prevHash,
      canonicalEvent: {
        clientSeq: event.clientSeq,
        eventType: event.eventType,
        startedAt: event.startedAt,
        durationMs: event.durationMs,
        deviceId: event.deviceId,
        epoch: event.epoch,
        serverReceivedAt: now,
      },
    });

    await db.insertInto('proctor_events')
      .values({
        tenant_id: getTenantId(),
        attempt_id: attemptId,
        user_id: userId,
        client_seq: event.clientSeq,
        event_type: event.eventType,
        started_at: new Date(event.startedAt),
        duration_ms: event.durationMs,
        device_id: event.deviceId,
        epoch: event.epoch,
        prev_hash: prevHash,
        event_hash: eventHash,
        classification: isConfirmed
          ? { confirmed: true, reason: classification.reason }
          : { confirmed: false, reason: classification.reason, technical: classification.technical },
        strike_level: strikeLevel,
        server_received_at: new Date(now),
      })
      .execute()
      .catch(() => null);

    prevHash = eventHash;
    storedKeys.add(key);

    results.push({
      seq: event.clientSeq,
      status: isConfirmed ? 'confirmed' : (classification.technical ? 'technical' : 'recorded'),
      confirmed: isConfirmed,
      strikeLevel,
      reason: classification.reason,
    });

    // ── THIRD confirmed strike → server-side termination (§13) ──
    if (strikeLevel === STRIKE_LEVELS.TERMINATED && !terminated) {
      terminated = true;
      await transitionAttempt(attemptId, ATTEMPT_STATUS.TERMINATED, userId).catch(() => null);
    }
  }

  // ── Audit (§17) ──
  const confirmedThisBatch = results.filter((r) => r.confirmed).length;
  if (confirmedThisBatch > 0 || terminated) {
    await audit({
      action: AUDIT_ACTIONS.PROCTOR_EVENT,
      userId,
      resourceType: 'attempt',
      resourceId: attemptId,
      details: {
        received: results.length,
        confirmed: confirmedCount,
        confirmed_this_batch: confirmedThisBatch,
        terminated,
        events: results.filter((r) => r.confirmed).map((r) => ({ seq: r.seq, level: r.strikeLevel })),
      },
    }).catch(() => null);
  }
  if (terminated) {
    await audit({
      action: AUDIT_ACTIONS.PROCTOR_TERMINATE,
      userId,
      resourceType: 'attempt',
      resourceId: attemptId,
      details: { confirmed_count: confirmedCount, reason: 'third_strike' },
    }).catch(() => null);
  }

  // Timeline built ONLY from valid events (a rejected/duplicate event may lack
  // startedAt — new Date(undefined).toISOString() would throw).
  const timeline = [];
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const ev = events[i];
    if (!ev || !Number.isFinite(ev.startedAt)) continue;
    timeline.push(buildTimelineEntry({
      event: ev,
      classification: { confirmed: r.confirmed, reason: r.reason, technical: r.status === 'technical' },
      strikeLevel: r.strikeLevel,
    }));
  }

  return {
    ok: true,
    confirmedCount,
    terminated,
    results,
    timeline,
  };
}

/**
 * Get the proctor state for an attempt (strikes + explainable timeline).
 *
 * @param {number} attemptId
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
export async function getProctorState(attemptId, userId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const attempt = await getAttempt(attemptId, userId);
    if (!attempt) return null;
    const rows = await db.selectFrom('proctor_events')
      .where('tenant_id', '=', getTenantId())
      .where('attempt_id', '=', attemptId)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .selectAll()
      .execute()
      .catch(() => []);
    const confirmed = rows.filter((r) => r.classification?.confirmed === true);
    return {
      attemptId,
      status: attempt.status,
      confirmedCount: confirmed.length,
      terminated: attempt.status === ATTEMPT_STATUS.TERMINATED,
      timeline: rows.map((r) => buildTimelineEntry({
        event: { clientSeq: r.client_seq, startedAt: new Date(r.started_at).getTime(), eventType: r.event_type, durationMs: r.duration_ms },
        classification: r.classification || {},
        strikeLevel: r.strike_level,
      })),
      chainTail: rows[rows.length - 1]?.event_hash ?? null,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Reopen an attempt after termination (teacher action, §14) — bumps the epoch
 * so old-epoch events are rejected, and moves the attempt back to in_progress.
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {string} params.actor - privileged actor (admin username/id)
 * @returns {Promise<Object>} result with the NEW epoch
 */
export async function reopenAttempt({ attemptId, actor = 'admin' } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const attempt = await db.selectFrom('attempts')
    .where('id', '=', attemptId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);
  if (!attempt) return { ok: false, code: 'not_found' };

  const newEpoch = Number(attempt.epoch ?? 1) + 1;

  await db.updateTable('attempts')
    .set({ epoch: newEpoch, status: ATTEMPT_STATUS.IN_PROGRESS, updated_at: new Date() })
    .where('id', '=', attemptId)
    .where('tenant_id', '=', getTenantId())
    .execute()
    .catch(() => null);

  // Re-issue a fresh lease (the terminated lease was released). The active-
  // lease partial UNIQUE is on (tenant_id, assignment_id, user_id) WHERE
  // status='active' — onConflictDoNothing() matches any conflicting unique
  // index, so a pre-existing active lease is never duplicated.
  await db.insertInto('attempt_leases')
    .values({
      tenant_id: getTenantId(),
      attempt_id: attemptId,
      assignment_id: attempt.assignment_id,
      user_id: attempt.user_id,
      status: 'active',
      started_at: new Date(),
    })
    .onConflictDoNothing()
    .execute()
    .catch(() => null);

  await audit({
    action: AUDIT_ACTIONS.PROCTOR_REOPEN,
    userId: attempt.user_id,
    resourceType: 'attempt',
    resourceId: attemptId,
    details: { actor, from_epoch: attempt.epoch ?? 1, to_epoch: newEpoch },
  }).catch(() => null);

  return { ok: true, attemptId, epoch: newEpoch, status: ATTEMPT_STATUS.IN_PROGRESS };
}
