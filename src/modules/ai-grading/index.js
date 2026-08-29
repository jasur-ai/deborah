/**
 * Deborah — Written AI Grading Shadow Mode Module Barrel
 *
 * Prompt 51 — rubric/evidence structured AI draft'ni student/final
 * grade'dan yashirin shadow rejimda ishlatish. Pure schema (no I/O —
 * PII redaction, prompt template, strict schema, evidence span, concept/
 * evidence/contradiction pipeline, deterministic aggregation, confidence
 * routing, shadow comparison) + DB service (graceful degradation).
 */

export * from './ai-grading.schema.js';
export * from './ai-grading.service.js';
