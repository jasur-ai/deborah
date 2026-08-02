/**
 * Edikit — AI/Content Checkpoint teacher multi-feature pilot (e2e, Prompt 60)
 *
 * Teacher measured pilot: source red-team + grading shadow benchmark +
 * question review + citation check + intervention + deck comparison +
 * outage drill → Phase G readiness. Security: summative AI authority va
 * unverified source publish BLOCK (guard'lar), PII redacted, SSRF URL
 * blocked, audit event yoziladi.
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
      }),
    }),
  };
  return { db, tables };
}

const data = () => ({
  guards: { isFinal: true, hasTeacherApproval: false, publish: true, sourceStatus: 'draft', citationVerified: false },
  redTeamScenarios: [
    { id: 's1', kind: 'ssrf', url: 'http://169.254.169.254/latest/meta-data' },
    { id: 's2', kind: 'xss', text: '<script>alert(1)</script>' },
    { id: 's3', kind: 'pii', text: 'Salom, men Aziz (AB1234567)' },
    { id: 's4', kind: 'xss', text: 'Fotosintez — xlorofill' },
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

describe('Prompt 60 — teacher multi-feature checkpoint pilot', () => {
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

  it('full pilot — all 7 pilots run, guards block publish, audit traced', async () => {
    const r = await mod.runAiCheckpoint({ scope: 'full', data: data(), actorId: 9 });
    expect(r.ok).toBe(true);

    // All pilots present
    const ids = r.pilots.map((p) => p.pilot);
    expect(ids).toContain('guards');
    expect(ids).toContain('red_team');
    expect(ids).toContain('shadow_benchmark');
    expect(ids).toContain('question_review');
    expect(ids).toContain('citation_check');
    expect(ids).toContain('intervention_pilot');
    expect(ids).toContain('deck_comparison');
    expect(ids).toContain('outage_drill');

    // Guards block: summative AI authority + unverified source
    const guards = r.pilots.find((p) => p.pilot === 'guards');
    expect(guards.ok).toBe(false);
    expect(guards.checks.find((c) => c.id === 'summative_authority').ok).toBe(false);
    expect(guards.checks.find((c) => c.id === 'verified_source').ok).toBe(false);

    // Red-team blocks malicious sources
    const redTeam = r.pilots.find((p) => p.pilot === 'red_team');
    expect(redTeam.checks.find((c) => c.id === 's1').ok).toBe(false); // ssrf
    expect(redTeam.checks.find((c) => c.id === 's2').ok).toBe(false); // xss
    expect(redTeam.checks.find((c) => c.id === 's4').ok).toBe(true); // benign

    // Shadow benchmark passes (perfect agreement)
    const shadow = r.pilots.find((p) => p.pilot === 'shadow_benchmark');
    expect(shadow.ok).toBe(true);
    expect(shadow.summary.metrics.qwk).toBe(1);

    // Citation check passes
    const citation = r.pilots.find((p) => p.pilot === 'citation_check');
    expect(citation.ok).toBe(true);

    // Outage drill: cost + retry policy
    const outage = r.pilots.find((p) => p.pilot === 'outage_drill');
    expect(outage.ok).toBe(true);
    expect(outage.summary.costUsd).toBeGreaterThan(0);

    // Phase G NOT ready (guards failed) — residual high risk
    expect(r.ready).toBe(false);
    expect(r.residualRisks.some((x) => x.level === 'high')).toBe(true);

    // Audit traced
    expect(auditMock).toHaveBeenCalled();
    expect(tables.ai_checkpoint_runs).toHaveLength(1);
  });

  it('teacher-approved + verified-source pilot → Phase G ready', async () => {
    const d = data();
    d.guards = { isFinal: true, hasTeacherApproval: true, publish: true, sourceStatus: 'approved', citationVerified: true };
    // benign red-team scenarios — hammasi pass bo'lishi uchun (guard'lar
    // allaqachon teacher-approve + verified source bilan ochiq)
    d.redTeamScenarios = [{ id: 's4', kind: 'xss', text: 'Fotosintez — xlorofill' }];
    const r = await mod.runAiCheckpoint({ scope: 'full', data: d, actorId: 9 });
    expect(r.pilots.find((p) => p.pilot === 'guards').ok).toBe(true);
    expect(r.ready).toBe(true);
  });

  it('rollbackable + human-governed: AI never changes teacher final', async () => {
    // Done condition: human-governed, source-grounded, rollbackable
    const r = await mod.runAiCheckpoint({ scope: 'grading', data: data(), actorId: 9 });
    const shadow = r.pilots.find((p) => p.pilot === 'shadow_benchmark');
    expect(shadow).toBeTruthy();
    // guard invariant
    expect(mod.assertNoSummativeAuthority({ isFinal: true, hasTeacherApproval: false }).ok).toBe(false);
  });
});
