/**
 * Edikit — Cast Confusion Signal Service (C3-10)
 * ------------------------------------------------
 * Participant private quick signal (confused / too_fast / technical_issue / need_example).
 *
 * Key principles:
 * - Individual identity DEFAULT yashirin — faqat aggregate count public.
 * - Per-participant cooldown + same-signal dedupe (time window).
 * - Teacher acknowledgement action (countsni acknowledge qiladi).
 * - Hech qachon participant-to-participant chat emas.
 */

// ── Signal enum ──
export const CONFUSION_SIGNALS = ['confused', 'too_fast', 'technical_issue', 'need_example'];

export const SIGNAL_LABELS = {
  confused: 'Chalkashdim',
  too_fast: 'Juda tez',
  technical_issue: 'Texnik muammo',
  need_example: 'Misol kerak',
};

export const SIGNAL_ICONS = {
  confused: '🤔',
  too_fast: '⚡',
  technical_issue: '🔧',
  need_example: '💡',
};

export const SIGNAL_COOLDOWN_MS = 15000;
export const SIGNAL_DEDUPE_WINDOW_MS = 30000;

// ── Pure helpers ──

/** Signal enum'ga tegishlimi? */
export function isValidSignal(signal) {
  return CONFUSION_SIGNALS.includes(signal);
}

/**
 * Same participant, same signal — time window ichida dedupe.
 * @param {number|null} lastSentAt  oxirgi yuborilgan vaqt (0 bo'lsa birinchi)
 * @param {number} now
 * @param {number} windowMs
 * @returns {boolean} true → dedupe (yuborma)
 */
export function isDuplicateSignal(lastSentAt, now, windowMs = SIGNAL_DEDUPE_WINDOW_MS) {
  if (!lastSentAt) return false;
  return now - lastSentAt < windowMs;
}

/**
 * Aggregate count — identity mutlaqo yo'q.
 * Same participant, same signal — window ichida dedupe (bitta sanaladi).
 * @param {Array<{signal:string, at:number, participantId?:string}>} signals
 * @param {number} now
 * @param {number} windowMs
 * @returns {{counts:Object<string,number>, total:number, windowMs:number}}
 */
export function aggregateSignals(signals, now = Date.now(), windowMs = SIGNAL_DEDUPE_WINDOW_MS) {
  const counts = {};
  for (const s of CONFUSION_SIGNALS) counts[s] = 0;
  const seen = new Set();
  let total = 0;
  for (const sig of signals || []) {
    if (!isValidSignal(sig.signal)) continue;
    if (now - (sig.at || 0) > windowMs) continue; // eskirgan
    const dedupeKey = sig.participantId ? `${sig.participantId}:${sig.signal}` : `${sig.signal}:${sig.at}`;
    if (seen.has(dedupeKey)) continue; // same participant, same signal
    seen.add(dedupeKey);
    counts[sig.signal] += 1;
    total += 1;
  }
  return { counts, total, windowMs };
}

/**
 * Public-safe aggregate payload (identity yashirin).
 * @param {Object<string,number>} counts
 * @returns {{type:string, counts:Object<string,number>, total:number, acknowledged:Object<string,boolean>}}
 */
export function buildAggregatePayload(counts) {
  const ack = {};
  for (const s of CONFUSION_SIGNALS) ack[s] = false;
  return { type: 'confusion_aggregate', counts, total: Object.values(counts).reduce((a, b) => a + b, 0), acknowledged: ack };
}

/**
 * Teacher acknowledgement — signal acknowledge qilinadi.
 * @param {Object} aggregate  buildAggregatePayload natijasi
 * @param {string|string[]} signals
 * @returns {Object} yangi aggregate (acknowledged=true)
 */
export function acknowledgeSignals(aggregate, signals) {
  const list = Array.isArray(signals) ? signals : [signals];
  const next = {
    ...aggregate,
    acknowledged: { ...(aggregate.acknowledged || {}) },
  };
  for (const s of list) {
    if (isValidSignal(s)) next.acknowledged[s] = true;
  }
  return next;
}

/**
 * Identity'ni butunlay olib tashlash — safe projection uchun.
 * @param {Array<{signal:string, participantId:string, at:number}>} records
 * @returns {Array<{signal:string, at:number}>}
 */
export function stripIdentity(records) {
  return (records || []).map(({ signal, at }) => ({ signal, at }));
}

export default {
  CONFUSION_SIGNALS,
  SIGNAL_LABELS,
  SIGNAL_ICONS,
  SIGNAL_COOLDOWN_MS,
  SIGNAL_DEDUPE_WINDOW_MS,
  isValidSignal,
  isDuplicateSignal,
  aggregateSignals,
  buildAggregatePayload,
  acknowledgeSignals,
  stripIdentity,
};
