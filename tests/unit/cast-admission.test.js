import { describe, it, expect, afterAll } from 'vitest';
import localDB from '../../firebase/local-db.js';
import { countActiveSessions } from '../../services/cast/session-store.js';

const TEST_SIDS = [];

async function seedSession(sid, { ended = false, endedAt = false } = {}) {
  TEST_SIDS.push(sid);
  await localDB.set(`cast_sessions/${sid}/meta`, {
    sessionId: sid,
    joinCode: `LC${sid.slice(-4).toUpperCase()}`,
    created_at: Date.now(),
    ...(endedAt ? { endedAt: Date.now() } : {}),
  });
  await localDB.set(`cast_sessions/${sid}/state`, {
    phase: ended ? 'ENDED' : 'LOBBY',
    revision: 1,
  });
}

describe('C5-09 item 20: countActiveSessions admission', () => {
  afterAll(async () => {
    for (const sid of TEST_SIDS) {
      await localDB.remove(`cast_sessions/${sid}`);
      await localDB.remove(`cast_private/${sid}`);
    }
  });

  it('counts only active (non-ended) sessions', async () => {
    await seedSession('cap_active_1');
    await seedSession('cap_active_2');
    await seedSession('cap_ended_1', { ended: true });
    await seedSession('cap_ended_2', { endedAt: true });

    const count = await countActiveSessions();
    // Local DB'da oldingi testlar sessiyalari ham bor bo'lishi mumkin —
    // bizning 2 active'ga qo'shiladi, ended'lar kirmaydi.
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('does not count ended sessions', async () => {
    const before = await countActiveSessions();
    await seedSession('cap_ended_only', { ended: true });
    await seedSession('cap_ended_only2', { endedAt: true });
    const after = await countActiveSessions();
    expect(after).toBe(before); // ended sessionlar hisobga kirmaydi
  });
});
