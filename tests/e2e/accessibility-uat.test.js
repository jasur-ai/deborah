/**
 * Deborah — WCAG 2.2 AA & Artifact Accessibility (e2e/security, Prompt 64)
 *
 * Full critical-journey UAT (research.md §26.1, §29): user settings →
 * automated audit (ACR) → gap backlog → human verification (close blocker)
 * → artifact QA → dashboard summary. Security: automated checker never
 * final (§15); blocker close requires human sign-off; audit trail.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertAutomatedCheckIsNotFinal } from '../../src/modules/accessibility/accessibility.schema.js';

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

describe('Prompt 64 — WCAG 2.2 AA accessibility UAT', () => {
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

  it('full journey — settings → audit → gap → human verify → artifact → summary', async () => {
    // 1. Student preference (reduced motion + screen reader)
    const settings = await mod.saveAccessibilitySettings({
      userKey: 's-2026-001', reducedMotion: true, screenReaderMode: true, fontScale: 1.3, updatedBy: 'admin',
    });
    expect(settings.ok).toBe(true);
    expect(settings.reducedMotion).toBe(true);

    // 2. Automated audit of the timed exam journey → critical timer violation
    const audit = await mod.runAudit({
      journey: 'student',
      pageUrl: '/exam/start',
      snapshot: {
        landmarks: ['banner', 'main', 'contentinfo'],
        headings: [{ level: 1 }, { level: 2 }],
        controls: [{ id: 'answer-a', hasLabel: true, targetSizePx: 24 }],
        focusables: [{ selector: 'button', hasFocusIndicator: false }],
        skipLinks: ['#main'],
        timers: [{ id: 'examTimer', hasLiveRegion: false }],
        dragDrops: [{ id: 'sort-q1', hasKeyboardAlternative: false }],
        media: [{ type: 'img', hasAlt: true }],
      },
      runBy: 'qa-bot',
    });
    expect(audit.ok).toBe(true);
    expect(audit.needsReview).toBe(true); // automated never final (§15)
    expect(audit.blockerCount).toBeGreaterThan(0);

    // 3. Known-gap backlog — blocker for timed journey
    const gap = await mod.createGap({
      ruleId: 'timer-live-region', description: 'Exam timer has no live-region warning',
      journey: 'student', severity: 'critical', isTimed: true, createdBy: 'qa-bot',
    });
    expect(gap.ok).toBe(true);
    expect(gap.isBlocker).toBe(true);

    // 4. Automation cannot close the blocker — human sign-off required
    const autoClose = await mod.transitionGapStatus({ gapId: gap.gapId, to: 'verified' });
    expect(autoClose.ok).toBe(false);
    const inProgress = await mod.transitionGapStatus({ gapId: gap.gapId, to: 'in_progress', actorId: 'dev' });
    expect(inProgress.ok).toBe(true);
    const fixed = await mod.transitionGapStatus({ gapId: gap.gapId, to: 'fixed', actorId: 'dev' });
    expect(fixed.ok).toBe(true);
    const verified = await mod.transitionGapStatus({ gapId: gap.gapId, to: 'verified', verifiedBy: 'accessibility-officer' });
    expect(verified.ok).toBe(true);
    expect(tables.a11y_gaps[0].verified_by).toBe('accessibility-officer');

    // 5. Generated artifact (PDF) QA — reading order + alt + contrast + tagged
    const artifact = await mod.checkArtifact({
      artifactType: 'pdf', artifactId: 101,
      readingOrderOk: true,
      images: [{ src: 'fig1.png', alt: 'Function graph' }],
      contrastPairs: [{ fg: '#222', bg: '#fff', fontSizePx: 16 }],
      tagged: true, checkedBy: 'quality-team',
    });
    expect(artifact.ok).toBe(true);
    expect(artifact.taggedPdf).toBe(true);

    // 6. Summary reflects the full lifecycle
    const summary = await mod.getAccessibilitySummary();
    expect(summary.ok).toBe(true);
    expect(summary.audits).toBe(1);
    expect(summary.openGaps).toBe(0); // all closed+verified
    expect(summary.blockers).toBe(0);
    expect(summary.artifacts).toBe(1);
    expect(summary.failedArtifacts).toBe(0);

    // 7. Audit trail — every privileged action recorded
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:settings:save' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:audit:run' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:gap:create' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:gap:status' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'a11y:artifact:check' }));
  });

  it('security — automated checker alone never final; blocker classification', async () => {
    // Create a blocker via timed critical
    const gap = await mod.createGap({ ruleId: 'target-size', description: 'Small targets in exam', severity: 'critical', isTimed: true, createdBy: 'bot' });
    expect(gap.isBlocker).toBe(true);

    // Minor non-timed is NOT a blocker
    const minor = await mod.createGap({ ruleId: 'landmark', description: 'Missing footer landmark', severity: 'minor', createdBy: 'bot' });
    expect(minor.isBlocker).toBe(false);

    // Verified requires verifiedBy — guard is enforced at service level too
    const rawGuard = assertAutomatedCheckIsNotFinal({ automatedOnly: true });
    expect(rawGuard.ok).toBe(false);
    expect(rawGuard.reason).toMatch(/human verification/i);
  });

  it('proctor journey — audit coverage', async () => {
    const r = await mod.runAudit({ journey: 'proctor', pageUrl: '/proctor/dashboard', snapshot: { landmarks: ['main'], controls: [] }, runBy: 'qa' });
    expect(r.ok).toBe(true);
    expect(tables.a11y_audits[0].journey).toBe('proctor');
    const s = await mod.getAccessibilitySummary();
    expect(s.journeyCoverage.find((j) => j.journey === 'proctor').auditCount).toBe(1);
  });
});
