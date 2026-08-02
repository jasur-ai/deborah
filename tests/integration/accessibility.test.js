/**
 * Edikit — WCAG 2.2 AA & Artifact Accessibility (integration tests, Prompt 64)
 *
 * Service qatlami (fake DB): settings idempotent upsert, audit ACR record
 * (needs_review + audit trail), gap FSM (verified requires human verifier),
 * artifact check upsert, summary.
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
    limit: (n) => builder(table, { ...state, limitN: n }),
    async execute() {
      let rows = (tables[table] || []).filter((r) => matches(r, state.wheres));
      if (state.limitN) rows = rows.slice(0, state.limitN);
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

describe('accessibility — service (Prompt 64)', () => {
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
        A11Y_SETTINGS_SAVE: 'a11y:settings:save',
        A11Y_AUDIT_RUN: 'a11y:audit:run',
        A11Y_GAP_CREATE: 'a11y:gap:create',
        A11Y_GAP_STATUS: 'a11y:gap:status',
        A11Y_ARTIFACT_CHECK: 'a11y:artifact:check',
      },
    }));
    mod = await import('../../src/modules/accessibility/index.js');
  });

  it('settings — defaults, idempotent upsert, audit', async () => {
    const defaults = await mod.getAccessibilitySettings({ userKey: 's1' });
    expect(defaults.reducedMotion).toBe(false);
    expect(defaults.fontScale).toBe(1);

    const r = await mod.saveAccessibilitySettings({ userKey: 's1', reducedMotion: true, highContrast: true, fontScale: 1.4, updatedBy: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.updated).toBe(false);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:settings:save' }));

    // Upsert must not silently reset fields omitted in the patch —
    // verify by re-reading the FULL settings (fontScale preserved at 1.4).
    const again = await mod.saveAccessibilitySettings({ userKey: 's1', reducedMotion: true, highContrast: true, fontScale: 1.4, updatedBy: 'admin' });
    expect(again.ok).toBe(true);
    expect(again.updated).toBe(true);

    const got = await mod.getAccessibilitySettings({ userKey: 's1' });
    expect(got.reducedMotion).toBe(true);
    expect(got.fontScale).toBe(1.4);
  });

  it('audit — records ACR evidence with needs_review + audit trail', async () => {
    const r = await mod.runAudit({
      journey: 'student',
      pageUrl: '/exam',
      snapshot: { landmarks: ['main'], timers: [{ id: 't', hasLiveRegion: false }] },
      runBy: 'admin',
    });
    expect(r.ok).toBe(true);
    expect(r.needsReview).toBe(true);
    expect(r.blockerCount).toBeGreaterThan(0);
    expect(tables.a11y_audits).toHaveLength(1);
    expect(tables.a11y_audits[0].wcag_target).toBe('2.2-AA');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:audit:run' }));

    // invalid journey rejected
    const bad = await mod.runAudit({ journey: 'robot' });
    expect(bad.ok).toBe(false);
  });

  it('gap — create, FSM, verified requires human verifier (§15)', async () => {
    const g = await mod.createGap({ ruleId: 'target-size', description: 'Small touch targets', severity: 'critical', isTimed: true, createdBy: 'admin' });
    expect(g.ok).toBe(true);
    expect(g.isBlocker).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:gap:create' }));

    // open → verified directly rejected
    const skip = await mod.transitionGapStatus({ gapId: g.gapId, to: 'verified' });
    expect(skip.ok).toBe(false);

    // open → in_progress → fixed
    await mod.transitionGapStatus({ gapId: g.gapId, to: 'in_progress', actorId: 'dev' });
    const fixed = await mod.transitionGapStatus({ gapId: g.gapId, to: 'fixed', actorId: 'dev' });
    expect(fixed.ok).toBe(true);

    // fixed → verified without verifier rejected (automated-only close)
    const noVerifier = await mod.transitionGapStatus({ gapId: g.gapId, to: 'verified' });
    expect(noVerifier.ok).toBe(false);

    // fixed → verified with human verifier OK
    const verified = await mod.transitionGapStatus({ gapId: g.gapId, to: 'verified', verifiedBy: 'quality-team' });
    expect(verified.ok).toBe(true);
    expect(verified.verifiedBy).toBe('quality-team');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:gap:status' }));

    // terminal
    const reopen = await mod.transitionGapStatus({ gapId: g.gapId, to: 'open' });
    expect(reopen.ok).toBe(false);

    const gaps = await mod.listGaps({ blockerOnly: true });
    expect(gaps).toHaveLength(1);
  });

  it('artifact check — reading order, alt text, contrast, tagged PDF — idempotent upsert', async () => {
    const r = await mod.checkArtifact({
      artifactType: 'pdf',
      artifactId: 7,
      readingOrderOk: true,
      images: [{ src: 'a.png', alt: 'Diagram' }, { src: 'b.png', alt: '' }],
      contrastPairs: [{ fg: '#333', bg: '#fff', fontSizePx: 16 }, { fg: '#888', bg: '#fff', fontSizePx: 12 }],
      tagged: false,
      checkedBy: 'admin',
    });
    expect(r.ok).toBe(false);
    expect(r.missingAlt).toContain('b.png');
    expect(r.contrastIssues).toHaveLength(1);
    expect(r.taggedPdf).toBe(false);
    expect(tables.a11y_artifact_checks).toHaveLength(1);
    expect(tables.a11y_artifact_checks[0].status).toBe('failed');

    // idempotent re-check
    const again = await mod.checkArtifact({
      artifactType: 'pdf', artifactId: 7,
      readingOrderOk: true,
      images: [{ src: 'a.png', alt: 'Diagram' }],
      tagged: true, checkedBy: 'admin',
    });
    expect(again.ok).toBe(true);
    expect(tables.a11y_artifact_checks).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:artifact:check' }));

    // invalid type
    const bad = await mod.checkArtifact({ artifactType: 'exe', artifactId: 1 });
    expect(bad.ok).toBe(false);
  });

  it('summary — journey coverage and counts', async () => {
    await mod.runAudit({ journey: 'student', snapshot: {} });
    await mod.runAudit({ journey: 'proctor', snapshot: {} });
    await mod.createGap({ ruleId: 'x', description: 'd', severity: 'blocker' });

    const s = await mod.getAccessibilitySummary();
    expect(s.ok).toBe(true);
    expect(s.audits).toBe(2);
    expect(s.openGaps).toBe(1);
    expect(s.blockers).toBe(1);
    expect(s.journeyCoverage.find((j) => j.journey === 'student').auditCount).toBe(1);
    expect(s.needsReview).toBe(2);
  });
});
