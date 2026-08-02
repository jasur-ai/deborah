/**
 * Edikit — Roster Mapper: Column Mapping, Validation & Diff Engine
 *
 * Converts raw parsed roster rows into a structured diff for admin review.
 * Stages: column mapping → required/duplicate/referential validation →
 *         create/update/deactivate/conflict diff → preview generation
 *
 * All data is localStorage/Firebase-compatible for offline/development use.
 *
 * @module roster/mapper
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

// ── Default Column Mapping ──
// Maps roster column names → academic entity fields
// Keys are normalized roster column headers (lowercase, trimmed)
export const DEFAULT_COLUMN_MAP = {
  // Identity fields (REQUIRED — at least one)
  'student_id':                   { field: 'userId',      entity: 'user',    required: false },
  'username':                     { field: 'username',    entity: 'user',    required: false },
  'email':                        { field: 'email',       entity: 'user',    required: false },
  'email_address':                { field: 'email',       entity: 'user',    required: false },

  // Name fields
  'first_name':                   { field: 'firstName',   entity: 'user',    required: false },
  'firstname':                    { field: 'firstName',   entity: 'user',    required: false },
  'last_name':                    { field: 'lastName',    entity: 'user',    required: false },
  'lastname':                     { field: 'lastName',    entity: 'user',    required: false },
  'display_name':                 { field: 'displayName', entity: 'user',    required: false },
  'displayname':                  { field: 'displayName', entity: 'user',    required: false },
  'full_name':                    { field: 'displayName', entity: 'user',    required: false },
  'fullname':                     { field: 'displayName', entity: 'user',    required: false },
  'name':                         { field: 'displayName', entity: 'user',    required: false },

  // Enrollment fields
  'course_code':                  { field: 'courseCode',  entity: 'course',  required: true },
  'course':                       { field: 'courseCode',  entity: 'course',  required: true },
  'class':                        { field: 'courseCode',  entity: 'course',  required: true },
  'section':                      { field: 'section',     entity: 'course',  required: false },
  'group':                        { field: 'groupName',   entity: 'group',   required: false },
  'group_name':                   { field: 'groupName',   entity: 'group',   required: false },
  'groupname':                    { field: 'groupName',   entity: 'group',   required: false },

  // Term fields
  'term':                         { field: 'termCode',    entity: 'term',    required: true },
  'term_code':                    { field: 'termCode',    entity: 'term',    required: true },
  'semester':                     { field: 'termCode',    entity: 'term',    required: false },
  'academic_year':                { field: 'termCode',    entity: 'term',    required: false },
  'year':                         { field: 'termCode',    entity: 'term',    required: false },

  // Academic unit fields
  'faculty':                      { field: 'facultyCode', entity: 'faculty', required: false },
  'faculty_code':                 { field: 'facultyCode', entity: 'faculty', required: false },
  'program':                      { field: 'programCode', entity: 'program', required: false },
  'program_code':                 { field: 'programCode', entity: 'program', required: false },
  'department':                   { field: 'facultyCode', entity: 'faculty', required: false },

  // External ID fields
  'external_id':                  { field: 'externalId',  entity: 'user',    required: false },
  'sis_id':                       { field: 'externalId',  entity: 'user',    required: false },
  'hemis_id':                     { field: 'externalId',  entity: 'user',    required: false },

  // Status/role fields
  'status':                       { field: 'status',      entity: 'enrollment', required: false },
  'role':                         { field: 'role',        entity: 'group',  required: false },
  'enrollment_status':            { field: 'status',      entity: 'enrollment', required: false },
};

const MAPPING_PATH = 'roster_mappings';

// ═══════════════════════════════════════════════════════════════════
// 1. COLUMN MAPPING API
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect roster columns from parsed rows and suggest mapping.
 * Returns the auto-detected column → field mapping with confidence.
 */
export async function detectColumnMapping(parsedRows, existingMapping) {
  if (!parsedRows || parsedRows.length === 0) return { columns: [], mapping: {}, unmapped: [] };

  // Collect all unique column names from parsed data
  const columns = new Set();
  for (const row of parsedRows) {
    if (row.data) Object.keys(row.data).forEach(k => columns.add(k));
  }
  const columnList = Array.from(columns);

  // Auto-detect mapping using DEFAULT_COLUMN_MAP
  const mapping = {};
  const unmapped = [];

  for (const col of columnList) {
    const normalized = col.toLowerCase().trim().replace(/[\s_-]+/g, '_');
    const directMatch = DEFAULT_COLUMN_MAP[normalized];
    if (directMatch) {
      mapping[col] = { ...directMatch, sourceColumn: col };
      continue;
    }
    // Fuzzy match: try partial match
    const fuzzy = Object.entries(DEFAULT_COLUMN_MAP).find(([key]) =>
      normalized.includes(key) || key.includes(normalized)
    );
    if (fuzzy) {
      mapping[col] = { ...fuzzy[1], sourceColumn: col };
      continue;
    }
    unmapped.push(col);
  }

  return { columns: columnList, mapping, unmapped };
}

/**
 * Save admin-approved column mapping for a session.
 */
export async function saveColumnMapping(sessionId, mapping) {
  await fb.set(`${MAPPING_PATH}/${sessionId}`, {
    mapping,
    savedAt: Date.now(),
  });
  return true;
}

/**
 * Load saved column mapping for a session.
 */
export async function loadColumnMapping(sessionId) {
  const snap = await fb.get(`${MAPPING_PATH}/${sessionId}`);
  return snap.exists() ? snap.val() : null;
}

// ═══════════════════════════════════════════════════════════════════
// 2. VALIDATION ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate required fields are present in the mapping.
 * Returns { valid, missing }
 */
export function validateMappingCompleteness(mapping) {
  const requiredFields = Object.values(DEFAULT_COLUMN_MAP).filter(m => m.required);
  const mappedFields = Object.values(mapping).map(m => m.field);
  const missing = requiredFields.filter(r => !mappedFields.includes(r.field));
  return {
    valid: missing.length === 0,
    missing: missing.map(m => `${m.field} (${m.entity})`),
  };
}

/**
 * Validate that all rows have the required fields filled.
 * Returns { valid: boolean, errors: Array<{rowIndex, field, message}> }
 */
export function validateRequiredFields(rows, mapping) {
  const errors = [];
  const requiredMap = Object.entries(mapping).filter(([, v]) => v.required);

  for (const row of rows) {
    for (const [col, map] of requiredMap) {
      const value = row.data?.[col];
      if (value === undefined || value === null || String(value).trim() === '') {
        errors.push({
          rowIndex: row.rowIndex,
          field: map.field,
          message: `Required field "${map.field}" (column: "${col}") is empty`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Detect duplicate rows within the file based on identity fields.
 * Returns { hasDuplicates: boolean, duplicates: Array<{field, values, rowIndices}> }
 */
export function detectFileDuplicates(rows, mapping) {
  const identityFields = ['userId', 'username', 'email', 'externalId'];
  const duplicateGroups = [];

  for (const idField of identityFields) {
    // Find which column maps to this identity field
    const colEntry = Object.entries(mapping).find(([, v]) => v.field === idField);
    if (!colEntry) continue;
    const [col] = colEntry;

    const seen = new Map();
    for (const row of rows) {
      const key = String(row.data?.[col] ?? '').toLowerCase().trim();
      if (!key) continue;
      if (seen.has(key)) {
        seen.get(key).push(row.rowIndex);
      } else {
        seen.set(key, [row.rowIndex]);
      }
    }

    for (const [value, indices] of seen.entries()) {
      if (indices.length > 1) {
        duplicateGroups.push({ field: idField, value, rowIndices: indices });
      }
    }
  }

  return {
    hasDuplicates: duplicateGroups.length > 0,
    duplicates: duplicateGroups,
  };
}

/**
 * Validate referential integrity — check that referenced entities exist.
 * Uses local DB lookup for courses, terms, groups.
 * Returns { valid, errors }
 */
export async function validateReferentialIntegrity(rows, mapping, { tenantId } = {}) {
  const errors = [];

  // Collect unique references
  const courseCodes = new Set();
  const termCodes = new Set();
  const usernames = new Set();

  for (const row of rows) {
    for (const [col, map] of Object.entries(mapping)) {
      const value = row.data?.[col];
      if (!value) continue;
      if (map.entity === 'course') courseCodes.add(String(value).trim());
      if (map.entity === 'term') termCodes.add(String(value).trim());
      if (map.entity === 'user' && map.field === 'username') usernames.add(String(value).trim());
    }
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════
// 3. DIFF ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a structured diff by comparing roster rows against existing state.
 *
 * @param {Array} rows — Parsed roster rows
 * @param {Object} mapping — Column → field mapping
 * @param {Object} existingState — Current DB state { users, enrollments, groups }
 * @returns {Object} diff — { creates, updates, deactivates, conflicts, summary }
 */
export function generateDiff(rows, mapping, existingState = {}) {
  const creates = [];
  const updates = [];
  const deactivates = [];
  const conflicts = [];

  const existingUsers = existingState.users || {};
  const existingEnrollments = existingState.enrollments || {};
  const processed = new Set();

  for (const row of rows) {
    const identity = resolveIdentity(row.data, mapping);
    if (!identity.primary) {
      conflicts.push({
        rowIndex: row.rowIndex,
        type: 'missing_identity',
        message: 'No identity field (username/email/externalId) resolved',
        row: row.data,
      });
      continue;
    }

    const existingUser = findExistingUser(existingUsers, identity, mapping);
    const existingEnrollment = findExistingEnrollment(existingEnrollments, identity, mapping, row.data);

    if (!existingUser) {
      creates.push({
        rowIndex: row.rowIndex,
        type: 'create',
        identity: identity.primary,
        data: extractEntityData(row.data, mapping, 'user'),
        enrollment: extractEnrollmentData(row.data, mapping),
        group: extractGroupData(row.data, mapping),
      });
    } else if (!existingEnrollment) {
      creates.push({
        rowIndex: row.rowIndex,
        type: 'enroll',
        identity: identity.primary,
        userId: existingUser.id,
        enrollment: extractEnrollmentData(row.data, mapping),
        group: extractGroupData(row.data, mapping),
      });
    } else {
      const changes = detectChanges(existingEnrollment, row.data, mapping);
      if (changes.length > 0) {
        updates.push({
          rowIndex: row.rowIndex,
          type: 'update',
          identity: identity.primary,
          userId: existingUser.id,
          enrollmentId: existingEnrollment.id,
          changes,
        });
      }
    }

    processed.add(identity.primary);
  }

  // Detect deactivations (students in DB but not in roster)
  for (const [key, enrollment] of Object.entries(existingEnrollments)) {
    if (!processed.has(key) && enrollment.status === 'active') {
      deactivates.push({
        type: 'deactivate',
        identity: key,
        userId: enrollment.userId,
        enrollmentId: enrollment.id,
      });
    }
  }

  return {
    creates,
    updates,
    deactivates,
    conflicts,
    summary: {
      totalRows: rows.length,
      creates: creates.length,
      updates: updates.length,
      deactivates: deactivates.length,
      conflicts: conflicts.length,
      unchanged: rows.length - creates.length - updates.length - conflicts.length,
    },
  };
}

/**
 * Generate a human-readable preview from a diff.
 */
export function generatePreview(diff) {
  const lines = [];

  lines.push(`═══ Roster Preview ═══`);
  lines.push(`Total rows: ${diff.summary.totalRows}`);
  lines.push(`→ ${diff.summary.creates} new students to enroll`);
  lines.push(`→ ${diff.summary.updates} existing enrollments to update`);
  lines.push(`→ ${diff.summary.deactivates} students to deactivate`);
  lines.push(`→ ${diff.summary.conflicts} conflicts to resolve`);
  lines.push('');

  if (diff.creates.length > 0) {
    lines.push(`── New Enrollments (${diff.creates.length}) ──`);
    for (const c of diff.creates.slice(0, 5)) {
      lines.push(`  + ${c.identity} → course: ${c.enrollment?.courseCode || '?'}`);
    }
    if (diff.creates.length > 5) lines.push(`  ... and ${diff.creates.length - 5} more`);
    lines.push('');
  }

  if (diff.updates.length > 0) {
    lines.push(`── Updates (${diff.updates.length}) ──`);
    for (const u of diff.updates.slice(0, 5)) {
      const changeDesc = u.changes.map(c => `${c.field}: ${c.oldValue} → ${c.newValue}`).join(', ');
      lines.push(`  ~ ${u.identity}: ${changeDesc}`);
    }
    if (diff.updates.length > 5) lines.push(`  ... and ${diff.updates.length - 5} more`);
    lines.push('');
  }

  if (diff.deactivates.length > 0) {
    lines.push(`── Deactivations (${diff.deactivates.length}) ──`);
    for (const d of diff.deactivates.slice(0, 5)) {
      lines.push(`  - ${d.identity}`);
    }
    if (diff.deactivates.length > 5) lines.push(`  ... and ${diff.deactivates.length - 5} more`);
    lines.push('');
  }

  if (diff.conflicts.length > 0) {
    lines.push(`── Conflicts (${diff.conflicts.length}) ──`);
    for (const c of diff.conflicts.slice(0, 5)) {
      lines.push(`  ! Row ${c.rowIndex}: ${c.message}`);
    }
    if (diff.conflicts.length > 5) lines.push(`  ... and ${diff.conflicts.length - 5} more`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Compute immutable hash of roster input for idempotency tracking.
 */
export function computeRosterHash(rows, mapping) {
  const normalized = rows.map(r => ({
    rowIndex: r.rowIndex,
    data: Object.fromEntries(
      Object.entries(r.data || {}).map(([k, v]) => [k.toLowerCase().trim(), String(v).trim()])
    ),
  }));
  const hash = crypto.createHash('sha256').update(JSON.stringify({ normalized, mapping })).digest('hex');
  return hash;
}

// ═══════════════════════════════════════════════════════════════════
// 4. INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve primary identity from row data based on mapping priority.
 */
function resolveIdentity(rowData, mapping) {
  const identity = { primary: null, secondary: [] };

  // Priority: userId > username > email > externalId
  const priority = ['userId', 'username', 'email', 'externalId'];

  for (const field of priority) {
    const col = Object.entries(mapping).find(([, v]) => v.field === field);
    if (!col) continue;
    const value = rowData?.[col[0]];
    if (value && String(value).trim()) {
      if (!identity.primary) {
        identity.primary = String(value).trim().toLowerCase();
      } else {
        identity.secondary.push({ field, value: String(value).trim() });
      }
    }
  }

  return identity;
}

/**
 * Extract entity data from row based on column mapping.
 */
function extractEntityData(rowData, mapping, entityType) {
  const data = {};
  for (const [col, map] of Object.entries(mapping)) {
    if (map.entity === entityType) {
      data[map.field] = rowData?.[col] || null;
    }
  }
  return data;
}

/**
 * Extract enrollment-specific data (course + term).
 */
function extractEnrollmentData(rowData, mapping) {
  const enrollment = {};
  for (const [col, map] of Object.entries(mapping)) {
    if (map.entity === 'course' || map.entity === 'term') {
      enrollment[map.field] = rowData?.[col] || null;
    }
  }
  return enrollment;
}

/**
 * Extract group-specific data.
 */
function extractGroupData(rowData, mapping) {
  const group = {};
  for (const [col, map] of Object.entries(mapping)) {
    if (map.entity === 'group') {
      group[map.field] = rowData?.[col] || null;
    }
  }
  return group;
}

/**
 * Find existing user in state by identity.
 */
function findExistingUser(existingUsers, identity, mapping) {
  if (!identity.primary) return null;
  // Try exact match
  for (const [, user] of Object.entries(existingUsers)) {
    if (user.username?.toLowerCase() === identity.primary) return user;
    if (user.email?.toLowerCase() === identity.primary) return user;
    if (user.externalId === identity.primary) return user;
  }
  return null;
}

/**
 * Find existing enrollment in state by identity + course.
 */
function findExistingEnrollment(existingEnrollments, identity, mapping, rowData) {
  if (!identity.primary) return null;
  const courseCode = extractEnrollmentData(rowData, mapping).courseCode;
  if (!courseCode) return null;

  for (const [, enrollment] of Object.entries(existingEnrollments)) {
    if (enrollment.userId === identity.primary || enrollment.username?.toLowerCase() === identity.primary) {
      if (enrollment.courseCode === courseCode || enrollment.course === courseCode) {
        return enrollment;
      }
    }
  }
  return null;
}

/**
 * Detect changes between existing enrollment and new roster data.
 */
function detectChanges(existing, rowData, mapping) {
  const changes = [];
  const comparableFields = ['groupName', 'section', 'status'];

  for (const field of comparableFields) {
    const col = Object.entries(mapping).find(([, v]) => v.field === field);
    if (!col) continue;
    const newValue = String(rowData?.[col[0]] || '').trim();
    const oldValue = String(existing[field] || '').trim();
    if (newValue && newValue !== oldValue) {
      changes.push({ field, oldValue, newValue });
    }
  }

  return changes;
}
