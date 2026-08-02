/**
 * Edikit — Paper Packet, QR & Chain of Custody Module Barrel Export
 *
 * Prompt 42 — approved examdan per-student/form paper packet va custody
 * ledger yaratish (research.md §52 Hybrid Paper Exam Factory, §16 security).
 *
 * Pure schema (no I/O) + DB service (graceful degradation without PG).
 */

export * from './paper.schema.js';
export * from './paper.service.js';
