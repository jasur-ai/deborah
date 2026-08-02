/**
 * Edikit — Unified Provider Async Adapter (integration tests, Prompt 58)
 *
 * Service qatlami: graceful degradation (PG'siz → 400/error),
 * validate-before-getDb, idempotency (request_hash), Gamma create flow
 * (job persistence + provider job id), Manus webhook replay/out-of-order
 * handling (§58-19), artifact copy on completion.
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
    raw: (str) => str,
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
        onConflict: (ocFn) => {
          let conflictCols = null;
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

/** Fixed Manus webhook payload. */
function manusWebhookBody({ taskId = 't1', seq = 1, event = 'task.progress', extra = {} }) {
  return JSON.stringify({ taskId, seq, event, ...extra });
}

describe('provider — graceful degradation (Prompt 58 §16)', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => null }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: {
        PROVIDER_JOB_CREATE: 'provider:job:create',
        PROVIDER_JOB_FAILED: 'provider:job:failed',
        PROVIDER_JOB_CANCEL: 'provider:job:cancel',
        PROVIDER_WEBHOOK_RECEIVED: 'provider:webhook:received',
        PROVIDER_WEBHOOK_REJECTED: 'provider:webhook:rejected',
        PROVIDER_ARTIFACT_COPY: 'provider:artifact:copy',
        PROVIDER_FOLLOW_UP: 'provider:follow-up',
        PROVIDER_CONFIG_UPDATE: 'provider:config:update',
      },
    }));
    vi.doMock('../../src/infrastructure/storage.js', () => ({
      default: { put: vi.fn(async () => ({ key: 'k', size: 1 })), getInfo: () => ({ type: 'local' }) },
    }));
    mod = await import('../../src/modules/provider/index.js');
  });

  it('createProviderJob — PG yo\u2018q → graceful error', async () => {
    const r = await mod.createProviderJob({ provider: 'gamma', title: 'Fotosintez' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('createProviderJob — invalid request rejected before DB', async () => {
    const r = await mod.createProviderJob({ provider: 'gamma', title: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title is required/i);
  });

  it('createProviderJob — invalid provider rejected before DB', async () => {
    const r = await mod.createProviderJob({ provider: 'canva', title: 'X' });
    expect(r.ok).toBe(false);
  });

  it('createProviderJob — PII in brief rejected before DB (§15)', async () => {
    const r = await mod.createProviderJob({ provider: 'manus', title: 'X', brief: 'Talaba aziza@mail.uz haqida' });
    expect(r.ok).toBe(false);
  });

  it('read paths — PG yo\u2018q → empty graceful shapes', async () => {
    expect(await mod.listProviderJobs()).toEqual([]);
    expect(await mod.getProviderJob(1)).toBeNull();
    expect(await mod.getProviderJobEvents(1)).toEqual([]);
    const dash = await mod.getProviderDashboard();
    expect(dash.ok).toBe(false);
    expect(Array.isArray(dash.configs)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GAMMA CREATE FLOW — in-memory DB + mocked client (§58-18)
// ═══════════════════════════════════════════════════════════════════

describe('provider — Gamma create flow with in-memory DB (Prompt 58 §18)', () => {
  let mod;
  let tables;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({});
    tables = fake.tables;
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: {
        PROVIDER_JOB_CREATE: 'provider:job:create',
        PROVIDER_JOB_FAILED: 'provider:job:failed',
        PROVIDER_JOB_CANCEL: 'provider:job:cancel',
        PROVIDER_WEBHOOK_RECEIVED: 'provider:webhook:received',
        PROVIDER_WEBHOOK_REJECTED: 'provider:webhook:rejected',
        PROVIDER_ARTIFACT_COPY: 'provider:artifact:copy',
        PROVIDER_FOLLOW_UP: 'provider:follow-up',
        PROVIDER_CONFIG_UPDATE: 'provider:config:update',
      },
    }));
    vi.doMock('../../src/infrastructure/storage.js', () => ({
      default: { put: vi.fn(async () => ({ key: 'k', size: 1 })), getInfo: () => ({ type: 'local' }) },
    }));
    // Mock provider client — Gamma create returns a generation id
    vi.doMock('../../src/modules/provider/provider.client.js', async () => {
      const actual = await vi.importActual('../../src/modules/provider/provider.client.js');
      return {
        ...actual,
        getGammaApiKey: () => 'sk-test',
        getManusApiKey: () => 'mk-test',
        getManusWebhookSecret: () => 'wh-secret',
        gammaCreate: async ({ payload }) => ({ ok: true, providerJobId: 'gen_1', raw: payload }),
        manusUploadFile: async ({ name }) => ({ ok: true, fileId: `f_${name || 'x'}`, raw: {} }),
        manusCreateProject: async () => ({ ok: true, projectId: 'proj_1', raw: {} }),
        manusCreateTask: async ({ payload }) => ({ ok: true, providerJobId: 'task_1', raw: payload }),
      };
    });
    mod = await import('../../src/modules/provider/index.js');
  });

  it('createProviderJob (gamma) — job persisted, provider job id linked, running', async () => {
    const r = await mod.createProviderJob({ provider: 'gamma', title: 'Fotosintez', numCards: 10, sourcePackIds: [1] });
    expect(r.ok, `create error: ${r.error}`).toBe(true);
    expect(r.jobId).toBe(1);
    expect(r.providerJobId).toBe('gen_1');
    expect(r.status).toBe('running');

    const job = tables['provider_jobs'][0];
    expect(job.provider).toBe('gamma');
    expect(job.provider_job_id).toBe('gen_1');
    expect(job.status).toBe('running');
    expect(job.request_hash).toMatch(/^p58_/);

    // Job event recorded
    expect(tables['provider_job_events'].map((e) => e.event_type)).toContain('job_created');
    // Attribution metadata persisted
    expect(JSON.parse(job.attribution)[0].provider).toBe('gamma');
  });

  it('createProviderJob (gamma) — idempotent: same request returns cached job', async () => {
    await mod.createProviderJob({ provider: 'gamma', title: 'Fotosintez', numCards: 10, sourcePackIds: [1, 2] });
    const r2 = await mod.createProviderJob({ provider: 'gamma', title: 'Fotosintez', numCards: 10, sourcePackIds: [2, 1] });
    expect(r2.ok).toBe(true);
    expect(r2.cached).toBe(true);
    expect(r2.jobId).toBe(1);
    expect(tables['provider_jobs']).toHaveLength(1); // no duplicate
  });

  it('createProviderJob (manus) — task created, status webhook_pending', async () => {
    const r = await mod.createProviderJob({ provider: 'manus', title: 'Tarix', numCards: 8, brief: 'Research qiling' });
    expect(r.ok, `create error: ${r.error}`).toBe(true);
    expect(r.providerJobId).toBe('task_1');
    expect(r.status).toBe('webhook_pending');
    const job = tables['provider_jobs'][0];
    expect(job.provider).toBe('manus');
    expect(job.status).toBe('webhook_pending');
  });
});

// ═══════════════════════════════════════════════════════════════════
// MANUS WEBHOOK — REPLAY / OUT-OF-ORDER (§58-19)
// ═══════════════════════════════════════════════════════════════════

describe('provider — Manus webhook replay & out-of-order (Prompt 58 §19)', () => {
  let mod;
  let tables;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({});
    tables = fake.tables;
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: {
        PROVIDER_JOB_CREATE: 'provider:job:create',
        PROVIDER_JOB_FAILED: 'provider:job:failed',
        PROVIDER_JOB_CANCEL: 'provider:job:cancel',
        PROVIDER_WEBHOOK_RECEIVED: 'provider:webhook:received',
        PROVIDER_WEBHOOK_REJECTED: 'provider:webhook:rejected',
        PROVIDER_ARTIFACT_COPY: 'provider:artifact:copy',
        PROVIDER_FOLLOW_UP: 'provider:follow-up',
        PROVIDER_CONFIG_UPDATE: 'provider:config:update',
      },
    }));
    vi.doMock('../../src/infrastructure/storage.js', () => ({
      default: { put: vi.fn(async () => ({ key: 'k', size: 1 })), getInfo: () => ({ type: 'local' }) },
    }));
    vi.doMock('../../src/modules/provider/provider.client.js', async () => {
      const actual = await vi.importActual('../../src/modules/provider/provider.client.js');
      return {
        ...actual,
        getGammaApiKey: () => 'sk-test',
        getManusApiKey: () => 'mk-test',
        getManusWebhookSecret: () => 'wh-secret',
        downloadArtifact: async ({ url }) => ({ ok: true, buffer: Buffer.from('deck'), size: 4, contentType: 'application/pdf' }),
      };
    });
    mod = await import('../../src/modules/provider/index.js');
  });

  function seedJob({ taskId = 't1', lastSeq = 0, status = 'webhook_pending' } = {}) {
    tables['provider_jobs'] = [{
      id: 1,
      tenant_id: 1,
      request_hash: 'p58_test',
      provider: 'manus',
      kind: 'presentation',
      title: 'Tarix',
      brief: JSON.stringify({}),
      provider_job_id: taskId,
      provider_project_id: 'proj_1',
      status,
      artifact_meta: JSON.stringify({ webhookLastSeq: lastSeq }),
      attribution: '[]',
      usage: '{}',
      created_at: new Date(),
      updated_at: new Date(),
    }];
  }

  // Real HMAC signature computed for the given body
  async function sign(body, secret = 'wh-secret') {
    // Node's crypto available in tests
    const { createHmac } = await import('crypto');
    return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  it('webhook — invalid signature rejected (401 path)', async () => {
    seedJob();
    const body = manusWebhookBody({ seq: 1 });
    const r = await mod.handleManusWebhook({ signature: 'sha256=deadbeef', body, bodyObj: JSON.parse(body) });
    expect(r.ok).toBe(false);
    expect(r.rejected).toBe(true);
  });

  it('webhook — replay (duplicate seq) is idempotent, no duplicate artifacts', async () => {
    seedJob({ lastSeq: 3 });
    const body = manusWebhookBody({ seq: 2, event: 'task.progress' });
    const r = await mod.handleManusWebhook({
      signature: await sign(body),
      body,
      bodyObj: JSON.parse(body),
    });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(true);
    expect(tables['provider_artifacts'] || []).toHaveLength(0);
  });

  it('webhook — out-of-order seq buffered, gap recorded', async () => {
    seedJob({ lastSeq: 1 });
    const body = manusWebhookBody({ seq: 5, event: 'task.progress' });
    const r = await mod.handleManusWebhook({
      signature: await sign(body),
      body,
      bodyObj: JSON.parse(body),
    });
    expect(r.ok).toBe(true);
    expect(r.buffered).toBe(true);
    // Job not completed; buffered seq recorded
    expect(tables['provider_jobs'][0].status).toBe('webhook_pending');
    const meta = JSON.parse(tables['provider_jobs'][0].artifact_meta);
    expect(meta.webhookBuffer.seq).toBe(5);
  });

  it('webhook — task.completed → artifact copied to object storage', async () => {
    seedJob({ lastSeq: 2 });
    const body = manusWebhookBody({
      seq: 3,
      event: 'task.completed',
      extra: {
        viewerUrl: 'https://manus.ai/view/1',
        artifacts: [{ url: 'https://manus.ai/dl/1.pdf', kind: 'export' }],
      },
    });
    const r = await mod.handleManusWebhook({
      signature: await sign(body),
      body,
      bodyObj: JSON.parse(body),
    });
    expect(r.ok, `webhook error: ${r.error}`).toBe(true);
    expect(r.status).toBe('completed');
    expect(r.copied).toBeGreaterThan(0);
    expect(tables['provider_jobs'][0].status).toBe('completed');
    expect(tables['provider_jobs'][0].artifact_key).toMatch(/provider\/manus/);
    expect(tables['provider_artifacts'] || []).toHaveLength(2); // preview + export
  });

  it('webhook — task.failed → dead letter recorded', async () => {
    seedJob({ lastSeq: 2 });
    const body = manusWebhookBody({ seq: 3, event: 'task.failed', extra: { error: 'agent crash' } });
    const r = await mod.handleManusWebhook({
      signature: await sign(body),
      body,
      bodyObj: JSON.parse(body),
    });
    expect(r.ok).toBe(false);
    expect(r.deadLetter).toBe(true);
    expect(tables['provider_dead_letters']).toHaveLength(1);
    expect(tables['provider_dead_letters'][0].error).toContain('agent crash');
    expect(tables['provider_jobs'][0].status).toBe('failed');
  });

  it('webhook — unknown task rejected silently (no data leak)', async () => {
    const body = manusWebhookBody({ taskId: 'ghost', seq: 1 });
    const r = await mod.handleManusWebhook({ signature: await sign(body), body, bodyObj: JSON.parse(body) });
    expect(r.ok).toBe(false);
    expect(r.rejected).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GAMMA POLL — COMPLETED → ARTIFACT COPY (§58-08/12)
// ═══════════════════════════════════════════════════════════════════

describe('provider — Gamma poll completion & artifact copy (Prompt 58 §08/12)', () => {
  let mod;
  let tables;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({});
    tables = fake.tables;
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: {
        PROVIDER_JOB_CREATE: 'provider:job:create',
        PROVIDER_JOB_FAILED: 'provider:job:failed',
        PROVIDER_JOB_CANCEL: 'provider:job:cancel',
        PROVIDER_WEBHOOK_RECEIVED: 'provider:webhook:received',
        PROVIDER_WEBHOOK_REJECTED: 'provider:webhook:rejected',
        PROVIDER_ARTIFACT_COPY: 'provider:artifact:copy',
        PROVIDER_FOLLOW_UP: 'provider:follow-up',
        PROVIDER_CONFIG_UPDATE: 'provider:config:update',
      },
    }));
    vi.doMock('../../src/infrastructure/storage.js', () => ({
      default: { put: vi.fn(async () => ({ key: 'k', size: 1 })), getInfo: () => ({ type: 'local' }) },
    }));
    vi.doMock('../../src/modules/provider/provider.client.js', async () => {
      const actual = await vi.importActual('../../src/modules/provider/provider.client.js');
      return {
        ...actual,
        getGammaApiKey: () => 'sk-test',
        getManusApiKey: () => 'mk-test',
        getManusWebhookSecret: () => 'wh-secret',
        gammaPoll: async () => ({
          ok: true,
          raw: {
            id: 'gen_1',
            status: 'completed',
            gammaUrl: 'https://gamma.app/p/1',
            exportUrl: 'https://gamma.app/x/deck.pdf',
            exportFormats: ['pdf', 'pptx'],
            credits: 12,
          },
        }),
        downloadArtifact: async ({ url }) => ({ ok: true, buffer: Buffer.from('deck'), size: 4, contentType: 'application/pdf' }),
      };
    });
    mod = await import('../../src/modules/provider/index.js');
  });

  it('pollGammaJob — completed: artifacts copied to storage, job updated', async () => {
    tables['provider_jobs'] = [{
      id: 1,
      tenant_id: 1,
      request_hash: 'p58_g',
      provider: 'gamma',
      kind: 'presentation',
      title: 'Fotosintez',
      brief: JSON.stringify({}),
      provider_job_id: 'gen_1',
      status: 'running',
      attribution: '[]',
      usage: '{}',
      created_at: new Date(),
      updated_at: new Date(),
    }];

    const r = await mod.pollGammaJob({ jobId: 1, maxAttempts: 1, persistOnly: true });
    expect(r.ok, `poll error: ${r.error}`).toBe(true);
    expect(r.status).toBe('completed');

    const job = tables['provider_jobs'][0];
    expect(job.status).toBe('completed');
    expect(job.preview_url).toContain('gamma.app/p/');
    expect(job.artifact_key).toMatch(/provider\/gamma/);
    expect(JSON.parse(job.usage).credits).toBe(12);

    // Artifacts copied (preview + export)
    expect(tables['provider_artifacts']).toHaveLength(2);
    expect(tables['provider_artifacts'].some((a) => a.kind === 'preview')).toBe(true);
    expect(tables['provider_artifacts'].some((a) => a.kind === 'export' && a.expiring)).toBe(true);

    // Events: polling → completed + artifact_copied
    const events = tables['provider_job_events'].map((e) => e.event_type);
    expect(events).toContain('job_completed');
    expect(events).toContain('artifact_copied');
  });

  it('pollGammaJob — completed job returns cached (idempotent)', async () => {
    tables['provider_jobs'] = [{
      id: 1, tenant_id: 1, request_hash: 'p58_g', provider: 'gamma', kind: 'presentation',
      title: 'F', brief: '{}', provider_job_id: 'gen_1', status: 'completed',
      attribution: '[]', usage: '{}', created_at: new Date(), updated_at: new Date(),
    }];
    const r = await mod.pollGammaJob({ jobId: 1, maxAttempts: 1 });
    expect(r.ok).toBe(true);
    expect(r.cached).toBe(true);
    expect(r.status).toBe('completed');
  });
});
