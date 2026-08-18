/**
 * Deborah — Cast Session Choreography Schema (C3-14)
 * --------------------------------------------------
 * Teacher reusable block sequence yaratadi. Har block typed config'ga ega.
 * Block enum (15):
 *   LOBBY, INSTRUCTIONS, THINK, QUESTION, CONFIDENCE, REVEAL, DISCUSS, REVOTE,
 *   EXPLANATION, LEADERBOARD, CLASS_GOAL, BREAK, QUICK_PROMPT, REDEMPTION, EXIT_TICKET
 */

import { z } from 'zod';

// ── Block type enum ──
export const CHOREO_BLOCK_TYPES = {
  LOBBY: 'LOBBY',
  INSTRUCTIONS: 'INSTRUCTIONS',
  THINK: 'THINK',
  QUESTION: 'QUESTION',
  CONFIDENCE: 'CONFIDENCE',
  REVEAL: 'REVEAL',
  DISCUSS: 'DISCUSS',
  REVOTE: 'REVOTE',
  EXPLANATION: 'EXPLANATION',
  LEADERBOARD: 'LEADERBOARD',
  CLASS_GOAL: 'CLASS_GOAL',
  BREAK: 'BREAK',
  QUICK_PROMPT: 'QUICK_PROMPT',
  REDEMPTION: 'REDEMPTION',
  EXIT_TICKET: 'EXIT_TICKET',
};

export const CHOREO_BLOCK_TYPE_LIST = Object.values(CHOREO_BLOCK_TYPES);

// ── Template mode ──
export const CHOREO_MODES = {
  GUIDED: 'guided', // teacher qo'lda boshqaradi (exit trigger ixtiyoriy)
  FULLY_AUTO: 'fully_auto', // har block uchun valid exit trigger talab qilinadi
};

// ── Per-block typed config schemas (item 2) ──
const BlockConfigSchema = {
  [CHOREO_BLOCK_TYPES.LOBBY]: z.object({}).default({}),
  [CHOREO_BLOCK_TYPES.INSTRUCTIONS]: z
    .object({
      title: z.string().max(80).optional().default(''),
      text: z.string().max(500).optional().default(''),
      seconds: z.number().int().min(0).max(600).optional().default(0),
    })
    .default({}),
  [CHOREO_BLOCK_TYPES.THINK]: z
    .object({ seconds: z.number().int().min(0).max(30).optional().default(5) })
    .default({}),
  [CHOREO_BLOCK_TYPES.QUESTION]: z
    .object({
      questionId: z.string().optional().nullable().default(null),
      scorable: z.boolean().optional().default(true),
      seconds: z.number().int().min(5).max(600).optional().default(30),
    })
    .default({}),
  [CHOREO_BLOCK_TYPES.CONFIDENCE]: z.object({}).default({}),
  [CHOREO_BLOCK_TYPES.REVEAL]: z
    .object({ showCorrect: z.boolean().optional().default(true) })
    .default({}),
  [CHOREO_BLOCK_TYPES.DISCUSS]: z
    .object({ seconds: z.number().int().min(0).max(600).optional().default(60) })
    .default({}),
  [CHOREO_BLOCK_TYPES.REVOTE]: z.object({}).default({}),
  [CHOREO_BLOCK_TYPES.EXPLANATION]: z
    .object({ mode: z.enum(['short_answer', 'mcq', 'auto']).optional().default('auto') })
    .default({}),
  [CHOREO_BLOCK_TYPES.LEADERBOARD]: z
    .object({ visible: z.boolean().optional().default(true) })
    .default({}),
  [CHOREO_BLOCK_TYPES.CLASS_GOAL]: z.object({}).default({}),
  [CHOREO_BLOCK_TYPES.BREAK]: z
    .object({ seconds: z.number().int().min(10).max(600).optional().default(60) })
    .default({}),
  [CHOREO_BLOCK_TYPES.QUICK_PROMPT]: z
    .object({
      promptText: z.string().min(1).max(500),
      seconds: z.number().int().min(5).max(600).optional().default(30),
    })
    .default({ promptText: '', seconds: 30 }),
  [CHOREO_BLOCK_TYPES.REDEMPTION]: z.object({}).default({}),
  [CHOREO_BLOCK_TYPES.EXIT_TICKET]: z
    .object({ promptText: z.string().max(500).optional().default('') })
    .default({}),
};

/** Parse + coerce a block config for a given type (throws on invalid). */
export function parseBlockConfig(type, config = {}) {
  const schema = BlockConfigSchema[type];
  if (!schema) return {};
  const parsed = schema.safeParse(config ?? {});
  return parsed.success ? parsed.data : null;
}

// ── Block schema ──
export const ChoreoBlockSchema = z
  .object({
    id: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/),
    type: z.enum(CHOREO_BLOCK_TYPE_LIST),
    config: z.record(z.unknown()).default({}),
  })
  .strict();

// ── Template model (item 3) ──
export const ChoreoTemplateSchema = z
  .object({
    templateId: z.string().regex(/^chor_[a-zA-Z0-9]+$/),
    version: z.number().int().min(1).default(1),
    ownerActorId: z.string().min(1),
    name: z.string().min(1).max(80),
    description: z.string().max(300).optional().default(''),
    mode: z.enum([CHOREO_MODES.GUIDED, CHOREO_MODES.FULLY_AUTO]).default(CHOREO_MODES.GUIDED),
    blocks: z.array(ChoreoBlockSchema).min(1).max(40),
    schemaVersion: z.number().int().min(1).default(1),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();

// ── Event → block completion map (runtime synch with state machine) ──
// Phase-transition event'lar choreography block'ini tugatadi.
export const BLOCK_COMPLETES_ON = {
  [CHOREO_BLOCK_TYPES.LOBBY]: ['cast:sessionStarted'],
  [CHOREO_BLOCK_TYPES.INSTRUCTIONS]: ['choreo:advance'],
  [CHOREO_BLOCK_TYPES.THINK]: ['cast:questionOpened'],
  [CHOREO_BLOCK_TYPES.QUESTION]: ['cast:questionClosed', 'poe:predictionLocked', 'orb:ended'],
  [CHOREO_BLOCK_TYPES.CONFIDENCE]: ['cast:questionClosed'],
  [CHOREO_BLOCK_TYPES.REVEAL]: ['cast:questionRevealed', 'poe:analysisShown'],
  [CHOREO_BLOCK_TYPES.DISCUSS]: ['discuss:ended'],
  [CHOREO_BLOCK_TYPES.REVOTE]: ['revote:closed'],
  [CHOREO_BLOCK_TYPES.EXPLANATION]: ['poe:explanationClosed'],
  [CHOREO_BLOCK_TYPES.LEADERBOARD]: ['cast:questionOpened'],
  [CHOREO_BLOCK_TYPES.CLASS_GOAL]: ['choreo:advance'],
  [CHOREO_BLOCK_TYPES.BREAK]: ['choreo:advance'],
  [CHOREO_BLOCK_TYPES.QUICK_PROMPT]: ['cast:questionClosed'],
  [CHOREO_BLOCK_TYPES.REDEMPTION]: ['choreo:advance'],
  [CHOREO_BLOCK_TYPES.EXIT_TICKET]: ['cast:questionClosed'],
};

/** Blocks that need a manual/timer exit (no phase event completes them). */
export const MANUAL_EXIT_BLOCKS = new Set([
  CHOREO_BLOCK_TYPES.INSTRUCTIONS,
  CHOREO_BLOCK_TYPES.CLASS_GOAL,
  CHOREO_BLOCK_TYPES.BREAK,
  CHOREO_BLOCK_TYPES.REDEMPTION,
]);

/** Blocks whose dependency is "kamida bitta QUESTION block o'tgan bo'lishi". */
export const QUESTION_DEPENDENT_BLOCKS = new Set([
  CHOREO_BLOCK_TYPES.CONFIDENCE,
  CHOREO_BLOCK_TYPES.REVEAL,
  CHOREO_BLOCK_TYPES.REVOTE,
  CHOREO_BLOCK_TYPES.EXPLANATION,
  CHOREO_BLOCK_TYPES.REDEMPTION,
]);

export const CHOREO_BLOCK_TYPE_LABELS = {
  [CHOREO_BLOCK_TYPES.LOBBY]: 'Lobbi',
  [CHOREO_BLOCK_TYPES.INSTRUCTIONS]: 'Ko‘rsatma',
  [CHOREO_BLOCK_TYPES.THINK]: 'O‘ylash',
  [CHOREO_BLOCK_TYPES.QUESTION]: 'Savol',
  [CHOREO_BLOCK_TYPES.CONFIDENCE]: 'Ishonch',
  [CHOREO_BLOCK_TYPES.REVEAL]: 'Natija',
  [CHOREO_BLOCK_TYPES.DISCUSS]: 'Muhokama',
  [CHOREO_BLOCK_TYPES.REVOTE]: 'Qayta ovoz',
  [CHOREO_BLOCK_TYPES.EXPLANATION]: 'Tushuntirish',
  [CHOREO_BLOCK_TYPES.LEADERBOARD]: 'Reyting',
  [CHOREO_BLOCK_TYPES.CLASS_GOAL]: 'Sinf maqsadi',
  [CHOREO_BLOCK_TYPES.BREAK]: 'Tanaffus',
  [CHOREO_BLOCK_TYPES.QUICK_PROMPT]: 'Tezkor savol',
  [CHOREO_BLOCK_TYPES.REDEMPTION]: 'Redemption',
  [CHOREO_BLOCK_TYPES.EXIT_TICKET]: 'Chiqish bileti',
};

export default {
  CHOREO_BLOCK_TYPES,
  CHOREO_BLOCK_TYPE_LIST,
  CHOREO_MODES,
  CHOREO_BLOCK_TYPE_LABELS,
  BlockConfigSchema,
  parseBlockConfig,
  ChoreoBlockSchema,
  ChoreoTemplateSchema,
  BLOCK_COMPLETES_ON,
  MANUAL_EXIT_BLOCKS,
  QUESTION_DEPENDENT_BLOCKS,
};
