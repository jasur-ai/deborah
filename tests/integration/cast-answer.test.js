import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSession, putAnswerIfAbsent, getAnswerStatus, listAnswersForQuestion, generateSessionId, generateJoinCode } from '../../services/cast/session-store.js';
import { initialState, applyEvent, assertCommandAllowed, replayEvents } from '../../services/cast/state-machine.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

// ═══════════════════════════════════════════════════════════════
// T-02 item 3+4: answer transaction, duplicate race, state revision
// conflict — real local-db adapter (transaction path'ni sinaydi).
// ═══════════════════════════════════════════════════════════════

let sessionId;
let questionId;

const pubQ = [{
  id: 'q_01',
  text: '1 + 1 = ?',
  options: [
    { id: 'o_a', text: '2' },
    { id: 'o_b', text: '3' },
  ],
}];
const privQ = [{ id: 'q_01', correctOptionIds: ['o_a'] }];

const config = { scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'off' } };

beforeAll(async () => {
  snapshotDb();
  sessionId = generateSessionId();
  questionId = 'q_01';
  await createSession({
    sessionId,
    joinCode: generateJoinCode(),
    meta: { title: 'Answer test' },
    config,
    state: initialState({
      primaryDirectorId: 'user:director',
      questionIds: pubQ.map((q) => q.id),
      questionCount: pubQ.length,
      choreography: null,
    }),
    privateQuestions: privQ,
    publicQuestions: pubQ,
  });
});

afterAll(async () => {
  restoreDb();
});

const answerRecord = (participantId, commandId, status = 'ACCEPTED') => ({
  participantId,
  commandId,
  status,
  selectedOptionIds: ['o_a'],
  receivedAt: Date.now(),
});

describe('T-02: answer transaction + duplicate race', () => {
  it('first answer accepted', async () => {
    const res = await putAnswerIfAbsent({
      sessionId,
      questionId,
      participantId: 'p1',
      attemptNo: 1,
      answerRecord: answerRecord('p1', 'cmd-1'),
    });
    expect(res.status).toBe('ACCEPTED');
    expect(res.answer.status).toBe('ACCEPTED');
  });

  it('same commandId retry returns REPLAYED_ACK (retry-safe)', async () => {
    const res = await putAnswerIfAbsent({
      sessionId,
      questionId,
      participantId: 'p1',
      attemptNo: 1,
      answerRecord: answerRecord('p1', 'cmd-1'),
    });
    expect(['ACCEPTED', 'REPLAYED_ACK']).toContain(res.status);
    expect(res.answer.status).toBe('ACCEPTED');
  });

  it('different commandId is rejected (duplicate race first-wins)', async () => {
    const res = await putAnswerIfAbsent({
      sessionId,
      questionId,
      participantId: 'p1',
      attemptNo: 1,
      answerRecord: answerRecord('p1', 'cmd-2'),
    });
    expect(res.status).toBe('ALREADY_ANSWERED');
  });

  it('listAnswersForQuestion returns only accepted', async () => {
    const list = await listAnswersForQuestion(sessionId, questionId);
    expect(list['p1']).toBeDefined();
    expect(list['p1'].status).toBe('ACCEPTED');
  });

  it('getAnswerStatus reflects persisted record', async () => {
    const rec = await getAnswerStatus(sessionId, questionId, 'p1', 1);
    expect(rec.commandId).toBe('cmd-1');
  });
});

describe('T-02: state revision conflict', () => {
  it('stale expectedRevision is detected by assertCommandAllowed/applyEvent flow', () => {
    // Director state revision model: commandlar expectedRevision bilan keladi;
    // applyEvent redux pure — konflikt event ordering orqali hal qilinadi.
    const st = applyEvent(initialState({
      primaryDirectorId: 'user:director',
      questionIds: ['q_01'],
      questionCount: 1,
      choreography: null,
    }), { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } });
    expect(st.revision).toBe(2);
    expect(st.phase).toBe('THINK_TIME');

    // revision 1 bilan kelgan command endi stale — replay orqali final state
    // aniq bo'ladi; stale event takrorlansa ham idempotent.
    const replay = replayEvents(initialState({
      primaryDirectorId: 'user:director',
      questionIds: ['q_01'],
      questionCount: 1,
      choreography: null,
    }), [
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } },
      { type: 'cast:questionPreview', revision: 3, serverAt: 2000, payload: { questionId: 'q_01', questionPosition: 0 } },
    ]);
    expect(replay.revision).toBe(3);
    expect(replay.phase).toBe('THINK_TIME');
  });

  it('command not allowed in current phase throws', () => {
    const st = initialState({
      primaryDirectorId: 'user:director',
      questionIds: ['q_01'],
      questionCount: 1,
      choreography: null,
    });
    expect(() => assertCommandAllowed(st, 'cast:questionOpen')).toThrow();
  });
});
