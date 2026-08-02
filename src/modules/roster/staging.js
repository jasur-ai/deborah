/**
 * Edikit — Roster Staging Area
 *
 * Stores parsed roster rows before committing to the academic DB.
 * Provides:
 *   1. Staging session management (create/update/delete)
 *   2. Parse report generation (row counts, errors, warnings)
 *   3. Row-level data with original + normalized values
 *   4. Staging → Commit validation hooks
 *
 * All data is stored in the local Firebase-compatible DB,
 * so it works even without PostgreSQL.
 *
 * @module roster/staging
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

const STAGING_PATH = 'roster_staging';

export async function createStagingSession({ filename, extension, fileSize, uploadedBy, totalRows, totalSheets, warnings }) {
  const sessionId = crypto.randomBytes(8).toString('hex');
  const session = {
    id: sessionId,
    filename,
    extension,
    fileSize,
    uploadedBy: uploadedBy || 'anonymous',
    status: 'staging',       // staging → reviewed → committed → error
    totalRows,
    totalSheets,
    totalErrors: 0,
    warnings: warnings || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    committedAt: null,
    rowErrors: [],
  };

  await fb.set(`${STAGING_PATH}/${sessionId}`, session);
  return sessionId;
}

export async function getStagingSession(sessionId) {
  const snap = await fb.get(`${STAGING_PATH}/${sessionId}`);
  return snap.exists() ? snap.val() : null;
}

export async function listStagingSessions({ status, limit = 20 } = {}) {
  const snap = await fb.get(STAGING_PATH);
  if (!snap.exists()) return [];

  const all = Object.values(snap.val());
  let filtered = status ? all.filter(s => s.status === status) : all;
  return filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
}

export async function updateStagingSession(sessionId, updates) {
  await fb.set(`${STAGING_PATH}/${sessionId}/updatedAt`, Date.now());
  for (const [key, value] of Object.entries(updates)) {
    await fb.set(`${STAGING_PATH}/${sessionId}/${key}`, value);
  }
  return true;
}

export async function addRowError(sessionId, rowIndex, field, message) {
  const error = { rowIndex, field, message, timestamp: Date.now() };
  const path = `${STAGING_PATH}/${sessionId}/rowErrors`;
  const snap = await fb.get(path);
  const errors = snap.exists() ? snap.val() : [];
  errors.push(error);
  await fb.set(path, errors);
  await fb.set(`${STAGING_PATH}/${sessionId}/totalErrors`, errors.length);
  return true;
}

export async function addParsedRows(sessionId, sheetName, rows) {
  const path = `${STAGING_PATH}/${sessionId}/sheets`;
  const snap = await fb.get(path);
  const sheets = snap.exists() ? snap.val() : {};

  sheets[sheetName] = {
    name: sheetName,
    rows: rows.map(r => ({
      rowIndex: r.rowIndex,
      data: r.data,
      validation: { status: 'pending', errors: [] },
    })),
    rowCount: rows.length,
  };

  await fb.set(path, sheets);
  await updateStagingSession(sessionId, { totalRows: Object.values(sheets).reduce((sum, s) => sum + s.rowCount, 0) });
  return true;
}

export async function getParsedRows(sessionId, sheetName) {
  const path = `${STAGING_PATH}/${sessionId}/sheets`;
  const snap = await fb.get(path);
  if (!snap.exists()) return [];
  const sheets = snap.val();
  if (sheetName) return sheets[sheetName]?.rows || [];
  return Object.values(sheets).flatMap(s => s.rows || []);
}

export async function generateParseReport(sessionId) {
  const session = await getStagingSession(sessionId);
  if (!session) return { error: 'Session not found' };

  const path = `${STAGING_PATH}/${sessionId}/sheets`;
  const snap = await fb.get(path);
  const sheets = snap.exists() ? snap.val() : {};

  const report = {
    sessionId,
    filename: session.filename,
    extension: session.extension,
    status: session.status,
    totalSheets: Object.keys(sheets).length,
    sheetDetails: [],
    totalRows: session.totalRows,
    totalErrors: session.totalErrors,
    warnings: session.warnings || [],
    rowErrors: session.rowErrors || [],
    parsedAt: session.createdAt,
  };

  for (const [name, sheet] of Object.entries(sheets)) {
    report.sheetDetails.push({
      name,
      rowCount: sheet.rowCount,
      sampleRows: sheet.rows.slice(0, 3).map(r => r.data),
    });
  }

  return report;
}

// New commitStagingSession function to replace the old one
// This version actually applies roster data (users, enrollments, groups)
export async function commitStagingSession(sessionId, userId, { mapping, hash } = {}) {
  const session = await getStagingSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found' };
  if (session.status !== 'staging' && session.status !== 'reviewed') {
    return { ok: false, error: `Session cannot be committed (status: ${session.status})` };
  }

  // ── Idempotency check: if same hash already committed, reject ──
  if (hash && session.lastCommittedHash === hash) {
    return { ok: false, error: 'Duplicate commit: this roster file has already been committed (hash match)' };
  }

  // ── Load mapping ──
  const { loadColumnMapping } = await import('./mapper.js');
  const savedMapping = await loadColumnMapping(sessionId);
  if (!savedMapping || !savedMapping.mapping) {
    return { ok: false, error: 'No column mapping found. POST /map first.' };
  }
  const effectiveMapping = mapping || savedMapping.mapping;

  // ── Load parsed rows ──
  const sheetsSnap = await fb.get(STAGING_PATH + '/' + sessionId + '/sheets');
  const sheets = sheetsSnap.exists() ? sheetsSnap.val() : {};
  const rows = Object.values(sheets).flatMap(s => s.rows || []);
  if (!rows || rows.length === 0) {
    return { ok: false, error: 'No parsed rows found. Upload a file first.' };
  }

  // ── Save pre-commit snapshot for rollback ──
  const snapshot = {
    committedAt: Date.now(),
    committedBy: userId,
    previousState: {
      users: await fb.get('users').then(s => s.exists() ? s.val() : {}),
      enrollments: await fb.get('enrollments').then(s => s.exists() ? s.val() : {}),
      groups: await fb.get('groups').then(s => s.exists() ? s.val() : {}),
    },
    hash,
  };

  // ── Generate diff ──
  const { generateDiff } = await import('./mapper.js');
  const existingState = {
    users: snapshot.previousState.users,
    enrollments: snapshot.previousState.enrollments,
    groups: snapshot.previousState.groups,
  };
  const diff = generateDiff(rows, effectiveMapping, existingState);

  const stats = { created: 0, updated: 0, deactivated: 0, unchanged: 0, errors: 0 };

  // Apply creates (new users + enrollments)
  for (const item of diff.creates) {
    if (item.type !== 'create') continue;
    const key = item.identity?.primary || item.data?.student_id || 'row-' + item.rowIndex;
    try {
      if (item.entity === 'user' && !existingState.users[key]) {
        await fb.set('users/' + key, {
          id: key,
          username: item.data.student_id || key,
          displayName: item.data.name || item.data.full_name || '',
          email: item.data.email || '',
          role: 'student',
          createdAt: Date.now(),
          source: 'roster',
        });
        stats.created++;
      }

      if (item.entity === 'enrollment') {
        const enrollmentKey = key + '_' + (item.data.course_code || 'unknown');
        if (!existingState.enrollments[enrollmentKey]) {
          await fb.set('enrollments/' + enrollmentKey, {
            id: enrollmentKey,
            userId: key,
            courseCode: item.data.course_code || '',
            termCode: item.data.term || '',
            groupCode: item.data.group || '',
            status: 'active',
            source: 'roster',
            createdAt: Date.now(),
          });
          stats.created++;
        } else {
          stats.unchanged++;
        }
      }
    } catch (err) {
      await addRowError(sessionId, item.rowIndex || 0, 'commit', err.message);
      stats.errors++;
    }
  }

  // Apply updates (existing users)
  for (const item of diff.updates) {
    try {
      const key = item.identity?.primary;
      if (!key) continue;
      const existing = existingState.users[key];
      if (existing) {
        await fb.set('users/' + key + '/displayName', item.data.name || item.data.full_name || existing.displayName);
        await fb.set('users/' + key + '/email', item.data.email || existing.email);
        stats.updated++;
      }
    } catch (err) {
      await addRowError(sessionId, item.rowIndex || 0, 'commit-update', err.message);
      stats.errors++;
    }
  }

  // Apply deactivations (mark as inactive, not hard-delete)
  for (const item of diff.deactivates) {
    try {
      const key = item.identity?.primary;
      if (!key) continue;
      const existing = existingState.users[key];
      if (existing) {
        await fb.set('users/' + key + '/status', 'inactive');
        await fb.set('users/' + key + '/deactivatedAt', Date.now());
        stats.deactivated++;
      }
    } catch (err) {
      await addRowError(sessionId, item.rowIndex || 0, 'commit-deactivate', err.message);
      stats.errors++;
    }
  }

  // ── Mark as committed ──
  await updateStagingSession(sessionId, {
    status: 'committed',
    committedAt: Date.now(),
    committedBy: userId,
    lastCommittedHash: hash || session.lastCommittedHash || null,
    commitStats: stats,
    snapshot,
  });

  await audit({
    action: AUDIT_ACTIONS.ROSTER_COMMIT,
    userId,
    resourceType: 'roster_staging',
    resourceId: sessionId,
    details: { filename: session.filename, totalRows: session.totalRows, stats, committedAt: Date.now() },
  });

  return { ok: true, stats };
}

export async function rollbackStagingSession(sessionId) {
  const session = await getStagingSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found' };
  if (session.status !== 'committed') {
    return { ok: false, error: `Session cannot be rolled back (status: ${session.status})` };
  }
  if (!session.snapshot) {
    return { ok: false, error: 'No rollback snapshot available for this session' };
  }

  try {
    // Restore previous state
    const { previousState } = session.snapshot;
    if (previousState.users) await fb.set('users', previousState.users);
    if (previousState.enrollments) await fb.set('enrollments', previousState.enrollments);
    if (previousState.groups) await fb.set('groups', previousState.groups);

    // Mark session as rolled back
    await updateStagingSession(sessionId, {
      status: 'rolled_back',
      rollbackAt: Date.now(),
      snapshot: null, // Clear snapshot to prevent double rollback
    });

    await audit({
      action: AUDIT_ACTIONS.ROSTER_DELETE,
      resourceType: 'roster_staging',
      resourceId: sessionId,
      details: { filename: session.filename, type: 'rollback' },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Rollback failed: ${err.message}` };
  }
}

/**
 * Export row-level errors as a downloadable JSON array.
 *
 * @param {string} sessionId
 * @returns {Promise<Object>} { errors: Array, totalErrors: number }
 */
export async function exportRowErrors(sessionId) {
  const session = await getStagingSession(sessionId);
  if (!session) return { error: 'Session not found' };

  const path = `${STAGING_PATH}/${sessionId}/rowErrors`;
  const snap = await fb.get(path);
  const errors = snap.exists() ? snap.val() : [];

  return {
    sessionId,
    filename: session.filename,
    totalErrors: errors.length,
    errors,
  };
}

/**
 * Set admin approval status for a staging session.
 *
 * @param {string} sessionId
 * @param {boolean} approved
 * @param {string} approvedBy
 * @returns {Promise<boolean>}
 */
export async function setSessionApproval(sessionId, approved, approvedBy) {
  await updateStagingSession(sessionId, {
    approved,
    approvedBy,
    approvedAt: Date.now(),
    status: approved ? 'reviewed' : 'staging',
  });
  return true;
}

export async function deleteStagingSession(sessionId) {
  const session = await getStagingSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found' };

  await fb.remove(`${STAGING_PATH}/${sessionId}`);

  await audit({
    action: AUDIT_ACTIONS.ROSTER_DELETE,
    resourceType: 'roster_staging',
    resourceId: sessionId,
    details: { filename: session.filename },
  });

  return { ok: true };
}
