/**
 * Edikit — Cast E2E (T-03): Answer flow
 * -------------------------------------
 * Socket.io-client orqali real server'da:
 * - Participant join + answer (item 5)
 * - Director answer count (item 5)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io } from 'socket.io-client';
import { startE2E, stopE2E, seedCastSession, serverUrl } from './cast-e2e.helper.js';
import { putAnswerIfAbsent, listAnswersForQuestion } from '../../services/cast/session-store.js';
import { readFileSync } from 'node:fs';

let socket;

beforeAll(async () => {
  await startE2E();
});

afterAll(async () => {
  if (socket) socket.disconnect();
  await stopE2E();
});

function emitAck(sessionId, type, payload = {}) {
  return new Promise((resolve) => {
    socket.emit('cast:command', {
      commandId: `cmd-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      type,
      payload,
      sentAtClient: Date.now(),
    }, (ack) => resolve(ack));
  });
}

describe('T-03 cast-answer: answer + count flow', () => {
  it('participant join (real joinCode) + answerSubmit is ACKed (item 5)', async () => {
    const { sessionId, joinCode, publicQuestions } = await seedCastSession({ title: 'Answer E2E', owner: 'user:user', questionCount: 1 });
    const qid = publicQuestions[0].id;
    const firstOptionId = publicQuestions[0].options[0].id;

    socket = io(serverUrl, { transports: ['websocket'], forceNew: true });
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('socket timeout')), 8000);
    });

    // Participant join — haqiqiy joinCode (membership ticket socket.data'ga saqlanadi)
    const joinAck = await emitAck(sessionId, 'cast:join', {
      joinCode,
      displayName: 'E2E Bot',
    });
    expect(joinAck.ok).toBe(true);

    // Seed'dagi savol hech qachon director tomonidan ochilmagan — demak
    // answer deterministik tarzda REJECTED_QUESTION_CLOSED bilan rad etilishi shart.
    // Bu ikki narsani isbotlaydi: (1) join (membership ticket) ishlagan —
    // aks holda NOT_AUTHORIZED bo'lardi; (2) error contract to'g'ri —
    // INTERNAL emas, aniq REJECTED_QUESTION_CLOSED kodi.
    const ansAck = await emitAck(sessionId, 'cast:answerSubmit', {
      questionId: qid,
      selectedOptionIds: [firstOptionId],
    });
    expect(ansAck.ok).toBe(false);
    expect(ansAck.error?.code).toBe('REJECTED_QUESTION_CLOSED');
    socket.disconnect();
    socket = null;
  }, 30000);

  it('director-side answer persistence via store (item 5)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Answer Persist', owner: 'user:user', questionCount: 1 });
    await putAnswerIfAbsent({
      sessionId,
      questionId: 'q_01',
      participantId: 'p1',
      attemptNo: 1,
      answerRecord: { participantId: 'p1', commandId: 'c1', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now() },
    });
    const list = await listAnswersForQuestion(sessionId, 'q_01');
    expect(list['p1'].status).toBe('ACCEPTED');
    expect(list['p1'].selectedOptionIds).toEqual(['o_a']);
  });

  it('duplicate answer is rejected (first-wins, item 5)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Dup', owner: 'user:user', questionCount: 1 });
    await putAnswerIfAbsent({
      sessionId, questionId: 'q_01', participantId: 'p2', attemptNo: 1,
      answerRecord: { participantId: 'p2', commandId: 'c1', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now() },
    });
    const second = await putAnswerIfAbsent({
      sessionId, questionId: 'q_01', participantId: 'p2', attemptNo: 1,
      answerRecord: { participantId: 'p2', commandId: 'c2', status: 'ACCEPTED', selectedOptionIds: ['o_b'], receivedAt: Date.now() },
    });
    expect(second.status).toBe('ALREADY_ANSWERED');
  });
});

describe('S31 — Participant answer experience', () => {
  it('S31.05/07 — state banner stillari + shimmer/bounce/glow yo\'q', () => {
    const css = readFileSync('public/css/cast-participant.css', 'utf8');
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const st of ['SELECTED', 'SENDING', 'SAVED', 'RETRYING', 'LOCKED']) {
      expect(css).toContain(`[data-state='${st}']`);
    }
    expect(body).not.toMatch(/shimmer|sweep|bounce|glow/);
    const ejs = readFileSync('views/cast/participant.ejs', 'utf8');
    expect(ejs).toContain('part-state-banner');
    expect(ejs).toContain('part-net');
  });

  it('S31.08/09/10/11 — badge, prefs, semantic reveal, net status', () => {
    const js = readFileSync('public/js/cast-participant.js', 'utf8');
    expect(js).toContain('cast-participant-prefs-v1');
    expect(js).toContain('updateBadge');
    expect(js).toContain('updateNet');
    expect(js).toContain('part-reveal--correct');
    expect(js).toContain('setJoinStep');
    const css = readFileSync('public/css/cast-participant.css', 'utf8');
    expect(css).toContain('safe-area-inset-top');
    expect(css).toContain('part-pref-contrast');
  });
});
