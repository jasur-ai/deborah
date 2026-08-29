/**
 * Deborah — Cast C3-14 Session Choreography Composer + Orchestration Tests
 * -----------------------------------------------------------------------
 * coverage: block add/reorder/duplicate/edit/delete + keyboard move up/down,
 *           dependency validation (revote-first-vote, reveal-scorable),
 *           fully-auto missing trigger, duration, preview timeline,
 *           runtime override (valid + invalid jump rad etiladi), replay
 *           sequence (state-machine applyEvent bilan), version migration + diff,
 *           public projection faqat currentType (config yashirin).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  CHOREO_BLOCK_TYPES,
  CHOREO_MODES,
  BLOCK_COMPLETES_ON,
  ChoreoTemplateSchema,
} from '../../services/cast/choreography-schema.js';
import {
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
} from '../../services/cast/choreography-service.js';
import { applyEvent, initialState } from '../../services/cast/state-machine.js';
import { publicStateProjection } from '../../services/cast/projections.js';

const TEST_OWNER = '__chor_teacher';

function baseTemplate() {
  return createTemplate({ ownerActorId: TEST_OWNER, name: 'Test reja' });
}

function standardTemplate() {
  let t = baseTemplate();
  t = addBlock(t, { id: 'b_lobby', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
  t = addBlock(t, { id: 'b_think', type: CHOREO_BLOCK_TYPES.THINK, config: { seconds: 5 } });
  t = addBlock(t, { id: 'b_q1', type: CHOREO_BLOCK_TYPES.QUESTION, config: { seconds: 30 } });
  t = addBlock(t, { id: 'b_conf', type: CHOREO_BLOCK_TYPES.CONFIDENCE, config: {} });
  t = addBlock(t, { id: 'b_reveal', type: CHOREO_BLOCK_TYPES.REVEAL, config: {} });
  return t;
}

describe('C3-14: Setup', () => {
  beforeAll(async () => {
    await fb.remove(`cast_choreo/${TEST_OWNER}`);
  });
  it('prepares clean template root', async () => {
    const snap = await fb.get(`cast_choreo/${TEST_OWNER}`);
    expect(snap.exists()).toBe(false);
  });
});

// ── Composer ops (item 4-5: add/reorder/duplicate/edit/delete + keyboard) ──
describe('C3-14: Composer ops', () => {
  it('addBlock appends and keeps order', () => {
    let t = baseTemplate();
    t = addBlock(t, { id: 'b1', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b2', type: CHOREO_BLOCK_TYPES.THINK, config: { seconds: 5 } });
    expect(t.blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(t.blocks[1].config.seconds).toBe(5);
  });

  it('addBlock at explicit position', () => {
    let t = standardTemplate();
    t = addBlock(t, { id: 'b_break', type: CHOREO_BLOCK_TYPES.BREAK, config: { seconds: 60 } }, 1);
    expect(t.blocks.map((b) => b.id)).toEqual(['b_lobby', 'b_break', 'b_think', 'b_q1', 'b_conf', 'b_reveal']);
  });

  it('removeBlock deletes by id', () => {
    let t = standardTemplate();
    t = removeBlock(t, 'b_conf');
    expect(t.blocks.some((b) => b.id === 'b_conf')).toBe(false);
  });

  it('reorderBlock moves block', () => {
    let t = standardTemplate();
    t = reorderBlock(t, 'b_think', 3);
    expect(t.blocks.map((b) => b.id)).toEqual(['b_lobby', 'b_q1', 'b_conf', 'b_think', 'b_reveal']);
  });

  it('keyboard move up/down (item 5)', () => {
    let t = standardTemplate();
    t = moveBlockDown(t, 'b_lobby');
    expect(t.blocks[0].id).toBe('b_think');
    t = moveBlockUp(t, 'b_lobby'); // b_lobby endi 1-indexda — yuqoriga ko'chiramiz
    expect(t.blocks[0].id).toBe('b_lobby');
    // Birinchi blokni yuqoriga ko'chirib bo'lmaydi
    expect(moveBlockUp(t, 'b_lobby')).toBe(t);
    // Oxirgi blokni pastga ko'chirib bo'lmaydi
    expect(moveBlockDown(t, 'b_reveal')).toBe(t);
  });

  it('duplicateBlock copies with new id', () => {
    let t = standardTemplate();
    const before = t.blocks.length;
    t = duplicateBlock(t, 'b_q1');
    expect(t.blocks.length).toBe(before + 1);
    const copy = t.blocks.find((b) => b.id !== 'b_q1' && b.type === CHOREO_BLOCK_TYPES.QUESTION);
    expect(copy).toBeTruthy();
    expect(copy.id).not.toBe('b_q1');
    expect(copy.config.seconds).toBe(30);
  });

  it('editBlockConfig updates typed config', () => {
    let t = standardTemplate();
    t = editBlockConfig(t, 'b_think', { seconds: 10 });
    expect(t.blocks.find((b) => b.id === 'b_think').config.seconds).toBe(10);
    // Invalid config (noto'g'ri tur) rad etiladi
    expect(() => editBlockConfig(t, 'b_think', { seconds: 'aaa' })).toThrow();
  });
});

// ── Dependency validation (items 6-8) ──
describe('C3-14: Dependency validation', () => {
  it('valid standard template', () => {
    expect(validateTemplate(standardTemplate()).valid).toBe(true);
  });

  it('REVOTE without prior QUESTION → error (item 7: first vote)', () => {
    let t = baseTemplate();
    t = addBlock(t, { id: 'b1', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b2', type: CHOREO_BLOCK_TYPES.REVOTE, config: {} });
    const v = validateTemplate(t);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('REVOTE'))).toBe(true);
  });

  it('REVEAL with non-scorable question → error (item 8)', () => {
    let t = baseTemplate();
    t = addBlock(t, { id: 'b1', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b2', type: CHOREO_BLOCK_TYPES.QUESTION, config: { scorable: false, seconds: 30 } });
    t = addBlock(t, { id: 'b3', type: CHOREO_BLOCK_TYPES.REVEAL, config: {} });
    const v = validateTemplate(t);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('scorable'))).toBe(true);
  });

  it('REVEAL after scorable question → ok', () => {
    let t = baseTemplate();
    t = addBlock(t, { id: 'b1', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b2', type: CHOREO_BLOCK_TYPES.QUESTION, config: { scorable: true, seconds: 30 } });
    t = addBlock(t, { id: 'b3', type: CHOREO_BLOCK_TYPES.REVEAL, config: {} });
    expect(validateTemplate(t).valid).toBe(true);
  });

  it('CONFIDENCE requires QUESTION before', () => {
    let t = baseTemplate();
    t = addBlock(t, { id: 'b1', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b2', type: CHOREO_BLOCK_TYPES.CONFIDENCE, config: {} });
    expect(validateTemplate(t).valid).toBe(false);
  });

  it('fully-auto missing exit trigger → error (item 9)', () => {
    let t = baseTemplate();
    t.mode = CHOREO_MODES.FULLY_AUTO;
    // INSTRUCTIONS — seconds default 0, avto trigger yo'q → error
    t = addBlock(t, { id: 'b_lobby', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b_inst', type: CHOREO_BLOCK_TYPES.INSTRUCTIONS, config: {} });
    const v = validateTemplate(t);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('exit trigger'))).toBe(true);
  });

  it('fully-auto with timer on manual block → ok', () => {
    let t = standardTemplate();
    t.mode = CHOREO_MODES.FULLY_AUTO;
    t = addBlock(t, { id: 'b_break', type: CHOREO_BLOCK_TYPES.BREAK, config: { seconds: 60 } });
    expect(validateTemplate(t).valid).toBe(true);
  });
});

// ── Duration (item 10) + preview (item 11) ──
describe('C3-14: Duration + preview', () => {
  it('estimateDuration sums per-block seconds', () => {
    const d = estimateDuration(standardTemplate());
    // LOBBY 20 + THINK 5 + QUESTION 30 + CONFIDENCE 5 + REVEAL 20
    expect(d.totalSeconds).toBe(80);
    expect(d.blockCount).toBe(5);
  });

  it('previewTemplate builds timeline with exit triggers', () => {
    const p = previewTemplate(standardTemplate());
    expect(p.valid).toBe(true);
    expect(p.timeline.length).toBe(5);
    expect(p.timeline[0].exit).toContain('cast:sessionStarted');
    expect(p.totalSeconds).toBe(80);
  });
});

// ── Runtime: override + invalid jump (items 14-16) ──
describe('C3-14: Runtime override', () => {
  it('buildRuntime snapshots blocks immutably', () => {
    const tpl = standardTemplate();
    const rt = buildRuntime(tpl, TEST_OWNER);
    expect(rt.blocks.length).toBe(5);
    expect(rt.currentIndex).toBe(0);
    expect(currentBlock(rt).id).toBe('b_lobby');
    expect(nextBlock(rt).id).toBe('b_think');
    expect(coverage(rt)).toBeCloseTo(1 / 5);
  });

  it('valid override sets overrideNext + logs event with actor/old/new', () => {
    const rt = buildRuntime(standardTemplate(), TEST_OWNER);
    const rt2 = applyOverride(rt, 'b_reveal', 'user:teacher_t1');
    expect(rt2.overrideNext).toBe('b_reveal');
    const ev = rt2.events[rt2.events.length - 1];
    expect(ev.type).toBe('choreo:override');
    expect(ev.toBlockId).toBe('b_reveal');
    expect(ev.targetIndex).toBe(4);
    expect(ev.by).toBe('user:teacher_t1');
  });

  it('invalid override jump → rejected (item 16)', () => {
    const rt = buildRuntime(standardTemplate(), TEST_OWNER);
    // Backward jump — rad
    expect(() => applyOverride(rt, 'b_lobby', 'user:t')).toThrow();
    // Noma'lum blok — rad
    expect(() => applyOverride(rt, 'b_missing', 'user:t')).toThrow();
  });

  it('override to QUESTION-dependent block without passed question → rejected', () => {
    let t = baseTemplate();
    t = addBlock(t, { id: 'b1', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b2', type: CHOREO_BLOCK_TYPES.THINK, config: { seconds: 5 } });
    t = addBlock(t, { id: 'b3', type: CHOREO_BLOCK_TYPES.REVEAL, config: {} }); // QUESTION yo'q
    const rt = buildRuntime(t, TEST_OWNER);
    expect(() => applyOverride(rt, 'b3', 'user:t')).toThrow();
  });

  it('runtimeHealth reports mismatch issues', () => {
    const rt = buildRuntime(standardTemplate(), TEST_OWNER);
    // LOBBY blok hozir, lekin phase QUESTION_OPEN — mismatch
    const h = runtimeHealth(rt, 'QUESTION_OPEN');
    expect(h.ok).toBe(false);
    expect(h.issues.length).toBeGreaterThan(0);
    const ok = runtimeHealth(rt, 'LOBBY_OPEN');
    expect(ok.ok).toBe(true);
  });
});

// ── Replay sequence: state-machine applyEvent bilan (item 12 + completion) ──
describe('C3-14: Replay sequence via state machine', () => {
  function initialStateWithChoreo() {
    const rt = buildRuntime(standardTemplate(), TEST_OWNER);
    return initialState({ primaryDirectorId: 'user:t', questionCount: 1, choreography: rt });
  }

  it('session start advances LOBBY → THINK', () => {
    let s = initialStateWithChoreo();
    expect(s.choreography.currentIndex).toBe(0);
    s = applyEvent(s, { type: 'cast:sessionStarted', payload: { startedAt: 1000 }, serverAt: 1000 });
    expect(s.phase).toBe('THINK_TIME');
    expect(s.choreography.currentIndex).toBe(1); // b_think
    const ev = s.choreography.events[s.choreography.events.length - 1];
    expect(ev.fromBlockId).toBe('b_lobby');
    expect(ev.toBlockId).toBe('b_think');
  });

  it('questionOpened advances THINK → QUESTION', () => {
    let s = applyEvent(initialStateWithChoreo(), { type: 'cast:sessionStarted', payload: {}, serverAt: 1000 });
    s = applyEvent(s, { type: 'cast:questionOpened', payload: { questionId: 'q1', openedAt: 2000, closesAt: 3000 }, serverAt: 2000 });
    expect(s.choreography.currentIndex).toBe(2); // b_q1
  });

  it('questionClosed advances QUESTION + CONFIDENCE → REVEAL (chain)', () => {
    let s = applyEvent(initialStateWithChoreo(), { type: 'cast:sessionStarted', payload: {}, serverAt: 1000 });
    s = applyEvent(s, { type: 'cast:questionOpened', payload: { questionId: 'q1', openedAt: 2000, closesAt: 3000 }, serverAt: 2000 });
    s = applyEvent(s, { type: 'cast:questionClosed', payload: { closesAt: 3000 }, serverAt: 3000 });
    // QUESTION va CONFIDENCE ikkalasi questionClosed bilan tugaydi → REVEAL
    expect(s.choreography.currentIndex).toBe(4); // b_reveal
  });

  it('override consumed on next advance', () => {
    let s = initialStateWithChoreo();
    s = applyEvent(s, { type: 'choreo:override', payload: { blockId: 'b_reveal', by: 'user:t' }, serverAt: 500 });
    expect(s.choreography.overrideNext).toBe('b_reveal');
    // sessionStarted → advance → override b_reveal'ga sakraydi
    s = applyEvent(s, { type: 'cast:sessionStarted', payload: {}, serverAt: 1000 });
    expect(s.choreography.currentIndex).toBe(4);
    expect(s.choreography.overrideNext).toBeNull();
  });

  it('manual advance (choreo:advance) works on manual-exit block', () => {
    let t = baseTemplate();
    t = addBlock(t, { id: 'b1', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b2', type: CHOREO_BLOCK_TYPES.BREAK, config: { seconds: 60 } });
    t = addBlock(t, { id: 'b3', type: CHOREO_BLOCK_TYPES.THINK, config: { seconds: 5 } });
    const rt = buildRuntime(t, TEST_OWNER);
    let s = initialState({ choreography: rt });
    s = applyEvent(s, { type: 'cast:sessionStarted', payload: {}, serverAt: 1000 }); // → BREAK
    expect(s.choreography.currentIndex).toBe(1);
    s = applyEvent(s, { type: 'choreo:advance', payload: { by: 'user:t' }, serverAt: 2000 }); // → THINK
    expect(s.choreography.currentIndex).toBe(2);
  });

  it('finished choreography stops advancing', () => {
    let s = initialStateWithChoreo();
    for (const ev of [
      { type: 'cast:sessionStarted', payload: {}, serverAt: 1000 },
      { type: 'cast:questionOpened', payload: { questionId: 'q1', openedAt: 2000, closesAt: 3000 }, serverAt: 2000 },
      { type: 'cast:questionClosed', payload: { closesAt: 3000 }, serverAt: 3000 },
      { type: 'cast:questionRevealed', payload: {}, serverAt: 4000 },
    ]) {
      s = applyEvent(s, ev);
    }
    expect(s.choreography.currentIndex).toBe(5); // finished (blocks.length)
    expect(s.choreography.events[s.choreography.events.length - 1].finished).toBe(true);
    // finished'dan keyingi event o'zgarmaydi
    const before = s.choreography;
    s = applyEvent(s, { type: 'cast:questionOpened', payload: { questionId: 'q2', openedAt: 5000, closesAt: 6000 }, serverAt: 5000 });
    expect(s.choreography.currentIndex).toBe(before.currentIndex);
  });
});

// ── Migration + diff (item 18) ──
describe('C3-14: Migration + diff', () => {
  it('migrateTemplate normalizes configs v1 → v2', () => {
    let t = baseTemplate();
    t = addBlock(t, { id: 'b1', type: CHOREO_BLOCK_TYPES.LOBBY, config: {} });
    t = addBlock(t, { id: 'b2', type: CHOREO_BLOCK_TYPES.THINK, config: { seconds: 7 } });
    t.schemaVersion = 1;
    const migrated = migrateTemplate(t, 2);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.blocks[1].config.seconds).toBe(7);
  });

  it('diffTemplates reports added/removed/changed/moved', () => {
    const a = standardTemplate();
    let b = removeBlock(a, 'b_conf');
    b = addBlock(b, { id: 'b_new', type: CHOREO_BLOCK_TYPES.BREAK, config: { seconds: 30 } });
    b = editBlockConfig(b, 'b_think', { seconds: 9 });
    const d = diffTemplates(a, b);
    expect(d.removed).toContain('b_conf');
    expect(d.added).toContain('b_new');
    expect(d.changed).toContain('b_think');
  });
});

// ── Storage + schema ──
describe('C3-14: Template storage', () => {
  it('saveTemplate persists with version++ and owner', async () => {
    const tpl = standardTemplate();
    const saved = await saveTemplate(TEST_OWNER, tpl);
    expect(saved.templateId).toMatch(/^chor_/);
    expect(saved.version).toBe(1);
    expect(saved.ownerActorId).toBe(TEST_OWNER);

    const again = await saveTemplate(TEST_OWNER, saved);
    expect(again.version).toBe(2);

    const loaded = await getTemplate(TEST_OWNER, saved.templateId);
    expect(loaded.name).toBe('Test reja');
    expect(loaded.blocks.length).toBe(5);
  });

  it('saveTemplate rejects invalid template', async () => {
    const tpl = baseTemplate();
    tpl.blocks = [{ id: 'x1', type: 'REVOTE', config: {} }]; // QUESTION yo'q
    await expect(saveTemplate(TEST_OWNER, tpl)).rejects.toThrow();
  });

  it('listTemplates returns metadata sorted by updatedAt', async () => {
    const list = await listTemplates(TEST_OWNER);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].templateId).toBeTruthy();
    expect(list[0].blockCount).toBe(5);
  });

  it('template schema validates contract shape', () => {
    const parsed = ChoreoTemplateSchema.safeParse(standardTemplate());
    expect(parsed.success).toBe(true);
  });
});

// ── Public projection (item 17 — xavfsiz) ──
describe('C3-14: Public projection', () => {
  it('only exposes current block type — no config/prompt/questionId', () => {
    const rt = buildRuntime(standardTemplate(), TEST_OWNER);
    const s = initialState({ choreography: rt });
    const proj = publicStateProjection(s);
    expect(proj.choreography.currentType).toBe('LOBBY');
    const json = JSON.stringify(proj.choreography);
    expect(json).not.toContain('promptText');
    expect(json).not.toContain('questionId');
    expect(json).not.toContain('config');
    expect(proj.choreography.progress).toBeCloseTo(1 / 5);
  });

  it('returns null when no choreography', () => {
    const proj = publicStateProjection(initialState({}));
    expect(proj.choreography).toBeNull();
  });
});

// ── Cleanup ──
describe('C3-14: Cleanup', () => {
  it('removes test data', async () => {
    await fb.remove(`cast_choreo/${TEST_OWNER}`);
    const snap = await fb.get(`cast_choreo/${TEST_OWNER}`);
    expect(snap.exists()).toBe(false);
  });
});
