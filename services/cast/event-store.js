/**
 * Deborah — Cast Event Store
 * --------------------------
 * Event commit + revisioned state update bitta logical operation.
 * Expected revision conflict → deterministic STALE_REVISION.
 *
 * Real Firebase: atomic multi-path update.
 * Local DB: serialized transaction.
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';

export const CAST_PRIVATE_ROOT = 'cast_private';
export const CAST_SESSION_ROOT = 'cast_sessions';

/**
 * Commit an event + state snapshot atomically, with revision conflict check.
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {number} input.expectedRevision — client's known revision
 * @param {object} input.event — { type, payload, serverAt } (revision assigned here)
 * @param {object} input.state — next state snapshot (revision +1)
 * @returns {Promise<{revision:number, event:object, state:object}>}
 */
export async function commitEvent({ sessionId, expectedRevision, event, state }) {
  const result = await fb.transaction(`${CAST_SESSION_ROOT}/${sessionId}/state`, (current) => {
    const cur = current && current.revision ? current.revision : 0;
    if (expectedRevision && cur !== expectedRevision) {
      // Abort transaction → STALE_REVISION
      return undefined;
    }
    const nextRevision = cur + 1;
    const committedEvent = {
      eventId: 'evt_' + crypto.randomBytes(6).toString('hex'),
      sessionId,
      revision: nextRevision,
      type: event.type,
      serverAt: event.serverAt || Date.now(),
      payload: event.payload || {},
    };
    return { ...(current || {}), ...state, revision: nextRevision, lastEvent: committedEvent };
  });

  if (!result.committed) {
    const latest = (await fb.get(`${CAST_SESSION_ROOT}/${sessionId}/state`)).val();
    throw new CastError(CAST_ERROR_CODES.STALE_REVISION, 'Sessiya holati yangilangan', {
      latestRevision: latest?.revision || 0,
      expectedRevision,
    });
  }

  const committedEvent = result.value?.lastEvent;
  // Persist event to the private event log (append by revision key)
  if (committedEvent) {
    const key = String(committedEvent.revision).padStart(8, '0');
    await fb.set(`${CAST_PRIVATE_ROOT}/${sessionId}/events/${key}`, committedEvent);
  }

  return {
    revision: result.value.revision,
    event: committedEvent,
    state: result.value,
  };
}

/**
 * Get events after a revision (replay / recovery).
 */
export async function getEventsAfter(sessionId, afterRevision = 0) {
  const snap = await fb.get(`${CAST_PRIVATE_ROOT}/${sessionId}/events`);
  if (!snap.exists()) return [];
  const all = snap.val() || {};
  return Object.keys(all)
    .sort()
    .filter((k) => Number(k) > afterRevision)
    .map((k) => all[k]);
}

/**
 * Get current state (with revision).
 */
export async function getCurrentState(sessionId) {
  const snap = await fb.get(`${CAST_SESSION_ROOT}/${sessionId}/state`);
  return snap.exists() ? snap.val() : null;
}

/**
 * Write an audit record (PII-safe).
 */
export async function writeAudit(sessionId, audit) {
  // C5-07 (item 12): session'ga bog'liq bo'lmagan audit (masalan global
  // degradation) sessionId'siz yoziladi — `cast_private/null/` path'ini yaratmaymiz.
  if (!sessionId) {
    return 'aud_global_' + crypto.randomBytes(6).toString('hex'); // global audit — persist qilinmaydi, log/live uchun
  }
  const id = 'aud_' + crypto.randomBytes(6).toString('hex');
  await fb.set(`${CAST_PRIVATE_ROOT}/${sessionId}/audit/${id}`, {
    ...audit,
    auditId: id,
    at: audit.at || Date.now(),
  });
  return id;
}
