/**
 * Edikit — Exam Command Center, Incident & Notifications Module Barrel Export
 *
 * Prompt 41 — exam-day health, attendance va incidentlarni bitta auditable
 * command centerda boshqarish (research.md §53.4–53.7, §38.5).
 *
 * Pure schema (no I/O) + DB service (graceful degradation without PG).
 */

export * from './command-center.schema.js';
export * from './command-center.service.js';
