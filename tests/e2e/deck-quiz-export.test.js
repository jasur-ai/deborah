/**
 * Edikit — Deck → Quiz → Export end-to-end (Prompt 59)
 *
 * To'liq oqim: canonical deck → extractQuizConcepts → 50/30/20 quiz
 * (citation bilan) → teacher approval → publish → deck export (attribution
 * + accessibility). Barcha infra mock'lar bilan (fake DB + storage).
 * §22.18: AI savol teacher approval'siz publish qilinmaydi.
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
        onConflict: (ocFn) => {
          let conflictCols = null;
          const columns = (cols) => {
            conflictCols = cols;
            return {
              doUpdateSet: (updater) => ({
                async execute() {
                  const existing = (tables[table] || []).find((r) =>
                    (conflictCols || []).every((c) => r[c] === row[c])
                  );
                  if (existing) {
                    const patch = typeof updater === 'function' ? updater(() => ({ __op: '+', __col: '', __val: 0 })) : updater;
                    for (const [k, v] of Object.entries(patch)) existing[k] = v;
                  } else {
                    const id = nextId++;
                    (tables[table] = tables[table] || []).push({ id, ...row });
                  }
                },
              }),
            };
          };
          return ocFn({ columns });
        },
      }),
    }),
    updateTable: (table) => ({
      set: (patch) => ({
        where: (col, op, val) => ({
          async execute() {
            for (const r of tables[table] || []) {
              if (matches(r, [[col, op, val]])) Object.assign(r, patch);
            }
          },
        }),
      }),
    }),
  };
  return { db, tables };
}

const canonicalDoc = {
  title: 'Fotosintez',
  learningOutcomes: ['Fotosintez jarayonini tushuntirish'],
  slides: [
    {
      id: 's1',
      title: 'Kirish',
      speakerNotes: 'Fotosintez — yorug\'lik energiyasini kimyoviy energiyaga aylantiradi.',
      blocks: [
        { type: 'heading', content: { heading: 'Fotosintez' } },
        { type: 'bullets', content: { items: ['Xlorofill', 'Quyosh nuri'] } },
        { type: 'image', content: { url: 'x', alt: 'Fotosintez diagrammasi' } },
      ],
      citations: ['source:1'],
    },
    { id: 's2', title: 'Xulosa', speakerNotes: 'Yakuniy xulosa.', blocks: [{ type: 'text', content: { text: 'Short summary.' } }], citations: [] },
  ],
};

describe('Prompt 59 — deck → quiz → export e2e', () => {
  let mod;
  let tables;
  let putMock;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({});
    tables = fake.tables;
    putMock = vi.fn(async () => ({ key: 'k', size: 1 }));

    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: {
        QUIZ_GENERATE: 'quiz:generate',
        QUIZ_APPROVE: 'quiz:approve',
        QUIZ_PUBLISH: 'quiz:publish',
        DECK_EXPORT: 'deck:export',
      },
    }));
    vi.doMock('../../src/infrastructure/storage.js', () => ({
      default: { put: putMock, getInfo: () => ({ type: 'local' }) },
    }));

    const quizMod = await import('../../src/modules/quiz-deck/index.js');
    const exportMod = await import('../../src/modules/deck-export/index.js');
    mod = { ...quizMod, ...exportMod };
  });

  it('generate → needs approval → publish (FSM) → export', async () => {
    // 1. Generate quiz from deck (idempotent request_hash)
    const gen = await mod.generateQuizFromDeck({
      presentationId: 4,
      versionId: 2,
      document: canonicalDoc,
      sourcePacks: [{ id: 1, title: 'Biologiya darsligi', url: 'https://x' }],
      actorId: 9,
    });
    expect(gen.ok).toBe(true);
    expect(gen.status).toBe('draft');
    expect(gen.questions).toHaveLength(2);
    expect(gen.questions[0].citation.verified).toBe(true);
    expect(gen.blueprint.total).toBe(2);

    // Idempotency — second call returns cached job
    const gen2 = await mod.generateQuizFromDeck({
      presentationId: 4,
      versionId: 2,
      document: canonicalDoc,
      sourcePacks: [{ id: 1, title: 'Biologiya darsligi' }],
    });
    expect(gen2.cached).toBe(true);
    expect(gen2.jobId).toBe(gen.jobId);

    // 2. §22.18 — publish without approval must FAIL
    const earlyPub = await mod.publishQuiz({ jobId: gen.jobId, actorId: 9 });
    expect(earlyPub.ok).toBe(false);

    // 3. Teacher approval
    const appr = await mod.approveQuiz({ jobId: gen.jobId, actorId: 9 });
    expect(appr.ok).toBe(true);
    expect(appr.status).toBe('approved');

    // 4. Publish → item ids
    const pub = await mod.publishQuiz({ jobId: gen.jobId, actorId: 9 });
    expect(pub.ok).toBe(true);
    expect(pub.status).toBe('published');
    expect(pub.itemIds).toHaveLength(2);
    const job = tables.deck_quiz_jobs.find((j) => j.id === gen.jobId);
    expect(JSON.parse(job.item_ids)).toHaveLength(2);

    // 5. Export deck → attribution + accessibility + storage put
    const exp = await mod.exportDeck({
      presentationId: 4,
      versionId: 2,
      format: 'pptx',
      document: canonicalDoc,
      provider: 'claude',
      model: 'claude-3',
      jobId: 9,
      humanReviewedAt: '2026-01-01',
      sourceLicenses: ['CC BY 4.0'],
      actorId: 9,
    });
    expect(exp.ok).toBe(true);
    expect(exp.status).toBe('done');
    expect(exp.a11y.passed).toBeGreaterThan(0);
    expect(putMock).toHaveBeenCalled();

    // Export idempotency
    const exp2 = await mod.exportDeck({
      presentationId: 4,
      versionId: 2,
      format: 'pptx',
      document: canonicalDoc,
      provider: 'claude',
      actorId: 9,
    });
    expect(exp2.cached).toBe(true);
    expect(exp2.exportId).toBe(exp.exportId);

    // Export row has attribution JSON (string in fake DB / object in real PG)
    const row = tables.deck_exports.find((r) => r.id === exp.exportId);
    const attr = typeof row.attribution === 'string' ? JSON.parse(row.attribution) : row.attribution;
    expect(attr.aiAssisted).toBe(true);
    expect(attr.provider).toBe('claude');
  });

  it('generate — marks needs_review when claim changed', async () => {
    const prevDoc = JSON.parse(JSON.stringify(canonicalDoc));
    prevDoc.slides[0].speakerNotes = 'ESKI claim — turli xil';
    const gen = await mod.generateQuizFromDeck({
      presentationId: 5,
      versionId: 1,
      document: canonicalDoc,
      previousDocument: prevDoc,
      actorId: 9,
    });
    expect(gen.ok).toBe(true);
    expect(gen.status).toBe('needs_review');
    expect(gen.needsReview).toContain('q_1');
  });

  it('generate — rejects invalid params before DB', async () => {
    const r = await mod.generateQuizFromDeck({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/presentationId/i);
  });

  it('export — rejects invalid format', async () => {
    const r = await mod.exportDeck({ presentationId: 4, versionId: 2, format: 'exe', document: canonicalDoc });
    expect(r.ok).toBe(false);
  });
});
