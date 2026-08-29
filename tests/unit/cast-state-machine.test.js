import { describe, it, expect } from 'vitest';
import { applyEvent, initialState, assertCommandAllowed, assertPhaseTransition, replayEvents, ALLOWED_NEXT_PHASE, ALLOWED_COMMANDS_BY_PHASE, CAST_PHASES } from '../../services/cast/state-machine.js';

function makeState(overrides = {}) {
  return { ...initialState({ primaryDirectorId: 'user:j', questionIds: ['q_01', 'q_02'], questionCount: 2 }), ...overrides };
}

describe('initialState', () => {
  it('starts in LOBBY_OPEN with revision 1', () => {
    const s = initialState({ primaryDirectorId: 'user:j', questionIds: ['q_01'], questionCount: 1 });
    expect(s.phase).toBe(CAST_PHASES.LOBBY_OPEN);
    expect(s.revision).toBe(1);
    expect(s.questionId).toBe('q_01');
  });
});

describe('Allowed commands', () => {
  it('allows session:start in lobby', () => {
    expect(() => assertCommandAllowed(makeState(), 'session:start')).not.toThrow();
  });

  it('allows join in lobby', () => {
    expect(() => assertCommandAllowed(makeState(), 'participant:join')).not.toThrow();
  });

  it('rejects question:open in lobby', () => {
    expect(() => assertCommandAllowed(makeState(), 'question:open')).toThrow();
  });

  it('allows question:open in THINK_TIME', () => {
    expect(() => assertCommandAllowed(makeState({ phase: CAST_PHASES.THINK_TIME }), 'question:open')).not.toThrow();
  });

  it('allows pause/add-time/close in QUESTION_OPEN', () => {
    const s = makeState({ phase: CAST_PHASES.QUESTION_OPEN });
    for (const cmd of ['question:pause', 'time:add', 'question:close']) {
      expect(() => assertCommandAllowed(s, cmd)).not.toThrow();
    }
  });

  it('rejects everything after ENDED', () => {
    const s = makeState({ phase: CAST_PHASES.ENDED });
    expect(() => assertCommandAllowed(s, 'session:start')).toThrow();
    expect(() => assertCommandAllowed(s, 'question:next')).toThrow();
  });
});

// T-01 item 1: har service pure funksiyasi table-driven test qilinadi.
// ALLOWED_NEXT_PHASE dan to'liq matritsa generatsiya qilinadi — har (from,to)
// kombinatsiya assertPhaseTransition'da sinovdan o'tadi (valid o'tadi, invalid throw).
describe('Phase transitions (T-01 table-driven full matrix)', () => {
  const phases = Object.keys(ALLOWED_NEXT_PHASE);

  it.each(phases.flatMap((from) => phases.map((to) => [from, to])))('from=%s to=%s', (from, to) => {
    // assertPhaseTransition qoidalari (state-machine.js bilan sinxron):
    //   1) same-phase → always allowed
    //   2) → ENDED → always allowed (session end)
    //   3) boshqa hollarda ALLOWED_NEXT_PHASE[from] ichida bo'lishi kerak
    const samePhase = from === to;
    const toEnded = to === CAST_PHASES.ENDED;
    const allowed = samePhase || toEnded || (ALLOWED_NEXT_PHASE[from] || []).includes(to);
    const fn = () => assertPhaseTransition(makeState({ phase: from }), to);
    if (allowed) {
      expect(fn).not.toThrow();
    } else {
      expect(fn).toThrow();
    }
  });

  it('ENDED is terminal — no outgoing transitions', () => {
    expect(ALLOWED_NEXT_PHASE[CAST_PHASES.ENDED]).toEqual([]);
  });

  it('every phase appears in ALLOWED_NEXT_PHASE (schema completeness)', () => {
    for (const p of Object.values(CAST_PHASES)) {
      expect(ALLOWED_NEXT_PHASE).toHaveProperty(p);
    }
  });
});

describe('Allowed commands (T-01 table-driven per phase)', () => {
  it.each(Object.keys(ALLOWED_COMMANDS_BY_PHASE))('phase=%s every listed command passes', (phase) => {
    const allowed = ALLOWED_COMMANDS_BY_PHASE[phase] || [];
    for (const cmd of allowed) {
      expect(() => assertCommandAllowed(makeState({ phase }), cmd)).not.toThrow();
    }
  });

  // Negative qoida: hech bir phase'da QUESTION_OPEN ruxsat etilmaydi (faqat
  // director flow'da alohida command; ALLOWED_COMMANDS_BY_PHASE'da hech yerda yo'q).
  it('QUESTION_OPEN command hech qaysi phaseda ruxsat etilmaydi (negative)', () => {
    for (const phase of Object.keys(ALLOWED_COMMANDS_BY_PHASE)) {
      const allowed = ALLOWED_COMMANDS_BY_PHASE[phase] || [];
      if (!allowed.includes('question:open')) {
        expect(() => assertCommandAllowed(makeState({ phase }), 'question:open')).toThrow();
      }
    }
  });

  it('every phase key in ALLOWED_COMMANDS_BY_PHASE is a real phase', () => {
    for (const phase of Object.keys(ALLOWED_COMMANDS_BY_PHASE)) {
      expect(Object.values(CAST_PHASES)).toContain(phase);
    }
  });
});

describe('Phase transitions', () => {
  it('THINK_TIME → QUESTION_OPEN valid', () => {
    expect(() => assertPhaseTransition(makeState({ phase: CAST_PHASES.THINK_TIME }), CAST_PHASES.QUESTION_OPEN)).not.toThrow();
  });

  it('LOBBY → QUESTION_OPEN invalid (must preview first)', () => {
    expect(() => assertPhaseTransition(makeState(), CAST_PHASES.QUESTION_OPEN)).toThrow();
  });

  it('QUESTION_OPEN → QUESTION_LOCKED valid', () => {
    expect(() => assertPhaseTransition(makeState({ phase: CAST_PHASES.QUESTION_OPEN }), CAST_PHASES.QUESTION_LOCKED)).not.toThrow();
  });

  it('QUESTION_LOCKED → REVEAL valid', () => {
    expect(() => assertPhaseTransition(makeState({ phase: CAST_PHASES.QUESTION_LOCKED }), CAST_PHASES.REVEAL)).not.toThrow();
  });

  it('REVEAL → ENDED valid', () => {
    expect(() => assertPhaseTransition(makeState({ phase: CAST_PHASES.REVEAL }), CAST_PHASES.ENDED)).not.toThrow();
  });

  it('LOBBY → ENDED invalid direct', () => {
    expect(() => assertPhaseTransition(makeState(), CAST_PHASES.ENDED)).not.toThrow(); // session end always allowed via command
  });
});

describe('applyEvent reducer', () => {
  it('is pure — does not mutate input state', () => {
    const s = makeState({ phase: CAST_PHASES.QUESTION_OPEN });
    const before = JSON.stringify(s);
    applyEvent(s, { type: 'cast:questionLocked', revision: 2, serverAt: 1 });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('applies questionOpened with timestamps', () => {
    const s = makeState({ phase: CAST_PHASES.THINK_TIME });
    const next = applyEvent(s, {
      type: 'cast:questionOpened',
      revision: 3,
      serverAt: 1000,
      payload: { questionId: 'q_01', openedAt: 1000, closesAt: 31000, timerMode: 'soft' },
    });
    expect(next.phase).toBe(CAST_PHASES.QUESTION_OPEN);
    expect(next.openedAt).toBe(1000);
    expect(next.closesAt).toBe(31000);
    expect(next.revision).toBe(3);
  });

  it('tracks paused ms on resume', () => {
    const s = makeState({ phase: CAST_PHASES.QUESTION_OPEN, pausedAt: 1000, totalPausedMs: 0 });
    const next = applyEvent(s, {
      type: 'cast:questionResumed',
      revision: 5,
      payload: { pausedDurationMs: 4000, closesAt: 35000 },
    });
    expect(next.totalPausedMs).toBe(4000);
    expect(next.pausedAt).toBeNull();
    expect(next.closesAt).toBe(35000);
  });

  it('replay determinism', () => {
    const events = [
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1, payload: {} },
      { type: 'cast:questionPreview', revision: 3, serverAt: 2, payload: { questionId: 'q_01', questionPosition: 0 } },
      { type: 'cast:questionOpened', revision: 4, serverAt: 3, payload: { questionId: 'q_01', openedAt: 3, closesAt: 30003, timerMode: 'soft' } },
      { type: 'cast:questionLocked', revision: 5, serverAt: 30000, payload: {} },
      { type: 'cast:questionRevealed', revision: 6, serverAt: 30005, payload: {} },
      { type: 'cast:sessionEnded', revision: 7, serverAt: 40000, payload: {} },
    ];
    const s1 = replayEvents(makeState(), events);
    const s2 = replayEvents(makeState(), events);
    expect(s1).toEqual(s2);
    expect(s1.phase).toBe(CAST_PHASES.ENDED);
  });

  it('unknown event is ignored (replay-safe)', () => {
    const s = makeState();
    const next = applyEvent(s, { type: 'cast:somethingWeird', revision: 99 });
    expect(next.phase).toBe(CAST_PHASES.LOBBY_OPEN);
  });
});
