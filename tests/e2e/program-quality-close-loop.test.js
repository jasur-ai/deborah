/**
 * Edikit — Program Quality & Accreditation Workspace (e2e/security, Prompt 62)
 *
 * Close-the-loop workflow (research.md §56.3): curriculum map → course↔outcome
 * mapping → direct/indirect evidence aggregation (with minimum cell
 * suppression) → finding (target vs observed) → improvement action
 * (owner/deadline) → follow-up evidence → close → accreditation export
 * (reproducible manifest/hash) → verify.
 *
 * Security: teacher leaderboard yo'q; raw PII aggregate'ga chiqmaydi; action
 * evidence'siz close bo'lmaydi (close blocker).
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

describe('Prompt 62 — program quality close-the-loop workflow', () => {
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

  it('full close-loop — map → evidence → finding → action → follow-up → close → export → verify', async () => {
    // 1. Map create (draft — tahrirlash mumkin)
    const map = await mod.createCurriculumMap({ name: 'BSc Matematika 2026', term: '2026-spring', version: 'v1', createdBy: 'admin' });
    expect(map.ok).toBe(true);

    // 2. Course↔outcome mapping (I/R/M/A) — publish'dan oldin draft'da
    await mod.mapCourseOutcome({ mapId: map.mapId, courseId: 1, courseCode: 'MATH-201', courseName: 'Algebra', outcomeId: 1, outcomeCode: 'PLO-4', outcomeName: 'Analitik fikrlash', irmaLevel: 'introduced', assessmentPoints: 1 });
    await mod.mapCourseOutcome({ mapId: map.mapId, courseId: 1, courseCode: 'MATH-201', courseName: 'Algebra', outcomeId: 1, outcomeCode: 'PLO-4', outcomeName: 'Analitik fikrlash', irmaLevel: 'assessed', assessmentPoints: 2 });

    // 3. Publish (audit)
    const pub = await mod.transitionMapStatus({ mapId: map.mapId, to: 'published', actorId: 'admin' });
    expect(pub.ok).toBe(true);
    const detail = await mod.getCurriculumMap({ mapId: map.mapId });
    expect(detail.entries).toHaveLength(1);
    expect(detail.gaps.gaps.some((g) => g.kind === 'missing_assessment')).toBe(false);

    // 3. Direct + indirect evidence (one suppressed cell)
    await mod.addEvidenceAggregation({ mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-4', evidenceType: 'direct', method: 'anchor rubric', sampleSize: 8, minCellSize: 5, observedPct: 58, benchmarkTargetPct: 75 });
    await mod.addEvidenceAggregation({ mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-4', evidenceType: 'indirect', method: 'survey', sampleSize: 3, minCellSize: 5, observedPct: 62, benchmarkTargetPct: 75 });
    const ev = await mod.listEvidenceAggregations({ mapId: map.mapId });
    expect(ev).toHaveLength(2);
    expect(ev.some((e) => e.is_suppressed && e.observed_pct === null)).toBe(true);

    // 4. Finding — target 75, observed 58 → critical_gap
    const finding = await mod.createFinding({ mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-4', title: 'PLO-4 target 75%, observed 58%', targetPct: 75, observedPct: 58, createdBy: 'admin' });
    expect(finding.ok).toBe(true);
    expect(finding.verdict).toBe('critical_gap');

    // 5. Action — close blocker initially blocks
    const action = await mod.createImprovementAction({ findingId: finding.findingId, title: "Course B'da new scaffold + revised lab", owner: 'program lead', deadline: '2026-09-01', createdBy: 'admin' });
    expect(action.ok).toBe(true);
    const blocked = await mod.transitionActionStatus({ actionId: action.actionId, to: 'closed', actorId: 'admin' });
    expect(blocked.ok).toBe(false);

    // 6. FSM open → in_progress → verification, then follow-up evidence
    await mod.transitionActionStatus({ actionId: action.actionId, to: 'in_progress' });
    await mod.transitionActionStatus({ actionId: action.actionId, to: 'verification' });
    await mod.addFollowUpEvidence({ actionId: action.actionId, cycle: 'next-term-week-4', evidenceRef: 'same-criterion-anchor-sample', decision: 'effective', collectedBy: 'admin' });

    // 7. Close — now allowed
    const closed = await mod.transitionActionStatus({ actionId: action.actionId, to: 'closed', actorId: 'admin' });
    expect(closed.ok).toBe(true);
    expect(tables.improvement_actions[0].status).toBe('closed');

    // 8. Export bundle with reproducible manifest
    const exp = await mod.createAccreditationExport({ mapId: map.mapId, standard: 'UZWQAA-2026', standardVersion: 'v1', exportedBy: 'admin' });
    expect(exp.ok).toBe(true);
    expect(exp.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(exp.manifest.findings).toHaveLength(1);
    expect(exp.manifest.actions[0].owner).toBe('program lead');
    expect(exp.manifest.evidence.some((e) => e.observedPct === null)).toBe(true);

    // 9. Verify — reproducible
    const v = await mod.verifyAccreditationExport({ exportId: exp.exportId });
    expect(v.verifiable).toBe(true);
    expect(v.matches).toBe(true);

    // 10. Audit trail
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:map:publish' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:finding:create' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:action:create' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:action:close' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'program-quality:export' }));
  });

  it('security — teacher ranking leaderboard blocked + raw PII never in aggregate', async () => {
    const map = await mod.createCurriculumMap({ name: 'BSc', term: '2026', version: 'v1' });
    await mod.transitionMapStatus({ mapId: map.mapId, to: 'published' });

    const lb = await mod.addEvidenceAggregation({ mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-1', evidenceType: 'direct', sampleSize: 8, aggregateMeta: { includeTeacherRanking: true } });
    expect(lb.ok).toBe(false);

    const pii = await mod.addEvidenceAggregation({ mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-1', evidenceType: 'indirect', sampleSize: 8, aggregateMeta: { studentEmail: 'aziz@x.com' } });
    expect(pii.ok).toBe(false);

    const ok = await mod.addEvidenceAggregation({ mapId: map.mapId, outcomeId: 1, outcomeCode: 'PLO-1', evidenceType: 'direct', sampleSize: 12, observedPct: 80 });
    expect(ok.ok).toBe(true);

    const items = await mod.listEvidenceAggregations({ mapId: map.mapId });
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain('aziz@x.com');
    expect(JSON.stringify(items)).not.toContain('studentEmail');
  });

  it('security — individual teacher ranking request rejected at guard level', async () => {
    const r = mod.assertNoTeacherLeaderboard({ teacherId: 5 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/teacher ranking/i);
  });

  it('export tamper detection — different content, different hash', async () => {
    const map = await mod.createCurriculumMap({ name: 'BSc', term: '2026', version: 'v1' });
    await mod.transitionMapStatus({ mapId: map.mapId, to: 'published' });
    const exp = await mod.createAccreditationExport({ mapId: map.mapId, standard: 'ABET-EAC', standardVersion: '2025', exportedBy: 'admin' });
    expect(exp.ok).toBe(true);

    // Simulate tamper: another map same content would differ only by map name
    const map2 = await mod.createCurriculumMap({ name: 'BSc Fizika', term: '2026', version: 'v1' });
    await mod.transitionMapStatus({ mapId: map2.mapId, to: 'published' });
    const exp2 = await mod.createAccreditationExport({ mapId: map2.mapId, standard: 'ABET-EAC', standardVersion: '2025', exportedBy: 'admin' });
    expect(exp2.manifestHash).not.toBe(exp.manifestHash);
  });
});
