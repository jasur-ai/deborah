import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// ── Isolated local DB instance for transaction tests ──
// Vitest env sets NODE_ENV=test → firebase/admin.js uses local DB (data/db.json).
// These tests exercise the transaction() primitive directly via the wrapper.
import { fb } from '../../firebase/admin.js';

describe('fb.transaction (local DB)', () => {
  it('commits update with committed=true', async () => {
    const r = await fb.transaction('__t/01', (cur) => (cur || 0) + 1);
    expect(r.committed).toBe(true);
    expect(r.value).toBe(1);
  });

  it('updater returning undefined aborts', async () => {
    const r = await fb.transaction('__t/02', () => undefined);
    expect(r.committed).toBe(false);
  });

  it('null updater result aborts and preserves previous', async () => {
    await fb.set('__t/03', { keep: true });
    const r = await fb.transaction('__t/03', () => null);
    expect(r.committed).toBe(false);
    expect(r.previous.keep).toBe(true);
  });

  it('serializes concurrent increments (no lost update)', async () => {
    await fb.set('__t/counter', 0);
    await Promise.all([
      fb.transaction('__t/counter', (cur) => (cur || 0) + 1),
      fb.transaction('__t/counter', (cur) => (cur || 0) + 1),
      fb.transaction('__t/counter', (cur) => (cur || 0) + 1),
      fb.transaction('__t/counter', (cur) => (cur || 0) + 1),
      fb.transaction('__t/counter', (cur) => (cur || 0) + 1),
    ]);
    const snap = await fb.get('__t/counter');
    expect(snap.val()).toBe(5);
  });

  it('reads latest persisted value inside updater', async () => {
    await fb.set('__t/04', 10);
    const r = await fb.transaction('__t/04', (cur) => (cur || 0) * 2);
    expect(r.value).toBe(20);
  });

  it('root-level transaction works', async () => {
    const r = await fb.transaction('__t/root_tx', (cur) => ({ root: true }));
    expect(r.committed).toBe(true);
    expect(r.value.root).toBe(true);
  });

  it('cleanup', async () => {
    await fb.remove('__t');
    const snap = await fb.get('__t');
    expect(snap.exists()).toBe(false);
  });
});
