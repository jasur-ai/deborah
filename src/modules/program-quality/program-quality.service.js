/**
 * Edikit — Program Quality & Accreditation Workspace (service)
 *
 * Prompt 62 — curriculum map (I/R/M/A), aggregate evidence (direct/indirect),
 * finding, improvement action (owner/deadline/evidence-required close) va
 * accreditation export (manifest/hash).
 *
 * Workflow (research.md §56): institution outcomes → program outcomes →
 * course outcomes → I/R/M/A → assessment points → aggregate evidence →
 * benchmark/target → finding → improvement action → next-cycle verification.
 *
 * SECURITY / DATA GUARD (Prompt 62 §15, §56.5):
 *   - Teacher punishment leaderboard yo'q (assertNoTeacherLeaderboard).
 *   - Raw PII aggregate UIga chiqmaydi (assertNoRawPiiInAggregate).
 *   - Har write path tenant-scoped + idempotent + audited.
 *   - Action owner/deadline/evidence'siz close bo'lmaydi (close blocker).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  IRMA_LEVELS,
  MAP_STATUS,
  MAP_TRANSITIONS,
  FINDING_STATUS,
  ACTION_STATUS,
  EVIDENCE_TYPES,
  computeCurriculumGaps,
  applyCellSuppression,
  assertNoTeacherLeaderboard,
  assertNoRawPiiInAggregate,
  evaluateFinding,
  assertFindingTransition,
  assertActionTransition,
  assertActionClose,
  assertFollowUpDecision,
  buildExportManifest,
  verifyExportManifest,
  DEFAULT_MIN_CELL_SIZE,
} from './program-quality.schema.js';

/** jsonb maydonlarni string (fake DB) / object (real PG) ikkalasida ham object qiladi. */
function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/**
 * Tenant scope — context yo'q bo'lsa null qaytaradi (fail-closed).
 * hech qachon default tenant'ga (1) yozmaydi — cross-tenant data leak
 * oldini oladi (credential module bilan bir xil pattern).
 */
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
// CURRICULUM MAP (versioned)
// ═══════════════════════════════════════════════════════════════════

/** Create a curriculum map (draft) — unique tenant+name+version. */
export async function createCurriculumMap({ name = '', frameworkId = null, term = null, version = 'v1', createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!name) return { ok: false, error: 'name is required' };

  const existing = await db
    .selectFrom('curriculum_maps')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('name', '=', name)
    .where('version', '=', version)
    .executeTakeFirst();
  if (existing) return { ok: false, error: `curriculum map ${name}@${version} already exists` };

  const row = await db
    .insertInto('curriculum_maps')
    .values({ tenant_id: tenantId, name, framework_id: frameworkId, term, version, status: MAP_STATUS.DRAFT, created_by: createdBy })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, mapId: row.id, version };
}

/** List maps (tenant-scoped). */
export async function listCurriculumMaps({ status = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('curriculum_maps').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('created_at', 'desc').execute();
}

/** Get one map with its entries + computed gaps. */
export async function getCurriculumMap({ mapId = 0 } = {}) {
  const db = getDb();
  if (!db) return null;
  const t = requireTenant();
  if (!t.ok) return null; // route 404 contract: null = topilmadi
  const tenantId = t.tenantId;
  const map = await db
    .selectFrom('curriculum_maps')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', mapId)
    .executeTakeFirst();
  if (!map) return null;
  const entries = await db
    .selectFrom('curriculum_map_entries')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('map_id', '=', mapId)
    .orderBy('outcome_code', 'asc')
    .execute();
  const outcomes = [...new Map(entries.map((e) => [e.outcome_id, { id: e.outcome_id, code: e.outcome_code, name: e.outcome_name }])).values()];
  const gaps = computeCurriculumGaps({ outcomes, entries });
  return { ...map, entries, gaps };
}

/** Transition map status (draft→review→published→archived). */
export async function transitionMapStatus({ mapId = 0, to = '', actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  const map = await db
    .selectFrom('curriculum_maps')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', mapId)
    .executeTakeFirst();
  if (!map) return { ok: false, error: 'curriculum map not found' };
  if (!Object.values(MAP_STATUS).includes(to)) return { ok: false, error: `invalid status: ${to}` };
  // FSM: draft→review→published→archived (version history)
  const allowed = MAP_TRANSITIONS[map.status] || [];
  if (!allowed.includes(to)) return { ok: false, error: `invalid map transition ${map.status} -> ${to}` };

  await db
    .updateTable('curriculum_maps')
    .set({ status: to, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', mapId)
    .execute();

  if (to === MAP_STATUS.PUBLISHED) {
    await audit({
      action: AUDIT_ACTIONS.PROGRAM_QUALITY_MAP_PUBLISH,
      userId: actorId,
      tenantId,
      resourceType: 'curriculum_map',
      resourceId: String(mapId),
      details: { name: map.name, version: map.version },
    });
  }
  return { ok: true, mapId, status: to };
}

// ═══════════════════════════════════════════════════════════════════
// CURRICULUM MAP ENTRIES (course ↔ outcome, I/R/M/A)
// ═══════════════════════════════════════════════════════════════════

/** Map a course↔outcome with I/R/M/A level (upsert, idempotent). */
export async function mapCourseOutcome({
  mapId = 0,
  courseId = 0,
  courseCode = '',
  courseName = '',
  outcomeId = 0,
  outcomeCode = '',
  outcomeName = '',
  irmaLevel = 'introduced',
  assessmentPoints = 0,
  createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!IRMA_LEVELS.includes(irmaLevel)) return { ok: false, error: `invalid IRMA level: ${irmaLevel}` };
  if (!courseId || !outcomeId) return { ok: false, error: 'courseId and outcomeId are required' };

  const map = await db
    .selectFrom('curriculum_maps')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', mapId)
    .executeTakeFirst();
  if (!map) return { ok: false, error: 'curriculum map not found' };
  if (map.status !== MAP_STATUS.DRAFT && map.status !== MAP_STATUS.REVIEW) {
    return { ok: false, error: `cannot edit map in ${map.status} state — publish a new version` };
  }

  const existing = await db
    .selectFrom('curriculum_map_entries')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('map_id', '=', mapId)
    .where('course_id', '=', courseId)
    .where('outcome_id', '=', outcomeId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('curriculum_map_entries')
      .set({ irma_level: irmaLevel, assessment_points: Number(assessmentPoints) || 0, course_code: courseCode, course_name: courseName, outcome_code: outcomeCode, outcome_name: outcomeName })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', existing.id)
      .execute();
    return { ok: true, entryId: existing.id, updated: true };
  }

  const row = await db
    .insertInto('curriculum_map_entries')
    .values({
      tenant_id: tenantId, map_id: mapId, course_id: courseId, course_code: courseCode,
      course_name: courseName, outcome_id: outcomeId, outcome_code: outcomeCode,
      outcome_name: outcomeName, irma_level: irmaLevel, assessment_points: Number(assessmentPoints) || 0,
    })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, entryId: row.id, updated: false };
}

// ═══════════════════════════════════════════════════════════════════
// EVIDENCE AGGREGATION (direct/indirect + suppression)
// ═══════════════════════════════════════════════════════════════════

/**
 * Add an aggregate evidence cell. Security:
 *   - teacher leaderboard yo'q;
 *   - raw PII aggregate'ga chiqmaydi (faqat anonymized meta);
 *   - sample_size < min_cell_size → observed_pct suppressed (null).
 */
export async function addEvidenceAggregation({
  mapId = 0,
  outcomeId = 0,
  outcomeCode = '',
  term = '',
  evidenceType = 'direct',
  method = '',
  sampleSize = 0,
  minCellSize = DEFAULT_MIN_CELL_SIZE,
  observedPct = null,
  benchmarkTargetPct = null,
  aggregateMeta = {},
  createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!EVIDENCE_TYPES.includes(evidenceType)) return { ok: false, error: `invalid evidence type: ${evidenceType}` };
  if (!outcomeId) return { ok: false, error: 'outcomeId is required' };

  // Guard: teacher leaderboard yo'q
  const lb = assertNoTeacherLeaderboard({ includeTeacherRanking: aggregateMeta?.includeTeacherRanking, teacherId: aggregateMeta?.teacherId });
  if (!lb.ok) return { ok: false, error: lb.reason };

  // Guard: raw PII aggregate'ga chiqmaydi
  const pii = assertNoRawPiiInAggregate({ payload: { aggregateMeta } });
  if (!pii.ok) return { ok: false, error: pii.reason };

  // Minimum cell suppression
  const cell = applyCellSuppression({ observedPct, sampleSize, minCellSize });

  const row = await db
    .insertInto('evidence_aggregations')
    .values({
      tenant_id: tenantId, map_id: mapId, outcome_id: outcomeId, outcome_code: outcomeCode,
      term, evidence_type: evidenceType, method, sample_size: Number(sampleSize) || 0,
      min_cell_size: Number(minCellSize) || DEFAULT_MIN_CELL_SIZE,
      observed_pct: cell.observedPct, benchmark_target_pct: benchmarkTargetPct,
      is_suppressed: cell.suppressed, aggregate_meta: JSON.stringify(aggregateMeta || {}),
      created_by: createdBy,
    })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, aggregationId: row.id, suppressed: cell.suppressed, observedPct: cell.observedPct };
}

/** List evidence aggregations (suppressed cells show null observed_pct). */
export async function listEvidenceAggregations({ mapId = 0, outcomeId = null, includeSuppressed = true } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('evidence_aggregations').selectAll().where('tenant_id', '=', tenantId);
  if (mapId) q = q.where('map_id', '=', mapId);
  if (outcomeId) q = q.where('outcome_id', '=', outcomeId);
  const rows = await q.orderBy('created_at', 'desc').execute();
  return rows
    .filter((r) => includeSuppressed || !r.is_suppressed)
    .map((r) => ({ ...r, aggregate_meta: parseJson(r.aggregate_meta) || {} }));
}

// ═══════════════════════════════════════════════════════════════════
// FINDING
// ═══════════════════════════════════════════════════════════════════

/** Create a finding (target vs observed gap). */
export async function createFinding({
  mapId = 0, outcomeId = 0, outcomeCode = '', title = '',
  targetPct = 0, observedPct = null, reviewNotes = '', createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!title || !outcomeId) return { ok: false, error: 'title and outcomeId are required' };

  const evalResult = evaluateFinding({ targetPct, observedPct });
  const row = await db
    .insertInto('program_findings')
    .values({
      tenant_id: tenantId, map_id: mapId, outcome_id: outcomeId, outcome_code: outcomeCode,
      title, target_pct: Number(targetPct), observed_pct: observedPct === null ? null : Number(observedPct),
      review_notes: reviewNotes, status: FINDING_STATUS.OPEN, created_by: createdBy,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.PROGRAM_QUALITY_FINDING_CREATE,
    userId: createdBy,
    tenantId,
    resourceType: 'program_finding',
    resourceId: String(row.id),
    details: { outcomeCode, targetPct, observedPct, verdict: evalResult.verdict },
  });
  return { ok: true, findingId: row.id, gap: evalResult.gapPct, verdict: evalResult.verdict };
}

/** Transition finding status (open→in_progress→resolved). */
export async function transitionFindingStatus({ findingId = 0, to = '', actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  const f = await db
    .selectFrom('program_findings')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', findingId)
    .executeTakeFirst();
  if (!f) return { ok: false, error: 'finding not found' };
  const trans = assertFindingTransition({ from: f.status, to });
  if (!trans.ok) return { ok: false, error: trans.reason };

  await db
    .updateTable('program_findings')
    .set({ status: to, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', findingId)
    .execute();
  if (to === FINDING_STATUS.RESOLVED) {
    await audit({
      action: AUDIT_ACTIONS.PROGRAM_QUALITY_FINDING_RESOLVE,
      userId: actorId,
      tenantId,
      resourceType: 'program_finding',
      resourceId: String(findingId),
      details: { outcomeCode: f.outcome_code },
    });
  }
  return { ok: true, findingId, status: to };
}

/** List findings for a map. */
export async function listFindings({ mapId = 0, status = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('program_findings').selectAll().where('tenant_id', '=', tenantId);
  if (mapId) q = q.where('map_id', '=', mapId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('created_at', 'desc').execute();
}

// ═══════════════════════════════════════════════════════════════════
// IMPROVEMENT ACTION (owner/deadline, close blocker)
// ═══════════════════════════════════════════════════════════════════

/** Create an improvement action for a finding. */
export async function createImprovementAction({ findingId = 0, title = '', owner = '', deadline = null, createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!title || !owner) return { ok: false, error: 'title and owner are required' };
  if (!deadline) return { ok: false, error: 'deadline is required' };

  const finding = await db
    .selectFrom('program_findings')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', findingId)
    .executeTakeFirst();
  if (!finding) return { ok: false, error: 'finding not found' };

  const row = await db
    .insertInto('improvement_actions')
    .values({ tenant_id: tenantId, finding_id: findingId, title, owner, deadline: new Date(deadline), status: ACTION_STATUS.OPEN, created_by: createdBy })
    .returning(['id'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.PROGRAM_QUALITY_ACTION_CREATE,
    userId: createdBy,
    tenantId,
    resourceType: 'improvement_action',
    resourceId: String(row.id),
    details: { findingId, owner, deadline },
  });
  return { ok: true, actionId: row.id };
}

/** Transition action status; close faqat verification'dan + evidence bilan. */
export async function transitionActionStatus({ actionId = 0, to = '', actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  const action = await db
    .selectFrom('improvement_actions')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', actionId)
    .executeTakeFirst();
  if (!action) return { ok: false, error: 'action not found' };
  const trans = assertActionTransition({ from: action.status, to });
  if (!trans.ok) return { ok: false, error: trans.reason };

  // Close blocker: evidence'siz close bo'lmaydi
  if (to === ACTION_STATUS.CLOSED) {
    const followUps = await db
      .selectFrom('follow_up_evidence')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('action_id', '=', actionId)
      .execute();
    const close = assertActionClose({ owner: action.owner, deadline: action.deadline, followUpEvidence: followUps });
    if (!close.ok) return { ok: false, error: close.reason };
  }

  await db
    .updateTable('improvement_actions')
    .set({ status: to, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', actionId)
    .execute();

  if (to === ACTION_STATUS.CLOSED) {
    await audit({
      action: AUDIT_ACTIONS.PROGRAM_QUALITY_ACTION_CLOSE,
      userId: actorId,
      tenantId,
      resourceType: 'improvement_action',
      resourceId: String(actionId),
      details: { title: action.title },
    });
  }
  return { ok: true, actionId, status: to };
}

/** Add follow-up evidence (next-cycle verification). */
export async function addFollowUpEvidence({ actionId = 0, cycle = '', evidenceRef = '', decision = '', notes = '', collectedBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  const dec = assertFollowUpDecision({ decision });
  if (!dec.ok) return { ok: false, error: dec.reason };
  if (!evidenceRef) return { ok: false, error: 'evidenceRef is required' };

  const action = await db
    .selectFrom('improvement_actions')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', actionId)
    .executeTakeFirst();
  if (!action) return { ok: false, error: 'action not found' };

  const row = await db
    .insertInto('follow_up_evidence')
    .values({ tenant_id: tenantId, action_id: actionId, cycle, evidence_ref: evidenceRef, decision, notes, collected_by: collectedBy })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, evidenceId: row.id };
}

/** List actions (with follow-up counts) for a finding/map. */
export async function listActions({ findingId = null, actionId = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('improvement_actions').selectAll().where('tenant_id', '=', tenantId);
  if (findingId) q = q.where('finding_id', '=', findingId);
  const rows = await q.orderBy('created_at', 'desc').execute();

  if (actionId) {
    const one = rows.find((r) => r.id === Number(actionId));
    if (!one) return [];
    const followUps = await db
      .selectFrom('follow_up_evidence')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('action_id', '=', actionId)
      .execute();
    return [{ ...one, followUps }];
  }

  // follow-up counts har action uchun
  const withCounts = [];
  for (const a of rows) {
    const followUps = await db
      .selectFrom('follow_up_evidence')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('action_id', '=', a.id)
      .execute();
    withCounts.push({ ...a, followUpCount: followUps.length });
  }
  return withCounts;
}

// ═══════════════════════════════════════════════════════════════════
// ACCREDITATION EXPORT (manifest/hash, reproducible)
// ═══════════════════════════════════════════════════════════════════

/** Create an accreditation export bundle with reproducible manifest hash. */
export async function createAccreditationExport({ mapId = 0, standard = '', standardVersion = '', exportedBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!standard) return { ok: false, error: 'accreditation standard is required' };

  const map = await db
    .selectFrom('curriculum_maps')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', mapId)
    .executeTakeFirst();
  if (!map) return { ok: false, error: 'curriculum map not found' };
  if (map.status !== MAP_STATUS.PUBLISHED) return { ok: false, error: 'export requires a published curriculum map' };

  const findings = await listFindings({ mapId });
  const actions = await listActions();
  // includeSuppressed: true — suppressed cell'lar manifest'da null observedPct +
  // suppressed: true bilan ko'rinadi (sampling metodologiyasi hujjatlanadi).
  const evidence = await listEvidenceAggregations({ mapId, includeSuppressed: true });

  const manifest = buildExportManifest({
    standard, standardVersion, mapName: map.name,
    findings: normalizeFindingsForManifest(findings),
    actions: normalizeActionsForManifest(actions.filter((a) => findings.some((f) => f.id === a.finding_id))),
    evidence: normalizeEvidenceForManifest(evidence),
  });

  const row = await db
    .insertInto('accreditation_exports')
    .values({
      tenant_id: tenantId, map_id: mapId, standard, standard_version: standardVersion,
      manifest: JSON.stringify(manifest.manifest), manifest_hash: manifest.hash, exported_by: exportedBy,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.PROGRAM_QUALITY_EXPORT,
    userId: exportedBy,
    tenantId,
    resourceType: 'accreditation_export',
    resourceId: String(row.id),
    details: { standard, standardVersion, mapName: map.name, hash: manifest.hash.slice(0, 12) },
  });
  return { ok: true, exportId: row.id, manifestHash: manifest.hash, manifest: manifest.manifest };
}

/** List exports. */
export async function listAccreditationExports({ mapId = 0 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('accreditation_exports').selectAll().where('tenant_id', '=', tenantId);
  if (mapId) q = q.where('map_id', '=', mapId);
  const rows = await q.orderBy('created_at', 'desc').execute();
  return rows.map((r) => ({ ...r, manifest: parseJson(r.manifest) || {} }));
}

/** Verify export integrity: stored hash vs freshly recomputed content. */
export async function verifyAccreditationExport({ exportId = 0 } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required', verifiable: false };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error, verifiable: false };
  const tenantId = t.tenantId;
  const row = await db
    .selectFrom('accreditation_exports')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', exportId)
    .executeTakeFirst();
  if (!row) return { ok: false, error: 'export not found', verifiable: false };

  const map = await db
    .selectFrom('curriculum_maps')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', row.map_id)
    .executeTakeFirst();
  const findings = await listFindings({ mapId: row.map_id });
  const actions = await listActions();
  // includeSuppressed: true — create bilan bir xil (reproducible hash uchun).
  const evidence = await listEvidenceAggregations({ mapId: row.map_id, includeSuppressed: true });

  const check = verifyExportManifest({
    expectedHash: row.manifest_hash, standard: row.standard, standardVersion: row.standard_version,
    mapName: map?.name || '',
    findings: normalizeFindingsForManifest(findings),
    actions: normalizeActionsForManifest(actions.filter((a) => findings.some((f) => f.id === a.finding_id))),
    evidence: normalizeEvidenceForManifest(evidence),
  });
  return { ok: check.ok, verifiable: check.matches, matches: check.matches, reason: check.reason };
}

// ── Manifest normalization helpers (snake_case DB rows → camelCase) ──

function normalizeFindingsForManifest(findings) {
  return (findings || []).map((f) => ({
    id: f.id,
    outcomeCode: f.outcome_code,
    title: f.title,
    targetPct: f.target_pct === null || f.target_pct === undefined ? null : Number(f.target_pct),
    observedPct: f.observed_pct === null || f.observed_pct === undefined ? null : Number(f.observed_pct),
    status: f.status,
  }));
}

function normalizeActionsForManifest(actions) {
  return (actions || []).map((a) => ({
    id: a.id,
    findingId: a.finding_id,
    title: a.title,
    owner: a.owner,
    status: a.status,
    followUpCount: a.followUpCount ?? 0,
  }));
}

function normalizeEvidenceForManifest(evidence) {
  return (evidence || []).map((e) => ({
    id: e.id,
    outcomeCode: e.outcome_code,
    evidenceType: e.evidence_type,
    sampleSize: e.sample_size,
    observedPct: e.observed_pct === null || e.observed_pct === undefined ? null : Number(e.observed_pct),
    isSuppressed: Boolean(e.is_suppressed),
  }));
}
