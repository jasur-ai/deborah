/**
 * Edikit — API, Socket, Job, Webhook & Outbox Contract Audit (e2e/security, Prompt 67)
 *
 * Full critical-journey (research.md §18/§19): route inventory → zod→OpenAPI
 * contract → socket allowlist → webhook raw-signature/replay/dedup →
 * transactional outbox + consumer idempotency.
 *
 * Security: webhook replay rejection (timestamp + event_id dedup), outbox
 * consumer idempotency (at-least-once → idempotent), undocumented privileged
 * endpoint detection (§24), sensitive-field guard (§15), socket allowlist.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { z } from 'zod';
import {
  verifyWebhookRawSignature,
  assertWebhookReplay,
  assertWebhookDedup,
  processWebhookOutOfOrder,
  assertSocketEventAllowed,
  assertNoSensitiveInGenericSchema,
  assertOutboxTransition,
  assertConsumerIdempotency,
  buildOpenApiDocument,
  assertOpenApiDocument,
  assertRouteEntry,
  WEBHOOK_STATUS,
} from '../../src/modules/api-contracts/api-contracts.schema.js';

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

describe('api-contracts — e2e/security critical journey', () => {
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

  it('full journey — routes → contract → openapi → socket → outbox', async () => {
    // 1. Route inventory
    await mod.registerRoute({ method: 'POST', path: '/api/v1/tests', authLevel: 'user', module: 'assessment', documented: true, idempotent: true, contractName: 'CreateTest', createdBy: 'admin' });
    await mod.registerRoute({ method: 'POST', path: '/api/v1/attempts/:id/events', authLevel: 'user', module: 'attempt', documented: true, contractName: 'AttemptEvent', createdBy: 'admin' });

    // 2. Contract save + publish (zod → OpenAPI)
    await mod.saveContract({ contractName: 'CreateTest', kind: 'request', zodSchema: z.object({ name: z.string(), duration: z.number() }), scope: 'user', createdBy: 'admin' });
    const cid = tables.api_contracts.find((c) => c.contract_name === 'CreateTest').id;
    await mod.setContractStatus({ contractId: cid, status: 'published', changedBy: 'admin' });

    // 3. OpenAPI document — routes + schemas present
    const doc = await mod.getOpenApiDocument();
    expect(doc.ok).toBe(true);
    expect(doc.doc.paths['/api/v1/tests']).toBeTruthy();
    expect(doc.doc.paths['/api/v1/attempts/:id/events']).toBeTruthy();
    expect(doc.doc.components.schemas.CreateTest).toBeTruthy();

    // 4. Socket allowlist entry
    const se = await mod.registerSocketEvent({ eventName: 'player:answer', version: 'v1', auth: 'player', rateLimitGroup: 'answer', zodSchema: z.object({ qIndex: z.number() }), documented: true, createdBy: 'admin' });
    expect(se.ok).toBe(true);

    // 5. Outbox enqueue + deliver (idempotent)
    const payload = { attemptId: 7 };
    const e1 = await mod.enqueueOutbox({ outboxType: 'scoring', payload, version: 'v1', jobType: 'scoring', traceRequired: true, createdBy: 'admin' });
    expect(e1.ok).toBe(true);
    const e2 = await mod.enqueueOutbox({ outboxType: 'scoring', payload, version: 'v1', jobType: 'scoring', traceRequired: true });
    expect(e2.idempotent).toBe(true);
    expect(tables.outbox_messages).toHaveLength(1);

    const delivered = await mod.processOutboxMessage({ messageId: e1.message.id, deliver: async () => ({ ok: true }), processedBy: 'worker' });
    expect(delivered.ok).toBe(true);
    expect(delivered.status).toBe('delivered');

    // 6. Summary — all wired
    const s = await mod.getContractSummary();
    expect(s.ok).toBe(true);
    expect(s.routes).toBe(2);
    expect(s.contractsPublished).toBe(1);
    expect(s.socketEvents).toBe(1);
    expect(s.outboxDelivered).toBe(1);
    expect(s.undocumentedPrivileged).toBe(0);
  });

  it('SECURITY — webhook replay rejected: stale timestamp + duplicate event_id', async () => {
    const secret = 'wh-secret-123';
    const raw = '{"event":"grade.released"}';
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const now = Date.now();

    // valid → received
    const ok = await mod.recordWebhook({ provider: 'hemis', eventId: 'evt-1', eventType: 'grade.released', secret, rawBody: raw, signature: sig, eventTime: now, createdBy: 'admin' });
    expect(ok.ok).toBe(true);

    // replay (same event_id) → duplicate
    const replay = await mod.recordWebhook({ provider: 'hemis', eventId: 'evt-1', eventType: 'grade.released', secret, rawBody: raw, signature: sig, eventTime: now });
    expect(replay.ok).toBe(false);
    expect(replay.duplicate).toBe(true);

    // stale timestamp replay
    const stale = await mod.recordWebhook({ provider: 'hemis', eventId: 'evt-2', eventType: 'grade.released', secret, rawBody: raw, signature: sig, eventTime: now - 10 * 60 * 1000 });
    expect(stale.ok).toBe(false);
    expect(stale.replayFailed).toBe(true);

    // forged signature
    const forged = await mod.recordWebhook({ provider: 'hemis', eventId: 'evt-3', eventType: 'grade.released', secret, rawBody: raw, signature: 'forgedsig', eventTime: now });
    expect(forged.ok).toBe(false);
    expect(forged.signatureFailed).toBe(true);

    // schema-level: out-of-order seq → out_of_order
    expect(processWebhookOutOfOrder({ seq: 1, lastSeen: 3 }).status).toBe(WEBHOOK_STATUS.OUT_OF_ORDER);
  });

  it('SECURITY — outbox consumer idempotency: no double delivery', async () => {
    const payload = { attemptId: 9 };
    const e = await mod.enqueueOutbox({ outboxType: 'gradeRelease', payload, version: 'v1', jobType: 'gradeRelease', traceRequired: true });
    const msgId = e.message.id;
    const deliveries = [];

    const d1 = await mod.processOutboxMessage({ messageId: msgId, deliver: async () => { deliveries.push('run1'); return { ok: true }; } });
    expect(d1.ok).toBe(true);
    expect(d1.status).toBe('delivered');

    // replay process → consumer idempotency → skip (no second delivery)
    const d2 = await mod.processOutboxMessage({ messageId: msgId, deliver: async () => { deliveries.push('run2'); return { ok: true }; } });
    expect(d2.duplicate).toBe(true);
    expect(deliveries).toEqual(['run1']);
  });

  it('SECURITY — undocumented privileged endpoint detected (§24); sensitive schema guard (§15)', async () => {
    // Stop condition — privileged endpoint must be documented
    const bad = await mod.registerRoute({ method: 'POST', path: '/api/v1/admin/super', authLevel: 'admin', documented: false, module: 'x' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/documented/);
    expect(tables.api_route_registry || []).toHaveLength(0);

    // schema-level
    expect(assertRouteEntry({ method: 'POST', path: '/api/v1/admin/super', authLevel: 'admin', documented: false }).ok).toBe(false);

    // §15 — private scoring in generic schema rejected
    expect(assertNoSensitiveInGenericSchema({ spec: { properties: { privateScore: { type: 'number' } } }, scope: 'user' }).ok).toBe(false);
    expect(assertNoSensitiveInGenericSchema({ spec: { properties: { name: { type: 'string' } } }, scope: 'user' }).ok).toBe(true);
  });

  it('SECURITY — socket event allowlist fail-closed; unversioned event rejected', async () => {
    expect(assertSocketEventAllowed({ event: 'player:answer', version: 'v1' }).ok).toBe(true);
    expect(assertSocketEventAllowed({ event: 'player:answer', version: 'v0' }).ok).toBe(false);
    expect(assertSocketEventAllowed({ event: 'host:exploit', version: 'v1' }).ok).toBe(false);
  });

  it('SECURITY — OpenAPI document excludes undocumented routes', () => {
    const doc = buildOpenApiDocument({
      routes: [
        { method: 'GET', path: '/api/v1/public', documented: true, auth_level: 'public', module: 'x' },
        { method: 'POST', path: '/api/v1/secret', documented: false, auth_level: 'admin', module: 'x' },
      ],
      contracts: [],
    });
    expect(assertOpenApiDocument(doc).ok).toBe(true);
    expect(doc.paths['/api/v1/public']).toBeTruthy();
    expect(doc.paths['/api/v1/secret']).toBeUndefined();
  });
});
