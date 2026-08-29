/**
 * Deborah — Roster Staging Area
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
import { safeKey } from '../../../utils/helpers.js';

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
const commitLocks = new Map();

// Per-session mutex (AUTH A-11 §10): parallel commit race — ikki request ham
// status='staging' o'qib, ikkalasi ham user/enrollment yozmasligi uchun.
// (invites.js acceptInvite dagi per-token mutex namunasi)
export async function commitStagingSession(sessionId, userId, opts = {}) {
  const prev = commitLocks.get(sessionId);
  const run = (prev || Promise.resolve()).then(() => _commitStagingSessionUnlocked(sessionId, userId, opts));
  commitLocks.set(sessionId, run);
  try {
    return await run;
  } finally {
    commitLocks.delete(sessionId);
  }
}

async function _commitStagingSessionUnlocked(sessionId, userId, { mapping, hash } = {}) {
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

  const stats = { created: 0, createdUsers: 0, createdEnrollments: 0, updated: 0, deactivated: 0, unchanged: 0, errors: 0 };

  // ── Apply creates (new users + enrollments) — AUTH A-11 §10 fix ──
  // Eski kod `item.entity === 'user'` tekshirardi — diff item'larida
  // `entity` field'i YO'Q (faqat `type: 'create' | 'enroll'`), shuning
  // uchun commit hech qanday user/enrollment YOZMAS edi (testlar faqat
  // status'ni tekshirgani uchun sezilmagan). Endi:
  //   create → user (auth schema) + enrollment + guruh
  //   enroll → faqat enrollment (user allaqachon mavjud)
  for (const item of diff.creates) {
    try {
      // diff item'larida `identity` STRING (identity.primary qiymati) — object emas!
      const idKey = item.identity || '';
      const userKey = idKey ? safeKey(idKey) : `row-${item.rowIndex}`;
      const courseCode = item.enrollment?.courseCode || '';
      const groupName = item.group?.groupName || '';

      // 1) User (faqat type 'create' — mavjud bo'lmasa)
      if (item.type === 'create' && !existingState.users[userKey]) {
        await fb.set(`users/${userKey}`, {
          username: item.data?.username || idKey || userKey,
          password: '',                    // parol invite aktivatsiyasida beriladi (A-11 §13)
          created_at: Date.now(),
          safeKey: userKey,
          isVip: false,
          display_name: item.data?.displayName || '',
          email: item.data?.email || '',
          role: 'student',
          source: 'roster',
          group: groupName,               // guruh prefilled — invite aktivatsiyasida
        });
        stats.created++;
        stats.createdUsers++;
      }

      // 2) Enrollment (create ham, enroll ham)
      const enrollmentKey = `${userKey}_${courseCode}`;
      if (courseCode && !existingState.enrollments[enrollmentKey]) {
        await fb.set(`enrollments/${enrollmentKey}`, {
          id: enrollmentKey,
          userId: userKey,
          courseCode,
          termCode: item.enrollment?.termCode || '',
          groupCode: groupName,
          status: 'active',
          source: 'roster',
          created_at: Date.now(),
        });
        stats.created++;
        stats.createdEnrollments++;
      } else if (courseCode && existingState.enrollments[enrollmentKey]) {
        stats.unchanged++;
      }

      // 3) Guruh (mavjud bo'lmasa yoziladi)
      if (groupName && !existingState.groups[safeKey(groupName)]) {
        await fb.set(`groups/${safeKey(groupName)}`, {
          name: groupName,
          code: safeKey(groupName),
          created_at: Date.now(),
          source: 'roster',
        });
      }
    } catch (err) {
      await addRowError(sessionId, item.rowIndex || 0, 'commit', err.message);
      stats.errors++;
    }
  }

  // ── Apply updates (enrollment changes) — A-11 review fix ──
  // diff update item'larida `.data` YO'Q — `changes` massivi bor
  // (detectChanges: groupName/section/status enrollment fieldlari).
  for (const item of diff.updates) {
    try {
      const key = item.identity;
      if (!key || !item.enrollmentId) continue;
      for (const ch of item.changes || []) {
        await fb.set(`enrollments/${item.enrollmentId}/${ch.field}`, ch.newValue);
      }
      stats.updated++;
    } catch (err) {
      await addRowError(sessionId, item.rowIndex || 0, 'commit-update', err.message);
      stats.errors++;
    }
  }

  // ── Apply deactivations (mark as inactive, not hard-delete) ──
  for (const item of diff.deactivates) {
    try {
      const key = item.identity;
      if (!key) continue;
      const userKey = safeKey(key);
      const existing = existingState.users[userKey];
      if (existing) {
        await fb.set(`users/${userKey}/status`, 'inactive');
        await fb.set(`users/${userKey}/deactivated_at`, Date.now());
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

/**
 * Expired staging sessiyalarni tozalaydi (A-10 §26 — 24 soat retention).
 *
 * Faqat faol (staging/reviewed) va retention muddati o'tgan sessiyalarni
 * o'chiradi; committed/rolled_back holatlar tarix sifatida saqlanadi.
 * Upload paytida opportunistik chaqiriladi (fail-soft).
 *
 * @param {number} [maxAgeMs] - Retention muddati (default 24 soat)
 * @returns {Promise<{ ok: boolean, purged: number }>}
 */
export async function purgeExpiredStagingSessions(maxAgeMs = 24 * 60 * 60 * 1000) {
  const snap = await fb.get(STAGING_PATH);
  if (!snap.exists()) return { ok: true, purged: 0 };

  const all = snap.val();
  const now = Date.now();

  // Expired sessiyalarni yig'ib, parallel tozalaymiz (ko'p sessiya uchun tez)
  const expired = [];
  for (const sid of Object.keys(all)) {
    const s = all[sid] || {};
    const active = s.status === 'staging' || s.status === 'reviewed';
    const ageMs = now - (s.updatedAt || s.createdAt || 0);
    if (active && ageMs > maxAgeMs) expired.push({ sid, ageMs });
  }

  await Promise.all(expired.map(async ({ sid, ageMs }) => {
    await fb.remove(`${STAGING_PATH}/${sid}`);
    await audit({
      action: AUDIT_ACTIONS.ROSTER_DELETE,
      resourceType: 'roster_staging',
      resourceId: sid,
      details: { reason: 'retention_purge', ageMs },
    });
  }));

  return { ok: true, purged: expired.length };
}

/**
 * Row-level status report (A-11 §11).
 * Har qator uchun status: 'ok' | 'error' + sabab (rowErrors dan).
 *
 * @param {string} sessionId
 * @returns {Promise<Object>} { rows: [{ rowIndex, sheet, status, errors }], summary }
 */
export async function buildRowStatusReport(sessionId) {
  const session = await getStagingSession(sessionId);
  if (!session) return { error: 'Session not found' };

  const sheetsSnap = await fb.get(`${STAGING_PATH}/${sessionId}/sheets`);
  const sheets = sheetsSnap.exists() ? sheetsSnap.val() : {};
  const errorsByRow = new Map();
  for (const e of session.rowErrors || []) {
    if (!errorsByRow.has(e.rowIndex)) errorsByRow.set(e.rowIndex, []);
    errorsByRow.get(e.rowIndex).push(e);
  }

  const rows = [];
  let okCount = 0;
  let errorCount = 0;
  for (const [sheetName, sheet] of Object.entries(sheets)) {
    for (const row of sheet.rows || []) {
      const errs = errorsByRow.get(row.rowIndex) || [];
      const status = errs.length > 0 ? 'error' : 'ok';
      if (errs.length > 0) errorCount++; else okCount++;
      rows.push({
        rowIndex: row.rowIndex,
        sheet: sheetName,
        status,
        errors: errs.map(e => ({ field: e.field, message: e.message })),
      });
    }
  }

  return {
    sessionId,
    rows,
    summary: { total: rows.length, ok: okCount, error: errorCount },
  };
}

/**
 * Reconciliation (A-11 §29) — commit'dan keyin count tekshirish.
 * Commit natijasini DB'dagi haqiqiy yozuvlar bilan solishtiradi.
 *
 * @param {string} sessionId
 * @returns {Promise<Object>} { expected, actual, matched }
 */
export async function reconcileSession(sessionId) {
  const session = await getStagingSession(sessionId);
  if (!session) return { error: 'Session not found' };

  const stats = session.commitStats || {};
  const usersSnap = await fb.get('users');
  const enrollSnap = await fb.get('enrollments');
  const users = usersSnap.exists() ? usersSnap.val() : {};
  const enrollments = enrollSnap.exists() ? enrollSnap.val() : {};

  // Roster commit'dan yozilgan yozuvlar soni (source: 'roster')
  let rosterUsers = 0;
  let rosterEnrollments = 0;
  for (const u of Object.values(users)) if (u.source === 'roster') rosterUsers++;
  for (const e of Object.values(enrollments)) if (e.source === 'roster') rosterEnrollments++;

  // AUTH A-11 §29: user va enrollment alohida hisoblanadi (created aralash edi)
  const expectedUsers = stats.createdUsers ?? 0;
  const expectedEnrollments = stats.createdEnrollments ?? 0;
  const matchedUsers = rosterUsers >= expectedUsers - stats.errors;
  const matchedEnrollments = rosterEnrollments >= expectedEnrollments - stats.errors;
  const matched = matchedUsers && matchedEnrollments;

  return {
    sessionId,
    status: session.status,
    expected: { users: expectedUsers, enrollments: expectedEnrollments },
    actual: { users: rosterUsers, enrollments: rosterEnrollments },
    matched,
    note: matched ? 'reconciled' : 'mismatch — rollback tavsiya etiladi',
  };
}
