/**
 * Edikit — Official HEMIS & OneID Adapter Boundary (service)
 *
 * Prompt 66 — rasmiy contract mavjud bo'lganda roster/grade va identity
 * integration'ni xavfsiz ulash (research.md §12, §19, §27, §30).
 *
 * SECURITY / DATA GUARD (Prompt 66 §15-17):
 *   - Scraping, undocumented endpoint va token reuse taqiqlanadi
 *     (schema: assertDocumentedEndpoint, assertNoTokenReuse).
 *   - Ratified-only grade push (§15 — ratifikatsiyasiz push yo'q).
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited
 *     (idempotency key = tenant+direction+entity+payload hash).
 *   - Privileged actionlar (connection, push, reconcile, token vault,
 *     OneID link) audit event bilan.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  assertValidEnum,
  assertAdapterContract,
  assertAdapterMode,
  assertValidFieldMap,
  assertHemispullTransition,
  buildIdempotencyKey,
  computePayloadHash,
  assertRetryAllowed,
  computeBackoff,
  buildDeadLetterEntry,
  assertRatifiedOnlyPush,
  computeReconciliationDiff,
  assertOneidAccountLink,
  classifyOneidMismatch,
  assertIdentityStatusTransition,
  buildTokenEnvelope,
  decryptTokenEnvelope,
  assertTokenVaultState,
  assertNoTokenReuse,
  assertDocumentedEndpoint,
  SYNC_JOB_STATUS,
  SYNC_DIRECTIONS,
  SYNC_ENTITIES,
  ADAPTER_MODES,
  IDENTITY_STATUS,
  TOKEN_TYPES,
  HEMIS_FIELD_MAP,
  ONEID_FIELD_MAP,
} from './external-integration.schema.js';
import {
  isLiveMode,
  hemisPullRoster,
  hemisPushGrades,
  hemisHealth,
  oneidVerifyIdentity,
} from './external-integration.client.js';

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
// CONNECTION REGISTRY
// ═══════════════════════════════════════════════════════════════════

/** Register/upsert an external connection (idempotent by tenant+provider). */
export async function registerConnection({
  provider = '', mode = ADAPTER_MODES.SANDBOX, baseUrl = '', clientId = '',
  scopes = '', rateLimitRps = 5, contractVersion = '0', createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const kind = assertValidEnum({ value: provider, allowed: ['hemis', 'oneid'], name: 'provider' });
  if (!kind.ok) return { ok: false, error: kind.reason };
  const modeGuard = assertAdapterMode({ mode, allowLive: isLiveMode() });
  if (!modeGuard.ok) return { ok: false, error: modeGuard.reason };
  if (mode === ADAPTER_MODES.LIVE && !baseUrl) return { ok: false, error: 'baseUrl is required in live mode' };

  const existing = await db.selectFrom('external_connections')
    .where('tenant_id', '=', tenantId).where('provider', '=', provider)
    .selectAll().executeTakeFirst();

  if (existing) {
    const row = await db.updateTable('external_connections')
      .set({
        mode, base_url: baseUrl || existing.base_url, client_id: clientId || existing.client_id,
        scopes: scopes || existing.scopes, rate_limit_rps: rateLimitRps || existing.rate_limit_rps,
        contract_version: contractVersion || existing.contract_version,
        status: 'configured', updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId).where('provider', '=', provider)
      .returning(['id', 'provider', 'mode', 'status'])
      .executeTakeFirst();
    await audit({ action: AUDIT_ACTIONS.EXT_CONNECTION_REGISTER, userId: createdBy, resourceType: 'external_connections', resourceId: row?.id, details: { provider, mode, updated: true } }).catch(() => {});
    return { ok: true, updated: true, connection: row };
  }

  const row = await db.insertInto('external_connections')
    .values({
      tenant_id: tenantId, provider, mode, base_url: baseUrl || null, client_id: clientId || null,
      scopes: scopes || null, rate_limit_rps: rateLimitRps, contract_version: contractVersion,
      status: 'configured', created_by: createdBy,
    })
    .returning(['id', 'provider', 'mode', 'status'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.EXT_CONNECTION_REGISTER, userId: createdBy, resourceType: 'external_connections', resourceId: row.id, details: { provider, mode } }).catch(() => {});
  return { ok: true, connection: row };
}

/** List external connections (tenant-scoped). */
export async function listConnections({ provider = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('external_connections').selectAll().where('tenant_id', '=', tenantId);
  if (provider) q = q.where('provider', '=', provider);
  return q.orderBy('provider', 'asc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

/** Adapter status — connection + live/sandbox mode + health. */
export async function getAdapterStatus({ provider = 'hemis' } = {}) {
  const db = getDb();
  const t = requireTenant();
  const tenantId = t.ok ? t.tenantId : null;
  let conn = null;
  if (db && tenantId) {
    conn = await db.selectFrom('external_connections')
      .where('tenant_id', '=', tenantId).where('provider', '=', provider)
      .selectAll().executeTakeFirst().catch(() => null);
  }
  const live = isLiveMode();
  const health = provider === 'hemis' ? await hemisHealth().catch(() => ({ ok: false, healthy: false })) : null;
  return {
    provider,
    mode: live ? ADAPTER_MODES.LIVE : ADAPTER_MODES.SANDBOX,
    configured: !!conn,
    status: conn?.status || 'not_configured',
    baseUrl: conn?.base_url || null,
    rateLimitRps: conn?.rate_limit_rps || 5,
    liveMode: live,
    health: health ? { healthy: health.healthy, mode: health.mode } : null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// FIELD MAPS
// ═══════════════════════════════════════════════════════════════════

/** Save source-of-truth field mapping rows (idempotent upsert). */
export async function saveFieldMap({ provider = 'hemis', entity = 'roster', map = null, createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const ref = provider === 'oneid' ? ONEID_FIELD_MAP : HEMIS_FIELD_MAP;
  const valid = assertValidFieldMap({ kind: provider === 'oneid' ? 'oneid' : 'hemis', map });
  if (!valid.ok) return { ok: false, error: valid.reason };

  let count = 0;
  for (const [sourceField, { canonical, required }] of Object.entries(map)) {
    const existing = await db.selectFrom('external_field_maps')
      .where('tenant_id', '=', tenantId).where('provider', '=', provider)
      .where('entity', '=', entity).where('source_field', '=', sourceField)
      .where('target_field', '=', canonical).selectAll().executeTakeFirst();
    if (existing) {
      await db.updateTable('external_field_maps').set({ required, transform: ref[sourceField]?.transform || null })
        .where('id', '=', existing.id).execute();
    } else {
      await db.insertInto('external_field_maps').values({
        tenant_id: tenantId, provider, entity, source_field: sourceField,
        target_field: canonical, direction: 'both', required: !!required,
        transform: ref[sourceField]?.transform || null, created_by: createdBy,
      }).execute();
    }
    count++;
  }
  return { ok: true, saved: count };
}

/** List field maps (tenant-scoped). */
export async function listFieldMaps({ provider = null, entity = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('external_field_maps').selectAll().where('tenant_id', '=', tenantId);
  if (provider) q = q.where('provider', '=', provider);
  if (entity) q = q.where('entity', '=', entity);
  return q.orderBy('source_field', 'asc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// HEMIS PULL → STAGING → DIFF
// ═══════════════════════════════════════════════════════════════════

/**
 * HEMIS pull → staging → diff flow. Idempotent: bitta tenant+direction+
 * entity+payload-hash faqat bitta job yaratadi (UNIQUE idempotency_key).
 */
export async function hemisPullToStaging({ connectionId = null, provider = 'hemis', tenantIdParam = null, createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = tenantIdParam || t.tenantId;

  const conn = await db.selectFrom('external_connections')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', Number(connectionId) || 0)
    .selectAll().executeTakeFirst().catch(() => null);
  if (!conn) return { ok: false, error: 'connection not found' };

  const pull = await hemisPullRoster({ baseUrl: conn.base_url || '', tenantId });
  if (!pull.ok) return { ok: false, error: pull.error };

  const payloadHash = computePayloadHash({ source: 'hemis', rows: pull.rows });
  const idemKey = buildIdempotencyKey({ tenantId, direction: SYNC_DIRECTIONS.PULL, entity: SYNC_ENTITIES.ROSTER, payloadHash });

  // Idempotency: existing job with same key → return it (no duplicate job).
  const existingJob = await db.selectFrom('external_sync_jobs')
    .where('tenant_id', '=', tenantId).where('idempotency_key', '=', idemKey)
    .selectAll().executeTakeFirst().catch(() => null);
  if (existingJob) {
    return { ok: true, idempotent: true, job: existingJob, rows: pull.rows };
  }

  const job = await db.insertInto('external_sync_jobs')
    .values({
      tenant_id: tenantId, connection_id: conn.id, direction: SYNC_DIRECTIONS.PULL,
      entity: SYNC_ENTITIES.ROSTER, status: SYNC_JOB_STATUS.SUCCESS, idempotency_key: idemKey,
      attempts: 1, max_attempts: 5, payload_hash: payloadHash, external_ref: `HEM-PULL-${Date.now()}`,
      created_by: createdBy, completed_at: new Date(),
    })
    .returning(['id', 'status', 'idempotency_key'])
    .executeTakeFirst();

  await audit({ action: AUDIT_ACTIONS.EXT_HEMIS_PULL, userId: createdBy, resourceType: 'external_sync_jobs', resourceId: job.id, details: { rows: pull.rows.length, source: 'hemis' } }).catch(() => {});
  return { ok: true, job, rows: pull.rows, mode: pull.mode };
}

// ═══════════════════════════════════════════════════════════════════
// RATIFIED-ONLY GRADE PUSH (§15)
// ═══════════════════════════════════════════════════════════════════

/**
 * Push ratified grades to HEMIS. Ratified-only (§15): har grade uchun
 * decision 'ratified' bo'lishi shart — provisional/rejected push qilinmaydi.
 * Idempotent: grade'ning canonical hash'i bilan bitta job.
 */
export async function pushRatifiedGrades({ connectionId = null, grades = [], decision = '', tenantIdParam = null, createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = tenantIdParam || t.tenantId;

  const conn = await db.selectFrom('external_connections')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(connectionId) || 0)
    .selectAll().executeTakeFirst().catch(() => null);
  if (!conn) return { ok: false, error: 'connection not found' };

  if (!Array.isArray(grades) || grades.length === 0) return { ok: false, error: 'grades are required' };

  // §15 — ratified-only push
  const ratified = assertRatifiedOnlyPush({ decision });
  if (!ratified.ok) return { ok: false, error: ratified.reason };

  const payloadHash = computePayloadHash({ decision, grades });
  const idemKey = buildIdempotencyKey({ tenantId, direction: SYNC_DIRECTIONS.PUSH, entity: SYNC_ENTITIES.GRADE, payloadHash });

  const existingJob = await db.selectFrom('external_sync_jobs')
    .where('tenant_id', '=', tenantId).where('idempotency_key', '=', idemKey)
    .selectAll().executeTakeFirst().catch(() => null);
  if (existingJob) return { ok: true, idempotent: true, job: existingJob };

  const push = await hemisPushGrades({ baseUrl: conn.base_url || '', grades, decision, tenantId });
  if (!push.ok) {
    // Failed — audit + job failed (retryable via retrySyncJob).
    const job = await db.insertInto('external_sync_jobs')
      .values({
        tenant_id: tenantId, connection_id: conn.id, direction: SYNC_DIRECTIONS.PUSH,
        entity: SYNC_ENTITIES.GRADE, status: SYNC_JOB_STATUS.FAILED, idempotency_key: idemKey,
        attempts: 1, max_attempts: 5, payload_hash: payloadHash, last_error: push.error,
        created_by: createdBy,
      })
      .returning(['id', 'status']).executeTakeFirst();
    await audit({ action: AUDIT_ACTIONS.EXT_GRADE_PUSH, userId: createdBy, resourceType: 'external_sync_jobs', resourceId: job.id, details: { ok: false, error: push.error } }).catch(() => {});
    return { ok: false, error: push.error, job };
  }

  const job = await db.insertInto('external_sync_jobs')
    .values({
      tenant_id: tenantId, connection_id: conn.id, direction: SYNC_DIRECTIONS.PUSH,
      entity: SYNC_ENTITIES.GRADE, status: SYNC_JOB_STATUS.SUCCESS, idempotency_key: idemKey,
      attempts: 1, max_attempts: 5, payload_hash: payloadHash,
      external_ref: (push.externalRefs || []).join(','), created_by: createdBy, completed_at: new Date(),
    })
    .returning(['id', 'status', 'external_ref'])
    .executeTakeFirst();

  await audit({ action: AUDIT_ACTIONS.EXT_GRADE_PUSH, userId: createdBy, resourceType: 'external_sync_jobs', resourceId: job.id, details: { ok: true, grades: grades.length, decision } }).catch(() => {});
  return { ok: true, job, externalRefs: push.externalRefs || [] };
}

// ═══════════════════════════════════════════════════════════════════
// RETRY / DEAD-LETTER
// ═══════════════════════════════════════════════════════════════════

/** Retry a failed job — backoff + max attempts guard (fail-closed). */
export async function retrySyncJob({ jobId = null, createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const job = await db.selectFrom('external_sync_jobs')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(jobId) || 0)
    .selectAll().executeTakeFirst();
  if (!job) return { ok: false, error: 'job not found' };

  // FSM: failed/dead_letter → running
  const fsm = assertHemispullTransition({ from: job.status, to: SYNC_JOB_STATUS.RUNNING });
  if (!fsm.ok) return { ok: false, error: fsm.reason };

  // Backoff guard
  const retry = assertRetryAllowed({ attempts: job.attempts, maxAttempts: job.max_attempts, nextRetryAt: job.next_retry_at ? Date.parse(job.next_retry_at) : null });
  if (!retry.ok) {
    if (retry.deadLetter) {
      const dl = buildDeadLetterEntry({ jobId: job.id, error: job.last_error, attempts: job.attempts });
      await db.updateTable('external_sync_jobs').set({ status: SYNC_JOB_STATUS.DEAD_LETTER, last_error: dl.error })
        .where('id', '=', job.id).execute();
      await audit({ action: AUDIT_ACTIONS.EXT_JOB_DLQ, userId: createdBy, resourceType: 'external_sync_jobs', resourceId: job.id, details: dl }).catch(() => {});
      return { ok: false, deadLettered: true, error: 'max attempts reached — job dead-lettered' };
    }
    return { ok: false, error: retry.reason };
  }

  const nextRetryAt = new Date(Date.now() + computeBackoff({ attempt: job.attempts })).toISOString();
  const row = await db.updateTable('external_sync_jobs')
    .set({ status: SYNC_JOB_STATUS.RUNNING, attempts: job.attempts + 1, next_retry_at: nextRetryAt })
    .where('id', '=', job.id)
    .returning(['id', 'status', 'attempts', 'next_retry_at'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.EXT_JOB_RETRY, userId: createdBy, resourceType: 'external_sync_jobs', resourceId: row.id, details: { attempts: row.attempts } }).catch(() => {});
  return { ok: true, job: row };
}

/** List sync jobs (tenant-scoped, optional status filter). */
export async function listSyncJobs({ direction = null, entity = null, status = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('external_sync_jobs').selectAll().where('tenant_id', '=', tenantId);
  if (direction) q = q.where('direction', '=', direction);
  if (entity) q = q.where('entity', '=', entity);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('id', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// PULL-BACK RECONCILIATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Pull-back reconciliation — external (HEMIS) vs local state diff.
 * @param {{ connectionId?: number, externalRows?: object[], localRows?: object[], keyField?: string, createdBy?: string }} params
 */
export async function runReconciliation({ connectionId = null, externalRows = null, localRows = [], keyField = 'externalId', createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const conn = await db.selectFrom('external_connections')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(connectionId) || 0)
    .selectAll().executeTakeFirst().catch(() => null);
  if (!conn) return { ok: false, error: 'connection not found' };

  // Pull fresh external state (sandbox fixture or live documented endpoint).
  let ext = externalRows;
  if (!ext) {
    const pull = await hemisPullRoster({ baseUrl: conn.base_url || '', tenantId });
    if (!pull.ok) return { ok: false, error: pull.error };
    ext = pull.rows;
  }

  const diff = computeReconciliationDiff({ external: ext, local: localRows, keyField });
  const payloadHash = computePayloadHash({ diff });
  const idemKey = buildIdempotencyKey({ tenantId, direction: SYNC_DIRECTIONS.PULL, entity: SYNC_ENTITIES.ROSTER, payloadHash });

  const existingJob = await db.selectFrom('external_sync_jobs')
    .where('tenant_id', '=', tenantId).where('idempotency_key', '=', idemKey)
    .selectAll().executeTakeFirst().catch(() => null);
  if (existingJob) return { ok: true, idempotent: true, diff, job: existingJob };

  const job = await db.insertInto('external_sync_jobs')
    .values({
      tenant_id: tenantId, connection_id: conn.id, direction: SYNC_DIRECTIONS.PULL,
      entity: SYNC_ENTITIES.ROSTER, status: SYNC_JOB_STATUS.SUCCESS, idempotency_key: idemKey,
      attempts: 1, max_attempts: 5, payload_hash: payloadHash,
      external_ref: `HEM-RECON-${Date.now()}`, created_by: createdBy, completed_at: new Date(),
    })
    .returning(['id', 'status'])
    .executeTakeFirst();

  await audit({ action: AUDIT_ACTIONS.EXT_RECONCILE, userId: createdBy, resourceType: 'external_sync_jobs', resourceId: job.id, details: { added: diff.addedCount, removed: diff.removedCount, changed: diff.changedCount } }).catch(() => {});
  return { ok: true, job, diff };
}

// ═══════════════════════════════════════════════════════════════════
// ONEID IDENTITY ACCOUNT PROVIDER
// ═══════════════════════════════════════════════════════════════════

/**
 * OneID account link — takeover guard (research §30.3): OneID subject
 * (PINFL) lokal identity bilan mos kelmasa → reject. Assurance I2+ talab.
 * @param {{ connectionId?: number, userId?: number, providerSubject?: string, pinfl?: string, createdBy?: string }} params
 */
export async function oneidLinkAccount({
  connectionId = null, userId = null, providerSubject = '', pinfl = '', createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const conn = await db.selectFrom('external_connections')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(connectionId) || 0)
    .selectAll().executeTakeFirst().catch(() => null);
  if (!conn) return { ok: false, error: 'connection not found' };
  if (!userId) return { ok: false, error: 'userId is required for account link' };

  // SOURCE OF TRUTH: foydalanuvchining saqlangan verified PINFL'i — request
  // body'ga hech qachon ishonilmaydi (takeover hujumining oldini olish).
  const userRow = await db.selectFrom('users')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(userId))
    .select(['id', 'pinfl']).executeTakeFirst().catch(() => null);
  const localSubject = userRow?.pinfl || '';
  if (!localSubject) {
    return { ok: false, error: 'user has no verified PINFL — account link blocked (fail-closed)' };
  }

  // OneID subject — hujumchi o'z OneID hisobini bog'lamoqchi bo'lsa,
  // verify'ga o'z subjectini beradi; sandbox'da u qaytariladi.
  const subjectToVerify = providerSubject || pinfl || '';
  if (!subjectToVerify) return { ok: false, error: 'providerSubject or pinfl is required' };

  const verify = await oneidVerifyIdentity({ baseUrl: conn.base_url || '', pinfl: subjectToVerify });
  if (!verify.ok) return { ok: false, error: verify.error };
  if (verify.verified !== true) return { ok: false, error: 'OneID identity verification failed' };

  // Takeover guard — OneID subject foydalanuvchining SAQLANGAN identity
  // bilan solishtiriladi; mos kelmasa → reject (research §30.3).
  const linkGuard = assertOneidAccountLink({
    providerSubject: verify.providerSubject || subjectToVerify,
    localSubject,
    assuranceLevel: verify.assuranceLevel || 'I2',
    minAssurance: 'I2',
  });
  if (!linkGuard.ok) return { ok: false, error: linkGuard.reason };

  const existing = await db.selectFrom('external_identities')
    .where('tenant_id', '=', tenantId).where('user_id', '=', Number(userId))
    .where('provider', '=', 'oneid').selectAll().executeTakeFirst();
  if (existing) {
    const fsm = assertIdentityStatusTransition({ from: existing.status, to: IDENTITY_STATUS.LINKED });
    if (!fsm.ok) return { ok: false, error: fsm.reason };
    const row = await db.updateTable('external_identities')
      .set({ status: IDENTITY_STATUS.LINKED, provider_subject: verify.providerSubject || providerSubject, assurance_level: verify.assuranceLevel || 'I2', linked_by: createdBy, linked_at: new Date() })
      .where('id', '=', existing.id).returning(['id', 'status']).executeTakeFirst();
    return { ok: true, identity: row };
  }

  const row = await db.insertInto('external_identities')
    .values({
      tenant_id: tenantId, user_id: Number(userId), provider: 'oneid',
      provider_subject: verify.providerSubject || providerSubject,
      assurance_level: verify.assuranceLevel || 'I2', status: IDENTITY_STATUS.LINKED,
      linked_by: createdBy, linked_at: new Date(),
    })
    .returning(['id', 'status', 'provider_subject'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.EXT_ONEID_LINK, userId: createdBy, resourceType: 'external_identities', resourceId: row.id, details: { userId, subject: row.provider_subject } }).catch(() => {});
  return { ok: true, identity: row };
}

/** Revoke OneID account link. */
export async function oneidRevokeLink({ linkId = null, revokedBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const link = await db.selectFrom('external_identities')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(linkId) || 0)
    .selectAll().executeTakeFirst();
  if (!link) return { ok: false, error: 'identity link not found' };
  const fsm = assertIdentityStatusTransition({ from: link.status, to: IDENTITY_STATUS.REVOKED });
  if (!fsm.ok) return { ok: false, error: fsm.reason };

  const row = await db.updateTable('external_identities')
    .set({ status: IDENTITY_STATUS.REVOKED, revoked_by: revokedBy, revoked_at: new Date() })
    .where('id', '=', link.id).returning(['id', 'status']).executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.EXT_ONEID_REVOKE, userId: revokedBy, resourceType: 'external_identities', resourceId: row.id, details: { userId: link.user_id } }).catch(() => {});
  return { ok: true, identity: row };
}

/** List OneID identity links (tenant-scoped). */
export async function listIdentities({ status = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('external_identities').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('id', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// TOKEN VAULT
// ═══════════════════════════════════════════════════════════════════

/**
 * Store a token (envelope encryption — research §12.3). Plaintext hech
 * qachon DB'ga tushmaydi; faqat { ciphertext, iv, keyRef } saqlanadi.
 * @param {{ connectionId?: number, tokenType?: string, token?: string, scopes?: string[], expiresAt?: string, masterKey?: string, createdBy?: string }} params
 */
export async function tokenVaultStore({
  connectionId = null, tokenType = TOKEN_TYPES.ACCESS, token = '', scopes = [],
  expiresAt = null, masterKey = '', createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const conn = await db.selectFrom('external_connections')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(connectionId) || 0)
    .selectAll().executeTakeFirst().catch(() => null);
  if (!conn) return { ok: false, error: 'connection not found' };
  const type = assertValidEnum({ value: tokenType, allowed: Object.values(TOKEN_TYPES), name: 'tokenType' });
  if (!type.ok) return { ok: false, error: type.reason };
  if (!token) return { ok: false, error: 'token is required' };

  const envelope = buildTokenEnvelope({ plaintext: token, masterKey });
  if (!envelope.ok) return { ok: false, error: envelope.reason };

  const row = await db.insertInto('token_vault')
    .values({
      tenant_id: tenantId, connection_id: conn.id, provider: conn.provider, token_type: tokenType,
      ciphertext: envelope.ciphertext, iv: envelope.iv, key_ref: envelope.keyRef,
      scope: scopes.join(' '), expires_at: expiresAt || null, created_by: createdBy,
    })
    .returning(['id', 'provider', 'token_type'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.EXT_TOKEN_STORE, userId: createdBy, resourceType: 'token_vault', resourceId: row.id, details: { provider: row.provider, tokenType: row.token_type } }).catch(() => {});
  return { ok: true, tokenId: row.id };
}

/**
 * Decrypt a vault token — faqat vazifaviy foydalanish (proxy), audit bilan.
 * @param {{ tokenId?: number, masterKey?: string, requiredScopes?: string[] }} params
 */
export async function tokenVaultDecrypt({ tokenId = null, masterKey = '', requiredScopes = [] } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const row = await db.selectFrom('token_vault')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(tokenId) || 0)
    .selectAll().executeTakeFirst();
  if (!row) return { ok: false, error: 'token not found' };
  const state = assertTokenVaultState({ row: { ...row, revokedAt: row.revoked_at, expiresAt: row.expires_at } });
  if (!state.ok) return { ok: false, error: state.reason };

  // Token reuse guard — requiredScopes ko'rsatilishi shart.
  const scopes = (row.scope || '').split(' ').filter(Boolean);
  const reuse = assertNoTokenReuse({ tokenScopes: scopes, requiredScopes });
  if (!reuse.ok) return { ok: false, error: reuse.reason };

  const dec = decryptTokenEnvelope({ ciphertext: row.ciphertext, iv: row.iv, keyRef: row.key_ref, masterKey });
  if (!dec.ok) return { ok: false, error: dec.reason };

  await db.updateTable('token_vault').set({ last_used_at: new Date() }).where('id', '=', row.id).execute();
  return { ok: true, token: dec.plaintext, provider: row.provider, scopes };
}

/** Revoke a vault token. */
export async function tokenVaultRevoke({ tokenId = null, revokedBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const row = await db.selectFrom('token_vault')
    .where('tenant_id', '=', tenantId).where('id', '=', Number(tokenId) || 0)
    .selectAll().executeTakeFirst();
  if (!row) return { ok: false, error: 'token not found' };
  const row2 = await db.updateTable('token_vault')
    .set({ revoked_at: new Date(), revoked_by: revokedBy })
    .where('id', '=', row.id).returning(['id', 'revoked_at']).executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.EXT_TOKEN_REVOKE, userId: revokedBy, resourceType: 'token_vault', resourceId: row2.id, details: { provider: row.provider } }).catch(() => {});
  return { ok: true, revokedAt: row2.revoked_at };
}

/** List vault tokens (metadata only — ciphertext/hech qanday secret yo'q). */
export async function listVaultTokens({ provider = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('token_vault').selectAll().where('tenant_id', '=', tenantId);
  if (provider) q = q.where('provider', '=', provider);
  const rows = await q.orderBy('id', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
  // Metadata only — secretlarni qaytarmaymiz.
  return rows.map((r) => ({ id: r.id, provider: r.provider, tokenType: r.token_type, scope: r.scope, expiresAt: r.expires_at, revokedAt: r.revoked_at, lastUsedAt: r.last_used_at }));
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════

/** Dashboard summary for the admin view. */
export async function getExternalIntegrationSummary() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const conns = await db.selectFrom('external_connections').selectAll().where('tenant_id', '=', tenantId).limit(1000).execute();
  const jobs = await db.selectFrom('external_sync_jobs').selectAll().where('tenant_id', '=', tenantId).limit(1000).execute();
  const identities = await db.selectFrom('external_identities').selectAll().where('tenant_id', '=', tenantId).limit(1000).execute();
  const tokens = await db.selectFrom('token_vault').selectAll().where('tenant_id', '=', tenantId).limit(1000).execute();

  return {
    ok: true,
    liveMode: isLiveMode(),
    connections: conns.length,
    connectionsByProvider: conns.reduce((acc, c) => { acc[c.provider] = (acc[c.provider] || 0) + 1; return acc; }, {}),
    jobs: jobs.length,
    jobsByStatus: jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {}),
    jobsFailed: jobs.filter((j) => j.status === SYNC_JOB_STATUS.FAILED).length,
    jobsDeadLetter: jobs.filter((j) => j.status === SYNC_JOB_STATUS.DEAD_LETTER).length,
    identitiesLinked: identities.filter((i) => i.status === IDENTITY_STATUS.LINKED).length,
    tokensActive: tokens.filter((t2) => !t2.revoked_at).length,
  };
}
