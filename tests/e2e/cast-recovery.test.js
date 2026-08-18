/**
 * Deborah — Cast E2E (T-03): Recovery
 * -----------------------------------
 * - Disconnect participant ma'lumotlari saqlanadi (item 8)
 * - Refresh'dan keyin state tiklanadi (item 8)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startE2E, stopE2E, seedCastSession, serverUrl } from './cast-e2e.helper.js';
import { upsertParticipant, markPresence, getParticipant, putAnswerIfAbsent, listAnswersForQuestion } from '../../services/cast/session-store.js';
import { initialState, replayEvents } from '../../services/cast/state-machine.js';

beforeAll(async () => {
  await startE2E();
});

afterAll(async () => {
  await stopE2E();
});

describe('T-03 cast-recovery: disconnect + refresh', () => {
  it('disconnect preserves participant answers (item 8)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Rec', owner: 'user:user', questionCount: 1 });
    await upsertParticipant(sessionId, { id: 'p1', displayAlias: 'A', presence: 'online', joinedAt: Date.now() });
    await putAnswerIfAbsent({
      sessionId, questionId: 'q_01', participantId: 'p1', attemptNo: 1,
      answerRecord: { participantId: 'p1', commandId: 'c1', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now() },
    });
    // disconnect → presence offline
    await markPresence(sessionId, 'p1', 'offline', Date.now());
    const p = await getParticipant(sessionId, 'p1');
    expect(p.presence).toBe('offline');
    // answer still there
    const list = await listAnswersForQuestion(sessionId, 'q_01');
    expect(list['p1'].status).toBe('ACCEPTED');
  });

  it('event replay reconstructs final state after refresh (item 8/9)', () => {
    const st0 = initialState({ primaryDirectorId: 'user:u', questionIds: ['q_01'], questionCount: 1, choreography: null });
    const events = [
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } },
      { type: 'cast:questionPreview', revision: 3, serverAt: 2000, payload: { questionId: 'q_01', questionPosition: 0 } },
      { type: 'cast:questionOpened', revision: 4, serverAt: 3000, payload: { questionId: 'q_01', openedAt: 3000, closesAt: 33000, timerMode: 'soft' } },
    ];
    const replay = replayEvents(st0, events);
    expect(replay.phase).toBe('QUESTION_OPEN');
    expect(replay.revision).toBe(4);
    expect(replay.openedAt).toBe(3000);
  });

  it('replay is deterministic across two refreshes (item 9)', () => {
    const st0 = initialState({ primaryDirectorId: 'user:u', questionIds: ['q_01'], questionCount: 1, choreography: null });
    const events = [
      { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } },
      { type: 'cast:questionOpened', revision: 3, serverAt: 3000, payload: { questionId: 'q_01', openedAt: 3000, closesAt: 33000, timerMode: 'soft' } },
    ];
    expect(replayEvents(st0, events)).toEqual(replayEvents(st0, events));
  });
});
