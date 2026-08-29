/**
 * Deborah — Seat, Proctor, Hall Ticket & Check-in Module Barrel Export
 *
 * Prompt 40 — published schedule asosida seat/proctor assignment va
 * offline-tolerant check-in (research.md §15, §53.3 Seating).
 *
 * Pure schema (no I/O) + DB service (graceful degradation without PG).
 */

export * from './seating.schema.js';
export * from './seating.service.js';
