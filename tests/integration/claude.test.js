/**
 * Deborah — Claude Native Adapter (integration tests, Prompt 57)
 *
 * Service qatlami: graceful degradation (PG'siz → 400/error),
 * validate-before-getDb, idempotency (request_hash), success flow
 * (job persistence + canonical doc + attribution + usage + circuit
 * reset), stream interruption/retry contract.
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
        // cols array bo'lmasa (fn.max obyekti) array'ga o'rab olamiz
        const cols = Array.isArray(state.cols) ? state.cols : [state.cols];
        return rows.map((r) => {
          const o = {};
          for (const c of cols) {
            if (c && c.__max) {
              o[c.__as || c.__max] = rows.reduce((m, x) => Math.max(m, Number(x[c.__max] || 0)), 0);
            } else {
              o[c] = r[c];
            }
          }
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
    fn: { max: (col) => ({ __max: col, as: (alias) => ({ __max: col, __as: alias }) }) },
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
        // Real upsert: conflict columns bo'yicha topilgan row'ni update qiladi,
        // aks holda insert qiladi (service'dagi onConflict(oc => oc.columns(...).doUpdateSet(...))).
        onConflict: (ocFn) => {
          let conflictCols = null;
          // Minimal expression builder — eb('col', '+', n) → { __op, __col, __val }
          const makeEb = () => (col, op, val) => ({ __op: op, __col: col, __val: val });
          const resolvePatch = (updater) =>
            typeof updater === 'function' ? updater(makeEb()) : updater;
          const columns = (cols) => {
            conflictCols = cols;
            return {
              doUpdateSet: (updater) => ({
                async execute() {
                  const existing = (tables[table] || []).find((r) =>
                    (conflictCols || []).every((c) => r[c] === row[c])
                  );
                  if (existing) {
                    const patch = resolvePatch(updater);
                    for (const [k, v] of Object.entries(patch)) {
                      if (v && v.__op) {
                        const cur = Number(existing[k] || 0);
                        existing[k] = v.__op === '+' ? cur + Number(v.__val || 0) : v.__val;
                      } else {
                        existing[k] = v;
                      }
                    }
                  } else {
                    const id = nextId++;
                    (tables[table] = tables[table] || []).push({ id, ...row });
                  }
                },
              }),
              doNothing: () => ({
                returning: () => ({ executeTakeFirst: async () => null }),
                execute: async () => {},
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

/** Fixed Claude output deck (citation src_1 → source pack 1). */
const DECK_TEXT = '```json\n{"title":"Fotosintez","language":"uz","slides":[' +
  '{"id":"s1","layout":"title","title":"Intro","blocks":[{"type":"text","content":{"text":"a"}}],"citations":[]},' +
  '{"id":"s2","layout":"closing","title":"Xulosa","blocks":[{"type":"bullets","content":{"items":["a"]}}],"citations":["src_1"]}' +
  ']}\n```';

describe('claude — graceful degradation (Prompt 57 §19)', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => null }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: { CLAUDE_SYNTHESIZE: 'claude:synthesize', CLAUDE_JOB_FAILED: 'claude:job:failed', CLAUDE_PROVIDER_UPDATE: 'claude:provider:update' },
    }));
    mod = await import('../../src/modules/claude/index.js');
  });

  const validReq = { title: 'Fotosintez', language: 'uz', theme: 'academic', slideCount: 8, sources: [1, 2] };

  it('synthesizeDeck — PG yo\u2018q → graceful error', async () => {
    const r = await mod.synthesizeDeck(validReq);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('synthesizeDeck — invalid request rejected before DB', async () => {
    const r = await mod.synthesizeDeck({ ...validReq, title: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title is required/i);
  });

  it('synthesizeDeck — unsupported file rejected before DB (stop condition)', async () => {
    const r = await mod.synthesizeDeck({
      ...validReq,
      files: [{ name: 'doc.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: 'x' }],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/conversion required|does not accept office/i);
  });

  it('synthesizeDeck — empty sources rejected before DB', async () => {
    const r = await mod.synthesizeDeck({ ...validReq, sources: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at least one source/i);
  });

  it('ensureClaudeProviders — PG yo\u2018q → graceful error', async () => {
    const r = await mod.ensureClaudeProviders();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('updateClaudeProvider — unsupported model rejected before DB', async () => {
    const r = await mod.updateClaudeProvider({ model: 'gpt-7' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unsupported model/i);
  });

  it('read paths — PG yo\u2018q → empty graceful shapes', async () => {
    expect(await mod.listClaudeJobs()).toEqual([]);
    expect(await mod.getClaudeJob(1)).toBeNull();
    expect(await mod.getClaudeJobEvents(1)).toEqual([]);
    const dash = await mod.getClaudeDashboard();
    expect(dash.ok).toBe(false);
    expect(Array.isArray(dash.providers)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FULL SUCCESS FLOW — in-memory DB + mocked provider (§57-20)
// ═══════════════════════════════════════════════════════════════════

describe('claude — full success flow with in-memory DB (Prompt 57 §20)', () => {
  let mod;
  let tables;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({
      source_packs: [
        { id: 1, tenant_id: 1, title: 'Biologiya darslik', url: 'https://x/1' },
        { id: 2, tenant_id: 1, title: 'Kimyo', url: 'https://x/2' },
      ],
    });
    tables = fake.tables;
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: { CLAUDE_SYNTHESIZE: 'claude:synthesize', CLAUDE_JOB_FAILED: 'claude:job:failed', CLAUDE_PROVIDER_UPDATE: 'claude:provider:update' },
    }));
    vi.doMock('../../src/modules/claude/claude.client.js', async () => {
      const actual = await vi.importActual('../../src/modules/claude/claude.client.js');
      return {
        ...actual,
        getApiKey: () => 'sk-test',
        streamMessage: async ({ onEvent }) => {
          onEvent?.({ event: 'content_block_delta', data: { delta: { type: 'text_delta', text: 'x' } } });
          return { ok: true, text: DECK_TEXT, usage: { input_tokens: 100, output_tokens: 50 }, stopReason: 'end_turn' };
        },
      };
    });
    mod = await import('../../src/modules/claude/index.js');
  });

  it('synthesizeDeck — success: job persisted, canonical doc, attribution, usage', async () => {
    const r = await mod.synthesizeDeck({ title: 'Fotosintez', language: 'uz', theme: 'academic', slideCount: 8, sources: [1, 2] });
    expect(r.ok, `synthesizeDeck error: ${r.error}`).toBe(true);
    expect(r.jobId).toBe(1);
    expect(r.document.slides).toHaveLength(2);
    expect(r.document.provider.name).toBe('claude');
    expect(r.usage.cost).toBeGreaterThan(0);

    const job = tables['claude_synthesis_jobs'][0];
    expect(job.status).toBe('completed');
    // canonical_document jsonb column — string sifatida saqlanadi, parse qilinadi
    expect(typeof job.canonical_document).toBe('string');
    expect(JSON.parse(job.canonical_document).title).toBe('Fotosintez');

    // Attribution: src_1 → source pack 1
    expect(tables['claude_attributions']).toHaveLength(1);
    expect(tables['claude_attributions'][0].source_pack_id).toBe(1);

    // Usage accounting persisted
    expect(tables['claude_usage']).toHaveLength(1);

    // Streaming job events recorded
    expect(tables['claude_job_events'].map((e) => e.event_type)).toContain('job_queued');
    expect(tables['claude_job_events'].map((e) => e.event_type)).toContain('job_running');
    expect(tables['claude_job_events'].map((e) => e.event_type)).toContain('job_completed');
  });

  it('synthesizeDeck — idempotent: same request returns cached job', async () => {
    await mod.synthesizeDeck({ title: 'Fotosintez', language: 'uz', slideCount: 8, sources: [1, 2] });
    const r2 = await mod.synthesizeDeck({ title: 'Fotosintez', language: 'uz', slideCount: 8, sources: [2, 1] });
    expect(r2.ok).toBe(true);
    expect(r2.cached).toBe(true);
    expect(r2.jobId).toBe(1);
    expect(tables['claude_synthesis_jobs']).toHaveLength(1); // no duplicate
  });

  it('synthesizeDeck — circuit reset on success (failure_count → 0)', async () => {
    tables['claude_circuit_breakers'] = [{ id: 1, tenant_id: 1, provider: 'claude', model: 'claude-sonnet-5', failure_count: 7, open_until: new Date(Date.now() - 1000).toISOString(), last_error: 'old' }];
    const r = await mod.synthesizeDeck({ title: 'Fotosintez', language: 'uz', slideCount: 8, sources: [1, 2] });
    expect(r.ok).toBe(true);
    const circ = tables['claude_circuit_breakers'][0];
    expect(circ.failure_count).toBe(0);
    expect(circ.open_until).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// STREAM INTERRUPTION / RETRY CONTRACT (§57-19)
// ═══════════════════════════════════════════════════════════════════

describe('claude — stream interruption & retry (Prompt 57 §19)', () => {
  let clientMod;
  beforeEach(async () => {
    vi.resetModules();
    // Oldingi describe'ning claude.client.js mock'ini olib tashlaymiz —
    // stream testlari REAL client + fetchImpl injeksiyasini ishlatadi.
    // vi.doUnmock: doMock uchun mos (vi.unmock hoisted — modul yuklanishida ishlaydi).
    vi.doUnmock('../../src/modules/claude/claude.client.js');
    clientMod = await import('../../src/modules/claude/index.js');
  });

  it('streamMessage — mid-stream failure retries once then succeeds', async () => {
    let calls = 0;
    const fakeFetch = vi.fn(async () => {
      calls++;
      const body = new ReadableStream({
        start(controller) {
          if (calls === 1) {
            // Simulate abrupt interruption (network drop mid-stream)
            controller.error(new Error('stream interrupted (timeout/abort)'));
            return;
          }
          controller.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'));
          controller.close();
        },
      });
      return { status: 200, ok: true, body };
    });
    const r = await clientMod.streamMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'x' }],
      maxRetries: 2,
      fetchImpl: fakeFetch,
    });
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('ok');
  });

  it('streamMessage — persistent 529 with maxRetries 2 → succeeds on 3rd attempt', async () => {
    let calls = 0;
    const fakeFetch = vi.fn(async () => {
      calls++;
      if (calls <= 2) return { status: 529, ok: false };
      return { status: 200, ok: true, body: new ReadableStream({ start(c) { c.close(); } }) };
    });
    const r = await clientMod.streamMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'x' }],
      maxRetries: 2,
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('streamMessage — exhausted retries return error', async () => {
    let calls = 0;
    const fakeFetch = vi.fn(async () => {
      calls++;
      return { status: 529, ok: false };
    });
    const r = await clientMod.streamMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'x' }],
      maxRetries: 1,
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/529/i);
    expect(calls).toBe(2); // attempt 0 + attempt 1
  });
});
