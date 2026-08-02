/**
 * Edikit — Safe File, Code & Oral Submission Service
 *
 * DB layer for Prompt 44 (research.md §16.3, §51):
 *   - Resumable upload session (session_key idempotency), chunk append
 *     with per-chunk hash chain + contiguous-offset validation.
 *   - Finalize: size/chunk-count verification → magic MIME detection →
 *     scanner orchestration (best-effort; verdicts IMMUTABLE) →
 *     quarantine decision (FAIL-CLOSED).
 *   - Authorized resubmission/version flow (max versions) + signed
 *     receipt per version.
 *   - Media transcript + confidence → manual listen queue.
 *   - SECURITY: uploaded code hook ishlamaydi (static policy check +
 *     sandbox limits contract); quarantine NEVER becomes a late penalty
 *     (it is 'needs_review' only).
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear
 * error, read paths return null/[] (consistent with the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  SAFE_SUBMIT_DEFAULTS,
  UPLOAD_SESSION_STATUS,
  QUARANTINE_STATUS,
  CHUNK_STATUS,
  VERSION_STATUS,
  TRANSCRIPT_STATUS,
  resolveUploadLimits,
  validateUploadSessionCreate,
  validateSessionTransition,
  detectMagicMime,
  sha256Hex,
  evaluateMimeMatch,
  decideQuarantine,
  evaluateArchivePlan,
  scanForMacros,
  scanPdfForActiveContent,
  staticCodePolicyCheck,
  validateChunk,
  validateUploadComplete,
  evaluateTranscriptConfidence,
  checkResubmissionAllowed,
  validateVersionTransition,
  buildSubmissionReceipt,
  verifySubmissionReceipt,
} from './safe-submit.schema.js';

const PG_UNIQUE_VIOLATION = '23505';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

function receiptSecret() {
  const secret = process.env.SESSION_SECRET || 'edikit-dev-secret';
  return secret.length >= 32 ? secret : secret.padEnd(32, 'x');
}

// ═══════════════════════════════════════════════════════════════════
// UPLOAD SESSION
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a resumable upload session (idempotent by session_key).
 *
 * @param {Object} opts
 * @param {number} opts.attemptId
 * @param {number} opts.userId
 * @param {string} opts.sessionKey
 * @param {string} opts.kind - file | code | audio | video
 * @param {string} [opts.declaredMime]
 * @param {number} [opts.expectedSize]
 * @param {string} [opts.originalName]
 * @param {Object} [opts.briefLimits]
 * @param {Object} [opts.briefPolicy] - { allowResubmit, maxVersions }
 */
export async function createUploadSession({
  attemptId, userId, sessionKey = '', kind = '', declaredMime = '', expectedSize = 0,
  originalName = '', briefLimits = {}, briefPolicy = {},
} = {}) {
  const limits = resolveUploadLimits({ kind, briefLimits });
  const v = validateUploadSessionCreate({ sessionKey, kind, declaredMime, expectedSize, limits });
  if (!v.ok) throw new Error(v.error);

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // Idempotent — same session_key returns the existing session
  const existing = await db.selectFrom('upload_sessions')
    .where('tenant_id', '=', getTenantId())
    .where('session_key', '=', sessionKey)
    .selectAll()
    .executeTakeFirst();
  if (existing) {
    await audit({
      action: AUDIT_ACTIONS.UPLOAD_SESSION_CREATE,
      userId,
      resourceType: 'upload_session',
      resourceId: existing.id,
      details: { sessionKey, idempotent: true, kind },
    }).catch(() => {});
    return { ok: true, id: existing.id, idempotent: true, session: existing };
  }

  // First version check: count existing versions for this attempt
  const versionCount = await db.selectFrom('submission_versions')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', Number(attemptId))
    .select(db.fn.countAll().as('n'))
    .executeTakeFirst();

  try {
    const row = await db.insertInto('upload_sessions')
      .values({
        tenant_id: getTenantId(),
        attempt_id: Number(attemptId),
        user_id: Number(userId),
        session_key: sessionKey,
        kind,
        status: UPLOAD_SESSION_STATUS.OPEN,
        original_name: originalName ? String(originalName).slice(0, 255) : null,
        declared_mime: declaredMime || null,
        expected_size: Number(expectedSize) || 0,
        chunk_size: limits.chunkSizeBytes,
        total_chunks: Math.ceil((Number(expectedSize) || 0) / limits.chunkSizeBytes),
        created_by: userId || null,
      })
      .returning(['id', 'session_key', 'kind', 'status', 'chunk_size', 'total_chunks'])
      .executeTakeFirst();

    await audit({
      action: AUDIT_ACTIONS.UPLOAD_SESSION_CREATE,
      userId,
      resourceType: 'upload_session',
      resourceId: row.id,
      details: { sessionKey, kind, expectedSize, versionCount: Number(versionCount?.n ?? 0) },
    }).catch(() => {});
    return { ok: true, id: row.id, session: row, limits };
  } catch (err) {
    if (err?.code === PG_UNIQUE_VIOLATION) {
      const again = await db.selectFrom('upload_sessions')
        .where('tenant_id', '=', getTenantId())
        .where('session_key', '=', sessionKey)
        .selectAll()
        .executeTakeFirst();
      return { ok: true, id: again.id, idempotent: true, session: again, limits };
    }
    throw err;
  }
}

/**
 * Append a chunk to a session (resume contract, per-chunk hash chain).
 *
 * @param {Object} opts
 * @param {number} opts.sessionId
 * @param {number} opts.userId
 * @param {number} opts.chunkIndex
 * @param {number} opts.offset
 * @param {Buffer} opts.chunkData
 */
export async function appendUploadChunk({ sessionId, userId, chunkIndex = 0, offset = 0, chunkData = Buffer.alloc(0) } = {}) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!Buffer.isBuffer(chunkData) || chunkData.length === 0) throw new Error('chunkData is required');

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const session = await db.selectFrom('upload_sessions')
    .where('id', '=', Number(sessionId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!session) throw new Error('Upload session not found');
  // Ownership guard — a student can only append to their OWN session (§16)
  if (Number(session.user_id) !== Number(userId)) {
    throw new Error('Not authorized for this upload session');
  }
  if (![UPLOAD_SESSION_STATUS.OPEN, UPLOAD_SESSION_STATUS.UPLOADING].includes(session.status)) {
    throw new Error(`Session not accepting chunks (status: ${session.status})`);
  }

  const limits = resolveUploadLimits({ kind: session.kind });
  const c = validateChunk({
    chunkIndex,
    offset,
    size: chunkData.length,
    receivedSize: session.received_size,
    limits,
  });
  if (!c.ok) throw new Error(c.error);

  const chunkHash = sha256Hex(chunkData);

  // Idempotent re-send of an already-received chunk → no-op
  const existing = await db.selectFrom('upload_chunks')
    .where('tenant_id', '=', getTenantId())
    .where('session_id', '=', Number(sessionId))
    .where('chunk_index', '=', Number(chunkIndex))
    .selectAll()
    .executeTakeFirst();
  if (existing) {
    if (existing.sha256 !== chunkHash) {
      throw new Error('chunk hash mismatch on resend');
    }
    await audit({
      action: AUDIT_ACTIONS.UPLOAD_CHUNK,
      userId,
      resourceType: 'upload_chunk',
      resourceId: existing.id,
      details: { sessionId, chunkIndex, idempotent: true },
    }).catch(() => {});
    return { ok: true, id: existing.id, idempotent: true, chunk: existing };
  }

  const storageKey = `uploads/${session.session_key}/${String(chunkIndex).padStart(6, '0')}.bin`;
  try {
    const storage = (await import('../../infrastructure/storage.js')).default;
    await storage.put(storageKey, chunkData, 'application/octet-stream');
  } catch (_) {
    // storage unavailable — hash/row still recorded; no throw
  }

  const row = await db.insertInto('upload_chunks')
    .values({
      tenant_id: getTenantId(),
      session_id: Number(sessionId),
      chunk_index: Number(chunkIndex),
      offset: Number(offset),
      size: chunkData.length,
      sha256: chunkHash,
      status: CHUNK_STATUS.VERIFIED,
      storage_key: storageKey,
    })
    .returning(['id', 'chunk_index', 'offset', 'size', 'sha256', 'status'])
    .executeTakeFirst();

  // Advance session counters + status
  const newReceived = Number(session.received_chunks) + 1;
  const newSize = Number(session.received_size) + chunkData.length;
  const nextStatus = newReceived >= session.total_chunks ? UPLOAD_SESSION_STATUS.COMPLETE : UPLOAD_SESSION_STATUS.UPLOADING;
  await db.updateTable('upload_sessions')
    .set({ received_chunks: newReceived, received_size: newSize, status: nextStatus, updated_at: new Date() })
    .where('id', '=', Number(sessionId))
    .execute();

  await audit({
    action: AUDIT_ACTIONS.UPLOAD_CHUNK,
    userId,
    resourceType: 'upload_chunk',
    resourceId: row.id,
    details: { sessionId, chunkIndex, offset, size: chunkData.length, receivedChunks: newReceived },
  }).catch(() => {});
  return { ok: true, id: row.id, chunk: row, sessionComplete: nextStatus === UPLOAD_SESSION_STATUS.COMPLETE };
}

/**
 * Finalize an upload: verify completeness, detect magic MIME, run
 * scanners (best-effort, verdicts immutable), decide quarantine (fail-closed).
 *
 * @param {Object} opts
 * @param {number} opts.sessionId
 * @param {number} opts.userId
 * @param {Buffer} [opts.fullContent] - assembled content (service may
 *   reassemble from chunks when storage unavailable)
 * @param {Object} [opts.scannerHooks] - optional real scanner adapters
 */
export async function finalizeUpload({ sessionId, userId, fullContent = null, scannerHooks = {} } = {}) {
  if (!sessionId) throw new Error('sessionId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const session = await db.selectFrom('upload_sessions')
    .where('id', '=', Number(sessionId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!session) throw new Error('Upload session not found');
  // Ownership guard — only the owner can finalize (§16)
  if (Number(session.user_id) !== Number(userId)) {
    throw new Error('Not authorized for this upload session');
  }

  const complete = validateUploadComplete({
    receivedSize: session.received_size,
    expectedSize: session.expected_size,
    receivedChunks: session.received_chunks,
    totalChunks: session.total_chunks,
  });
  if (!complete.ok) throw new Error(complete.reason);

  // Assemble full content (server-side) — from passed buffer or storage
  let content = null;
  if (fullContent && Buffer.isBuffer(fullContent) && fullContent.length > 0) {
    content = fullContent;
  } else {
    try {
      const chunks = await db.selectFrom('upload_chunks')
        .where('tenant_id', '=', getTenantId())
        .where('session_id', '=', Number(sessionId))
        .orderBy('chunk_index', 'asc')
        .select(['chunk_index', 'storage_key'])
        .execute();
      const storage = (await import('../../infrastructure/storage.js')).default;
      const parts = [];
      for (const ch of chunks) {
        const buf = await storage.get(ch.storage_key);
        if (buf) parts.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
      }
      if (parts.length > 0) content = Buffer.concat(parts);
    } catch (_) {
      content = null;
    }
  }
  if (!content || content.length === 0) throw new Error('unable to assemble upload content');

  const finalHash = sha256Hex(content);
  const magicMime = detectMagicMime(content.subarray(0, 16));
  const mimeCheck = evaluateMimeMatch({ declaredMime: session.declared_mime || '', magicMime });

  // ── Scanner orchestration (best-effort — verdicts immutable) ──
  const results = [];
  const recordScan = async (scanner, verdict, details) => {
    if (!SCAN_VERDICTS.includes(verdict)) verdict = 'unscannable';
    await db.insertInto('scan_results')
      .values({
        tenant_id: getTenantId(),
        session_id: Number(sessionId),
        scanner,
        verdict,
        details: JSON.stringify(details || {}),
      })
      .execute();
    results.push({ scanner, verdict });
  };

  try {
    // 1. Magic scan
    if (!mimeCheck.ok) {
      await recordScan('magic', 'suspicious', { reason: mimeCheck.reason });
    } else {
      await recordScan('magic', 'clean', { magicMime });
    }

    // 2. Archive / macro / PDF active-content (pure heuristics)
    const isZip = magicMime === 'application/zip';
    const isPdf = magicMime === 'application/pdf';
    if (isZip) {
      // Heuristic: ratio + entry estimate — real scan via scannerHooks.archive
      if (scannerHooks.archive) {
        const r = await scannerHooks.archive(content);
        await recordScan('archive', r?.verdict || 'unscannable', r?.details || {});
      } else {
        const plan = evaluateArchivePlan({
          compressedBytes: content.length,
          entryCount: 0,
          estimatedDecompressedBytes: content.length * 20, // unknown → conservative
        });
        await recordScan('archive', plan.verdict, { reason: plan.reason, ratio: plan.ratio, heuristic: true });
      }
    }
    if (isPdf) {
      const r = scannerHooks.pdf
        ? await scannerHooks.pdf(content)
        : scanPdfForActiveContent({ pdfBytes: content });
      await recordScan('pdf', r?.verdict || r?.status || 'unscannable', r?.markers ? { markers: r.markers } : {});
    }
    if (session.kind === 'code') {
      const macro = scanForMacros({ fileName: session.original_name || '', entryNames: [] });
      await recordScan('macro', macro.verdict, { hasMacro: macro.hasMacro, reason: macro.reason });
      const code = scannerHooks.staticPolicy
        ? await scannerHooks.staticPolicy(content.toString('utf8'))
        : staticCodePolicyCheck({ source: content.toString('utf8') });
      await recordScan('codesandbox', code.verdict, { flags: code.flags, reason: code.reason });
    } else {
      const macro = scanForMacros({ fileName: session.original_name || '', entryNames: [] });
      await recordScan('macro', macro.verdict, { hasMacro: macro.hasMacro, reason: macro.reason });
    }
  } catch (err) {
    // Scanner infra failed → FAIL-CLOSED (unscannable), never clean
    await recordScan('magic', 'unscannable', { error: err.message });
  }

  const decision = decideQuarantine(results);
  const finalStatus = decision.status === QUARANTINE_STATUS.CLEAN
    ? UPLOAD_SESSION_STATUS.ACCEPTED
    : UPLOAD_SESSION_STATUS.QUARANTINED;

  await db.updateTable('upload_sessions')
    .set({
      status: finalStatus,
      sha256: finalHash,
      magic_mime: magicMime,
      quarantine_status: decision.status,
      quarantine_reason: decision.reason,
      storage_key: `uploads/${session.session_key}/final.bin`,
      updated_at: new Date(),
    })
    .where('id', '=', Number(sessionId))
    .execute();

  try {
    const storage = (await import('../../infrastructure/storage.js')).default;
    await storage.put(`uploads/${session.session_key}/final.bin`, content, session.declared_mime || 'application/octet-stream');
  } catch (_) {
    // storage unavailable — row still records hash/status
  }

  await audit({
    action: AUDIT_ACTIONS.UPLOAD_FINALIZE,
    userId,
    resourceType: 'upload_session',
    resourceId: Number(sessionId),
    details: { sha256: finalHash.slice(0, 12), status: finalStatus, quarantine: decision.status, scans: results },
  }).catch(() => {});
  return { ok: true, sessionId: Number(sessionId), status: finalStatus, quarantine: decision.status, sha256: finalHash };
}

// ═══════════════════════════════════════════════════════════════════
// SUBMISSION VERSIONS + SIGNED RECEIPT
// ═══════════════════════════════════════════════════════════════════

/**
 * Submit the current upload as a submission version (authorized
 * resubmission flow). Issues an immutable signed receipt per version.
 *
 * @param {Object} opts
 * @param {number} opts.attemptId
 * @param {number} opts.userId
 * @param {number} opts.uploadSessionId
 * @param {Object} opts.policy - { allowResubmit, maxVersions, attemptOpen }
 */
export async function submitVersion({ attemptId, userId, uploadSessionId, policy = {} } = {}) {
  if (!attemptId || !userId || !uploadSessionId) {
    throw new Error('attemptId, userId and uploadSessionId are required');
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const session = await db.selectFrom('upload_sessions')
    .where('id', '=', Number(uploadSessionId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!session) throw new Error('Upload session not found');
  // Ownership guard — only the owner can submit (§16)
  if (Number(session.user_id) !== Number(userId)) {
    throw new Error('Not authorized for this upload session');
  }
  if (![UPLOAD_SESSION_STATUS.ACCEPTED, UPLOAD_SESSION_STATUS.QUARANTINED].includes(session.status)) {
    throw new Error(`Session not submittable (status: ${session.status})`);
  }

  // Current version count
  const versionRow = await db.selectFrom('submission_versions')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', Number(attemptId))
    .select(db.fn.countAll().as('n'))
    .executeTakeFirst();
  const currentVersion = Number(versionRow?.n ?? 0);
  const nextVersion = currentVersion + 1;

  if (currentVersion > 0) {
    const resub = checkResubmissionAllowed({
      currentVersion,
      attemptOpen: !!policy.attemptOpen,
      authorized: !!policy.allowResubmit,
      maxVersions: policy.maxVersions || SAFE_SUBMIT_DEFAULTS.maxVersions,
    });
    if (!resub.ok) throw new Error(resub.reason);
  }

  try {
    const row = await db.insertInto('submission_versions')
      .values({
        tenant_id: getTenantId(),
        attempt_id: Number(attemptId),
        user_id: Number(userId),
        version_no: nextVersion,
        upload_session_id: Number(uploadSessionId),
        status: VERSION_STATUS.SUBMITTED,
        created_by: userId || null,
      })
      .returning(['id', 'version_no', 'status'])
      .executeTakeFirst();

    // Supersede the previous version (if any)
    if (currentVersion > 0) {
      await db.updateTable('submission_versions')
        .set({
          status: VERSION_STATUS.SUPERSEDED,
          superseded_by: row.id,
          superseded_at: new Date(),
        })
        .where('tenant_id', '=', getTenantId())
        .where('attempt_id', '=', Number(attemptId))
        .where('version_no', '=', currentVersion)
        .execute();
    }

    // Signed receipt (immutable)
    const receipt = buildSubmissionReceipt({
      attemptId: Number(attemptId),
      versionNo: nextVersion,
      sessionKey: session.session_key,
      sha256: session.sha256 || '',
      quarantineStatus: session.quarantine_status || 'pending',
      secret: receiptSecret(),
    });

    const receiptRow = await db.insertInto('submission_receipts')
      .values({
        tenant_id: getTenantId(),
        version_id: row.id,
        attempt_id: Number(attemptId),
        receipt_token: receipt.receiptToken,
        receipt_body: JSON.stringify(receipt.body),
        signature: receipt.signature,
      })
      .returning(['id', 'receipt_token'])
      .executeTakeFirst();

    await audit({
      action: AUDIT_ACTIONS.SUBMISSION_VERSION,
      userId,
      resourceType: 'submission_version',
      resourceId: row.id,
      details: { attemptId, versionNo: nextVersion, receiptId: receiptRow.id },
    }).catch(() => {});
    return {
      ok: true, versionId: row.id, versionNo: nextVersion,
      receipt: { token: receiptRow.receipt_token, body: receipt.body, signature: receipt.signature },
    };
  } catch (err) {
    if (err?.code === PG_UNIQUE_VIOLATION) {
      const again = await db.selectFrom('submission_versions')
        .where('tenant_id', '=', getTenantId())
        .where('attempt_id', '=', Number(attemptId))
        .where('version_no', '=', nextVersion)
        .selectAll()
        .executeTakeFirst();
      const receipt = await db.selectFrom('submission_receipts')
        .where('tenant_id', '=', getTenantId())
        .where('version_id', '=', again.id)
        .selectAll()
        .executeTakeFirst();
      if (receipt) {
        return {
          ok: true, versionId: again.id, versionNo: again.version_no, idempotent: true,
          receipt: { token: receipt.receipt_token, body: receipt.receipt_body, signature: receipt.signature },
        };
      }
    }
    throw err;
  }
}

/**
 * List submission versions for an attempt (immutable history).
 */
export async function listSubmissionVersions({ attemptId } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.selectFrom('submission_versions')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', Number(attemptId))
    .orderBy('version_no', 'desc')
    .selectAll()
    .execute();
}

/**
 * Verify a stored receipt (client-side verifiable).
 */
export async function verifyStoredReceipt({ receiptToken } = {}) {
  const db = await getDb();
  if (!db) return null;
  const receipt = await db.selectFrom('submission_receipts')
    .where('tenant_id', '=', getTenantId())
    .where('receipt_token', '=', receiptToken)
    .selectAll()
    .executeTakeFirst();
  if (!receipt) return null;
  const parsed = typeof receipt.receipt_body === 'string' ? JSON.parse(receipt.receipt_body) : receipt.receipt_body;
  const ok = verifySubmissionReceipt({ body: parsed, signature: receipt.signature }, receiptSecret());
  return { ok, token: receipt.receipt_token, body: parsed, signature: receipt.signature };
}

// ═══════════════════════════════════════════════════════════════════
// MEDIA TRANSCRIPTS + MANUAL LISTEN QUEUE
// ═══════════════════════════════════════════════════════════════════

/**
 * Record a media transcript for an oral/audio/video submission.
 * Low-confidence / empty → manual_listen queue.
 *
 * @param {Object} opts
 * @param {number} opts.sessionId
 * @param {number} opts.attemptId
 * @param {number} opts.userId
 * @param {string} opts.kind - oral | audio | video
 * @param {string} opts.transcriptText
 * @param {number} opts.confidence
 * @param {string} [opts.sourceHash]
 */
export async function createMediaTranscript({ sessionId, attemptId, userId, kind = 'oral', transcriptText = '', confidence = 0, sourceHash = null } = {}) {
  if (!sessionId || !attemptId) throw new Error('sessionId and attemptId are required');
  if (!['oral', 'audio', 'video'].includes(kind)) throw new Error(`Invalid transcript kind: ${kind}`);
  if (!transcriptText) throw new Error('transcriptText is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // Ownership guard — transcripts belong to the owner's session (§16)
  if (userId) {
    const session = await db.selectFrom('upload_sessions')
      .where('id', '=', Number(sessionId))
      .where('tenant_id', '=', getTenantId())
      .select(['user_id'])
      .executeTakeFirst();
    if (session && Number(session.user_id) !== Number(userId)) {
      throw new Error('Not authorized for this upload session');
    }
  }

  const conf = Number(confidence) || 0;
  const t = evaluateTranscriptConfidence({ confidence: conf, transcriptText });
  const row = await db.insertInto('media_transcripts')
    .values({
      tenant_id: getTenantId(),
      session_id: Number(sessionId),
      attempt_id: Number(attemptId),
      kind,
      transcript_text: transcriptText,
      confidence: conf,
      status: TRANSCRIPT_STATUS.DRAFT,
      manual_listen: t.manualListen,
      source_hash: sourceHash || null,
      created_by: userId || null,
    })
    .returning(['id', 'status', 'manual_listen'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.MEDIA_TRANSCRIPT_CREATE,
    userId,
    resourceType: 'media_transcript',
    resourceId: row.id,
    details: { sessionId, kind, confidence: conf, manualListen: row.manual_listen },
  }).catch(() => {});
  return { ok: true, id: row.id, manualListen: row.manual_listen, reason: t.reason };
}

/**
 * List the manual listen queue (low-confidence transcripts).
 */
export async function listManualListenQueue({ status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('media_transcripts')
    .where('tenant_id', '=', getTenantId())
    .where('manual_listen', '=', true)
    .orderBy('created_at', 'asc')
    .limit(100);
  if (status) q = q.where('status', '=', status);
  return q.selectAll().execute();
}

/**
 * Approve / reject a transcript (privileged, audited).
 */
export async function setTranscriptStatus({ transcriptId, status = 'approved', actorId = null } = {}) {
  if (!transcriptId) throw new Error('transcriptId is required');
  if (![TRANSCRIPT_STATUS.APPROVED, TRANSCRIPT_STATUS.REJECTED].includes(status)) {
    throw new Error(`Invalid transcript status: ${status}`);
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const row = await db.updateTable('media_transcripts')
    .set({ status, updated_at: new Date() })
    .where('id', '=', Number(transcriptId))
    .where('tenant_id', '=', getTenantId())
    .returning(['id', 'status'])
    .executeTakeFirst();
  if (!row) throw new Error('Transcript not found');
  await audit({
    action: AUDIT_ACTIONS.MEDIA_TRANSCRIPT_REVIEW,
    userId: actorId,
    resourceType: 'media_transcript',
    resourceId: Number(transcriptId),
    details: { status },
  }).catch(() => {});
  return { ok: true, id: row.id, status: row.status };
}

// ═══════════════════════════════════════════════════════════════════
// READ PATHS
// ═══════════════════════════════════════════════════════════════════

export async function getUploadSession(id) {
  const db = await getDb();
  if (!db) return null;
  return db.selectFrom('upload_sessions')
    .where('id', '=', Number(id))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
}

export async function listUploadSessions({ attemptId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('upload_sessions')
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'desc')
    .limit(100);
  if (attemptId) q = q.where('attempt_id', '=', Number(attemptId));
  return q.selectAll().execute();
}

export async function listScanResults({ sessionId } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.selectFrom('scan_results')
    .where('tenant_id', '=', getTenantId())
    .where('session_id', '=', Number(sessionId))
    .orderBy('scanned_at', 'asc')
    .selectAll()
    .execute();
}

export async function listUploadChunks({ sessionId } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.selectFrom('upload_chunks')
    .where('tenant_id', '=', getTenantId())
    .where('session_id', '=', Number(sessionId))
    .orderBy('chunk_index', 'asc')
    .selectAll()
    .execute();
}

// ═══════════════════════════════════════════════════════════════════
// QUARANTINE REVIEW (human-only, NEVER penalty)
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve a quarantined session — ACCEPT (false positive, still has the
 * immutable scan log) or REJECT (human-confirmed problem). This is a
 * manual, audited, privileged action. Quarantine itself NEVER triggers a
 * penalty — only a human REJECT after review does.
 *
 * @param {Object} opts
 * @param {number} opts.sessionId
 * @param {string} opts.action - accept | reject
 * @param {string} [opts.note]
 * @param {number} [opts.actorId]
 */
export async function resolveQuarantine({ sessionId, action = '', note = '', actorId = null } = {}) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!['accept', 'reject'].includes(action)) throw new Error(`Invalid quarantine action: ${action}`);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const session = await db.selectFrom('upload_sessions')
    .where('id', '=', Number(sessionId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!session) throw new Error('Upload session not found');
  if (session.status !== UPLOAD_SESSION_STATUS.QUARANTINED) {
    throw new Error(`Session not quarantined (status: ${session.status})`);
  }

  const to = action === 'accept' ? UPLOAD_SESSION_STATUS.ACCEPTED : UPLOAD_SESSION_STATUS.REJECTED;
  const v = validateSessionTransition(session.status, to);
  if (!v.ok) throw new Error(v.error);

  await db.updateTable('upload_sessions')
    .set({
      status: to,
      quarantine_reason: note ? String(note).slice(0, 500) : session.quarantine_reason,
      updated_at: new Date(),
    })
    .where('id', '=', Number(sessionId))
    .execute();

  await audit({
    action: AUDIT_ACTIONS.UPLOAD_QUARANTINE_REVIEW,
    userId: actorId,
    resourceType: 'upload_session',
    resourceId: Number(sessionId),
    details: { action, note: note?.slice(0, 200) || '' },
  }).catch(() => {});
  return { ok: true, sessionId: Number(sessionId), status: to };
}
