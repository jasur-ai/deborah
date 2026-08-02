/**
 * Edikit — Scan, Reconciliation, OMR & OCR Module Barrel Export
 *
 * Prompt 43 — scanned paper pages'ni silent loss'siz student/questionga
 * reconcile qilish (research.md §52.5 scan quality gate, §16 security).
 *
 * Pure schema (no I/O) + DB service (graceful degradation without PG).
 */

export * from './scan.schema.js';
export * from './scan.service.js';
