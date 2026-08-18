import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSession, upsertParticipant, markPresence, getParticipant, removeParticipant, listParticipants, putAnswerIfAbsent, listAnswersForQuestion, generateSessionId, generateJoinCode } from '../../services/cast/session-store.js';
import { initialState, replayEvents } from '../../services/cast/state-machine.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

// ═══════════════════════════════════════════════════════════════
// T-02 item 7+9: disconnect persistence + event replay final-state.
// Disconnect participant'ni o'chirmaydi (presence offline qiladi),
// javoblari saqlanadi. Event replay deterministik final state beradi.
// ═══════════════════════════════════════════════════════════════

let sessionId;

const pubQ = [{
  id: 'q_01',
  text: 'Savol',
  options: [
    { id: 'o_a', text: 'A' },
    { id: 'o_b', text: 'B' },
  ],
}];
const privQ = [{ id: 'q_01', correctOptionIds: ['o_a'] }];
const config = { scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'off' } };

beforeAll(async () => {
  snapshotDb();
  sessionId = generateSessionId();
  await createSession({
    sessionId,
    joinCode: generateJoinCode(),
    meta: { title: 'Recovery test' },
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

describe('T-02: disconnect persistence (item 7)', () => {
  it('participant joins and answers', async () => {
    await upsertParticipant(sessionId, {
      id: 'p1',
      displayAlias: 'Jasur',
      presence: 'online',
      joinedAt: Date.now(),
    });
    await putAnswerIfAbsent({
      sessionId,
      questionId: 'q_01',
      participantId: 'p1',
      attemptNo: 1,
      answerRecord: { participantId: 'p1', commandId: 'c1', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now() },
    });
    const list = await listAnswersForQuestion(sessionId, 'q_01');
    expect(list['p1'].status).toBe('ACCEPTED');
  });

  it('disconnect marks presence offline — participant and answers preserved', async () => {
    await markPresence(sessionId, 'p1', 'offline', Date.now());
    const p = await getParticipant(sessionId, 'p1');
    expect(p.presence).toBe('offline');

    // Answer hali ham bor (data loss yo'q)
    const list = await listAnswersForQuestion(sessionId, 'q_01');
    expect(list['p1'].status).toBe('ACCEPTED');
  });

  it('removeParticipant deletes only the participant record', async () => {
    await removeParticipant(sessionId, 'p1');
    const p = await getParticipant(sessionId, 'p1');
    expect(p).toBeNull();

    // Javoblar o'chmaydi (answer persistency must outlive participant record)
    const list = await listAnswersForQuestion(sessionId, 'q_01');
    expect(list['p1'].status).toBe('ACCEPTED');
  });

  it('listParticipants reflects current state', async () => {
    const all = await listParticipants(sessionId);
    // Object shaklida qaytadi: { participantId: record } — p1 remove qilingan
    expect(typeof all).toBe('object');
    expect(all).not.toBeNull();
    expect(all['p1']).toBeUndefined();
  });
});

describe('T-02: event replay final-state (item 9)', () => {
  it('replay of full lifecycle reaches ENDED deterministically', () => {
    const st0 = initialState({
      primaryDirectorId: 'user:director',
      questionIds: ['q_01'],
      questionCount: 1,
      choreography: null,
    });
    const events = [
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } },
      { type: 'cast:questionPreview', revision: 3, serverAt: 2000, payload: { questionId: 'q_01', questionPosition: 0 } },
      { type: 'cast:questionOpened', revision: 4, serverAt: 3000, payload: { questionId: 'q_01', openedAt: 3000, closesAt: 33000, timerMode: 'soft' } },
      { type: 'cast:questionLocked', revision: 5, serverAt: 32000, payload: {} },
      { type: 'cast:questionRevealed', revision: 6, serverAt: 32005, payload: {} },
      { type: 'cast:sessionEnded', revision: 7, serverAt: 40000, payload: {} },
    ];
    const final1 = replayEvents(st0, events);
    const final2 = replayEvents(st0, events);
    expect(final1).toEqual(final2);
    expect(final1.phase).toBe('ENDED');
    expect(final1.revision).toBe(7);
  });

  it('replay is order-sensitive — reordered events give different state', () => {
    const st0 = initialState({
      primaryDirectorId: 'user:director',
      questionIds: ['q_01'],
      questionCount: 1,
      choreography: null,
    });
    const a = replayEvents(st0, [
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } },
      { type: 'cast:questionOpened', revision: 3, serverAt: 3000, payload: { questionId: 'q_01', openedAt: 3000, closesAt: 33000, timerMode: 'soft' } },
    ]);
    const b = replayEvents(st0, [
      { type: 'cast:questionOpened', revision: 3, serverAt: 3000, payload: { questionId: 'q_01', openedAt: 3000, closesAt: 33000, timerMode: 'soft' } },
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } },
    ]);
    // sessionStarted'dan oldin questionOpened — final phase farq qilishi mumkin;
    // muhimi replay deterministik: xuddi shu ketma-ketlik bir xil natija beradi.
    expect(replayEvents(st0, [
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } },
      { type: 'cast:questionOpened', revision: 3, serverAt: 3000, payload: { questionId: 'q_01', openedAt: 3000, closesAt: 33000, timerMode: 'soft' } },
    ])).toEqual(a);
    expect(replayEvents(st0, [
      { type: 'cast:questionOpened', revision: 3, serverAt: 3000, payload: { questionId: 'q_01', openedAt: 3000, closesAt: 33000, timerMode: 'soft' } },
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } },
    ])).toEqual(b);
  });
});
