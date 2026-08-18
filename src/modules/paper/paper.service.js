/**
 * Deborah — Paper Packet, QR & Chain of Custody Service
 *
 * DB layer for Prompt 42:
 *   - Batch generation: paper_batches + paper_packets + paper_pages, all
 *     idempotent (batch_key / opaque_packet_id / qr_token UNIQUE).
 *   - Per-page signed QR (no answer keys / raw PII), content hashes.
 *   - Detachable identity cover stored separately (cover_identity).
 *   - Custody ledger: append-only chain with HMAC signatures.
 *   - Short-lived download: signed download token with expiry.
 *
 * SECURITY / DATA GUARD (Prompt 42 §15, research.md §52.3):
 *   - QR payload faqat { packet, page, epoch, nonce, sig }; secret scan
 *     (scanPaperForSecrets) batch/packet/page artifactlarida.
 *   - Download token short-lived (TTL) va scope-langan.
 *   - Har bir write path tenant-scoped + idempotency.
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear error,
 * read paths return null/[] (consistent with the rest of the platform).
 */

import { createHash, createHmac } from 'node:crypto';
import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  buildPacketPlan,
  buildBatchManifest,
  buildPageQrPayload,
  signPageQr,
  verifyPageQr,
  scanPaperForSecrets,
  validateBatchTransition,
  validateCustodyEvent,
  signCustodyEvent,
  generateBackupCode,
  canonicalStringify,
  MIN_SIGNING_KEY_LENGTH,
  PAPER_BATCH_STATUS,
} from './paper.schema.js';

/** PostgreSQL unique-violation error code (23505). */
const PG_UNIQUE_VIOLATION = '23505';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * HMAC signing key — stable per deployment (SESSION_SECRET derived),
 * falls back to a dev key (tests/CI).
 */
function signingKey() {
  const secret = process.env.SESSION_SECRET || 'deborah-dev-secret';
  return secret.length >= MIN_SIGNING_KEY_LENGTH ? secret : secret.padEnd(MIN_SIGNING_KEY_LENGTH, 'x');
}

// ═══════════════════════════════════════════════════════════════════
// BATCH GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a paper batch: batch + packets + pages, all idempotent.
 *
 * @param {Object} opts
 * @param {string} opts.batchKey - idempotency key (e.g. `paper:assign12:run5`)
 * @param {number} opts.assignmentId
 * @param {number|null} opts.runId
 * @param {Array<Object>} opts.students - [{ userId, variant, accommodation, identity }]
 * @param {Object} opts.pageHashes - { [opaquePacketId]: { [pageIndex]: hash } }
 * @param {number} opts.epoch
 * @param {number|null} opts.createdBy
 * @returns {Promise<{ ok: boolean, batchId?: number, idempotent?: boolean, packets?: number, pages?: number, error?: string }>}
 */
export async function generatePaperBatch({
  batchKey, assignmentId, runId = null, students = [],
  pageHashes = {}, epoch = 1, createdBy = null,
} = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!batchKey) throw new Error('batchKey is required');
  if (!assignmentId) throw new Error('assignmentId is required');

  // Idempotency: existing batch_key → return existing (no re-generation).
  const existing = await db.selectFrom('paper_batches')
    .where('tenant_id', '=', getTenantId())
    .where('batch_key', '=', String(batchKey).slice(0, 120))
    .select(['id'])
    .executeTakeFirst();
  if (existing) return { ok: true, batchId: existing.id, idempotent: true };

  // Build packet plans (pure, deterministic).
  const plans = [];
  const pagesByPacket = {};
  for (const st of students || []) {
    const plan = buildPacketPlan({
      assignmentId,
      studentUserId: st.userId,
      variant: st.variant || null,
      accommodation: st.accommodation || {},
      pageCount: st.pageCount || 1,
      pageHashes: (pageHashes[st.opaquePacketId] || pageHashes[st.userId] || {}),
      identity: st.identity || {},
    });
    if (!plan.ok) throw new Error(plan.error);
    // Secret scan per plan — answer key / rubric hech qachon.
    const scan = scanPaperForSecrets(plan.plan);
    if (!scan.ok) throw new Error(`Secret scan failed: ${scan.found}`);
    plans.push(plan.plan);
  }

  const manifest = buildBatchManifest({ batchKey, packetPlans: plans });
  const manifestScan = scanPaperForSecrets(manifest.manifest);
  if (!manifestScan.ok) throw new Error(`Manifest secret scan failed: ${manifestScan.found}`);

  let batchId;
  try {
    batchId = await db.transaction().execute(async (trx) => {
      const batch = await trx.insertInto('paper_batches')
        .values({
          tenant_id: getTenantId(),
          assignment_id: Number(assignmentId),
          run_id: runId ? Number(runId) : null,
          batch_key: String(batchKey).slice(0, 120),
          status: PAPER_BATCH_STATUS.GENERATED,
          packet_count: plans.length,
          manifest_hash: manifest.hash,
          created_by: createdBy,
          updated_at: new Date(),
        })
        .returning('id')
        .executeTakeFirst();

      let pages = 0;
      for (const plan of plans) {
        const backupCode = generateBackupCode();
        const packet = await trx.insertInto('paper_packets')
          .values({
            tenant_id: getTenantId(),
            batch_id: batch.id,
            assignment_id: Number(assignmentId),
            opaque_packet_id: plan.opaque_packet_id,
            student_user_id: plan.student_user_id,
            variant: plan.variant,
            page_count: plan.page_count,
            checksum: plan.checksum,
            accommodation_flags: plan.accommodation_flags,
            backup_code: backupCode,
            cover_identity: plan.cover_identity,
            created_by: createdBy,
          })
          .returning('id')
          .executeTakeFirst();

        for (const pg of plan.pages) {
          const signed = signPageQr({
            packetId: plan.opaque_packet_id,
            pageIndex: pg.page_index,
            epoch,
            nonce: backupCode,
            key: signingKey(),
            issuedAt: Date.now(),
          });
          await trx.insertInto('paper_pages')
            .values({
              tenant_id: getTenantId(),
              packet_id: packet.id,
              page_index: pg.page_index,
              qr_token: signed.token,
              qr_hash: scanPaperForSecrets(signed.payload).ok ? pageQrHash(signed.payload) : null,
              content_hash: pg.content_hash,
              render_flags: plan.accommodation_flags,
            })
            .execute();
          pages += 1;
        }
      }

      // First custody event: generated.
      await trx.insertInto('paper_custody_ledger')
        .values({
          tenant_id: getTenantId(),
          batch_id: batch.id,
          event_type: 'generated',
          actor_user_id: createdBy,
          count: plans.length,
          discrepancy: 0,
          signature: signCustodyEvent({
            prevEventId: null, eventType: 'generated', count: plans.length,
            batchId: batch.id, key: signingKey(),
          }),
          prev_event_id: null,
          note: `batch ${batchKey}`,
        })
        .execute();

      return batch.id;
    });
  } catch (err) {
    if (String(err?.code) === PG_UNIQUE_VIOLATION) {
      const re = await db.selectFrom('paper_batches')
        .where('tenant_id', '=', getTenantId())
        .where('batch_key', '=', String(batchKey).slice(0, 120))
        .select(['id'])
        .executeTakeFirst();
      if (re) return { ok: true, batchId: re.id, idempotent: true };
    }
    throw err;
  }

  await audit({
    action: AUDIT_ACTIONS.PAPER_BATCH_GENERATE,
    userId: createdBy,
    resourceType: 'paper_batch',
    resourceId: batchId,
    details: { batchKey, packets: plans.length, assignmentId },
  });
  return { ok: true, batchId, idempotent: false, packets: plans.length, pages: plans.reduce((s, p) => s + p.page_count, 0) };
}

/** Tiny helper — SHA-256 hex of canonical JSON (for qr_hash). */
function pageQrHash(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════
// READ PATHS
// ═══════════════════════════════════════════════════════════════════

/** Get a paper batch by id. */
export async function getPaperBatch(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('paper_batches')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) {
    return null;
  }
}

/** List paper batches. */
export async function listPaperBatches({ assignmentId, status, limit = 100, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('paper_batches')
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
    if (assignmentId) q = q.where('assignment_id', '=', assignmentId);
    if (status) q = q.where('status', '=', status);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

/** Get packets for a batch (opaque ids + variants, NO student PII unless requested). */
export async function listPackets({ batchId, includeIdentity = false, limit = 500, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('paper_packets')
      .where('tenant_id', '=', getTenantId())
      .orderBy('id', 'asc')
      .limit(limit)
      .offset(offset);
    if (batchId) q = q.where('batch_id', '=', batchId);
    const rows = await q.selectAll().execute();
    return rows.map((r) => {
      const out = {
        id: r.id,
        opaquePacketId: r.opaque_packet_id,
        variant: r.variant,
        pageCount: r.page_count,
        checksum: r.checksum,
        accommodationFlags: typeof r.accommodation_flags === 'string' ? JSON.parse(r.accommodation_flags) : r.accommodation_flags,
        backupCode: r.backup_code,
      };
      if (includeIdentity) {
        out.studentUserId = r.student_user_id;
        out.coverIdentity = typeof r.cover_identity === 'string' ? JSON.parse(r.cover_identity) : r.cover_identity;
      }
      return out;
    });
  } catch (_) {
    return [];
  }
}

/** Get pages for a packet (QR tokens + content hashes). */
export async function listPacketPages(packetId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('paper_pages')
      .where('packet_id', '=', packetId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('page_index', 'asc')
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// BATCH STATUS + CUSTODY LEDGER
// ═══════════════════════════════════════════════════════════════════

/** Transition a batch through its status machine. */
export async function transitionPaperBatch({ id, to, actorUserId = null, note = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const batch = await getPaperBatch(id);
  if (!batch) throw new Error('Batch not found');

  const v = validateBatchTransition(batch.status, to);
  if (!v.ok) throw new Error(v.error);

  await db.updateTable('paper_batches')
    .set({ status: v.to, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.PAPER_BATCH_TRANSITION,
    userId: actorUserId,
    resourceType: 'paper_batch',
    resourceId: id,
    details: { from: batch.status, to: v.to },
  });
  return { ok: true, from: batch.status, to: v.to };
}

/**
 * Record a custody event (append-only chain). Batch status auto-advances
 * on generated → downloaded → received → reconciled → archived|destroyed.
 * The custody insert + batch transition are wrapped in ONE transaction so a
 * failed milestone transition never leaves a half-committed ledger row.
 */
export async function recordCustodyEvent({ batchId, data = {}, actorUserId = null } = {}) {
  const v = validateCustodyEvent(data);
  if (!v.ok) throw new Error(v.error);

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const batch = await getPaperBatch(batchId);
  if (!batch) throw new Error('Batch not found');

  // Pre-validate the auto-advance transition BEFORE any write — an illegal
  // milestone (e.g. duplicate batch_downloaded) must not record a ledger row.
  const statusMap = {
    batch_downloaded: PAPER_BATCH_STATUS.DOWNLOADED,
    operator_received: PAPER_BATCH_STATUS.RECEIVED,
    sealed_received: PAPER_BATCH_STATUS.RECEIVED,
    scanned_received: PAPER_BATCH_STATUS.RECEIVED,
    reconciled: PAPER_BATCH_STATUS.RECONCILED,
    archived: PAPER_BATCH_STATUS.ARCHIVED,
    destroyed: PAPER_BATCH_STATUS.DESTROYED,
    unused_destroyed: PAPER_BATCH_STATUS.DESTROYED,
  };
  const target = statusMap[v.event.event_type];
  if (target) {
    const check = validateBatchTransition(batch.status, target);
    if (!check.ok) throw new Error(check.error);
  }

  let inserted;
  let prevEventId;
  await db.transaction().execute(async (trx) => {
    const last = await trx.selectFrom('paper_custody_ledger')
      .where('tenant_id', '=', getTenantId())
      .where('batch_id', '=', batchId)
      .orderBy('id', 'desc')
      .select(['id'])
      .executeTakeFirst();
    prevEventId = last?.id || null;

    inserted = await trx.insertInto('paper_custody_ledger')
      .values({
        tenant_id: getTenantId(),
        batch_id: batchId,
        event_type: v.event.event_type,
        actor_user_id: actorUserId,
        count: v.event.count,
        discrepancy: v.event.discrepancy,
        signature: signCustodyEvent({
          prevEventId: prevEventId,
          eventType: v.event.event_type,
          count: v.event.count,
          discrepancy: v.event.discrepancy,
          batchId,
          key: signingKey(),
        }),
        prev_event_id: prevEventId,
        note: v.event.note,
      })
      .returning('id')
      .executeTakeFirst();

    // Auto-advance batch status inside the SAME transaction.
    if (target) {
      await trx.updateTable('paper_batches')
        .set({ status: target, updated_at: new Date() })
        .where('id', '=', batchId)
        .where('tenant_id', '=', getTenantId())
        .execute();
    }
  });

  if (target) {
    await audit({
      action: AUDIT_ACTIONS.PAPER_BATCH_TRANSITION,
      userId: actorUserId,
      resourceType: 'paper_batch',
      resourceId: batchId,
      details: { from: batch.status, to: target },
    });
  }
  await audit({
    action: AUDIT_ACTIONS.PAPER_CUSTODY_EVENT,
    userId: actorUserId,
    resourceType: 'paper_custody_ledger',
    resourceId: inserted?.id,
    details: { batchId, eventType: v.event.event_type, count: v.event.count, discrepancy: v.event.discrepancy },
  });
  return { ok: true, id: inserted?.id, prevEventId };
}

/** List custody events for a batch (chain order). */
export async function listCustodyEvents({ batchId, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('paper_custody_ledger')
      .where('tenant_id', '=', getTenantId())
      .orderBy('id', 'asc')
      .limit(limit)
      .offset(offset);
    if (batchId) q = q.where('batch_id', '=', batchId);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// QR VERIFY + SHORT-LIVED DOWNLOAD
// ═══════════════════════════════════════════════════════════════════

/** Verify a scanned page QR (authenticity + integrity + replay/duplicate flag). */
export async function verifyScannedPageQr({ token, actorUserId = null } = {}) {
  const v = verifyPageQr(token, signingKey());
  if (!v.ok) return v;

  const db = await getDb();
  if (!db) return { ...v, replay: false }; // no DB — cannot check replay

  // Authenticity + duplicate detection: qr_token must exist exactly once
  // (UNIQUE); scanned_at is set on FIRST scan — a second scan of the same QR
  // (photocopy/duplicate) is flagged as replay.
  let row = null;
  try {
    row = await db.selectFrom('paper_pages')
      .where('qr_token', '=', String(token))
      .where('tenant_id', '=', getTenantId())
      .select(['id', 'packet_id', 'page_index', 'scanned_at'])
      .executeTakeFirst();
  } catch (_) {
    return { ...v, replay: false }; // DB unavailable — cannot check replay
  }
  if (!row) return { ok: false, error: 'qr_token not found in ledger' };
  if (row.scanned_at) {
    return { ok: false, error: 'duplicate scan detected (QR already scanned)', replay: true, packetId: row.packet_id, pageIndex: row.page_index };
  }
  try {
    await db.updateTable('paper_pages')
      .set({ scanned_at: new Date() })
      .where('id', '=', row.id)
      .where('tenant_id', '=', getTenantId())
      .execute();
  } catch (_) {
    return { ok: false, error: 'failed to mark scan' };
  }
  await audit({
    action: AUDIT_ACTIONS.PAPER_QR_VERIFY,
    userId: actorUserId,
    resourceType: 'paper_pages',
    resourceId: row.id,
    details: { packetId: row.packet_id, pageIndex: row.page_index, replay: false },
  });
  return { ok: true, payload: v.payload, packetId: row.packet_id, pageIndex: row.page_index, replay: false };
}

/**
 * Create a short-lived download token for a batch (expiry minutes).
 * Scope: only this batch's packets/pages. Token format: <hex>.<exp>
 * (signature over { scope, batchId, tenantId, exp }).
 */
export async function createBatchDownloadToken({ batchId, expiresInMinutes = 15, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const batch = await getPaperBatch(batchId);
  if (!batch) throw new Error('Batch not found');

  const exp = Date.now() + Number(expiresInMinutes) * 60 * 1000;
  const sig = createHmac('sha256', signingKey())
    .update(JSON.stringify({ scope: 'paper_batch_download', batchId: Number(batchId), tenantId: getTenantId(), exp }))
    .digest('hex');
  const token = `${sig}.${exp}`;

  await audit({
    action: AUDIT_ACTIONS.PAPER_DOWNLOAD_TOKEN,
    userId,
    resourceType: 'paper_batch',
    resourceId: batchId,
    details: { expiresInMinutes, scope: 'paper_batch_download' },
  });
  return { ok: true, token, expiresAt: new Date(exp).toISOString() };
}

/** Verify a batch download token (scope + expiry). Token format: <hex>.<exp>. */
export async function verifyBatchDownloadToken({ token, batchId } = {}) {
  if (!token || !batchId) return { ok: false, error: 'token and batchId required' };
  const batch = await getPaperBatch(Number(batchId));
  if (!batch) return { ok: false, error: 'Batch not found' };

  const [sig, expRaw] = String(token).split('.');
  if (!sig || !expRaw) return { ok: false, error: 'malformed token' };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, error: 'token expired' };
  const expected = createHmac('sha256', signingKey())
    .update(JSON.stringify({ scope: 'paper_batch_download', batchId: Number(batchId), tenantId: getTenantId(), exp }))
    .digest('hex');
  if (expected !== sig) return { ok: false, error: 'token signature mismatch' };
  return { ok: true, batchId: Number(batchId) };
}
