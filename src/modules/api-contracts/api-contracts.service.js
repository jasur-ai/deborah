/**
 * Edikit — API, Socket, Job, Webhook & Outbox Contract Audit (service)
 *
 * Prompt 67 — barcha module boundarylarini versionlangan Zod/OpenAPI/event
 * contractlar bilan birlashtirish (research.md §18, §19).
 *
 * SECURITY / DATA GUARD (Prompt 67 §15-17):
 *   - Undocumented privileged endpoint yoki unversioned event qolmaydi
 *     (stop condition §24 — assertRouteEntry + assertSocketEventAllowed).
 *   - Sensitive case generic API schema'ga qo'shilmaydi (§15).
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited.
 *   - Webhook raw-signature/replay/dedup/out-of-order audited.
 *   - Outbox consumer idempotency (at-least-once → idempotent consumer).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

// ── Outbox/queue telemetry (Prompt 69 §10 — queue depth/age, guarded) ──
import { incrementCounter, observeHistogram } from '../../telemetry/index.js';
import {
  assertValidEnum,
  zodToOpenApiSchema,
  computeSchemaHash,
  buildOpenApiDocument,
  assertOpenApiDocument,
  assertRouteEntry,
  assertSocketEventAllowed,
  assertJobContract,
  buildJobTrace,
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
  CONTRACT_KINDS,
  CONTRACT_STATUS,
  WEBHOOK_STATUS,
  OUTBOX_STATUS,
  SOCKET_AUTH_LEVELS,
} from './api-contracts.schema.js';

function getTenantId() {
  const ctx = getCurrentTenant();
  return ctx?.id ?? ctx?.tenantId ?? null;
}

/** Har service funksiyasida tenant scope fail-closed guard. */
function requireTenant() {
  const tenantId = getTenantId();
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  return { ok: true, tenantId };
}

// ═══════════════════════════════════════════════════════════════════
// ROUTE INVENTORY
// ═══════════════════════════════════════════════════════════════════

/** Register a route in the /api/v1 inventory (idempotent upsert). */
export async function registerRoute({
  method = '', path = '', version = 'v1', authLevel = 'public', module = '',
  idempotent = false, etagSupport = false, cursorPagination = false,
  documented = false, contractName = null, createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const entry = assertRouteEntry({ method, path, authLevel, documented });
  if (!entry.ok) return { ok: false, error: entry.reason };

  const existing = await db.selectFrom('api_route_registry')
    .where('tenant_id', '=', tenantId)
    .where('method', '=', method.toUpperCase())
    .where('path', '=', path)
    .where('version', '=', version)
    .selectAll().executeTakeFirst().catch(() => null);

  if (existing) {
    const row = await db.updateTable('api_route_registry')
      .set({ auth_level: authLevel, module: module || existing.module, idempotent, etag_support: etagSupport, cursor_pagination: cursorPagination, documented, contract_name: contractName || existing.contract_name, updated_at: new Date() })
      .where('tenant_id', '=', tenantId).where('id', '=', existing.id)
      .returning(['id', 'method', 'path', 'version', 'auth_level', 'documented'])
      .executeTakeFirst();
    await audit({ action: AUDIT_ACTIONS.CONTRACT_ROUTE_REGISTER, userId: createdBy, resourceType: 'api_route_registry', resourceId: row?.id, details: { method: row?.method, path: row?.path, documented: row?.documented, updated: true } }).catch(() => {});
    return { ok: true, updated: true, route: row };
  }

  const row = await db.insertInto('api_route_registry')
    .values({
      tenant_id: tenantId, method: method.toUpperCase(), path, version, auth_level: authLevel,
      module, idempotent, etag_support: etagSupport, cursor_pagination: cursorPagination,
      documented, contract_name: contractName, created_by: createdBy,
    })
    .returning(['id', 'method', 'path', 'version', 'auth_level', 'documented'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.CONTRACT_ROUTE_REGISTER, userId: createdBy, resourceType: 'api_route_registry', resourceId: row.id, details: { method: row.method, path: row.path, documented: row.documented } }).catch(() => {});
  return { ok: true, route: row };
}

/** List route inventory (tenant-scoped). */
export async function listRoutes({ authLevel = null, documented = null, module = null, limit = 500 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('api_route_registry').selectAll().where('tenant_id', '=', tenantId);
  if (authLevel) q = q.where('auth_level', '=', authLevel);
  if (documented !== null) q = q.where('documented', '=', !!documented);
  if (module) q = q.where('module', '=', module);
  return q.orderBy('method', 'asc').orderBy('path', 'asc').limit(Math.min(Number(limit) || 500, 2000)).execute();
}

/** Detect undocumented privileged routes (stop condition §24). */
export async function listUndocumentedPrivilegedRoutes() {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  return db.selectFrom('api_route_registry')
    .selectAll().where('tenant_id', '=', tenantId)
    .where('documented', '=', false)
    .where('auth_level', 'in', ['user', 'admin'])
    .limit(100).execute();
}

// ═══════════════════════════════════════════════════════════════════
// CONTRACT REGISTRY (Zod → OpenAPI)
// ═══════════════════════════════════════════════════════════════════

/**
 * Register a versioned contract (request/response/event/job).
 * Zod schema → OpenAPI 3.1 spec; sensitive-field guard (§15).
 */
export async function saveContract({
  contractName = '', kind = 'request', zodSchema = null, version = 'v1',
  scope = 'user', createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  if (!contractName) return { ok: false, error: 'contractName is required' };
  const k = assertValidEnum({ value: kind, allowed: CONTRACT_KINDS, name: 'kind' });
  if (!k.ok) return { ok: false, error: k.reason };

  const converted = zodToOpenApiSchema(zodSchema);
  if (!converted.ok) return { ok: false, error: converted.reason };
  const spec = converted.spec;

  // §15 — sensitive case generic schema'ga qo'shilmaydi.
  const sensitive = assertNoSensitiveInGenericSchema({ spec, scope });
  if (!sensitive.ok) return { ok: false, error: sensitive.reason };

  const schemaHash = computeSchemaHash(spec);

  const existing = await db.selectFrom('api_contracts')
    .where('tenant_id', '=', tenantId).where('contract_name', '=', contractName)
    .where('version', '=', version).selectAll().executeTakeFirst().catch(() => null);
  if (existing) {
    const row = await db.updateTable('api_contracts')
      .set({ kind, spec: JSON.stringify(spec), schema_hash: schemaHash, updated_at: new Date() })
      .where('tenant_id', '=', tenantId).where('id', '=', existing.id)
      .returning(['id', 'contract_name', 'version', 'status'])
      .executeTakeFirst();
    await audit({ action: AUDIT_ACTIONS.CONTRACT_SAVE, userId: createdBy, resourceType: 'api_contracts', resourceId: row?.id, details: { contractName, version, hash: schemaHash, updated: true } }).catch(() => {});
    return { ok: true, updated: true, contract: row, schemaHash };
  }

  const row = await db.insertInto('api_contracts')
    .values({
      tenant_id: tenantId, contract_name: contractName, kind, version,
      spec: JSON.stringify(spec), schema_hash: schemaHash, status: CONTRACT_STATUS.DRAFT, created_by: createdBy,
    })
    .returning(['id', 'contract_name', 'version', 'status'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.CONTRACT_SAVE, userId: createdBy, resourceType: 'api_contracts', resourceId: row.id, details: { contractName, version, hash: schemaHash } }).catch(() => {});
  return { ok: true, contract: row, schemaHash };
}

/** Publish/deprecate a contract (draft → published → deprecated). */
export async function setContractStatus({ contractId = null, status = 'published', changedBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const s = assertValidEnum({ value: status, allowed: Object.values(CONTRACT_STATUS), name: 'status' });
  if (!s.ok) return { ok: false, error: s.reason };

  const row = await db.updateTable('api_contracts')
    .set({ status, published_by: changedBy, published_at: status === CONTRACT_STATUS.PUBLISHED ? new Date() : null })
    .where('tenant_id', '=', tenantId).where('id', '=', Number(contractId) || 0)
    .returning(['id', 'contract_name', 'version', 'status'])
    .executeTakeFirst();
  if (!row) return { ok: false, error: 'contract not found' };
  await audit({ action: AUDIT_ACTIONS.CONTRACT_STATUS, userId: changedBy, resourceType: 'api_contracts', resourceId: row.id, details: { contractName: row.contract_name, status } }).catch(() => {});
  return { ok: true, contract: row };
}

/** List contracts (tenant-scoped). */
export async function listContracts({ kind = null, status = null, limit = 500 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('api_contracts').selectAll().where('tenant_id', '=', tenantId);
  if (kind) q = q.where('kind', '=', kind);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('contract_name', 'asc').orderBy('version', 'asc').limit(Math.min(Number(limit) || 500, 2000)).execute();
}

/** Build + validate the OpenAPI 3.1 document from registry + published contracts. */
export async function getOpenApiDocument() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const routes = await listRoutes({ limit: 2000 });
  const contracts = (await listContracts({ status: CONTRACT_STATUS.PUBLISHED, limit: 2000 }))
    .map((c) => ({
      ...c,
      // spec jsonb sifatida saqlanadi (JSON.stringify) — object qilib qaytaramiz.
      spec: typeof c.spec === 'string' ? JSON.parse(c.spec) : c.spec,
    }));
  const doc = buildOpenApiDocument({ routes, contracts });
  const valid = assertOpenApiDocument(doc);
  if (!valid.ok) return { ok: false, error: valid.reason };
  return { ok: true, doc };
}

// ═══════════════════════════════════════════════════════════════════
// SOCKET EVENT CONTRACT REGISTRY
// ═══════════════════════════════════════════════════════════════════

/** Register a socket event contract (allowlist entry, fail-closed §11). */
export async function registerSocketEvent({
  eventName = '', version = 'v1', auth = 'public', rateLimitGroup = 'default',
  zodSchema = null, documented = false, createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const allowed = assertSocketEventAllowed({ event: eventName, version });
  if (!allowed.ok) return { ok: false, error: allowed.reason };
  const a = assertValidEnum({ value: auth, allowed: SOCKET_AUTH_LEVELS, name: 'auth' });
  if (!a.ok) return { ok: false, error: a.reason };

  const converted = zodToOpenApiSchema(zodSchema);
  if (!converted.ok) return { ok: false, error: converted.reason };
  const spec = converted.spec;
  const schemaHash = computeSchemaHash(spec);

  const existing = await db.selectFrom('socket_event_contracts')
    .where('tenant_id', '=', tenantId).where('event_name', '=', eventName)
    .where('version', '=', version).selectAll().executeTakeFirst().catch(() => null);
  if (existing) {
    const row = await db.updateTable('socket_event_contracts')
      .set({ auth, rate_limit_group: rateLimitGroup, spec: JSON.stringify(spec), schema_hash: schemaHash, documented, updated_at: new Date() })
      .where('tenant_id', '=', tenantId).where('id', '=', existing.id)
      .returning(['id', 'event_name', 'version', 'auth', 'documented'])
      .executeTakeFirst();
    return { ok: true, updated: true, event: row };
  }

  const row = await db.insertInto('socket_event_contracts')
    .values({
      tenant_id: tenantId, event_name: eventName, version, auth, rate_limit_group: rateLimitGroup,
      spec: JSON.stringify(spec), schema_hash: schemaHash, documented, created_by: createdBy,
    })
    .returning(['id', 'event_name', 'version', 'auth', 'documented'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.CONTRACT_SOCKET_EVENT, userId: createdBy, resourceType: 'socket_event_contracts', resourceId: row.id, details: { eventName, version, auth } }).catch(() => {});
  return { ok: true, event: row };
}

/** List socket event contracts (tenant-scoped). */
export async function listSocketEvents({ limit = 500 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  return db.selectFrom('socket_event_contracts').selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('event_name', 'asc').limit(Math.min(Number(limit) || 500, 2000)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// WEBHOOK EVENT LEDGER (raw-signature / replay / dedup / out-of-order)
// ═══════════════════════════════════════════════════════════════════

/**
 * Record a webhook delivery — signature verify + replay tolerance +
 * event_id dedup + out-of-order seq. Fail-closed.
 * @param {{ provider?: string, eventId?: string, eventType?: string, version?: string, secret?: string, rawBody?: string, signature?: string, eventTime?: number, seq?: number, lastSeenSeq?: number, createdBy?: string }} params
 */
export async function recordWebhook({
  provider = '', eventId = '', eventType = '', version = 'v1', secret = '',
  rawBody = '', signature = '', eventTime = 0, seq = null, lastSeenSeq = 0, createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  if (!provider) return { ok: false, error: 'provider is required' };

  // Raw-signature (timing-safe HMAC) — fail-closed.
  const sig = verifyWebhookRawSignature({ secret, rawBody, signature });
  if (!sig.ok) return { ok: false, error: sig.reason, signatureFailed: true };

  // Replay guard — timestamp tolerance.
  const replay = assertWebhookReplay({ eventTime });
  if (!replay.ok) return { ok: false, error: replay.reason, replayFailed: true };

  // Dedup guard — provider event_id UNIQUE.
  const existing = await db.selectFrom('webhook_events')
    .where('tenant_id', '=', tenantId).where('provider', '=', provider)
    .where('event_id', '=', eventId).selectAll().executeTakeFirst().catch(() => null);
  const dedup = assertWebhookDedup({ eventId, existing: !!existing });
  if (!dedup.ok) return { ok: false, error: dedup.reason, duplicate: true, existing };

  // Out-of-order detection.
  const ooo = processWebhookOutOfOrder({ seq, lastSeen: lastSeenSeq });
  const status = ooo.status;

  // Insert — race condition: ikkita so'rov bir vaqtda event_id yuborsa
  // UNIQUE (tenant_id, provider, event_id) violation bo'lishi mumkin. O'sha
  // holatda mavjud qatorni qayta o'qib, idempotent duplicate javob qaytaramiz.
  try {
    const row = await db.insertInto('webhook_events')
      .values({
        tenant_id: tenantId, provider, event_id: eventId, event_type: eventType, version,
        signature_ok: true, received_at: new Date(), seq: seq ?? null, status,
        processed_at: status === WEBHOOK_STATUS.OUT_OF_ORDER ? null : new Date(),
      })
      .returning(['id', 'event_id', 'event_type', 'status'])
      .executeTakeFirst();

    await audit({ action: AUDIT_ACTIONS.WEBHOOK_RECORD, userId: createdBy, resourceType: 'webhook_events', resourceId: row.id, details: { provider, eventType, status } }).catch(() => {});
    return { ok: true, webhook: row, status, outOfOrder: !!ooo.outOfOrder };
  } catch (e) {
    const isUniqueViolation =
      (e && (e.code === '23505' || /unique/i.test(e.message || ''))) || false;
    if (!isUniqueViolation) throw e;
    const existing = await db.selectFrom('webhook_events')
      .where('tenant_id', '=', tenantId).where('provider', '=', provider)
      .where('event_id', '=', eventId).selectAll().executeTakeFirst().catch(() => null);
    return { ok: true, duplicate: true, webhook: existing, status: existing?.status || WEBHOOK_STATUS.RECEIVED };
  }
}

/** List webhook events (tenant-scoped). */
export async function listWebhookEvents({ provider = null, status = null, limit = 200 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('webhook_events').selectAll().where('tenant_id', '=', tenantId);
  if (provider) q = q.where('provider', '=', provider);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('id', 'desc').limit(Math.min(Number(limit) || 200, 1000)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTIONAL OUTBOX + CONSUMER IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

/** Enqueue an outbox message (consumer_key UNIQUE → idempotent). */
export async function enqueueOutbox({
  outboxType = '', payload = null, version = 'v1', jobType = null,
  traceRequired = false, createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  if (!outboxType || payload === null || payload === undefined) {
    return { ok: false, error: 'outboxType and payload are required' };
  }

  // Job contract guard (§12) — jobType berilgan bo'lsa tekshiriladi.
  if (jobType) {
    const job = assertJobContract({ jobType, version });
    if (!job.ok) return { ok: false, error: job.reason };
  }

  const consumerKey = buildConsumerKey({ tenantId, outboxType, payload });
  const traceId = traceRequired ? buildJobTrace({ tenantId, jobType: outboxType }) : null;

  // ── Queue telemetry: enqueue count + payload size (guarded) ──
  try {
    incrementCounter('edikit_outbox_enqueued_total', { help: 'Outbox messages enqueued' }, { value: 1, labels: { outboxType } });
    observeHistogram('edikit_outbox_payload_size_bytes', JSON.stringify(payload).length, { help: 'Outbox payload size', labels: { outboxType } });
  } catch (_) {}

  const existing = await db.selectFrom('outbox_messages')
    .where('tenant_id', '=', tenantId).where('consumer_key', '=', consumerKey)
    .selectAll().executeTakeFirst().catch(() => null);
  if (existing) {
    return { ok: true, idempotent: true, message: existing };
  }

  const row = await db.insertInto('outbox_messages')
    .values({
      tenant_id: tenantId, outbox_type: outboxType, payload: JSON.stringify(payload),
      version, status: OUTBOX_STATUS.PENDING, consumer_key: consumerKey,
      attempts: 0, max_attempts: 5, trace_id: traceId, created_by: createdBy,
    })
    .returning(['id', 'outbox_type', 'status', 'consumer_key'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.OUTBOX_ENQUEUE, userId: createdBy, resourceType: 'outbox_messages', resourceId: row.id, details: { outboxType, version, traceId } }).catch(() => {});
  return { ok: true, message: row };
}

/**
 * Process an outbox message (consumer idempotency): already delivered →
 * skip; pending → processing → delivered/failed; retry with backoff;
 * exhausted → dead_letter.
 */
export async function processOutboxMessage({ messageId = null, deliver = null, processedBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const msg = await db.selectFrom('outbox_messages')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(messageId) || 0)
    .selectAll().executeTakeFirst();
  if (!msg) return { ok: false, error: 'outbox message not found' };

  // Consumer idempotency — delivered bo'lsa qayta ishlamaydi.
  const idem = assertConsumerIdempotency({ status: msg.status, consumerKey: msg.consumer_key });
  if (!idem.ok) return { ok: true, duplicate: true, message: msg };

  // FSM: pending|failed|dead_letter → processing
  const fsm = assertOutboxTransition({ from: msg.status, to: OUTBOX_STATUS.PROCESSING });
  if (!fsm.ok) return { ok: false, error: fsm.reason };

  await db.updateTable('outbox_messages').set({ status: OUTBOX_STATUS.PROCESSING, attempts: msg.attempts + 1, updated_at: new Date() })
    .where('tenant_id', '=', tenantId).where('id', '=', msg.id).execute();

  let deliveryOk = true;
  let deliveryError = '';
  if (typeof deliver === 'function') {
    try {
      const r = await deliver({ payload: typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload, message: msg });
      deliveryOk = r?.ok !== false;
      deliveryError = r?.error || '';
    } catch (e) {
      deliveryOk = false;
      deliveryError = e.message || 'delivery error';
    }
  }

  if (deliveryOk) {
    await db.updateTable('outbox_messages')
      .set({ status: OUTBOX_STATUS.DELIVERED, processed_at: new Date(), last_error: null, updated_at: new Date() })
      .where('tenant_id', '=', tenantId).where('id', '=', msg.id).execute();
    await audit({ action: AUDIT_ACTIONS.OUTBOX_DELIVERED, userId: processedBy, resourceType: 'outbox_messages', resourceId: msg.id, details: { outboxType: msg.outbox_type, attempts: msg.attempts + 1 } }).catch(() => {});
    // ── Queue telemetry: processed + latency (guarded) ──
    try {
      incrementCounter('edikit_outbox_processed_total', { help: 'Outbox messages processed' }, { value: 1, labels: { outboxType: msg.outbox_type, status: 'delivered' } });
      observeHistogram('edikit_outbox_process_latency_ms', Date.now() - (new Date(msg.created_at || Date.now())).getTime(), { help: 'Outbox processing latency' });
    } catch (_) {}
    return { ok: true, status: OUTBOX_STATUS.DELIVERED };
  }

  // Failed — retry guard (backoff) yoki dead-letter.
  const retry = assertRetryAllowed({ attempts: msg.attempts + 1, maxAttempts: msg.max_attempts });
  if (!retry.ok && retry.deadLetter) {
    await db.updateTable('outbox_messages')
      .set({ status: OUTBOX_STATUS.DEAD_LETTER, last_error: deliveryError, updated_at: new Date() })
      .where('tenant_id', '=', tenantId).where('id', '=', msg.id).execute();
    await audit({ action: AUDIT_ACTIONS.OUTBOX_DEAD_LETTER, userId: processedBy, resourceType: 'outbox_messages', resourceId: msg.id, details: { outboxType: msg.outbox_type, error: deliveryError } }).catch(() => {});
    return { ok: false, deadLettered: true, error: deliveryError };
  }

  const nextRetryAt = new Date(Date.now() + computeBackoff({ attempt: msg.attempts })).toISOString();
  await db.updateTable('outbox_messages')
    .set({ status: OUTBOX_STATUS.FAILED, last_error: deliveryError, next_retry_at: nextRetryAt, updated_at: new Date() })
    .where('tenant_id', '=', tenantId).where('id', '=', msg.id).execute();
  await audit({ action: AUDIT_ACTIONS.OUTBOX_FAILED, userId: processedBy, resourceType: 'outbox_messages', resourceId: msg.id, details: { outboxType: msg.outbox_type, error: deliveryError } }).catch(() => {});
  return { ok: false, error: deliveryError, retryAt: nextRetryAt };
}

/** List outbox messages (tenant-scoped, optional status filter). */
export async function listOutbox({ status = null, limit = 200 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('outbox_messages').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('id', 'desc').limit(Math.min(Number(limit) || 200, 1000)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════

/** Dashboard summary for the admin view. */
export async function getContractSummary() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const routes = await listRoutes({ limit: 2000 });
  const contracts = await listContracts({ limit: 2000 });
  const socketEvents = await listSocketEvents({ limit: 2000 });
  const webhooks = await listWebhookEvents({ limit: 1000 });
  const outbox = await listOutbox({ limit: 1000 });
  const undocumented = await listUndocumentedPrivilegedRoutes();

  return {
    ok: true,
    routes: routes.length,
    routesByAuth: routes.reduce((acc, r) => { acc[r.auth_level] = (acc[r.auth_level] || 0) + 1; return acc; }, {}),
    undocumentedPrivileged: undocumented.length,
    contracts: contracts.length,
    contractsPublished: contracts.filter((c) => c.status === CONTRACT_STATUS.PUBLISHED).length,
    socketEvents: socketEvents.length,
    socketEventsDocumented: socketEvents.filter((s) => s.documented).length,
    webhooks: webhooks.length,
    webhooksRejected: webhooks.filter((w) => w.status === WEBHOOK_STATUS.REJECTED).length,
    outboxPending: outbox.filter((m) => m.status === OUTBOX_STATUS.PENDING).length,
    outboxDelivered: outbox.filter((m) => m.status === OUTBOX_STATUS.DELIVERED).length,
    outboxFailed: outbox.filter((m) => m.status === OUTBOX_STATUS.FAILED).length,
    outboxDeadLetter: outbox.filter((m) => m.status === OUTBOX_STATUS.DEAD_LETTER).length,
  };
}
