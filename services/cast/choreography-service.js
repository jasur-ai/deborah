/**
 * Edikit — Cast Session Choreography Service (C3-14)
 * ---------------------------------------------------
 * Teacher reusable block sequence yaratadi (composer); Director runtime'da
 * current/next block, timing va override'ni boshqaradi.
 *
 * Composer ops — PURE funksiyalar (test qilish oson):
 *   addBlock / removeBlock / reorderBlock / moveBlockUp / moveBlockDown /
 *   duplicateBlock / editBlockConfig
 * Validation: dependency (revote-first-vote, reveal-scorable), fully-auto
 *   exit trigger, duration, preview/rehearsal, migration + diff.
 * Runtime: buildRuntime, advanceRuntime (pure), overrideNext, health, coverage.
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CastError, CAST_ERROR_CODES } from './errors.js';
import {
  CHOREO_BLOCK_TYPES,
  CHOREO_BLOCK_TYPE_LIST,
  CHOREO_MODES,
  ChoreoBlockSchema,
  ChoreoTemplateSchema,
  parseBlockConfig,
  BLOCK_COMPLETES_ON,
  MANUAL_EXIT_BLOCKS,
  QUESTION_DEPENDENT_BLOCKS,
} from './choreography-schema.js';

export { CHOREO_BLOCK_TYPES, CHOREO_BLOCK_TYPE_LIST, CHOREO_MODES, BLOCK_COMPLETES_ON } from './choreography-schema.js';

const TEMPLATE_ROOT = (ownerId) => `cast_choreo/${ownerId}`;

// ── ID / model ──
export function generateTemplateId() {
  return 'chor_' + crypto.randomBytes(6).toString('hex');
}

export function generateBlockId(prefix = 'b') {
  return `${prefix}_${crypto.randomBytes(3).toString('hex')}`;
}

export function createTemplate({ ownerActorId, name, description = '', mode = CHOREO_MODES.GUIDED }) {
  const now = Date.now();
  return {
    templateId: generateTemplateId(),
    version: 1,
    ownerActorId,
    name: String(name || '').trim() || 'Yangi choreography',
    description: String(description || '').trim(),
    mode,
    blocks: [],
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Composer ops (item 4-5) — pure ──
function withBlockId(block) {
  const parsed = ChoreoBlockSchema.safeParse(block);
  if (!parsed.success) {
    throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, 'Blok noto‘g‘ri: ' + (parsed.error.issues[0]?.message || ''));
  }
  const type = parsed.data.type;
  const cfg = parseBlockConfig(type, parsed.data.config);
  if (cfg === null) {
    throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, `Blok config noto‘g‘ri (${type})`);
  }
  return { ...parsed.data, config: cfg };
}

export function addBlock(template, block, position = null) {
  const b = withBlockId(block);
  if (template.blocks.some((x) => x.id === b.id)) {
    throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, `Takroriy blok ID: ${b.id}`);
  }
  const blocks = [...template.blocks];
  const idx = position === null || position === undefined ? blocks.length : Math.max(0, Math.min(position, blocks.length));
  blocks.splice(idx, 0, b);
  return { ...template, blocks, updatedAt: Date.now() };
}

export function removeBlock(template, blockId) {
  if (!template.blocks.some((b) => b.id === blockId)) {
    throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, 'Blok topilmadi');
  }
  return { ...template, blocks: template.blocks.filter((b) => b.id !== blockId), updatedAt: Date.now() };
}

export function reorderBlock(template, blockId, toIndex) {
  const from = template.blocks.findIndex((b) => b.id === blockId);
  if (from === -1) throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, 'Blok topilmadi');
  const blocks = [...template.blocks];
  const [moved] = blocks.splice(from, 1);
  const target = Math.max(0, Math.min(toIndex, blocks.length));
  blocks.splice(target, 0, moved);
  return { ...template, blocks, updatedAt: Date.now() };
}

/** Keyboard move up (item 5 — drag-and-dropga alternativa). */
export function moveBlockUp(template, blockId) {
  const from = template.blocks.findIndex((b) => b.id === blockId);
  if (from <= 0) return template; // birinchi — yuqoriga yo'l yo'q
  return reorderBlock(template, blockId, from - 1);
}

/** Keyboard move down. */
export function moveBlockDown(template, blockId) {
  const from = template.blocks.findIndex((b) => b.id === blockId);
  if (from === -1 || from >= template.blocks.length - 1) return template;
  return reorderBlock(template, blockId, from + 1);
}

export function duplicateBlock(template, blockId) {
  const src = template.blocks.find((b) => b.id === blockId);
  if (!src) throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, 'Blok topilmadi');
  const copy = { ...src, id: generateBlockId('b'), config: JSON.parse(JSON.stringify(src.config)) };
  const idx = template.blocks.findIndex((b) => b.id === blockId);
  return addBlock(template, copy, idx + 1);
}

export function editBlockConfig(template, blockId, config) {
  const idx = template.blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, 'Blok topilmadi');
  const type = template.blocks[idx].type;
  const parsed = parseBlockConfig(type, config);
  if (parsed === null) {
    throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, `Blok config noto‘g‘ri (${type})`);
  }
  const blocks = [...template.blocks];
  blocks[idx] = { ...blocks[idx], config: parsed };
  return { ...template, blocks, updatedAt: Date.now() };
}

// ── Dependency validation (items 6-9) ──
export function validateTemplate(template) {
  const errors = [];
  const warnings = [];
  const blocks = template.blocks || [];

  if (blocks.length === 0) {
    errors.push('Kamida 1 blok talab qilinadi');
    return { valid: false, errors, warnings };
  }

  const ids = new Set();
  for (const b of blocks) {
    if (!b.id || ids.has(b.id)) errors.push(`Takroriy/yaroqsiz blok ID: ${b.id}`);
    ids.add(b.id);
    if (!CHOREO_BLOCK_TYPE_LIST.includes(b.type)) errors.push(`Noma'lum blok turi: ${b.type}`);
  }

  if (blocks[0].type !== CHOREO_BLOCK_TYPES.LOBBY) {
    warnings.push('Birinchi blok odatda LOBBY bo‘ladi');
  }

  // Question-dependent blocks (items 7-8): oldinda kamida 1 QUESTION bo'lishi kerak
  blocks.forEach((b, i) => {
    if (!QUESTION_DEPENDENT_BLOCKS.has(b.type)) return;
    const before = blocks.slice(0, i);
    const hasQuestion = before.some((x) => x.type === CHOREO_BLOCK_TYPES.QUESTION);
    if (!hasQuestion) {
      errors.push(`Blok "${b.id}" (${b.type}) oldidan kamida bitta QUESTION blok talab qilinadi`);
    }
    // Reveal — scorable question (item 8)
    if (b.type === CHOREO_BLOCK_TYPES.REVEAL) {
      const lastQuestion = [...before].reverse().find((x) => x.type === CHOREO_BLOCK_TYPES.QUESTION);
      if (lastQuestion && lastQuestion.config?.scorable === false) {
        errors.push(`REVEAL oldidan QUESTION blok "${lastQuestion.id}" scorable emas`);
      }
    }
    // Revote — first vote (item 7)
    if (b.type === CHOREO_BLOCK_TYPES.REVOTE) {
      // REVOTE va QUESTION orasida boshqa REVOTE bo'lmasin (ikki marta revote)
      const sinceLastQuestion = before.slice((() => { const li = before.map((x) => x.type).lastIndexOf(CHOREO_BLOCK_TYPES.QUESTION); return li; })() + 1);
      if (sinceLastQuestion.some((x) => x.type === CHOREO_BLOCK_TYPES.REVOTE)) {
        errors.push('REVOTE oldidan birinchi ovoz (QUESTION) talab qilinadi — ketma-ket revote mumkin emas');
      }
    }
  });

  // Fully-auto exit trigger (item 9)
  if (template.mode === CHOREO_MODES.FULLY_AUTO) {
    blocks.forEach((b) => {
      if (b.type === CHOREO_BLOCK_TYPES.LOBBY) return; // session:start trigger
      const hasTimer = Number(b.config?.seconds || 0) > 0;
      const autoTriggers = (BLOCK_COMPLETES_ON[b.type] || []).filter((t) => t !== 'choreo:advance');
      if (!hasTimer && autoTriggers.length === 0) {
        errors.push(`Fully-auto rejimda blok "${b.id}" (${b.type}) uchun exit trigger talab qilinadi (timer yoki avtomatik)`);
      }
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Duration estimate (item 10) ──
const BLOCK_BASE_SECONDS = {
  [CHOREO_BLOCK_TYPES.LOBBY]: 20,
  [CHOREO_BLOCK_TYPES.INSTRUCTIONS]: 15,
  [CHOREO_BLOCK_TYPES.THINK]: 5,
  [CHOREO_BLOCK_TYPES.QUESTION]: 30,
  [CHOREO_BLOCK_TYPES.CONFIDENCE]: 5,
  [CHOREO_BLOCK_TYPES.REVEAL]: 20,
  [CHOREO_BLOCK_TYPES.DISCUSS]: 60,
  [CHOREO_BLOCK_TYPES.REVOTE]: 30,
  [CHOREO_BLOCK_TYPES.EXPLANATION]: 90,
  [CHOREO_BLOCK_TYPES.LEADERBOARD]: 15,
  [CHOREO_BLOCK_TYPES.CLASS_GOAL]: 30,
  [CHOREO_BLOCK_TYPES.BREAK]: 60,
  [CHOREO_BLOCK_TYPES.QUICK_PROMPT]: 30,
  [CHOREO_BLOCK_TYPES.REDEMPTION]: 45,
  [CHOREO_BLOCK_TYPES.EXIT_TICKET]: 60,
};

export function blockDurationSeconds(block) {
  const cfg = block.config || {};
  const seconds = Number(cfg.seconds || 0);
  return seconds > 0 ? seconds : BLOCK_BASE_SECONDS[block.type] || 15;
}

export function estimateDuration(template) {
  const blocks = template.blocks || [];
  let total = 0;
  const perBlock = {};
  for (const b of blocks) {
    const d = blockDurationSeconds(b);
    perBlock[b.id] = d;
    total += d;
  }
  return { totalSeconds: total, perBlock, blockCount: blocks.length };
}

// ── Preview / rehearsal (item 11) — block sequence'ni simulyatsiya qiladi ──
export function previewTemplate(template) {
  const validation = validateTemplate(template);
  const timeline = [];
  let cursor = 0;
  for (const b of template.blocks || []) {
    const d = blockDurationSeconds(b);
    timeline.push({
      blockId: b.id,
      type: b.type,
      startMs: cursor,
      endMs: cursor + d,
      exit: (BLOCK_COMPLETES_ON[b.type] || []).filter((t) => t !== 'choreo:advance'),
    });
    cursor += d;
  }
  return {
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    timeline,
    totalSeconds: cursor,
    mode: template.mode,
  };
}

// ── Migration + diff (item 18) ──
export function migrateTemplate(template, targetVersion = 2) {
  let t = { ...template };
  while ((t.schemaVersion || 1) < targetVersion) {
    if (t.schemaVersion === 1) {
      // v1 → v2: config'larni typed schema orqali normalize qilamiz
      const blocks = (t.blocks || []).map((b) => {
        const cfg = parseBlockConfig(b.type, b.config || {});
        return { ...b, config: cfg === null ? {} : cfg };
      });
      t = { ...t, blocks, schemaVersion: 2, updatedAt: Date.now() };
    } else {
      break;
    }
  }
  return t;
}

/**
 * Diff between two templates (item 18).
 * @returns {{ added: string[], removed: string[], changed: string[], moved: string[] }}
 */
export function diffTemplates(a, b) {
  const aMap = new Map((a?.blocks || []).map((x) => [x.id, x]));
  const bMap = new Map((b?.blocks || []).map((x) => [x.id, x]));
  const aIds = aMap.keys();
  const bIds = bMap.keys();
  const added = [...bIds].filter((id) => !aMap.has(id));
  const removed = [...aIds].filter((id) => !bMap.has(id));
  const changed = [];
  const moved = [];
  const aIndex = new Map((a?.blocks || []).map((x, i) => [x.id, i]));
  const bIndex = new Map((b?.blocks || []).map((x, i) => [x.id, i]));
  for (const [id, bb] of bMap) {
    const aa = aMap.get(id);
    if (!aa) continue;
    if (JSON.stringify({ type: aa.type, config: aa.config }) !== JSON.stringify({ type: bb.type, config: bb.config })) {
      changed.push(id);
    }
    if (aIndex.get(id) !== bIndex.get(id)) moved.push(id);
  }
  return { added, removed, changed, moved };
}

// ── Runtime (items 12-16) ──
export function buildRuntime(template, actorId) {
  return {
    templateId: template.templateId,
    version: template.version,
    ownerActorId: template.ownerActorId || actorId,
    mode: template.mode || CHOREO_MODES.GUIDED,
    blocks: (template.blocks || []).map((b) => ({ ...b, config: JSON.parse(JSON.stringify(b.config || {})) })),
    currentIndex: 0,
    nextIndex: Math.min(1, (template.blocks || []).length - 1),
    overrideNext: null,
    startedAt: null,
    blockStartedAt: null,
    events: [],
  };
}

export function currentBlock(runtime) {
  if (!runtime || !runtime.blocks) return null;
  return runtime.blocks[runtime.currentIndex] || null;
}

export function nextBlock(runtime) {
  if (!runtime || !runtime.blocks) return null;
  if (runtime.overrideNext) {
    const b = runtime.blocks.find((x) => x.id === runtime.overrideNext);
    if (b) return b;
  }
  return runtime.blocks[runtime.nextIndex] || null;
}

export function coverage(runtime) {
  if (!runtime || !runtime.blocks || runtime.blocks.length === 0) return 0;
  return Math.min(1, (runtime.currentIndex + 1) / runtime.blocks.length);
}

/** Invalid jump — state machine'da rad etiladi (item 16). */
export function assertValidJump(template, currentIndex, targetBlockId) {
  const blocks = template?.blocks || [];
  const targetIdx = blocks.findIndex((b) => b.id === targetBlockId);
  if (targetIdx === -1) {
    throw new CastError(CAST_ERROR_CODES.INVALID_JUMP, 'Nishon blok topilmadi');
  }
  if (targetIdx <= currentIndex) {
    throw new CastError(CAST_ERROR_CODES.INVALID_JUMP, 'Faqat oldinga sakrash mumkin');
  }
  // Dependency — nishon blok uchun oldingi bloklar yetarli bo'lishi kerak
  const before = blocks.slice(0, targetIdx);
  if (QUESTION_DEPENDENT_BLOCKS.has(blocks[targetIdx].type)) {
    const hasQuestion = before.some((x) => x.type === CHOREO_BLOCK_TYPES.QUESTION);
    if (!hasQuestion) {
      throw new CastError(CAST_ERROR_CODES.INVALID_JUMP, `Blok "${targetBlockId}" oldidan QUESTION talab qilinadi`);
    }
  }
  return targetIdx;
}

/**
 * Advance runtime (pure) — current block event bilan tugasa, keyingisiga o'tadi.
 * Bir event BIR NECHTA blokni tugatishi mumkin (masalan: questionClosed
 * QUESTION + CONFIDENCE'ni yopadi) — loop bilan chain advance qilinadi.
 * Manual advance ('choreo:advance') — har bir bosishda bitta qadam.
 * @returns {object} yangi runtime (o'zgarmasa ham origin runtime qaytariladi)
 */
export function advanceRuntime(runtime, eventType, serverAt, by = null) {
  if (!runtime || !runtime.blocks || runtime.blocks.length === 0) return runtime;
  const isManual = eventType === 'choreo:advance';
  let rt = runtime;
  let guard = 0;

  while (guard++ <= (rt.blocks.length || 1) + 1) {
    const cur = rt.blocks[rt.currentIndex];
    if (!cur) break;
    const completes = (BLOCK_COMPLETES_ON[cur.type] || []).includes(eventType);
    if (!isManual && !completes) break;

    let nextIdx = rt.currentIndex + 1;
    // Override (item 14-15): overrideNext'ga sakraydi
    if (rt.overrideNext) {
      const oi = rt.blocks.findIndex((b) => b.id === rt.overrideNext);
      if (oi > rt.currentIndex) nextIdx = oi;
    }

    const finished = nextIdx >= rt.blocks.length;
    const toId = finished ? null : rt.blocks[nextIdx].id;
    rt = {
      ...rt,
      currentIndex: nextIdx,
      nextIndex: finished ? nextIdx : Math.min(nextIdx + 1, rt.blocks.length - 1),
      overrideNext: null,
      blockStartedAt: serverAt,
      events: [...(rt.events || []).slice(-59), { at: serverAt, type: eventType, by, fromBlockId: cur.id, toBlockId: toId, finished: finished || undefined }],
    };
    if (isManual || finished) break; // manual — bitta qadam; finished — to'xta
    // Chain faqat "companion" bloklarga davom etadi (CONFIDENCE) — boshqa blok
    // (masalan ikkinchi QUESTION) bir xil event bilan o'tkazib yuborilmaydi.
    const nextCur = rt.blocks[rt.currentIndex];
    if (!nextCur) break;
    const nextCompletes = (BLOCK_COMPLETES_ON[nextCur.type] || []).includes(eventType);
    if (!nextCompletes || nextCur.type !== CHOREO_BLOCK_TYPES.CONFIDENCE) break;
  }
  return rt;
}

/** Apply an override to the runtime (validated). Replay-determinizm uchun `at` timestamp beriladi. */
export function applyOverride(runtime, targetBlockId, by, at = Date.now()) {
  const idx = assertValidJump({ blocks: runtime.blocks }, runtime.currentIndex, targetBlockId);
  return {
    ...runtime,
    overrideNext: targetBlockId,
    events: [...(runtime.events || []).slice(-59), { at, type: 'choreo:override', by, fromBlockId: null, toBlockId: targetBlockId, targetIndex: idx }],
  };
}

/** Runtime health (item 13) — director dashboard uchun. */
export function runtimeHealth(runtime, phase) {
  const issues = [];
  // Legitim finished — sog'lom (dashboardda ⚠ ko'rsatilmaydi)
  if (runtime && runtime.currentIndex >= (runtime.blocks || []).length) {
    return { ok: true, issues: [], finished: true };
  }
  const cur = currentBlock(runtime);
  if (!cur) {
    return { ok: false, issues: ['Choreography bo‘sh'] };
  }
  if (runtime.overrideNext && !runtime.blocks.some((b) => b.id === runtime.overrideNext)) {
    issues.push('Override nishon blok topilmadi');
  }
  // Current block type bilan phase mosligi (yumshoq)
  const phaseByBlock = {
    [CHOREO_BLOCK_TYPES.LOBBY]: 'LOBBY_OPEN',
    [CHOREO_BLOCK_TYPES.QUESTION]: 'QUESTION_OPEN',
    [CHOREO_BLOCK_TYPES.REVEAL]: 'REVEAL',
    [CHOREO_BLOCK_TYPES.DISCUSS]: 'DISCUSSION',
    [CHOREO_BLOCK_TYPES.REVOTE]: 'REVOTE_OPEN',
    [CHOREO_BLOCK_TYPES.THINK]: 'THINK_TIME',
  };
  const expectedPhase = phaseByBlock[cur.type];
  if (expectedPhase && phase && phase !== expectedPhase) {
    issues.push(`Blok "${cur.type}" fazasi "${expectedPhase}", hozirgi "${phase}"`);
  }
  return { ok: issues.length === 0, issues };
}

// ── Storage (template model — ID/version/owner, item 3) ──
export async function saveTemplate(ownerActorId, template) {
  if (!ownerActorId) throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Avtorizatsiya talab qilinadi');
  const existing = template.templateId ? await getTemplate(ownerActorId, template.templateId) : null;
  const merged = {
    ...template,
    templateId: template.templateId || generateTemplateId(),
    version: existing ? (existing.version || 1) + 1 : 1,
    ownerActorId,
    updatedAt: Date.now(),
    createdAt: existing?.createdAt || Date.now(),
  };
  const validation = validateTemplate(merged);
  if (!validation.valid) {
    throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, validation.errors.join('; '));
  }
  const parsed = ChoreoTemplateSchema.safeParse(merged);
  if (!parsed.success) {
    throw new CastError(CAST_ERROR_CODES.TEMPLATE_INVALID, 'Template noto‘g‘ri: ' + (parsed.error.issues[0]?.message || ''));
  }
  const final = parsed.data;
  await fb.set(`${TEMPLATE_ROOT(ownerActorId)}/${final.templateId}`, final);
  return final;
}

export async function getTemplate(ownerActorId, templateId) {
  const snap = await fb.get(`${TEMPLATE_ROOT(ownerActorId)}/${templateId}`);
  return snap.exists() ? snap.val() : null;
}

export async function listTemplates(ownerActorId) {
  const snap = await fb.get(TEMPLATE_ROOT(ownerActorId));
  const all = snap.exists() ? snap.val() : {};
  return Object.entries(all)
    .map(([id, t]) => ({ templateId: id, name: t.name, version: t.version, mode: t.mode, blockCount: (t.blocks || []).length, updatedAt: t.updatedAt }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export default {
  generateTemplateId,
  generateBlockId,
  createTemplate,
  addBlock,
  removeBlock,
  reorderBlock,
  moveBlockUp,
  moveBlockDown,
  duplicateBlock,
  editBlockConfig,
  validateTemplate,
  estimateDuration,
  blockDurationSeconds,
  previewTemplate,
  migrateTemplate,
  diffTemplates,
  buildRuntime,
  currentBlock,
  nextBlock,
  coverage,
  assertValidJump,
  advanceRuntime,
  applyOverride,
  runtimeHealth,
  saveTemplate,
  getTemplate,
  listTemplates,
};
