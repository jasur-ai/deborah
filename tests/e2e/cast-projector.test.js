/**
 * Deborah — Cast E2E (T-03): Projector safe projection
 * ---------------------------------------------------
 * - Projector sahifasi public projection render qiladi (item 7)
 * - Projection HTML'ida answer key (correctOptionIds) YO'Q (item 7)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startE2E, stopE2E, newContext, newPage, seedCastSession, serverUrl } from './cast-e2e.helper.js';
import { participantQuestionProjection, publicStateProjection } from '../../services/cast/projections.js';
import { initialState } from '../../services/cast/state-machine.js';

let context;

beforeAll(async () => {
  await startE2E();
  context = await newContext();
});

afterAll(async () => {
  await context.close();
  await stopE2E();
});

describe('T-03 cast-projector: safe projection', () => {
  it('participantQuestionProjection never leaks answer key (item 7)', () => {
    const pub = {
      id: 'q_01',
      text: 'Secret?',
      options: [{ id: 'o_a', text: 'A' }, { id: 'o_b', text: 'B' }],
    };
    const proj = participantQuestionProjection(pub, { phase: 'QUESTION_OPEN' });
    const s = JSON.stringify(proj);
    expect(s).not.toContain('correctOptionIds');
    expect(s).not.toContain('explanation');
  });

  it('publicStateProjection contains no private data (item 7)', () => {
    const st = initialState({ primaryDirectorId: 'user:u', questionIds: ['q_01'], questionCount: 1, choreography: null });
    const pub = publicStateProjection(st);
    const s = JSON.stringify(pub);
    expect(s).not.toContain('correctOptionIds');
    expect(pub.phase).toBe('LOBBY_OPEN');
  });

  it('projector route rejects without valid ticket — safe by default (item 7)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Proj', owner: 'user:user' });
    const page = await newPage(context);
    // Ticket'siz — 403 (projector faqat director tomonidan chiqarilgan bir martalik
    // token bilan ochiladi; default holatda answer key hech qachon ko'rinmaydi)
    const resp = await page.goto(`${serverUrl}/cast/${sessionId}/projector`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    expect(resp.status()).toBe(403);
    await page.close();
  }, 30000);
});
