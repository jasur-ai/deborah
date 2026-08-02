/**
 * Edikit — Academic Grade Rules & Deterministic Calculation Module Barrel
 *
 * Prompt 45 — weighted, hurdle, late, exempt, resit va rounding qoidalarini
 * versionlangan DSL'da hisoblash (research.md §18 GradingService). Pure
 * schema (no I/O) + DB service (graceful degradation without PG).
 */

export * from './grading.schema.js';
export * from './grading.service.js';
