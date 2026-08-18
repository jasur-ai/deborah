import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSession, getSessionMeta, getConfig, getState, resolveSessionByCode, countActiveSessions, generateSessionId, generateJoinCode } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

// ═══════════════════════════════════════════════════════════════
// T-02 item 1+2: local adapter fixture + session create full flow
// Real local-db adapter orqali (createApp server'isiz — store to'g'ridan).
// ═══════════════════════════════════════════════════════════════

let sessionId;
let joinCode;

const makeQuestions = (n = 2) => {
  const publicQuestions = [];
  const privateQuestions = [];
  for (let i = 0; i < n; i++) {
    const qid = `q_${String(i + 1).padStart(2, '0')}`;
    publicQuestions.push({
      id: qid,
      text: `Savol ${i + 1}`,
      options: [
        { id: 'o_a', text: 'A' },
        { id: 'o_b', text: 'B' },
      ],
    });
    privateQuestions.push({
      id: qid,
      correctOptionIds: ['o_a'],
    });
  }
  return { publicQuestions, privateQuestions };
};

const config = {
  scoring: { scorePolicy: 'accuracy' },
  timer: { mode: 'soft', defaultSeconds: 30 },
};

beforeAll(async () => {
  snapshotDb();
});

afterAll(async () => {
  restoreDb();
});

describe('T-02: session create full flow', () => {
  it('creates session with meta/config/state/questions', async () => {
    const { publicQuestions, privateQuestions } = makeQuestions();
    sessionId = generateSessionId();
    joinCode = generateJoinCode();

    const res = await createSession({
      sessionId,
      joinCode,
      meta: { title: 'Integratsiya testi', tier: 'S' },
      config,
      state: initialState({
        primaryDirectorId: 'user:director',
        questionIds: publicQuestions.map((q) => q.id),
        questionCount: publicQuestions.length,
        choreography: null,
      }),
      privateQuestions,
      publicQuestions,
    });

    expect(res.sessionId).toBe(sessionId);
    expect(res.joinCode).toBe(joinCode);

    // meta persisted
    const meta = await getSessionMeta(sessionId);
    expect(meta.title).toBe('Integratsiya testi');
    expect(meta.sessionId).toBe(sessionId);
    expect(meta.joinCode).toBe(joinCode);

    // config persisted
    const cfg = await getConfig(sessionId);
    expect(cfg.scoring.scorePolicy).toBe('accuracy');

    // state persisted
    const state = await getState(sessionId);
    expect(state.phase).toBe('LOBBY_OPEN');
  });

  it('resolves session by join code', async () => {
    const found = await resolveSessionByCode(joinCode);
    expect(found).toBe(sessionId);
  });

  it('generates unique ids and codes', () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
    expect(generateJoinCode()).not.toBe(generateJoinCode());
  });

  it('countActiveSessions excludes ENDED sessions', async () => {
    // Baseline: hozirgi active soni
    const before = await countActiveSessions();

    // Faqat ENDED session qo'shamiz — count O'ZGARMASLIGI kerak (exclusion)
    const { publicQuestions, privateQuestions } = makeQuestions(1);
    const endedSid = generateSessionId();
    await createSession({
      sessionId: endedSid,
      joinCode: generateJoinCode(),
      meta: { title: 'Ended', tier: 'S' },
      config,
      state: {
        ...initialState({
          primaryDirectorId: 'user:d3',
          questionIds: ['q_01'],
          questionCount: 1,
          choreography: null,
        }),
        phase: 'ENDED',
      },
      privateQuestions,
      publicQuestions,
    });

    const after = await countActiveSessions();
    expect(after).toBe(before); // ENDED session count'ga kirmadi

    // Active session qo'shsak — count oshishi kerak (control)
    const activeSid = generateSessionId();
    await createSession({
      sessionId: activeSid,
      joinCode: generateJoinCode(),
      meta: { title: 'Active', tier: 'S' },
      config,
      state: initialState({
        primaryDirectorId: 'user:d2',
        questionIds: ['q_01'],
        questionCount: 1,
        choreography: null,
      }),
      privateQuestions,
      publicQuestions,
    });
    const final = await countActiveSessions();
    expect(final).toBe(before + 1); // faqat active qo'shildi
  });
});
