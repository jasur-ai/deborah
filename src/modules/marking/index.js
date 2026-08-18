/**
 * Deborah — Marker Allocation, Calibration & Moderation Module Barrel
 *
 * Prompt 46 — pseudonymous marking, workload/conflict allocation, anchor
 * calibration, single/sample/second/double marking modes, disagreement &
 * adjudication, external examiner scoping (research.md §17, §54.3). Pure
 * schema (no I/O) + DB service (graceful degradation without PG).
 */

export * from './marking.schema.js';
export * from './marking.service.js';
