import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSession, generateSessionId, generateJoinCode } from '../../services/cast/session-store.js';
import { initialState, applyEvent } from '../../services/cast/state-machine.js';
import { normalizeCastQuestion } from '../../services/cast/test-normalizer.js';
import { splitQuestion } from '../../services/cast/test-loader.js';
import { participantQuestionProjection, revealProjection, directorQuestionProjection, publicStateProjection } from '../../services/cast/projections.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

// ═══════════════════════════════════════════════════════════════
// T-02 item 6: projector/participant/director projection boundary.
// Participant projection hech qachon answer key olib chiqmaydi;
// director projection private ma'lumotni oladi; reveal faqat
// director call'ida ochiladi.
// ═══════════════════════════════════════════════════════════════

const pubQ = [{
  id: 'q_01',
  text: '1 + 1 = ?',
  options: [
    { id: 'o_a', text: '2' },
    { id: 'o_b', text: '3' },
  ],
}];
const privQ = [{ id: 'q_01', correctOptionIds: ['o_a'], explanation: 'secret' }];
const config = { scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'off' } };

let sessionId;

beforeAll(async () => {
  snapshotDb();
  sessionId = generateSessionId();
  await createSession({
    sessionId,
    joinCode: generateJoinCode(),
    meta: { title: 'Projection test' },
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

describe('T-02: split + participant projection boundary', () => {
  it('splitQuestion separates public/private', () => {
    const norm = normalizeCastQuestion({ text: 'S', options: ['A', 'B'], correct: 0, explanation: 'x' }, 0);
    const { publicQuestion, privateQuestion } = splitQuestion(norm);
    expect(publicQuestion.correctOptionIds).toBeUndefined();
    expect(publicQuestion.explanation).toBeUndefined();
    expect(privateQuestion.correctOptionIds).toEqual(['o_a']);
  });

  it('participant projection leaks no answer key', () => {
    const proj = participantQuestionProjection(pubQ[0], { phase: 'QUESTION_OPEN' });
    const s = JSON.stringify(proj);
    expect(s).not.toContain('correctOptionIds');
    expect(s).not.toContain('secret');
    expect(proj.text).toBe('1 + 1 = ?');
  });

  it('publicStateProjection strips private fields', () => {
    let st = initialState({
      primaryDirectorId: 'user:director',
      questionIds: pubQ.map((q) => q.id),
      questionCount: pubQ.length,
      choreography: null,
    });
    st = applyEvent(st, { type: 'cast:sessionStarted', revision: 2, serverAt: 1000, payload: { startedAt: 1000 } });
    const pub = publicStateProjection(st);
    const s = JSON.stringify(pub);
    expect(s).not.toContain('correctOptionIds');
    expect(pub.phase).toBe('THINK_TIME');
  });
});

describe('T-02: director + reveal boundary', () => {
  it('directorQuestionProjection exposes only hasExplanation flag — never the key', () => {
    // Security by design: director o'z kanalida ham answer key'ni olmaydi;
    // key faqat revealProjection orqali ochiladi.
    const proj = directorQuestionProjection(pubQ[0], privQ[0]);
    const s = JSON.stringify(proj);
    expect(s).not.toContain('correctOptionIds');
    expect(s).not.toContain('secret');
    expect(proj.hasExplanation).toBe(true);
  });

  it('revealProjection exposes correct ids + explanation (policy-gated)', () => {
    const rev = revealProjection(privQ[0], { includeExplanation: true });
    expect(rev.correctOptionIds).toEqual(['o_a']);
    expect(rev.explanation).toBe('secret');
  });

  it('reveal without includeExplanation omits explanation', () => {
    const rev = revealProjection(privQ[0], {});
    expect(rev.correctOptionIds).toEqual(['o_a']);
    expect(rev.explanation).toBeUndefined();
  });
});
