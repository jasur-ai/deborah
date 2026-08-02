/**
 * Edikit — API, Socket, Job, Webhook & Outbox Contract Audit (unit tests, Prompt 67)
 *
 * PURE schema testlari: zod→OpenAPI 3.1 converter, OpenAPI document build/
 * validate, route inventory (stop condition §24), cursor/idempotency/ETag
 * conventions, socket event allowlist (fail-closed §11), job contract/trace
 * (§12), webhook raw-signature/replay/dedup/out-of-order (§13), outbox FSM +
 * consumer idempotency (§14), sensitive-field guard (§15).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  zodToOpenApiSchema,
  computeSchemaHash,
  buildOpenApiDocument,
  assertOpenApiDocument,
  buildRouteKey,
  assertRouteEntry,
  encodeCursor,
  decodeCursor,
  assertCursor,
  buildIdempotencyKey,
  assertIdempotencyHeader,
  buildEtag,
  matchEtag,
  assertSocketEventAllowed,
  assertJobContract,
  buildJobTrace,
  assertJobTrace,
  verifyWebhookRawSignature,
  assertWebhookReplay,
  assertWebhookDedup,
  processWebhookOutOfOrder,
  assertOutboxTransition,
  assertConsumerIdempotency,
  buildConsumerKey,
  assertRetryAllowed,
  computeBackoff,
  assertNoSensitiveInGenericSchema,
  assertValidEnum,
  SOCKET_EVENT_CONTRACTS,
  WEBHOOK_STATUS,
  OUTBOX_STATUS,
} from '../../src/modules/api-contracts/api-contracts.schema.js';

describe('api-contracts — zod → OpenAPI 3.1 (§18/§19)', () => {
  it('converts a zod object to OpenAPI 3.1 schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      role: z.enum(['admin', 'user']),
      tags: z.array(z.string()),
    });
    const r = zodToOpenApiSchema(schema);
    expect(r.ok).toBe(true);
    expect(r.spec.type).toBe('object');
    expect(r.spec.properties.name.type).toBe('string');
    expect(r.spec.properties.role.enum).toEqual(['admin', 'user']);
    expect(r.spec.required).toContain('name');
  });

  it('rejects non-zod schema', () => {
    expect(zodToOpenApiSchema(null).ok).toBe(false);
    expect(zodToOpenApiSchema('nope').ok).toBe(false);
  });

  it('schema hash is deterministic', () => {
    const s1 = { type: 'object', properties: { a: { type: 'string' } } };
    expect(computeSchemaHash(s1)).toBe(computeSchemaHash(s1));
    expect(computeSchemaHash(s1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds + validates an OpenAPI 3.1 document (documented routes only)', () => {
    const doc = buildOpenApiDocument({
      routes: [
        { method: 'POST', path: '/api/v1/tests', module: 'assessment', documented: true, auth_level: 'user', contract_name: 'CreateTest' },
        { method: 'GET', path: '/api/v1/hidden', module: 'assessment', documented: false, auth_level: 'admin' },
      ],
      contracts: [
        { contract_name: 'CreateTest', status: 'published', spec: { type: 'object', properties: {} } },
      ],
    });
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/api/v1/tests'].post).toBeTruthy();
    expect(doc.paths['/api/v1/hidden']).toBeUndefined(); // undocumented → not in doc
    expect(doc.components.schemas.CreateTest).toBeTruthy();
    expect(assertOpenApiDocument(doc).ok).toBe(true);
  });

  it('openapi validation fail-closed', () => {
    expect(assertOpenApiDocument(null).ok).toBe(false);
    expect(assertOpenApiDocument({ openapi: '3.0.0', info: { title: 'x' }, paths: {} }).ok).toBe(false);
  });
});

describe('api-contracts — route inventory (stop condition §24)', () => {
  it('route key is deterministic', () => {
    expect(buildRouteKey({ method: 'post', path: '/api/v1/tests' })).toBe('POST v1/api/v1/tests');
  });

  it('valid route entry passes', () => {
    expect(assertRouteEntry({ method: 'GET', path: '/api/v1/tests', authLevel: 'user', documented: true }).ok).toBe(true);
    expect(assertRouteEntry({ method: 'POST', path: '/api/v1/tests', authLevel: 'public' }).ok).toBe(true);
  });

  it('privileged endpoint MUST be documented (§24)', () => {
    const r = assertRouteEntry({ method: 'POST', path: '/api/v1/admin/super', authLevel: 'admin', documented: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/documented/);
  });

  it('invalid method/path rejected', () => {
    expect(assertRouteEntry({ method: 'FOO', path: '/x', authLevel: 'public' }).ok).toBe(false);
    expect(assertRouteEntry({ method: 'GET', path: 'no-slash', authLevel: 'public' }).ok).toBe(false);
  });
});

describe('api-contracts — cursor / idempotency / ETag conventions', () => {
  it('cursor round-trip', () => {
    const c = encodeCursor({ kind: 'id', key: 'id', value: 42 });
    expect(c).toBeTruthy();
    const d = decodeCursor(c);
    expect(d.ok).toBe(true);
    expect(d.value).toBe('42');
    expect(d.kind).toBe('id');
  });

  it('cursor reuse guard — kind/key mismatch rejected', () => {
    const c = encodeCursor({ kind: 'id', key: 'id', value: 42 });
    expect(assertCursor({ cursor: c, kind: 'id', key: 'id' }).ok).toBe(true);
    expect(assertCursor({ cursor: c, kind: 'date', key: 'created_at' }).ok).toBe(false);
  });

  it('malformed cursor rejected', () => {
    expect(decodeCursor('garbage').ok).toBe(false);
    expect(assertCursor({ cursor: '', kind: 'id', key: 'id' }).ok).toBe(false);
  });

  it('idempotency key format', () => {
    const k = buildIdempotencyKey({ tenantId: 1, operation: 'create-test', payload: { name: 'x' } });
    expect(k.startsWith('edikit:1:create-test:')).toBe(true);
    expect(assertIdempotencyHeader(k).ok).toBe(true);
    expect(assertIdempotencyHeader('').ok).toBe(false);
    expect(assertIdempotencyHeader('foo').ok).toBe(false);
  });

  it('ETag + If-Match / If-None-Match', () => {
    const etag = buildEtag({ name: 'x' });
    expect(etag).toMatch(/^"sha256-[0-9a-f]{32}"$/);
    expect(matchEtag({ currentEtag: etag, ifMatch: etag }).ok).toBe(true);
    const stale = matchEtag({ currentEtag: etag, ifMatch: '"sha256-other"' });
    expect(stale.ok).toBe(false);
    expect(stale.status).toBe(412);
    const notModified = matchEtag({ currentEtag: etag, ifNoneMatch: etag });
    expect(notModified.ok).toBe(false);
    expect(notModified.status).toBe(304);
  });
});

describe('api-contracts — socket event allowlist (§11)', () => {
  it('allowlisted events pass with version', () => {
    expect(assertSocketEventAllowed({ event: 'player:answer', version: 'v1' }).ok).toBe(true);
    expect(assertSocketEventAllowed({ event: 'host:create', version: 'v1' }).ok).toBe(true);
    expect(SOCKET_EVENT_CONTRACTS['player:answer'].rateLimitGroup).toBe('answer');
  });

  it('unallowlisted / unversioned event rejected (fail-closed)', () => {
    const r = assertSocketEventAllowed({ event: 'admin:deleteAll', version: 'v1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/allowlist/);
    expect(assertSocketEventAllowed({ event: 'player:answer', version: 'v2' }).ok).toBe(false);
    expect(assertSocketEventAllowed({ event: '' }).ok).toBe(false);
  });
});

describe('api-contracts — job contract & trace (§12)', () => {
  it('contracted job types pass', () => {
    expect(assertJobContract({ jobType: 'scoring', version: 'v1' }).ok).toBe(true);
    expect(assertJobContract({ jobType: 'gradeRelease', version: 'v1' }).ok).toBe(true);
  });

  it('uncontracted job type rejected', () => {
    expect(assertJobContract({ jobType: 'hackJob', version: 'v1' }).ok).toBe(false);
    expect(assertJobContract({ jobType: 'scoring', version: 'v2' }).ok).toBe(false);
  });

  it('job trace build + validate', () => {
    const t = buildJobTrace({ tenantId: 1, jobType: 'scoring' });
    expect(assertJobTrace(t).ok).toBe(true);
    expect(assertJobTrace('').ok).toBe(false);
    expect(assertJobTrace('short').ok).toBe(false);
  });
});

describe('api-contracts — webhook raw-signature / replay / dedup / out-of-order (§13)', () => {
  it('raw-signature verify (HMAC-SHA256, timing-safe)', () => {
    const secret = 'wh-secret-123';
    const raw = '{"event":"grade.released"}';
    const sig = require('crypto').createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyWebhookRawSignature({ secret, rawBody: raw, signature: sig }).ok).toBe(true);
    expect(verifyWebhookRawSignature({ secret, rawBody: raw, signature: 'deadbeef' }).ok).toBe(false);
    expect(verifyWebhookRawSignature({ secret, rawBody: raw, signature: '' }).ok).toBe(false);
  });

  it('replay guard — timestamp tolerance', () => {
    const now = 1_000_000;
    expect(assertWebhookReplay({ eventTime: now, now }).ok).toBe(true);
    expect(assertWebhookReplay({ eventTime: now - 60_000, now, toleranceMs: 5 * 60_000 }).ok).toBe(true);
    expect(assertWebhookReplay({ eventTime: now - 10 * 60_000, now, toleranceMs: 5 * 60_000 }).ok).toBe(false);
    expect(assertWebhookReplay({ eventTime: 0, now }).ok).toBe(false);
  });

  it('dedup — event_id UNIQUE (replay rejected)', () => {
    expect(assertWebhookDedup({ eventId: 'evt-1', existing: false }).ok).toBe(true);
    const dup = assertWebhookDedup({ eventId: 'evt-1', existing: true });
    expect(dup.ok).toBe(false);
    expect(dup.duplicate).toBe(true);
  });

  it('out-of-order — old seq → out_of_order status', () => {
    expect(processWebhookOutOfOrder({ seq: 5, lastSeen: 3 }).status).toBe(WEBHOOK_STATUS.RECEIVED);
    expect(processWebhookOutOfOrder({ seq: 2, lastSeen: 3 }).status).toBe(WEBHOOK_STATUS.OUT_OF_ORDER);
    expect(processWebhookOutOfOrder({ seq: null, lastSeen: 0 }).status).toBe(WEBHOOK_STATUS.RECEIVED);
  });
});

describe('api-contracts — outbox FSM + consumer idempotency (§14)', () => {
  it('valid transitions', () => {
    expect(assertOutboxTransition({ from: 'pending', to: 'processing' }).ok).toBe(true);
    expect(assertOutboxTransition({ from: 'processing', to: 'delivered' }).ok).toBe(true);
    expect(assertOutboxTransition({ from: 'failed', to: 'dead_letter' }).ok).toBe(true);
    expect(assertOutboxTransition({ from: 'delivered', to: 'processing' }).ok).toBe(false);
  });

  it('consumer idempotency — delivered → skip', () => {
    expect(assertConsumerIdempotency({ status: 'pending', consumerKey: 'k' }).ok).toBe(true);
    const dup = assertConsumerIdempotency({ status: OUTBOX_STATUS.DELIVERED, consumerKey: 'k' });
    expect(dup.ok).toBe(false);
    expect(dup.duplicate).toBe(true);
    expect(assertConsumerIdempotency({ status: 'pending', consumerKey: '' }).ok).toBe(false);
  });

  it('consumer key deterministic per payload', () => {
    const k1 = buildConsumerKey({ tenantId: 1, outboxType: 'scoring', payload: { attemptId: 5 } });
    const k2 = buildConsumerKey({ tenantId: 1, outboxType: 'scoring', payload: { attemptId: 5 } });
    const k3 = buildConsumerKey({ tenantId: 1, outboxType: 'scoring', payload: { attemptId: 6 } });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('retry guard + exponential backoff', () => {
    const now = 1_000_000;
    expect(assertRetryAllowed({ attempts: 0, maxAttempts: 5, now }).ok).toBe(true);
    const exhausted = assertRetryAllowed({ attempts: 5, maxAttempts: 5, now });
    expect(exhausted.deadLetter).toBe(true);
    expect(computeBackoff({ attempt: 0, baseMs: 500 })).toBe(500);
    expect(computeBackoff({ attempt: 2, baseMs: 500 })).toBe(2000);
  });
});

describe('api-contracts — sensitive-field guard (§15)', () => {
  it('generic user schema rejects sensitive fields', () => {
    const spec = { type: 'object', properties: { name: { type: 'string' }, privateScore: { type: 'number' } } };
    const r = assertNoSensitiveInGenericSchema({ spec, scope: 'user' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/privatescore/i);
  });

  it('admin scope allowed; clean schema passes', () => {
    const clean = { type: 'object', properties: { name: { type: 'string' } } };
    expect(assertNoSensitiveInGenericSchema({ spec: clean, scope: 'user' }).ok).toBe(true);
    const admin = { type: 'object', properties: { pinfl: { type: 'string' } } };
    expect(assertNoSensitiveInGenericSchema({ spec: admin, scope: 'admin' }).ok).toBe(true);
  });

  it('enum validator fail-closed', () => {
    expect(assertValidEnum({ value: 'v1', allowed: ['v1'] }).ok).toBe(true);
    expect(assertValidEnum({ value: 'x', allowed: ['v1'] }).ok).toBe(false);
  });
});
