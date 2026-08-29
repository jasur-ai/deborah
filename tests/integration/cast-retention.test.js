import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSession, generateSessionId, generateJoinCode } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';
import { inspectSession, applyRetentionForSession, runRetentionJob, revokeExpiredTokens } from '../../services/cast/retention-job.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import fb from '../../firebase/admin.js';

// ═══════════════════════════════════════════════════════════════
// T-02 item 8: retention/deletion — real local-db adapter orqali.
// Expired NAMED_ANSWER class DELETE qilinadi, legal hold saqlanadi,
// eski join kodlar revoke qilinadi, audit raw data'siz yoziladi.
// ═══════════════════════════════════════════════════════════════

const pubQ = [{ id: 'q_01', text: 'S', options: [{ id: 'o_a', text: 'A' }] }];
const privQ = [{ id: 'q_01', correctOptionIds: ['o_a'] }];
const config = { scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'off' } };

const adapter = {
  dbGet: (p) => fb.get(p),
  dbSet: (p, v) => fb.set(p, v),
  dbRemove: (p) => fb.remove(p),
  dbUpdate: (p, v) => fb.update(p, v),
};

beforeAll(async () => {
  snapshotDb();
});

afterAll(async () => {
  restoreDb();
});

async function makeSession({ title, createdAt, endedAt, withAnswers = true } = {}) {
  const sessionId = generateSessionId();
  const joinCode = generateJoinCode();
  await createSession({
    sessionId,
    joinCode,
    meta: {
      title: title || 'Retention',
      tier: 'S',
    },
    config,
    state: initialState({
      primaryDirectorId: 'user:d',
      questionIds: pubQ.map((q) => q.id),
      questionCount: pubQ.length,
      choreography: null,
    }),
    privateQuestions: privQ,
    publicQuestions: pubQ,
  });
  // createSession meta'da created_at ni o'zi yozadi — retention simulyatsiyasi
  // uchun eski timestamp'larni alohida update qilamiz.
  await fb.update(`cast_sessions/${sessionId}/meta`, {
    created_at: createdAt || Date.now(),
    ended_at: endedAt || null,
  });
  if (withAnswers) {
    await fb.set(`cast_private/${sessionId}/answers/q_01/p1/1`, {
      participantId: 'p1', commandId: 'c1', status: 'ACCEPTED', selectedOptionIds: ['o_a'], receivedAt: Date.now(),
    });
  }
  return { sessionId, joinCode };
}

describe('T-02: retention inspection', () => {
  it('fresh session with answers — nothing expired yet', async () => {
    const { sessionId } = await makeSession({ title: 'Fresh' });
    const insp = await inspectSession(adapter, sessionId, { now: Date.now() });
    expect(insp.expired.length).toBe(0);
  });

  it('very old ended session — named answers expired for deletion', async () => {
    const old = Date.now() - 400 * 24 * 3600 * 1000; // 400 days ago
    const { sessionId } = await makeSession({ title: 'Old', createdAt: old, endedAt: old + 1000 });
    const insp = await inspectSession(adapter, sessionId, { now: Date.now() });
    const expiredClasses = insp.expired.map((e) => e.cls);
    expect(expiredClasses).toContain('named_answer');
  });

  it('legal hold blocks deletion', async () => {
    const old = Date.now() - 400 * 24 * 3600 * 1000;
    const { sessionId } = await makeSession({ title: 'Held', createdAt: old, endedAt: old + 1000 });
    await fb.set(`cast_private/${sessionId}/governance/legal_holds`, [
      { holdId: 'h1', startedAt: Date.now() - 1000, until: Date.now() + 86400000 },
    ]);
    const insp = await inspectSession(adapter, sessionId, { now: Date.now() });
    expect(insp.legalHold).toBe(true);
    expect(insp.expired.length).toBe(0);
  });
});

describe('T-02: retention apply + delete', () => {
  it('deletes expired answers and writes tombstone + safe audit', async () => {
    const old = Date.now() - 400 * 24 * 3600 * 1000;
    const { sessionId } = await makeSession({ title: 'DeleteMe', createdAt: old, endedAt: old + 1000 });
    const res = await applyRetentionForSession(adapter, sessionId, { now: Date.now() });
    expect(res.deleted).toBeGreaterThan(0);
    expect(res.tombstoned).toBe(true);

    // Answers o'chirilgan
    const snap = await fb.get(`cast_private/${sessionId}/answers`);
    expect(snap.exists()).toBe(false);

    // Tombstone yozilgan
    const ts = await fb.get(`cast_private/${sessionId}/governance/tombstones`);
    expect(ts.exists()).toBe(true);
  });
});

describe('T-02: token revoke + full job', () => {
  it('revokes expired join codes', async () => {
    const { sessionId, joinCode } = await makeSession({ title: 'Codes' });
    // created_at eski qilib yozib, revoke qilamiz
    await fb.set(`cast_codes/${joinCode}`, { sessionId, created_at: Date.now() - 30 * 60 * 1000 });
    const res = await revokeExpiredTokens(adapter, Date.now(), 15 * 60 * 1000);
    expect(res.revoked).toBeGreaterThan(0);
    const gone = await fb.get(`cast_codes/${joinCode}`);
    expect(gone.exists()).toBe(false);
  });

  it('runRetentionJob processes sessions and writes job record', async () => {
    const old = Date.now() - 400 * 24 * 3600 * 1000;
    const { sessionId } = await makeSession({ title: 'Job', createdAt: old, endedAt: old + 1000 });
    const job = await runRetentionJob(adapter, { now: Date.now(), sessionIds: [sessionId] });
    expect(job.processed).toBe(1);
    expect(job.deleted).toBeGreaterThan(0);
    expect(job.policyId).toBeTruthy();
    expect(job.jobId).toBeTruthy();
    expect(job.failed).toBe(0);
  });
});
