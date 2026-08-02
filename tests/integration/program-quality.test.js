/**
 * Edikit — Program Quality & Accreditation Workspace (integration tests, Prompt 62)
 *
 * Service qatlami (fake DB): curriculum map CRUD/version, course↔outcome
 * mapping (idempotent upsert), evidence aggregation + minimum cell
 * suppression, finding create/transition, improvement action close blocker,
 * follow-up evidence, accreditation export manifest/hash + verify.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    limit: () => builder(table, state),
    async execute() {
      const rows = (tables[table] || []).filter((r) => matches(r, state.wheres));
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
    updateTable: (table) => ({
      set: (patch) => ({
        where: () => ({
          where: () => ({
            async execute() {
              for (const row of tables[table] || []) Object.assign(row, patch);
            },
          }),
          async execute() {
            for (const row of tables[table] || []) Object.assign(row, patch);
          },
        }),
        async execute() {
          for (const row of tables[table] || []) Object.assign(row, patch);
        },
      }),
    }),
  };
  return { db, tables };
}

describe('program quality — service (Prompt 62)', () => {
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
        PROGRAM_QUALITY_MAP_PUBLISH: 'program-quality:map:publish',
        PROGRAM_QUALITY_FINDING_CREATE: 'program-quality:finding:create',
        PROGRAM_QUALITY_FINDING_RESOLVE: 'program-quality:finding:resolve',
        PROGRAM_QUALITY_ACTION_CREATE: 'program-quality:action:create',
        PROGRAM_QUALITY_ACTION_CLOSE: 'program-quality:action:close',
        PROGRAM_QUALITY_EXPORT: 'program-quality:export',
      },
    }));
    mod = await import('../../src/modules/program-quality/index.js');
  });

  it('curriculum map — create/duplicate/publish/version', async () => {
    const c1 = await mod.createCurriculumMap({ name: 'BSc Matematika', term: '2026-spring', version: 'v1', createdBy: 'admin' });
    expect(c1.ok).toBe(true);
    const dup = await mod.createCurriculumMap({ name: 'BSc Matematika', term: '2026-spring', version: 'v1' });
    expect(dup.ok).toBe(false);

    const maps = await mod.listCurriculumMaps();
    expect(maps).toHaveLength(1);

    const pub = await mod.transitionMapStatus({ mapId: c1.mapId, to: 'published', actorId: 'admin' });
    expect(pub.ok).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:map:publish' }));
  });

  it('course↔outcome mapping — upsert idempotent + gap report', async () => {
    const map = await mod.createCurriculumMap({ name: 'BSc', term: '2026', version: 'v1' });
    const m1 = await mod.mapCourseOutcome({
      mapId: map.mapId, courseId: 1, courseCode: 'MATH-201', courseName: 'Algebra',
      outcomeId: 1, outcomeCode: 'PLO-1', outcomeName: 'Analitik fikrlash',
      irmaLevel: 'introduced', assessmentPoints: 1,
    });
    expect(m1.ok).toBe(true);
    const m2 = await mod.mapCourseOutcome({
      mapId: map.mapId, courseId: 1, courseCode: 'MATH-201', courseName: 'Algebra',
      outcomeId: 1, outcomeCode: 'PLO-1', outcomeName: 'Analitik fikrlash',
      irmaLevel: 'assessed', assessmentPoints: 2,
    });
    expect(m2.ok).toBe(true);
    expect(m2.updated).toBe(true);
    expect(tables.curriculum_map_entries).toHaveLength(1);
    expect(tables.curriculum_map_entries[0].irma_level).toBe('assessed');

    const detail = await mod.getCurriculumMap({ mapId: map.mapId });
    expect(detail.entries).toHaveLength(1);
    // no assessment gap: assessed is present → no missing_assessment
    expect(detail.gaps.gaps.some((g) => g.kind === 'missing_assessment')).toBe(false);
  });

  it('evidence aggregation — minimum cell suppression + no PII/teacher ranking', async () => {
    const map = await mod.createCurriculumMap({ name: 'BSc', term: '2026', version: 'v1' });
    await mod.transitionMapStatus({ mapId: map.mapId, to: 'published' });

    const small = await mod.addEvidenceAggregation({
      mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-4', evidenceType: 'direct',
      sampleSize: 3, minCellSize: 5, observedPct: 58, benchmarkTargetPct: 75,
    });
    expect(small.ok).toBe(true);
    expect(small.suppressed).toBe(true);
    expect(small.observedPct).toBeNull();

    const ok = await mod.addEvidenceAggregation({
      mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-4', evidenceType: 'direct',
      sampleSize: 8, minCellSize: 5, observedPct: 58, benchmarkTargetPct: 75,
    });
    expect(ok.suppressed).toBe(false);
    expect(ok.observedPct).toBe(58);

    // security guards
    const pii = await mod.addEvidenceAggregation({
      mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-4', evidenceType: 'indirect',
      sampleSize: 8, aggregateMeta: { studentName: 'Aziz' },
    });
    expect(pii.ok).toBe(false);
    const lb = await mod.addEvidenceAggregation({
      mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-4', evidenceType: 'indirect',
      sampleSize: 8, aggregateMeta: { includeTeacherRanking: true },
    });
    expect(lb.ok).toBe(false);

    const list = await mod.listEvidenceAggregations({ mapId: map.mapId });
    expect(list).toHaveLength(2);
    expect(list[0].is_suppressed).toBe(true);
  });

  it('finding → action → follow-up → close (close blocker) + export verify', async () => {
    const map = await mod.createCurriculumMap({ name: 'BSc', term: '2026', version: 'v1' });
    await mod.transitionMapStatus({ mapId: map.mapId, to: 'published' });

    const f = await mod.createFinding({
      mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-4', title: 'PLO-4 target 75, observed 58',
      targetPct: 75, observedPct: 58, createdBy: 'admin',
    });
    expect(f.ok).toBe(true);
    expect(f.verdict).toBe('critical_gap');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:finding:create' }));

    // action — owner+deadline required
    const noOwner = await mod.createImprovementAction({ findingId: f.findingId, title: 'scaffold', owner: '', deadline: '2026-09-01' });
    expect(noOwner.ok).toBe(false);
    const action = await mod.createImprovementAction({ findingId: f.findingId, title: 'Course B scaffold', owner: 'program lead', deadline: '2026-09-01', createdBy: 'admin' });
    expect(action.ok).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:action:create' }));

    // valid FSM: open → in_progress → verification
    await mod.transitionActionStatus({ actionId: action.actionId, to: 'in_progress' });
    await mod.transitionActionStatus({ actionId: action.actionId, to: 'verification' });

    // close without evidence → blocked (close blocker)
    const earlyClose = await mod.transitionActionStatus({ actionId: action.actionId, to: 'closed', actorId: 'admin' });
    expect(earlyClose.ok).toBe(false);
    expect(earlyClose.error).toMatch(/follow-up evidence/i);

    // follow-up evidence + close
    const fu = await mod.addFollowUpEvidence({ actionId: action.actionId, cycle: 'next-term-week-4', evidenceRef: 'anchor-sample', decision: 'effective', collectedBy: 'admin' });
    expect(fu.ok).toBe(true);
    const closed = await mod.transitionActionStatus({ actionId: action.actionId, to: 'closed', actorId: 'admin' });
    expect(closed.ok).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:action:close' }));

    // export manifest + verify
    const exp = await mod.createAccreditationExport({ mapId: map.mapId, standard: 'UZWQAA-2026', standardVersion: 'v1', exportedBy: 'admin' });
    expect(exp.ok).toBe(true);
    expect(exp.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:export' }));

    const v = await mod.verifyAccreditationExport({ exportId: exp.exportId });
    expect(v.verifiable).toBe(true);
    expect(v.matches).toBe(true);
  });

  it('export requires published map; finding FSM enforced', async () => {
    const map = await mod.createCurriculumMap({ name: 'DraftOnly', term: '2026', version: 'v1' });
    const exp = await mod.createAccreditationExport({ mapId: map.mapId, standard: 'X', exportedBy: 'admin' });
    expect(exp.ok).toBe(false);
    expect(exp.error).toMatch(/published/i);

    const f = await mod.createFinding({ mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-1', title: 'x', targetPct: 70, observedPct: 50 });
    await mod.transitionFindingStatus({ findingId: f.findingId, to: 'resolved' });
    const bad = await mod.transitionFindingStatus({ findingId: f.findingId, to: 'open' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/invalid finding transition/i);
  });
});
