/**
 * Edikit — Trace Context Propagation (Prompt 69)
 *
 * AsyncLocalStorage asosidagi trace context — HTTP so'rovidan boshlangan
 * trace ID barcha ichki async chaqiruvlarga (DB, outbox, provider) uzatiladi.
 * Node.js AsyncLocalStorage orqali bir xil trace ID butun request oqimida
 * saqlanadi — research.md §38.3 talabi (HTTP, Socket, DB, queue, provider bir
 * trace ID bilan).
 *
 * PURE: hech qanday I/O yo'q, faqat context storage.
 */

import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Run a function within a trace context.
 * @param {{ traceId: string, spanId: string, sampled?: boolean }} ctx
 * @param {Function} fn
 * @returns {*} fn natijasi (async bo'lsa Promise)
 */
export function runWithTrace(ctx, fn) {
  return storage.run(ctx || null, fn);
}

/**
 * Get the current trace context (or null).
 * @returns {{ traceId: string, spanId: string, sampled?: boolean } | null}
 */
export function getTraceContext() {
  return storage.getStore() || null;
}

/** True if a trace context is active. */
export function hasTraceContext() {
  return !!storage.getStore();
}

export default { runWithTrace, getTraceContext, hasTraceContext };
