/**
 * Deborah — AI Question Generator 50/30/20 Module Barrel
 *
 * Prompt 53 — source-grounded, difficulty-controlled item draft pipeline
 * (research.md §8, §8.6 lifecycle). Pure schema (50/30/20 counts,
 * blueprint validation, job planning, source verifier, distractor
 * generator, validators, lifecycle guard) + DB service (graceful
 * degradation, teacher review → item-bank publish).
 */

export * from './ai-question-gen.schema.js';
export * from './ai-question-gen.service.js';
