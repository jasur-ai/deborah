/**
 * Edikit — AI/Content Checkpoint (integration tests, Prompt 60)
 *
 * Service qatlami: runAiCheckpoint — idempotent (request_hash), tenant
 * scoped, audit, Phase G readiness persist; outage/failure drill through
 * fake DB; guard'lar publish'ni bloklaydi (§15).
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
      if (state.cols) {
        const cols = Array.isArray(state.cols) ? state.cols : [state.cols];
        return rows.map((r) => {
          const o = {};
          for (const c of cols) o[c] = r[c];
          return o;
        });
      }
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
  };
  return { db, tables };
}

const demoData = () => ({
  guards: { isFinal: true, hasTeacherApproval: false, publish: true, sourceStatus: 'draft', citationVerified: false },
  redTeamScenarios: [
    { id: 's1', kind: 'ssrf', url: 'http://169.254.169.254/latest/meta-data' },
    { id: 's2', kind: 'xss', text: '<script>alert(1)</script>' },
    { id: 's3', kind: 'xss', text: 'Fotosintez — xlorofill' },
  ],
  aiScores: [4, 3, 2, 4, 3, 3, 2, 4, 1, 3],
  goldScores: [4, 3, 2, 4, 3, 3, 2, 4, 1, 3],
  confidences: [0.9, 0.85, 0.7, 0.95, 0.8, 0.75, 0.6, 0.9, 0.5, 0.8],
  candidates: [
    { id: 'q1', stem: 'Fotosintez jarayonida qanday modda sintezlanadi?', options: [{ text: 'Glyukoza', isCorrect: true }, { text: 'Karbonat angidrid' }, { text: 'Kislorod' }, { text: 'Suv' }], correct: 'Glyukoza', sourceRefs: [{ chunkId: 1 }], approvedChunks: [{ id: 1, quote: 'Fotosintez jarayonida glyukoza sintezlanadi' }] },
    { id: 'q2', stem: 'Xlorofill qayerda joylashgan?', options: [{ text: 'Xloroplast', isCorrect: true }, { text: 'Yadro' }, { text: 'Mitoxondriya' }, { text: 'Ribosoma' }], correct: 'Xloroplast', sourceRefs: [{ chunkId: 2 }], approvedChunks: [{ id: 2, quote: 'Xlorofill xloroplastda joylashgan' }] },
  ],
  citationRecords: [{ id: 'c1', url: 'https://example.com/paper', title: 'Maqola' }],
  intervention: { preScore: 40, postScore: 75, retentionScore: 70, responses: [{ correct: true }, { correct: true }, { correct: false }, { correct: true }], misconception: { id: 1, label: 'xlorofill' }, interventions: [{ id: 1, title: 'Video' }] },
  deckNative: { title: 'Native', slides: [{ id: 's1', title: 'Kirish', blocks: [{ type: 'text', content: { text: 'Fotosintez' } }] }] },
  deckProvider: { title: 'Provider', attribution: { provider: 'claude' }, slides: [{ id: 's1', title: 'Kirish', blocks: [{ type: 'text', content: { text: 'Fotosintez' } }] }] },
  outage: { provider: 'gamma', failureCount: 3, openUntil: null, statusCodes: [429, 500, 200], credits: 1200, minutes: 10, brief: 'Fotosintez mavzusida savol' },
});

describe('ai-checkpoint — service (Prompt 60 §18/19)', () => {
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
      AUDIT_ACTIONS: { AI_CHECKPOINT_RUN: 'ai:checkpoint:run' },
    }));
    mod = await import('../../src/modules/ai-checkpoint/index.js');
  });

  it('runAiCheckpoint — full run persists + audits', async () => {
    const r = await mod.runAiCheckpoint({ scope: 'full', data: demoData(), actorId: 9 });
    expect(r.ok).toBe(true);
    expect(r.runId).toBeTruthy();
    expect(r.ready).toBe(false); // guards fail (no teacher approval)
    expect(r.pilots.length).toBeGreaterThan(6);
    // guards pilot first — summative authority blocked
    expect(r.pilots[0].pilot).toBe('guards');
    expect(r.pilots[0].ok).toBe(false);
    // persisted row
    const row = tables.ai_checkpoint_runs.find((x) => x.id === r.runId);
    expect(row).toBeTruthy();
    expect(row.request_hash).toMatch(/^cp_/);
    expect(row.phase_g_ready).toBe(false);
    expect(auditMock).toHaveBeenCalled();
  });

  it('runAiCheckpoint — idempotent (same hash returns cached)', async () => {
    const r1 = await mod.runAiCheckpoint({ scope: 'grading', data: demoData(), actorId: 9 });
    const r2 = await mod.runAiCheckpoint({ scope: 'grading', data: demoData(), actorId: 9 });
    expect(r2.cached).toBe(true);
    expect(r2.runId).toBe(r1.runId);
    expect(tables.ai_checkpoint_runs.filter((x) => x.scope === 'grading')).toHaveLength(1);
  });

  it('runAiCheckpoint — different scope → different hash', async () => {
    const r1 = await mod.runAiCheckpoint({ scope: 'source', data: demoData() });
    const r2 = await mod.runAiCheckpoint({ scope: 'provider', data: demoData() });
    expect(r1.runId).not.toBe(r2.runId);
    expect(r1.pilots.some((p) => p.pilot === 'red_team')).toBe(true);
    expect(r2.pilots.some((p) => p.pilot === 'outage_drill')).toBe(true);
  });

  it('runAiCheckpoint — PG yo\u2018q → graceful error', async () => {
    vi.resetModules();
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => null }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({ audit: vi.fn(), AUDIT_ACTIONS: { AI_CHECKPOINT_RUN: 'ai:checkpoint:run' } }));
    const m = await import('../../src/modules/ai-checkpoint/index.js');
    const r = await m.runAiCheckpoint({ scope: 'full', data: demoData() });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('runAiCheckpoint — guards fail → phase G not ready + residual risk', async () => {
    const r = await mod.runAiCheckpoint({ scope: 'full', data: demoData(), actorId: 9 });
    expect(r.residualRisks.some((x) => x.level === 'high')).toBe(true);
    expect(r.summary.failed).toBeGreaterThan(0);
  });

  it('runAiCheckpoint — teacher-approved guards → pass path', async () => {
    const data = demoData();
    data.guards = { isFinal: true, hasTeacherApproval: true, publish: true, sourceStatus: 'approved', citationVerified: true };
    const r = await mod.runAiCheckpoint({ scope: 'full', data, actorId: 9 });
    expect(r.pilots[0].ok).toBe(true);
  });
});
