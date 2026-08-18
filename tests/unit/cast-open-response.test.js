/**
 * Edikit — Cast C3-12 Open-Response Semantic Board Tests
 * -------------------------------------------------------
 * coverage: private collection + opaque IDs, PII/profanity SAFE_HOLD
 *           (hech qachon providerga yuborilmaydi), provider invalid schema,
 *           provider timeout → local fallback, manual merge/split/rename/
 *           move/confirm + event log, projector safe projection (confirmed
 *           only, identity yo'q), deletion hook, registry policy, state
 *           machine ORB phases, no-grade guard.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  getClusteringProvider,
  getActiveClusteringProvider,
  providerAllowsTraining,
  providerRetentionDays,
  providerSupportsDeletion,
  CLUSTERING_PROVIDERS,
  CLUSTERING_PROVIDER_POLICIES,
} from '../../services/cast/provider-registry.js';
import {
  normalizeTokens,
  tokenJaccard,
  localClustering,
  parseClusterResponse,
  httpClustering,
  runClustering,
  ClusteringAdapter,
  CLUSTERING_DEFAULTS,
} from '../../services/cast/clustering-adapter.js';
import {
  ORB_STATE,
  ORB_MANUAL_ACTIONS,
  ORB_RESPONSE_MAX,
  ORB_NEVER_GRADED,
  validateOpenResponse,
  opaqueResponseId,
  collectOpenResponse,
  buildProviderItems,
  recordClusterResult,
  getOrbData,
  applyManualActionPure,
  applyManualAction,
  listOrbEvents,
  buildProjectorBoard,
  deleteOrb,
} from '../../services/cast/open-response-service.js';
import { applyEvent, initialState, assertCommandAllowed, ALLOWED_NEXT_PHASE } from '../../services/cast/state-machine.js';
import { publicStateProjection } from '../../services/cast/projections.js';

const TEST_ROOT = 'cast_private/__orb_test';

describe('C3-12: Setup', () => {
  beforeAll(async () => {
    await fb.remove(TEST_ROOT);
  });
  it('prepares clean test root', async () => {
    const snap = await fb.get(TEST_ROOT);
    expect(snap.exists()).toBe(false);
  });
});

// ── C3-12 Provider registry (item 15) ──
describe('C3-12: Provider registry policy', () => {
  it('local provider is default, offline, no training use', () => {
    const p = getClusteringProvider(CLUSTERING_PROVIDERS.LOCAL);
    expect(p.id).toBe('local');
    expect(p.needsApiKey).toBe(false);
    expect(p.trainingUse).toBe(false);
    expect(p.supportsDeletion).toBe(true);
    expect(providerAllowsTraining('local')).toBe(false);
    expect(providerRetentionDays('local')).toBe(CLUSTERING_PROVIDER_POLICIES.local.retentionDays);
  });

  it('external provider requires API key + has policy', () => {
    const p = getClusteringProvider(CLUSTERING_PROVIDERS.EXTERNAL);
    expect(p.needsApiKey).toBe(true);
    expect(p.trainingUse).toBe(false); // training uchun yuborilmaydi
    expect(providerSupportsDeletion('external')).toBe(true);
  });

  it('unknown provider → null', () => {
    expect(getClusteringProvider('bogus')).toBeNull();
  });

  it('active provider respects env (external only when configured)', () => {
    const prevProvider = process.env.CAST_CLUSTERING_PROVIDER;
    const prevUrl = process.env.CAST_CLUSTERING_API_URL;
    const prevKey = process.env.CAST_CLUSTERING_API_KEY;
    process.env.CAST_CLUSTERING_PROVIDER = 'external';
    delete process.env.CAST_CLUSTERING_API_URL;
    delete process.env.CAST_CLUSTERING_API_KEY;
    expect(getActiveClusteringProvider().id).toBe('local'); // konfig bo'lmasa local
    process.env.CAST_CLUSTERING_API_URL = 'https://x.example/cluster';
    process.env.CAST_CLUSTERING_API_KEY = 'k';
    expect(getActiveClusteringProvider().id).toBe('external');
    process.env.CAST_CLUSTERING_PROVIDER = prevProvider;
    if (prevUrl) process.env.CAST_CLUSTERING_API_URL = prevUrl; else delete process.env.CAST_CLUSTERING_API_URL;
    if (prevKey) process.env.CAST_CLUSTERING_API_KEY = prevKey; else delete process.env.CAST_CLUSTERING_API_KEY;
  });
});

// ── C3-12 Clustering adapter (items 5-8, 14) ──
describe('C3-12: Clustering adapter', () => {
  it('adapter interface requires name + cluster', () => {
    expect(ClusteringAdapter.validate({ name: 'x', cluster: () => {} }).ok).toBe(true);
    expect(ClusteringAdapter.validate({ name: 'x' }).ok).toBe(false);
  });

  it('normalizeTokens strips punctuation, keeps latin+cyrillic words', () => {
    const t = normalizeTokens('Formulani noto‘g‘ri tanlash!');
    expect(t).toContain('formulani');
    expect(t).toContain('tanlash');
  });

  it('tokenJaccard similarity in 0..1', () => {
    const a = normalizeTokens('Formulani noto‘g‘ri tanlash');
    const b = normalizeTokens('Formulani noto‘g‘ri tanlash kerak edi');
    const c = normalizeTokens('Bugun ob-havo juda yaxshi');
    expect(tokenJaccard(a, b)).toBeGreaterThan(tokenJaccard(a, c));
    expect(tokenJaccard([], [])).toBe(0);
  });

  it('localClustering groups similar responses deterministically', () => {
    const items = [
      { responseId: 'r_1', text: 'Formulani noto‘g‘ri qo‘lladim' },
      { responseId: 'r_2', text: 'Formula noto‘g‘ri tanlandi' },
      { responseId: 'r_3', text: 'Formulani noto‘g‘ri ishlatdim' },
      { responseId: 'r_4', text: 'Boshqa mavzu haqida' },
    ];
    const res = localClustering(items, { similarityThreshold: 0.4 });
    expect(res.algorithm).toBe('local_jaccard');
    const cluster = res.clusters.find((c) => c.responseIds.length >= 2);
    expect(cluster).toBeTruthy();
    expect(cluster.confidence).toBeGreaterThan(0);
    expect(cluster.confidence).toBeLessThanOrEqual(0.95);
    expect(res.unclustered).toContain('r_4');
  });

  it('strict schema: valid provider response parses', () => {
    const { ok, parsed } = parseClusterResponse({
      status: 'SUGGESTED',
      clusters: [{ id: 'c_1', label: 'Formula xato', responseIds: ['r_1', 'r_2'], confidence: 0.8 }],
      unclusteredResponseIds: ['r_3'],
    });
    expect(ok).toBe(true);
    expect(parsed.clusters[0].teacherConfirmed).toBe(false);
  });

  it('invalid schema rejected (missing id / bad confidence / wrong status)', () => {
    expect(parseClusterResponse({ status: 'SUGGESTED', clusters: [{ label: 'x', responseIds: [] }] }).ok).toBe(false);
    expect(parseClusterResponse({ status: 'SUGGESTED', clusters: [{ id: 'c', label: 'x', responseIds: ['r'], confidence: 5 }] }).ok).toBe(false);
    expect(parseClusterResponse({ status: 'DONE', clusters: [] }).ok).toBe(false);
    expect(parseClusterResponse(null).ok).toBe(false);
    expect(parseClusterResponse({ status: 'SUGGESTED', clusters: 'nope' }).ok).toBe(false);
  });

  // AbortSignal'ni hurmat qiluvchi mock — real fetch kabi abort'da reject qiladi
  const abortAware = () => (_url, opts) => new Promise((_resolve, reject) => {
    if (opts && opts.signal) {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }
  });

  it('httpClustering timeout → { ok:false, TIMEOUT } (fallback trigger)', async () => {
    const res = await httpClustering([{ responseId: 'r_1', text: 'x' }], {
      url: 'https://x.example/cluster',
      apiKey: 'k',
      timeoutMs: 50,
      fetchImpl: abortAware(),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('TIMEOUT');
  });

  it('httpClustering invalid JSON → INVALID_JSON', async () => {
    const res = await httpClustering([{ responseId: 'r_1', text: 'x' }], {
      url: 'https://x.example/cluster',
      apiKey: 'k',
      timeoutMs: 500,
      fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('INVALID_JSON');
  });

  it('httpClustering invalid schema → INVALID_SCHEMA (no fallback inside)', async () => {
    const res = await httpClustering([{ responseId: 'r_1', text: 'x' }], {
      url: 'https://x.example/cluster',
      apiKey: 'k',
      timeoutMs: 500,
      fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'BROKEN' }) }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('INVALID_STATUS');
  });

  it('runClustering external failure → LOCAL fallback with usedFallback=true', async () => {
    const prevProvider = process.env.CAST_CLUSTERING_PROVIDER;
    const prevUrl = process.env.CAST_CLUSTERING_API_URL;
    const prevKey = process.env.CAST_CLUSTERING_API_KEY;
    process.env.CAST_CLUSTERING_PROVIDER = 'external';
    process.env.CAST_CLUSTERING_API_URL = 'https://x.example/cluster';
    process.env.CAST_CLUSTERING_API_KEY = 'k';
    try {
      const res = await runClustering(
        [
          { responseId: 'r_1', text: 'Formulani noto‘g‘ri qo‘lladim' },
          { responseId: 'r_2', text: 'Formula noto‘g‘ri tanlandi' },
        ],
        { timeoutMs: 30, fetchImpl: abortAware() },
      );
      expect(res.provider).toBe('local');
      expect(res.usedFallback).toBe(true);
      expect(res.fallbackReason).toBe('TIMEOUT');
    } finally {
      process.env.CAST_CLUSTERING_PROVIDER = prevProvider;
      if (prevUrl) process.env.CAST_CLUSTERING_API_URL = prevUrl; else delete process.env.CAST_CLUSTERING_API_URL;
      if (prevKey) process.env.CAST_CLUSTERING_API_KEY = prevKey; else delete process.env.CAST_CLUSTERING_API_KEY;
    }
  });

  it('runClustering default (local) works without env', async () => {
    const res = await runClustering([{ responseId: 'r_1', text: 'A' }, { responseId: 'r_2', text: 'B' }]);
    expect(res.provider).toBe('local');
    expect(res.usedFallback).toBe(false);
    expect(Array.isArray(res.clusters)).toBe(true);
  });
});

// ── C3-12 Open-response service (items 1-4, 6) ──
describe('C3-12: Collection + PII guard', () => {
  it('validateOpenResponse: 1..280 chars', () => {
    expect(validateOpenResponse('  ').error).toBe('EMPTY');
    expect(validateOpenResponse('x'.repeat(281)).error).toBe('TOO_LONG');
    expect(validateOpenResponse('  Javobim  ').clean).toBe('Javobim');
    expect(ORB_RESPONSE_MAX).toBe(280);
  });

  it('opaque response id: session-scoped, never participantId', () => {
    const id1 = opaqueResponseId('sess1', 1);
    const id2 = opaqueResponseId('sess2', 1);
    expect(id1).toMatch(/^r_[0-9a-f]{8}_1$/);
    expect(id1).not.toBe(id2); // session-scoped
  });

  it('clean response → RECEIVED (clusterable)', async () => {
    const res = await collectOpenResponse({ sessionId: '__orb_test', runId: 'orb_1', participantId: 'p_a', text: 'Formulani noto‘g‘ri tanladim', commandId: 'c1' });
    expect(res.ok).toBe(true);
    expect(res.item.state).toBe(ORB_STATE.RECEIVED);
    expect(res.item.responseId).toMatch(/^r_/);
  });

  it('PII (email) response → SAFE_HOLD, never in provider items', async () => {
    await collectOpenResponse({ sessionId: '__orb_test', runId: 'orb_1', participantId: 'p_b', text: 'Aloqa: ali@mail.uz', commandId: 'c2' });
    const data = await getOrbData('__orb_test', 'orb_1');
    const held = Object.values(data.responses).find((r) => r.participantId === 'p_b');
    expect(held.state).toBe(ORB_STATE.SAFE_HOLD);
    const providerItems = buildProviderItems(data.responses);
    // SAFE_HOLD item provider items'ga kirmaydi
    expect(providerItems.some((it) => it.text.includes('ali@mail.uz'))).toBe(false);
    // Identity provider items'da yo'q
    expect(JSON.stringify(providerItems)).not.toContain('participantId');
    expect(JSON.stringify(providerItems)).not.toContain('p_b');
  });

  it('profanity response → SAFE_HOLD (harmful safe hold)', async () => {
    await collectOpenResponse({ sessionId: '__orb_test', runId: 'orb_1', participantId: 'p_c', text: 'Bu ahmoqona savol edi', commandId: 'c3' });
    const data = await getOrbData('__orb_test', 'orb_1');
    const held = Object.values(data.responses).find((r) => r.participantId === 'p_c');
    expect(held.state).toBe(ORB_STATE.SAFE_HOLD);
  });

  it('provider items include only RECEIVED, identity-free', async () => {
    const data = await getOrbData('__orb_test', 'orb_1');
    const items = buildProviderItems(data.responses);
    expect(items.length).toBe(1); // faqat p_a ning RECEIVED javobi
    expect(items[0].text).toBe('Formulani noto‘g‘ri tanladim');
  });
});

// ── C3-12 Manual actions (items 10-11) + event log ──
describe('C3-12: Manual actions', () => {
  it('ORB_MANUAL_ACTIONS has exactly 5', () => {
    expect(ORB_MANUAL_ACTIONS).toEqual(['merge', 'split', 'rename', 'move', 'confirm']);
  });

  it('pure confirm marks teacherConfirmed + confirmedAt', () => {
    const state = { responses: {}, clusters: { c_1: { id: 'c_1', label: 'L', responseIds: ['r_1'], teacherConfirmed: false } }, unclustered: [] };
    const res = applyManualActionPure(state, 'confirm', { clusterId: 'c_1' });
    expect(res.ok).toBe(true);
    expect(res.next.clusters.c_1.teacherConfirmed).toBe(true);
    expect(res.next.clusters.c_1.confirmedAt).toBeTruthy();
    expect(res.event.action).toBe('confirm');
  });

  it('pure rename validates label', () => {
    const state = { clusters: { c_1: { id: 'c_1', label: 'Old', responseIds: ['r_1'] } }, unclustered: [] };
    expect(applyManualActionPure(state, 'rename', { clusterId: 'c_1', label: '   ' }).error).toBe('LABEL_REQUIRED');
    const ok = applyManualActionPure(state, 'rename', { clusterId: 'c_1', label: 'Yangi nom' });
    expect(ok.next.clusters.c_1.label).toBe('Yangi nom');
  });

  it('pure split moves responseIds to unclustered', () => {
    const state = { clusters: { c_1: { id: 'c_1', label: 'L', responseIds: ['r_1', 'r_2'] } }, unclustered: [] };
    const res = applyManualActionPure(state, 'split', { clusterId: 'c_1', responseIds: ['r_2'] });
    expect(res.next.clusters.c_1.responseIds).toEqual(['r_1']);
    expect(res.next.unclustered).toContain('r_2');
    const emptied = applyManualActionPure({ clusters: { c_1: { id: 'c_1', label: 'L', responseIds: ['r_1'] } }, unclustered: [] }, 'split', { clusterId: 'c_1', responseIds: ['r_1'] });
    expect(emptied.next.clusters.c_1).toBeUndefined();
  });

  it('pure merge requires 2 clusters, unions responseIds', () => {
    const state = {
      clusters: {
        c_1: { id: 'c_1', label: 'A', responseIds: ['r_1', 'r_2'], teacherConfirmed: false, confidence: 0.6 },
        c_2: { id: 'c_2', label: 'B', responseIds: ['r_3'], teacherConfirmed: false, confidence: 0.7 },
      },
      unclustered: [],
    };
    expect(applyManualActionPure(state, 'merge', { clusterIds: ['c_1'] }).error).toBe('MERGE_NEEDS_TWO');
    const res = applyManualActionPure(state, 'merge', { clusterIds: ['c_1', 'c_2'], label: 'Birlashgan' });
    const merged = Object.values(res.next.clusters).find((c) => c.manual);
    expect(merged.responseIds.sort()).toEqual(['r_1', 'r_2', 'r_3']);
    expect(merged.label).toBe('Birlashgan');
    expect(res.next.clusters.c_1).toBeUndefined();
  });

  it('pure move across clusters; invalid action rejected', () => {
    const state = { clusters: { a: { id: 'a', label: 'A', responseIds: ['r_1'] }, b: { id: 'b', label: 'B', responseIds: [] } }, unclustered: [] };
    const res = applyManualActionPure(state, 'move', { responseId: 'r_1', fromClusterId: 'a', toClusterId: 'b' });
    expect(res.next.clusters.b.responseIds).toContain('r_1');
    expect(res.next.clusters.a).toBeUndefined(); // bo'shab qoldi → o'chirildi
    expect(applyManualActionPure(state, 'delete', {}).error).toBe('INVALID_ACTION');
  });

  it('persisted manual action writes event log', async () => {
    // Cluster'ni avval yaratamiz (service path: cast_private/{sid}/orb/{runId})
    await fb.set(`${TEST_ROOT}/orb/orb_2/clusters/c_1`, { id: 'c_1', label: 'Formula', responseIds: ['r_1'], teacherConfirmed: false });
    await fb.set(`${TEST_ROOT}/orb/orb_2/responses/r_1`, { responseId: 'r_1', text: 'x', state: 'CLUSTERED' });
    const res = await applyManualAction({ sessionId: '__orb_test', runId: 'orb_2', action: 'confirm', payload: { clusterId: 'c_1' }, actorId: 'teacher', commandId: 'c10' });
    expect(res.ok).toBe(true);
    const events = await listOrbEvents('__orb_test', 'orb_2');
    expect(events.length).toBe(1);
    expect(events[0].action).toBe('confirm');
    expect(events[0].actorId).toBe('teacher');
  });
});

// ── C3-12 Cluster run persistence (fix: suggested clusters render in director UI) ──
describe('C3-12: Cluster run → getOrbData', () => {
  it('recordClusterResult persists suggested clusters + unclustered to data', async () => {
    const items = [
      { responseId: 'r_c1', text: 'Formula notogri qollandi' },
      { responseId: 'r_c2', text: 'Formula notogri tanlandi' },
      { responseId: 'r_c3', text: 'Boshqa mavzu haqida fikr bildiraman' },
    ];
    const result = await runClustering(items, { similarityThreshold: 0.4 });
    await recordClusterResult({ sessionId: '__orb_test', runId: 'orb_run', result, providerId: 'local' });
    const data = await getOrbData('__orb_test', 'orb_run');
    const suggested = Object.values(data.clusters).filter((c) => !c.teacherConfirmed);
    expect(suggested.length).toBeGreaterThan(0); // director UI suggested ustuni to'ladi
    expect(suggested[0].responseIds.length).toBeGreaterThanOrEqual(2);
    expect(data.unclustered.length).toBeGreaterThanOrEqual(0);
    expect(data.lastClusterRun.provider).toBe('local');
  });
});

// ── C3-12 Per-participant dedupe (overwrite) ──
describe('C3-12: Per-participant single response', () => {
  it('second submit replaces first (one response per participant)', async () => {
    await collectOpenResponse({ sessionId: '__orb_test', runId: 'orb_ded', participantId: 'p1', text: 'Birinchi javob', commandId: 'd1' });
    await collectOpenResponse({ sessionId: '__orb_test', runId: 'orb_ded', participantId: 'p1', text: 'Ikkinchi javob', commandId: 'd2' });
    const data = await getOrbData('__orb_test', 'orb_ded');
    const mine = Object.values(data.responses).filter((r) => r.participantId === 'p1');
    expect(mine.length).toBe(1);
    expect(mine[0].text).toBe('Ikkinchi javob');
  });
});

// ── C3-12 Merged confirmed clusters keep exemplar (fix) ──
describe('C3-12: Merged-confirmed exemplar', () => {
  it('merge of confirmed clusters yields projector exemplar', async () => {
    const root = `${TEST_ROOT}/orb/orb_mg`;
    await fb.set(`${root}/clusters/c_a`, { id: 'c_a', label: 'A', responseIds: ['r_a1', 'r_a2'], teacherConfirmed: true, confidence: 0.8 });
    await fb.set(`${root}/clusters/c_b`, { id: 'c_b', label: 'B', responseIds: ['r_b1'], teacherConfirmed: true, confidence: 0.7 });
    await fb.set(`${root}/responses/r_a1`, { responseId: 'r_a1', text: 'Formula xato', state: 'CONFIRMED' });
    await fb.set(`${root}/responses/r_a2`, { responseId: 'r_a2', text: 'Formula notogri', state: 'CONFIRMED' });
    await fb.set(`${root}/responses/r_b1`, { responseId: 'r_b1', text: 'Boshqa fikr', state: 'CONFIRMED' });
    const res = await applyManualAction({
      sessionId: '__orb_test', runId: 'orb_mg', action: 'merge',
      payload: { clusterIds: ['c_a', 'c_b'], label: 'Birlashgan' }, actorId: 'teacher', commandId: 'm1',
    });
    expect(res.ok).toBe(true);
    const board = await buildProjectorBoard('__orb_test', 'orb_mg');
    expect(board.clusters.length).toBe(1);
    expect(board.clusters[0].count).toBe(3);
    expect(board.clusters[0].exemplar).toBeTruthy();
  });
});

// ── C3-12 Projector safe projection (items 12-13) + grade guard ──
describe('C3-12: Projector safe projection', () => {
  it('public board created ONLY after teacher confirmation (tugallanish sharti)', async () => {
    // Hech qanday cluster yaratilmagan — board bo'sh
    const empty = await buildProjectorBoard('__orb_test', 'orb_1');
    expect(empty.clusters).toEqual([]);
    expect(empty.confirmedClusters).toBe(0);
  });

  it('confirmed cluster appears with label/count/exemplar, NO identity', async () => {
    // qo'lda cluster + confirm (service path: .../orb/{runId}/...)
    await fb.set(`${TEST_ROOT}/orb/orb_2/clusters/c_1`, { id: 'c_1', label: 'Formula xato', responseIds: ['r_1'], teacherConfirmed: true, confirmedAt: Date.now() });
    await fb.set(`${TEST_ROOT}/orb/orb_2/responses/r_1`, { responseId: 'r_1', text: 'Formulani noto‘g‘ri tanladim', state: 'CONFIRMED' });
    const board = await buildProjectorBoard('__orb_test', 'orb_2');
    expect(board.clusters.length).toBe(1);
    expect(board.clusters[0].label).toBe('Formula xato');
    expect(board.clusters[0].count).toBe(1);
    expect(board.clusters[0].exemplar).toContain('Formulani');
    const json = JSON.stringify(board);
    expect(json).not.toContain('participantId');
    expect(json).not.toContain('displayAlias');
    expect(json).not.toContain('flags');
  });

  it('suggested (unconfirmed) cluster NEVER public', async () => {
    await fb.set(`${TEST_ROOT}/orb/orb_3/clusters/c_x`, { id: 'c_x', label: 'Tasdiqlanmagan', responseIds: ['r_9'], teacherConfirmed: false });
    await fb.set(`${TEST_ROOT}/orb/orb_3/responses/r_9`, { responseId: 'r_9', text: 'sir', state: 'CLUSTERED' });
    const board = await buildProjectorBoard('__orb_test', 'orb_3');
    expect(board.clusters).toEqual([]);
  });

  it('ORB_NEVER_GRADED — clustering score/gradega aylanmaydi', () => {
    expect(ORB_NEVER_GRADED).toBe(true);
  });
});

// ── C3-12 Deletion hook (item 17) ──
describe('C3-12: Deletion hook', () => {
  it('local deletion removes orb data', async () => {
    await fb.set(`${TEST_ROOT}/orb/orb_del/responses/r_1`, { responseId: 'r_1', text: 'x', state: 'RECEIVED' });
    const res = await deleteOrb({ sessionId: '__orb_test', runId: 'orb_del', providerId: 'local' });
    expect(res.ok).toBe(true);
    const snap = await fb.get(`${TEST_ROOT}/orb/orb_del`);
    expect(snap.exists()).toBe(false);
  });

  it('external provider with supportsDeletion triggers provider-side hook', async () => {
    const prevUrl = process.env.CAST_CLUSTERING_DELETE_URL;
    const prevKey = process.env.CAST_CLUSTERING_API_KEY;
    process.env.CAST_CLUSTERING_DELETE_URL = 'https://x.example/delete';
    process.env.CAST_CLUSTERING_API_KEY = 'k';
    let called = false;
    try {
      const res = await deleteOrb({
        sessionId: '__orb_test',
        runId: 'orb_xt',
        providerId: 'external',
        fetchImpl: async () => { called = true; return { ok: true }; },
      });
      expect(called).toBe(true);
      expect(res.providerNotified).toBe(true);
      expect(res.ok).toBe(true);
    } finally {
      if (prevUrl) process.env.CAST_CLUSTERING_DELETE_URL = prevUrl; else delete process.env.CAST_CLUSTERING_DELETE_URL;
      if (prevKey) process.env.CAST_CLUSTERING_API_KEY = prevKey; else delete process.env.CAST_CLUSTERING_API_KEY;
    }
  });
});

// ── C3-12 State machine + reconnect projection ──
describe('C3-12: State machine ORB phases', () => {
  it('orb:opened → ORB_COLLECT; orb:closed → ORB_REVIEW; orb:ended → QUESTION_OPEN', () => {
    let st = initialState({ questionIds: ['q1'], questionCount: 1 });
    st = applyEvent(st, { type: 'orb:opened', payload: { runId: 'orb_1', prompt: 'Nega?', openedAt: 1, closesAt: 61000 }, serverAt: 1 });
    expect(st.phase).toBe('ORB_COLLECT');
    expect(st.orbFlow.runId).toBe('orb_1');
    st = applyEvent(st, { type: 'orb:closed', payload: { closedAt: 2 }, serverAt: 2 });
    expect(st.phase).toBe('ORB_REVIEW');
    st = applyEvent(st, { type: 'orb:ended', payload: { endedAt: 3 }, serverAt: 3 });
    expect(st.phase).toBe('QUESTION_OPEN');
    expect(st.orbFlow).toBeNull();
  });

  it('transitions: ORB_COLLECT → ORB_REVIEW → QUESTION_OPEN', () => {
    expect(ALLOWED_NEXT_PHASE.ORB_COLLECT).toContain('ORB_REVIEW');
    expect(ALLOWED_NEXT_PHASE.ORB_REVIEW).toContain('QUESTION_OPEN');
    expect(ALLOWED_NEXT_PHASE.ORB_REVIEW).toContain('ENDED');
  });

  it('assertCommandAllowed: orb:launch in THINK_TIME/REVEAL, orb:close in ORB_COLLECT, orb:manual in ORB_REVIEW', () => {
    const st = initialState({ questionIds: ['q1'], questionCount: 1 });
    expect(() => assertCommandAllowed({ ...st, phase: 'THINK_TIME' }, 'orb:launch')).not.toThrow();
    expect(() => assertCommandAllowed({ ...st, phase: 'ORB_COLLECT' }, 'orb:close')).not.toThrow();
    expect(() => assertCommandAllowed({ ...st, phase: 'ORB_REVIEW' }, 'orb:manual')).not.toThrow();
    expect(() => assertCommandAllowed({ ...st, phase: 'ORB_REVIEW' }, 'orb:close')).toThrow();
  });

  it('public state projection exposes orb context for reconnect', () => {
    const proj = publicStateProjection({ phase: 'ORB_COLLECT', questionId: null, orbFlow: { runId: 'orb_1', prompt: 'Nega?' } });
    expect(proj.orb.phase).toBe('COLLECT');
    expect(proj.orb.runId).toBe('orb_1');
    expect(proj.orb.prompt).toBe('Nega?');
    expect(JSON.stringify(proj.orb)).not.toContain('participantId');
    expect(publicStateProjection({ phase: 'LOBBY_OPEN' }).orb).toBeNull();
  });
});

// ── C3-12 Cleanup ──
describe('C3-12: Cleanup', () => {
  it('removes test data', async () => {
    await fb.remove(TEST_ROOT);
    const snap = await fb.get(TEST_ROOT);
    expect(snap.exists()).toBe(false);
  });
});
