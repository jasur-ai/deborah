import { describe, it, expect } from 'vitest';
import { resolvePreset, diffPreset, PRESET_REGISTRY } from '../../services/cast/presets.js';
import { initialState, applyEvent, replayEvents, ALLOWED_COMMANDS_BY_PHASE, ALLOWED_NEXT_PHASE } from '../../services/cast/state-machine.js';
import { calculateQuestionScore, participationPoints } from '../../services/cast/scoring.js';
import { hashConfig, canonicalSerialize } from '../../services/cast/config-schema.js';
import { participantQuestionProjection, publicStateProjection } from '../../services/cast/projections.js';
import { normalizeCastQuestion } from '../../services/cast/test-normalizer.js';
import { splitQuestion } from '../../services/cast/test-loader.js';
import { CAST_PHASES } from '../../utils/cast-constants.js';

// ═══════════════════════════════════════════════════════════════
// T-01 item 3: Golden config/preset/state/scoring snapshotlar.
// Snapshotlar regression guard — kutilmaganda o'zgarishi fail qiladi.
// ═══════════════════════════════════════════════════════════════

describe('T-01 Golden: preset registry snapshot', () => {
  it('registry has exactly the documented presets', () => {
    expect(Object.keys(PRESET_REGISTRY).sort()).toMatchSnapshot();
  });

  it('default preset is responsive_accuracy', () => {
    const r = resolvePreset('responsive_accuracy');
    expect(r.preset?.id || r.preset).toBe('responsive_accuracy');
    expect(r.config.scoring?.scorePolicy).toBeDefined();
  });

  it('every preset resolves without throwing', () => {
    for (const id of Object.keys(PRESET_REGISTRY)) {
      const r = resolvePreset(id);
      expect(r.config).toBeDefined();
      expect(r.config.scoring).toBeDefined();
    }
  });
});

describe('T-01 Golden: config canonical hash', () => {
  it('hashConfig is deterministic for equal configs', () => {
    const a = hashConfig({ scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'soft' } });
    const b = hashConfig({ scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'soft' } });
    expect(a).toBe(b);
  });

  it('hash changes when a field changes', () => {
    const a = hashConfig({ scoring: { scorePolicy: 'accuracy' } });
    const b = hashConfig({ scoring: { scorePolicy: 'speed' } });
    expect(a).not.toBe(b);
  });

  it('canonicalSerialize output is stable (golden)', () => {
    const cfg = {
      scoring: { scorePolicy: 'accuracy' },
      timer: { mode: 'soft', defaultSeconds: 30 },
      participation: { paperCardMode: false },
    };
    expect(canonicalSerialize(cfg)).toMatchSnapshot();
  });
});

describe('T-01 Golden: initial state snapshot', () => {
  it('initialState shape (golden)', () => {
    const st = initialState({
      primaryDirectorId: 'd1',
      questionIds: ['q_01', 'q_02'],
      questionCount: 2,
      choreography: null,
    });
    expect(st).toMatchSnapshot();
  });

  it('phase transitions table (golden)', () => {
    expect(ALLOWED_NEXT_PHASE).toMatchSnapshot();
  });

  it('allowed commands per phase table (golden)', () => {
    expect(ALLOWED_COMMANDS_BY_PHASE).toMatchSnapshot();
  });
});

describe('T-01 Golden: state-machine event reducer', () => {
  it('replayEvents determinism (golden final state)', () => {
    const st0 = initialState({
      primaryDirectorId: 'd1',
      questionIds: ['q_01', 'q_02'],
      questionCount: 2,
      choreography: null,
    });
    const events = [
      { type: 'cast:sessionStarted', at: 1000, by: 'd1', payload: { startedAt: 1000 } },
      { type: 'cast:questionOpened', at: 2000, by: 'd1', payload: { questionId: 'q_01', openedAt: 2000, closesAt: 32000, questionPosition: 1, timerMode: 'soft' } },
    ];
    const final = replayEvents(st0, events);
    expect(final.phase).toBe(CAST_PHASES.QUESTION_OPEN);
    expect(final).toMatchSnapshot();
  });

  it('applyEvent returns deterministic next state for open (golden)', () => {
    const st0 = initialState({
      primaryDirectorId: 'd1',
      questionIds: ['q_01'],
      questionCount: 1,
      choreography: null,
    });
    const st1 = applyEvent(st0, { type: 'cast:sessionStarted', at: 1000, by: 'd1', payload: { startedAt: 1000 } });
    const st2 = applyEvent(st1, { type: 'cast:questionOpened', at: 2000, by: 'd1', payload: { questionId: 'q_01', openedAt: 2000, closesAt: 32000, questionPosition: 1, timerMode: 'soft' } });
    expect(st2).toMatchSnapshot();
  });
});

describe('T-01 Golden: scoring', () => {
  it('accuracy score policy (golden)', () => {
    const r = calculateQuestionScore({
      scorePolicy: 'accuracy',
      correctOptionIds: ['o_a'],
      selectedOptionIds: ['o_a'],
      timeUsedMs: 5000,
      timeLimitMs: 30000,
    });
    expect(r).toMatchSnapshot();
  });

  it('speed score policy (golden)', () => {
    const r = calculateQuestionScore({
      scorePolicy: 'speed',
      correctOptionIds: ['o_a'],
      selectedOptionIds: ['o_a'],
      timeUsedMs: 15000,
      timeLimitMs: 30000,
    });
    expect(r).toMatchSnapshot();
  });

  it('wrong answer yields zero (golden)', () => {
    const r = calculateQuestionScore({
      scorePolicy: 'accuracy',
      correctOptionIds: ['o_a'],
      selectedOptionIds: ['o_b'],
      timeUsedMs: 1000,
      timeLimitMs: 30000,
    });
    expect(r.score).toBe(0);
  });

  it('participationPoints golden', () => {
    expect(participationPoints({ participated: true, isCorrect: false, basePoints: 1 })).toMatchSnapshot();
  });
});

describe('T-01 Golden: no answer-key projection (item 7)', () => {
  const raw = {
    text: '1 + 1 = ?',
    options: ['2', '3', '4', '5'],
    correct: 0,
    explanation: 'secret explanation',
  };

  it('participant projection never leaks answer key (golden)', () => {
    const norm = normalizeCastQuestion(raw, 0);
    const { publicQuestion } = splitQuestion(norm);
    const proj = participantQuestionProjection(publicQuestion, { phase: CAST_PHASES.QUESTION_OPEN });
    const serialized = JSON.stringify(proj);
    expect(serialized).not.toContain('correctOptionIds');
    expect(serialized).not.toContain('secret');
    expect(proj).toMatchSnapshot();
  });

  it('publicStateProjection contains no private data (golden)', () => {
    const st = initialState({
      primaryDirectorId: 'd1',
      questionIds: ['q_01'],
      questionCount: 1,
      choreography: null,
    });
    const st2 = applyEvent(st, { type: 'cast:sessionStarted', at: 1000, by: 'd1', payload: { startedAt: 1000 } });
    const pub = publicStateProjection(st2);
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain('correctOptionIds');
    expect(pub).toMatchSnapshot();
  });
});

describe('T-01 Golden: preset diff', () => {
  it('diffPreset returns empty object when no overrides', () => {
    const base = resolvePreset('responsive_accuracy');
    const same = resolvePreset('responsive_accuracy');
    expect(diffPreset(base.config, same.config)).toEqual({});
  });

  it('diffPreset flags a changed field', () => {
    const base = resolvePreset('responsive_accuracy');
    const overridden = resolvePreset('responsive_accuracy', { timer: { defaultSeconds: 15 } });
    const diffs = diffPreset(base.config, overridden.config);
    expect(Object.keys(diffs).length).toBeGreaterThan(0);
    expect(Object.keys(diffs)).toContain('timer.defaultSeconds');
  });
});
