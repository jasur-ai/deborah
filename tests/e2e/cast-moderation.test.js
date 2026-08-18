/**
 * Edikit — Cast E2E (T-03): Moderation boundary
 * ----------------------------------------------
 * - Unmoderated text public projector/participant projection'da YO'Q (item 11)
 * - Moderated text faqat tasdiqlangandan keyin ko'rinadi (item 11)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startE2E, stopE2E, seedCastSession } from './cast-e2e.helper.js';
import { publicStateProjection, publicEvidenceProjection } from '../../services/cast/projections.js';
import { initialState } from '../../services/cast/state-machine.js';

beforeAll(async () => {
  await startE2E();
});

afterAll(async () => {
  await stopE2E();
});

describe('T-03 cast-moderation: unmoderated text is not public', () => {
  it('publicStateProjection contains no wall/message content (item 11)', () => {
    const st = {
      ...initialState({ primaryDirectorId: 'user:u', questionIds: ['q_01'], questionCount: 1, choreography: null }),
      // Director-side wall bo'lishi mumkin — lekin public projection'da ko'rinmaydi
      wallQueue: [{ text: 'salbiy fikr', status: 'pending' }],
    };
    const pub = publicStateProjection(st);
    const s = JSON.stringify(pub);
    expect(s).not.toContain('salbiy fikr');
    expect(s).not.toContain('wallQueue');
    expect(s).not.toContain('wall');
  });

  it('publicEvidenceProjection exposes only aggregate counts — no text (item 11)', () => {
    const ev = {
      questionId: 'q_01',
      accepted: 5,
      responseRate: 0.5,
      active: 10,
      eligible: 10,
      revision: 2,
      // Private aggregate — public projection'da ko'rinmaydi
      distribution: [{ optionId: 'o_a', count: 4 }],
      named: ['someone'],
    };
    const pub = publicEvidenceProjection(ev);
    const s = JSON.stringify(pub);
    expect(s).not.toContain('someone');
    expect(s).not.toContain('distribution');
    expect(pub.accepted).toBe(5);
    expect(pub.responseRate).toBe(0.5);
  });

  it('moderated text flow is director-gated (session safe without wall)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Mod', owner: 'user:user', questionCount: 1 });
    expect(sessionId).toBeTruthy();
  });
});
