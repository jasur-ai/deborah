/**
 * Deborah — API, Socket, Job, Webhook & Outbox Contract Audit (integration tests, Prompt 67)
 *
 * Service qatlami (fake DB): route inventory (undocumented privileged
 * detection), contract save/publish (zod→OpenAPI + sensitive guard), socket
 * event registry (allowlist), outbox enqueue/process (consumer idempotency,
 * retry/DLQ), webhook record (signature/replay/dedup), OpenAPI document.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { z } from 'zod';

// ── Chainable in-memory fake DB (Kysely-ish) ──
function makeFakeDb(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let nextId = 1;

  const matches = (row, wheres) =>
    (wheres || []).every(([col, op, val]) => {
      if (op === '=') return row[col] === val;
      if (op === 'in') return Array.isArray(val) && val.includes(row[col]);
      return true;
    });

  const builder = (table, state = {}) => ({
    select: (cols) => builder(table, { ...state, cols }),
    selectAll: () => builder(table, { ...state, cols: null }),
    where: (col, op, val) => builder(table, { ...state, wheres: [...(state.wheres || []), [col, op, val]] }),
    orderBy: () => builder(table, state),
    limit: (n) => builder(table, { ...state, limitN: n }),
    async execute() {
      let rows = (tables[table] || []).filter((r) => matches(r, state.wheres));
      if (state.limitN) rows = rows.slice(0, state.limitN);
      if (state.cols === null) return rows.map((r) => ({ ...r }));
      return rows;
    },
    async executeTakeFirst() {
      const rows = await this.execute();
      return rows[0] || null;
    },
  });

  const db = {
    selectFrom: (table) => builder(table),
    insertInto: (table) => ({
      values: (row) => ({
        returning: (cols) => ({
          async executeTakeFirst() {
            const id = nextId++;
            (tables[table] = tables[table] || []).push({ id, ...row });
            const o = {};
            for (const c of cols) o[c] = { id, ...row }[c];
            return o;
          },
          async execute() {
            const id = nextId++;
            (tables[table] = tables[table] || []).push({ id, ...row });
          },
        }),
        async execute() {
          const id = nextId++;
          (tables[table] = tables[table] || []).push({ id, ...row });
        },
      }),
    }),
    updateTable: (table) => {
      const state = { patch: null, wheres: [] };
      const b = {
        set: (patch) => { state.patch = patch; return b; },
        where: (col, op, val) => { state.wheres.push([col, op, val]); return b; },
        async execute() {
          for (const row of tables[table] || []) {
            if (matches(row, state.wheres)) Object.assign(row, state.patch);
          }
        },
        returning: (cols) => ({
          async executeTakeFirst() {
            let found = null;
            for (const row of tables[table] || []) {
              if (matches(row, state.wheres)) { Object.assign(row, state.patch); found = row; }
            }
            if (!found) return null;
            const o = {};
            for (const c of cols) o[c] = found[c];
            return o;
          },
        }),
      };
      return b;
    },
  };

  return { db, tables };
}

describe('api-contracts — service layer (fake DB)', () => {
  let mod;
  let tables;
  let auditMock;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({});
    tables = fake.tables;
    auditMock = vi.fn(async () => true);
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: auditMock,
      AUDIT_ACTIONS: {
        CONTRACT_ROUTE_REGISTER: 'contract:route:register',
        CONTRACT_SAVE: 'contract:save',
        CONTRACT_STATUS: 'contract:status',
        CONTRACT_SOCKET_EVENT: 'contract:socket:event',
        WEBHOOK_RECORD: 'webhook:record',
        OUTBOX_ENQUEUE: 'outbox:enqueue',
        OUTBOX_DELIVERED: 'outbox:delivered',
        OUTBOX_FAILED: 'outbox:failed',
        OUTBOX_DEAD_LETTER: 'outbox:dead-letter',
      },
    }));
    mod = await import('../../src/modules/api-contracts/index.js');
  });

  it('route — register idempotent + undocumented privileged detection', async () => {
    const r = await mod.registerRoute({ method: 'POST', path: '/api/v1/tests', authLevel: 'user', module: 'assessment', documented: true, createdBy: 'admin' });
    expect(r.ok).toBe(true);
    expect(tables.api_route_registry).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'contract:route:register' }));

    // undocumented privileged must be rejected at the schema level
    const bad = await mod.registerRoute({ method: 'POST', path: '/api/v1/hidden', authLevel: 'admin', documented: false, module: 'x' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/documented/);

    // documented privileged is fine
    await mod.registerRoute({ method: 'DELETE', path: '/api/v1/users/:id', authLevel: 'admin', module: 'users', documented: true, createdBy: 'admin' });
    const undocumented = await mod.listUndocumentedPrivilegedRoutes();
    expect(undocumented).toHaveLength(0);
  });

  it('contract — save zod→OpenAPI + publish + sensitive guard', async () => {
    const schema = z.object({ name: z.string(), age: z.number().optional() });
    const r = await mod.saveContract({ contractName: 'CreateTest', kind: 'request', zodSchema: schema, version: 'v1', scope: 'user', createdBy: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.schemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'contract:save' }));

    // sensitive guard — privateScore in generic schema rejected
    const sensitive = await mod.saveContract({
      contractName: 'Sensitive', kind: 'response', scope: 'user',
      zodSchema: z.object({ privateScore: z.number() }), createdBy: 'admin',
    });
    expect(sensitive.ok).toBe(false);
    expect(sensitive.error).toMatch(/privatescore/i);

    // publish
    const id = tables.api_contracts.find((c) => c.contract_name === 'CreateTest').id;
    const pub = await mod.setContractStatus({ contractId: id, status: 'published', changedBy: 'admin' });
    expect(pub.ok).toBe(true);
    expect(pub.contract.status).toBe('published');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'contract:status' }));
  });

  it('openapi document — built from documented routes + published contracts', async () => {
    await mod.registerRoute({ method: 'POST', path: '/api/v1/tests', authLevel: 'user', module: 'assessment', documented: true, contractName: 'CreateTest' });
    await mod.saveContract({ contractName: 'CreateTest', kind: 'request', zodSchema: z.object({ name: z.string() }), scope: 'user' });
    const cid = tables.api_contracts.find((c) => c.contract_name === 'CreateTest').id;
    await mod.setContractStatus({ contractId: cid, status: 'published' });

    const doc = await mod.getOpenApiDocument();
    expect(doc.ok).toBe(true);
    expect(doc.doc.openapi).toBe('3.1.0');
    expect(doc.doc.paths['/api/v1/tests']).toBeTruthy();
    expect(doc.doc.components.schemas.CreateTest).toBeTruthy();
  });

  it('socket event — register from allowlist; unallowlisted rejected', async () => {
    const ok = await mod.registerSocketEvent({ eventName: 'player:answer', version: 'v1', auth: 'player', rateLimitGroup: 'answer', zodSchema: z.object({ qIndex: z.number() }), documented: true, createdBy: 'admin' });
    expect(ok.ok).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'contract:socket:event' }));

    const bad = await mod.registerSocketEvent({ eventName: 'admin:deleteAll', version: 'v1', auth: 'admin', zodSchema: z.object({}), documented: true });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/allowlist/);

    const list = await mod.listSocketEvents();
    expect(list).toHaveLength(1);
  });

  it('outbox — enqueue idempotent, process delivered, consumer idempotency', async () => {
    const payload = { attemptId: 5 };
    const e1 = await mod.enqueueOutbox({ outboxType: 'scoring', payload, version: 'v1', jobType: 'scoring', traceRequired: true, createdBy: 'admin' });
    expect(e1.ok).toBe(true);
    // trace required for scoring job — fake DB returning() faqat tanlangan
    // kolonkalarni qaytaradi, shuning uchun tables'dan tekshiramiz.
    expect(tables.outbox_messages.find((m) => m.id === e1.message.id).trace_id).toBeTruthy();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'outbox:enqueue' }));

    // idempotent enqueue — same payload → same consumer_key → same message
    const e2 = await mod.enqueueOutbox({ outboxType: 'scoring', payload, version: 'v1', jobType: 'scoring', traceRequired: true });
    expect(e2.idempotent).toBe(true);
    expect(tables.outbox_messages).toHaveLength(1);

    // process → delivered
    const msgId = e1.message.id;
    const delivered = await mod.processOutboxMessage({ messageId: msgId, deliver: async () => ({ ok: true }), processedBy: 'worker' });
    expect(delivered.ok).toBe(true);
    expect(delivered.status).toBe('delivered');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'outbox:delivered' }));

    // consumer idempotency — delivered → skip (no re-delivery)
    const again = await mod.processOutboxMessage({ messageId: msgId, deliver: async () => ({ ok: true }) });
    expect(again.duplicate).toBe(true);
  });

  it('outbox — failed delivery retries with backoff; exhausted → dead-letter', async () => {
    const e = await mod.enqueueOutbox({ outboxType: 'publish', payload: { assetId: 1 }, version: 'v1', jobType: 'publish', traceRequired: true });
    const msgId = e.message.id;

    // Simulate: attempts near max → dead-letter on next failure
    tables.outbox_messages.find((m) => m.id === msgId).attempts = 5;
    const failed = await mod.processOutboxMessage({ messageId: msgId, deliver: async () => ({ ok: false, error: 'boom' }) });
    expect(failed.ok).toBe(false);
    expect(failed.deadLettered).toBe(true);
    expect(tables.outbox_messages.find((m) => m.id === msgId).status).toBe('dead_letter');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'outbox:dead-letter' }));
  });

  it('webhook — signature + replay + dedup + out-of-order', async () => {
    const secret = 'wh-secret-123';
    const raw = '{"event":"grade.released"}';
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const now = Date.now();

    // valid
    const ok = await mod.recordWebhook({ provider: 'hemis', eventId: 'evt-1', eventType: 'grade.released', secret, rawBody: raw, signature: sig, eventTime: now, createdBy: 'admin' });
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe('received');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'webhook:record' }));

    // replay — same event_id → duplicate rejected
    const dup = await mod.recordWebhook({ provider: 'hemis', eventId: 'evt-1', eventType: 'grade.released', secret, rawBody: raw, signature: sig, eventTime: now });
    expect(dup.ok).toBe(false);
    expect(dup.duplicate).toBe(true);

    // bad signature
    const badSig = await mod.recordWebhook({ provider: 'hemis', eventId: 'evt-2', eventType: 'x', secret, rawBody: raw, signature: 'deadbeef', eventTime: now });
    expect(badSig.ok).toBe(false);
    expect(badSig.signatureFailed).toBe(true);

    // stale timestamp (replay)
    const stale = await mod.recordWebhook({ provider: 'hemis', eventId: 'evt-3', eventType: 'x', secret, rawBody: raw, signature: sig, eventTime: now - 10 * 60 * 1000 });
    expect(stale.ok).toBe(false);
    expect(stale.replayFailed).toBe(true);
  });

  it('summary — counts', async () => {
    await mod.registerRoute({ method: 'GET', path: '/api/v1/health', authLevel: 'public', module: 'health', documented: true });
    const s = await mod.getContractSummary();
    expect(s.ok).toBe(true);
    expect(s.routes).toBe(1);
    expect(s.routesByAuth.public).toBe(1);
    expect(s.undocumentedPrivileged).toBe(0);
  });
});
