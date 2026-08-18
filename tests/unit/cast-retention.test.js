/**
 * Edikit — Cast C4-07 Retention Job Tests
 * ------------------------------------------
 * coverage: expired delete/anonymize (item 6), legal hold (item 12),
 *           tombstone (item 9/10), token revoke (item 8), retry,
 *           job contract (item 5), audit no raw text (item 11).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  listCastSessions,
  inspectSession,
  applyRetentionForSession,
  revokeExpiredTokens,
  runRetentionJob,
  applyTombstonesOnRestore,
} from '../../services/cast/retention-job.js';
import {
  writeTombstone,
  restoreWithTombstones,
  deleteDataClass,
  retryFailedDeletions,
  registerCleanupHook,
  listCleanupHooks,
  runCleanupHooks,
} from '../../services/cast/deletion-service.js';
import { DATA_CLASSES, resolveRetentionPolicy } from '../../services/cast/data-policy.js';

const DAY = 24 * 60 * 60 * 1000;

function makeDb() {
  const db = new Map();
  return {
    db,
    adapter: {
      dbGet: async (p) => ({ exists: () => db.has(p), val: () => db.get(p) }),
      dbSet: async (p, v) => db.set(p, v),
      dbRemove: async (p) => db.delete(p),
      dbUpdate: async (p, v) => db.set(p, { ...(db.get(p) || {}), ...v }),
    },
  };
}

function seedSession(db, sessionId, { ageDays = 0, ended = false, answers = true, openText = true, holds = [] } = {}) {
  const now = 2_000_000_000_000;
  const createdAt = now - ageDays * DAY;
  db.set(`cast_sessions/${sessionId}/meta`, {
    created_at: createdAt,
    ...(ended ? { ended_at: createdAt + 3600_000 } : {}),
  });
  db.set(`cast_sessions/${sessionId}/scores`, { p1: { total: 1000 } });
  if (answers) db.set(`cast_private/${sessionId}/answers`, { q1: { p1: { 1: { optionId: 'a' } } } });
  if (openText) db.set(`cast_private/${sessionId}/wall_queue`, { w1: { text: 'savol' } });
  if (holds.length) db.set(`cast_private/${sessionId}/governance/legal_holds`, holds);
  // cast_sessions root — merge (bir nechta sessiya seed qilinadi)
  const sessions = db.get('cast_sessions') || {};
  sessions[sessionId] = { meta: true };
  db.set('cast_sessions', sessions);
}

describe('C4-07: retention job — expired delete (item 6)', () => {
  it('eski sessiya javoblarini o\'chiradi, yangisini o\'chirmaydi', async () => {
    const { db, adapter } = makeDb();
    seedSession(db, 'cast_old', { ageDays: 120 }); // named_answer 90d > 120d → DELETE
    seedSession(db, 'cast_fresh', { ageDays: 10 });

    const result = await runRetentionJob(adapter, { now: 2_000_000_000_000 });
    expect(result.deleted).toBeGreaterThan(0);
    // Eski sessiya answers o'chdi
    expect(db.has(`cast_private/cast_old/answers`)).toBe(false);
    expect(db.has(`cast_private/cast_old/wall_queue`)).toBe(false);
    // Yangi sessiya saqlanadi
    expect(db.has(`cast_private/cast_fresh/answers`)).toBe(true);
    expect(db.has(`cast_private/cast_fresh/wall_queue`)).toBe(true);
  });

  it('job contract (item 5): jobId/policyId/processed/deleted/failed', async () => {
    const { db, adapter } = makeDb();
    seedSession(db, 'cast_old', { ageDays: 100 });
    const result = await runRetentionJob(adapter, { now: 2_000_000_000_000 });
    expect(result.jobId).toMatch(/^ret_/);
    expect(result.policyId).toBe('institution_default_v1');
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(Array.isArray(result.failedIds)).toBe(true);
    // Job record saqlanadi
    expect(db.has(`cast_private/retention_jobs/${result.jobId}`)).toBe(true);
  });
});

describe('C4-07: legal hold (item 12)', () => {
  it('legal hold ostidagi sessiya o\'chirilmaydi', async () => {
    const { db, adapter } = makeDb();
    const hold = { holdId: 'hold_x', scope: 'session', reason: 'sud', createdAt: 1000, expiresAt: null };
    seedSession(db, 'cast_held', { ageDays: 200, holds: [hold] });

    const insp = await inspectSession(adapter, 'cast_held', { now: 2_000_000_000_000 });
    expect(insp.legalHold).toBe(true);
    expect(insp.expired).toEqual([]);

    const res = await applyRetentionForSession(adapter, 'cast_held', { now: 2_000_000_000_000 });
    expect(res.deleted).toBe(0);
    expect(db.has(`cast_private/cast_held/answers`)).toBe(true);
  });
});

describe('C4-07: audit no raw text (item 11)', () => {
  it('retention audit recordda raw text yo\'q', async () => {
    const { db, adapter } = makeDb();
    seedSession(db, 'cast_old', { ageDays: 100 });
    await runRetentionJob(adapter, { now: 2_000_000_000_000 });
    // Audit record topish — nested path'larni skaner qilamiz
    const allJson = JSON.stringify([...db.entries()]);
    expect(allJson).toContain('retention:applied');
    expect(allJson).not.toContain('savol'); // raw open text emas
    expect(allJson).toContain('"safe":true');
  });
});

describe('C4-07: tombstone (item 9/10)', () => {
  it('writeTombstone + restore re-apply blocked pathlarni chiqaradi', async () => {
    const { db, adapter } = makeDb();
    db.set(`cast_private/s1/governance/tombstones`, {
      'answers/q1/p1/1': { deletedAt: 1, reason: 'retention', restoreBlocked: true },
    });
    const restorePayload = {
      answers: { q1: { p1: { 1: { optionId: 'a' }, 2: { optionId: 'b' } } } },
    };
    const res = await restoreWithTombstones(adapter, 's1', { restorePayload });
    expect(res.blockedCount).toBe(1);
    // O'chirilgan path restore'da qayta tiklanmaydi
    expect(res.restored.answers.q1.p1['1']).toBeUndefined();
    expect(res.restored.answers.q1.p1['2']).toBeDefined();
  });

  it('deleteDataClass tombstone yozadi + cleanup hook chaqiradi', async () => {
    const { db, adapter } = makeDb();
    db.set(`cast_private/s1/answers`, { q1: { p1: { 1: {} } } });
    const hooked = [];
    registerCleanupHook({ id: 'test_cache', kind: 'cache', fn: async (paths) => hooked.push(paths) });

    const policy = resolveRetentionPolicy('x', { named_answer: { days: 90 } });
    const res = await deleteDataClass(adapter, 's1', {
      cls: DATA_CLASSES.NAMED_ANSWER,
      paths: [`cast_private/s1/answers`],
      policy,
    });
    expect(res.deleted).toBe(1);
    expect(db.has(`cast_private/s1/answers`)).toBe(false);
    expect(db.has(`cast_private/s1/governance/tombstones`)).toBe(true);
    expect(hooked.length).toBe(1);
  });
});

describe('C4-07: token revoke (item 8)', () => {
  it('15 min dan eski join kodlar o\'chiriladi', async () => {
    const { db, adapter } = makeDb();
    const now = 2_000_000_000_000;
    // Root object (read uchun) + per-key (remove uchun) — flat adapter
    db.set('cast_codes', {
      OLD123: { sessionId: 's1', created_at: now - 30 * 60 * 1000 },
      NEW456: { sessionId: 's1', created_at: now - 1000 },
    });
    db.set('cast_codes/OLD123', { sessionId: 's1', created_at: now - 30 * 60 * 1000 });
    db.set('cast_codes/NEW456', { sessionId: 's1', created_at: now - 1000 });
    const res = await revokeExpiredTokens(adapter, now);
    expect(res.revoked).toBe(1);
    expect(db.has('cast_codes/OLD123')).toBe(false);
    expect(db.has('cast_codes/NEW456')).toBe(true);
  });
});

describe('C4-07: failed retry', () => {
  it('retryFailedDeletions muvaffaqiyatli/fail ajratadi', async () => {
    const ok = new Set(['s2']);
    const runFn = async (sid) => {
      if (!ok.has(sid)) throw new Error('fail');
    };
    const res = await retryFailedDeletions({}, ['s1', 's2', 's3'], runFn);
    expect(res.retried).toEqual(['s2']);
    expect(res.stillFailing).toEqual(['s1', 's3']);
  });
});

describe('C4-07: cleanup hooks registry', () => {
  it('register + list + run', async () => {
    registerCleanupHook({ id: 'search_idx', kind: 'search', fn: async () => {} });
    const hooks = listCleanupHooks();
    expect(hooks.some((h) => h.id === 'search_idx')).toBe(true);
    const results = await runCleanupHooks(['/x']);
    expect(results.length).toBeGreaterThan(0);
  });
});
