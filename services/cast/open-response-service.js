/**
 * Deborah — Cast Open-Response Service (C3-12)
 * --------------------------------------------
 * Open-Response Semantic Board.
 *
 * Flow: raw open response'lar PRIVATE storega yoziladi (item 1), har
 * response moderation state oladi (item 2), PII/profanity o'tmaganlari
 * clustering provider'ga opaque response ID + cleaned text bilan yuboriladi
 * (item 3-4, 6). Teacher unclustered/suggested/confirmed ustunlarini ko'radi
 * (item 9), merge/split/rename/move/confirm actionlari (item 10) event logga
 * yoziladi (item 11). Projector'ga FAQAT confirmed label/count/exemplar
 * chiqadi — raw identity yo'q (item 12-13). Provider timeout'da manual tag
 * board + lokal fallback (item 14). Cluster natijasi score/gradega ta'sir
 * qilmaydi (item 16). Delete/retention provider-side deletion hook (item 17).
 *
 * "Public board teacher confirmationisiz yaratilmaydi" (tugallanish sharti):
 * buildProjectorBoard faqat teacherConfirmed cluster'larni qaytaradi.
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { flagSensitive } from './moderation-service.js';
import {
  getClusteringProvider,
  providerRetentionDays,
  providerSupportsDeletion,
} from './provider-registry.js';

// ── States / actions ──
export const ORB_STATE = {
  RECEIVED: 'RECEIVED', // qabul qilindi — clustering'ga tayyor
  SAFE_HOLD: 'SAFE_HOLD', // PII/profanity — provider'ga yuborilmaydi (item 3)
  CLUSTERED: 'CLUSTERED',
  CONFIRMED: 'CONFIRMED', // teacher tasdiqladi — projector'ga chiqadi
  HIDDEN: 'HIDDEN',
};

export const ORB_MANUAL_ACTIONS = ['merge', 'split', 'rename', 'move', 'confirm'];
export const ORB_RESPONSE_MAX = 280;
export const ORB_EXEMPLAR_MAX = 140;

/** Score/grade guard — clustering hech qachon grade'ga aylanmaydi (item 16). */
export const ORB_NEVER_GRADED = true;

const ORB_ROOT = (sessionId, runId) => `cast_private/${sessionId}/orb/${runId}`;

// ── Validation ──

/**
 * Open response matnini tekshirish.
 * @returns {{ok:boolean, clean?:string, error?:string}}
 */
export function validateOpenResponse(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return { ok: false, error: 'EMPTY' };
  if (clean.length > ORB_RESPONSE_MAX) return { ok: false, error: 'TOO_LONG' };
  return { ok: true, clean };
}

/** Session-scoped opaque response ID — hech qachon participantId emas (item 6). */
export function opaqueResponseId(sessionId, index) {
  const h = crypto.createHash('sha1').update(String(sessionId)).digest('hex').slice(0, 8);
  return `r_${h}_${index}`;
}

// ── Collection (item 1-2, 3) ──

/**
 * Raw open response'ni private storega yozish + moderation state.
 * PII/profanity → SAFE_HOLD (provider'ga yuborilmaydi).
 * @returns {Promise<{ok:boolean, item?:object, error?:string}>}
 */
export async function collectOpenResponse({ sessionId, runId, participantId, text, commandId }) {
  const v = validateOpenResponse(text);
  if (!v.ok) return { error: v.error };
  const { flags, priority } = flagSensitive(v.clean);
  const sensitive = flags.email || flags.phone || flags.profanity || flags.pii || flags.url;
  const root = ORB_ROOT(sessionId, runId);
  // Per-participant bitta javob — yangi javob eskisini almashtiradi (POE kabi)
  const snap0 = await fb.get(`${root}/responses`);
  if (snap0.exists()) {
    for (const [rid, r] of Object.entries(snap0.val())) {
      if (r && r.participantId === participantId) {
        await fb.remove(`${root}/responses/${rid}`);
      }
    }
  }
  const snap = await fb.get(`${root}/responses`);
  const existing = snap.exists() ? snap.val() : {};
  const count = Object.keys(existing).length;
  const responseId = opaqueResponseId(sessionId, count + 1);
  const item = {
    responseId,
    participantId, // PRIVATE — projector projection'da chiqmaydi
    text: v.clean,
    state: sensitive ? ORB_STATE.SAFE_HOLD : ORB_STATE.RECEIVED,
    flags,
    priority,
    at: Date.now(),
    commandId,
  };
  await fb.set(`${root}/responses/${responseId}`, item);
  return { ok: true, item };
}

/**
 * Provider'ga yuboriladigan itemlar — faqat RECEIVED, cleaned text,
 * opaque response ID. SAFE_HOLD (PII) va identity CHIQARIB TASHLANADI.
 * @returns {Array<{responseId:string, text:string}>}
 */
export function buildProviderItems(records = {}) {
  return Object.values(records)
    .filter((r) => r && r.state === ORB_STATE.RECEIVED)
    .map((r) => ({ responseId: r.responseId, text: r.text }));
}

// ── Cluster run (item 5-8) ──

/** Cluster natijasini saqlash (SUGGESTED). */
export async function recordClusterResult({ sessionId, runId, result, providerId }) {
  const provider = getClusteringProvider(providerId);
  const root = ORB_ROOT(sessionId, runId);
  const run = {
    at: Date.now(),
    provider: result.provider,
    usedFallback: !!result.usedFallback,
    fallbackReason: result.fallbackReason || null,
    clusters: result.clusters || [],
    unclusteredResponseIds: result.unclustered || [],
    retentionDays: providerRetentionDays(providerId),
    trainingUse: provider ? provider.trainingUse : false,
  };
  await fb.set(`${root}/cluster_runs/last`, run);
  // Suggested cluster'larni ${root}/clusters ga persist — director UI shu yerdan o'qiydi.
  // Oldingi tasdiqlanmagan (suggested) cluster'lar yangi run natijalari bilan almashtiriladi;
  // teacherConfirmed cluster'lar saqlanib qoladi.
  const clustersSnap = await fb.get(`${root}/clusters`);
  if (clustersSnap.exists()) {
    for (const [cid, c] of Object.entries(clustersSnap.val())) {
      if (c && !c.teacherConfirmed) await fb.remove(`${root}/clusters/${cid}`);
    }
  }
  for (const c of result.clusters || []) {
    await fb.set(`${root}/clusters/${c.id}`, { ...c, at: Date.now() });
  }
  // Unclustered'ni meta'ga persist
  const metaSnap = await fb.get(`${root}/meta`);
  const meta = metaSnap.exists() ? metaSnap.val() : {};
  await fb.set(`${root}/meta`, { ...meta, unclustered: result.unclustered || [] });
  // Response state'larini yangilash: RECEIVED → CLUSTERED (biriktirilganlar)
  const responsesSnap = await fb.get(`${root}/responses`);
  if (responsesSnap.exists()) {
    const responses = responsesSnap.val();
    const inClusters = new Set((result.clusters || []).flatMap((c) => c.responseIds || []));
    for (const [rid, r] of Object.entries(responses)) {
      if (r.state === ORB_STATE.RECEIVED && inClusters.has(rid)) {
        await fb.set(`${root}/responses/${rid}/state`, ORB_STATE.CLUSTERED);
      }
    }
  }
  return run;
}

/** Director-private holat: responses + clusters + unclustered + meta + events. */
export async function getOrbData(sessionId, runId) {
  const root = ORB_ROOT(sessionId, runId);
  const [metaSnap, responsesSnap, clustersSnap, lastRunSnap, eventsSnap] = await Promise.all([
    fb.get(`${root}/meta`),
    fb.get(`${root}/responses`),
    fb.get(`${root}/clusters`),
    fb.get(`${root}/cluster_runs/last`),
    fb.get(`${root}/events`),
  ]);
  const metaVal = metaSnap.exists() ? metaSnap.val() : {};
  const unclustered = [
    ...(Array.isArray(metaVal.unclustered) ? metaVal.unclustered : []),
    ...(lastRunSnap.exists() ? lastRunSnap.val().unclusteredResponseIds || [] : []),
  ];
  return {
    meta: {
      runId,
      prompt: metaVal.prompt || null,
      openedAt: metaVal.openedAt || null,
      closedAt: metaVal.closedAt || null,
      status: metaVal.status || 'COLLECT',
      provider: metaVal.provider || 'local',
      retentionDays: metaVal.retentionDays || 14,
    },
    responses: responsesSnap.exists() ? responsesSnap.val() : {},
    clusters: clustersSnap.exists() ? clustersSnap.val() : {},
    lastClusterRun: lastRunSnap.exists() ? lastRunSnap.val() : null,
    unclustered: [...new Set(unclustered)],
    events: eventsSnap.exists() ? Object.values(eventsSnap.val()) : [],
  };
}

// ── Manual actions (item 10-11) — PURE ──

/**
 * Pure manual action. state = { responses, clusters, unclustered }.
 * @returns {{ok:boolean, next?:object, event?:object, error?:string}}
 */
export function applyManualActionPure(state, action, payload = {}) {
  if (!ORB_MANUAL_ACTIONS.includes(action)) return { ok: false, error: 'INVALID_ACTION' };
  const clusters = { ...(state.clusters || {}) };
  let unclustered = [...(state.unclustered || [])];
  let eventPayload = {};

  if (action === 'merge') {
    const clusterIds = Array.isArray(payload.clusterIds) ? payload.clusterIds : [];
    if (clusterIds.length < 2) return { ok: false, error: 'MERGE_NEEDS_TWO' };
    const found = clusterIds.map((id) => clusters[id]).filter(Boolean);
    if (found.length !== clusterIds.length) return { ok: false, error: 'CLUSTER_NOT_FOUND' };
    const responseIds = [...new Set(found.flatMap((c) => c.responseIds || []))];
    const newId = 'c_man_' + crypto.randomBytes(4).toString('hex');
    const label = String(payload.label || '').trim().slice(0, 120) || found[0].label;
    clusters[newId] = {
      id: newId,
      label,
      responseIds,
      confidence: Math.max(...found.map((c) => c.confidence || 0)),
      teacherConfirmed: found.every((c) => c.teacherConfirmed),
      manual: true,
      at: Date.now(),
      confirmedAt: found.every((c) => c.teacherConfirmed) ? Date.now() : null,
    };
    for (const id of clusterIds) delete clusters[id];
    unclustered = unclustered.filter((rid) => !responseIds.includes(rid));
    eventPayload = { clusterIds, newClusterId: newId, label, responseIds };
  }

  if (action === 'split') {
    const cluster = clusters[payload.clusterId];
    if (!cluster) return { ok: false, error: 'CLUSTER_NOT_FOUND' };
    const responseIds = Array.isArray(payload.responseIds) ? payload.responseIds : [];
    const valid = responseIds.filter((rid) => cluster.responseIds.includes(rid));
    if (!valid.length) return { ok: false, error: 'EMPTY_SPLIT' };
    cluster.responseIds = cluster.responseIds.filter((rid) => !valid.includes(rid));
    unclustered = [...new Set([...unclustered, ...valid])];
    if (!cluster.responseIds.length) delete clusters[payload.clusterId];
    eventPayload = { clusterId: payload.clusterId, responseIds: valid };
  }

  if (action === 'rename') {
    const cluster = clusters[payload.clusterId];
    if (!cluster) return { ok: false, error: 'CLUSTER_NOT_FOUND' };
    const label = String(payload.label || '').trim().slice(0, 120);
    if (!label) return { ok: false, error: 'LABEL_REQUIRED' };
    cluster.label = label;
    eventPayload = { clusterId: payload.clusterId, label };
  }

  if (action === 'move') {
    const { responseId, fromClusterId, toClusterId } = payload;
    if (!responseId || !toClusterId) return { ok: false, error: 'MOVE_REQUIRES_TARGET' };
    const to = clusters[toClusterId];
    if (!to) return { ok: false, error: 'TARGET_NOT_FOUND' };
    if (fromClusterId && clusters[fromClusterId]) {
      clusters[fromClusterId].responseIds = clusters[fromClusterId].responseIds.filter((r) => r !== responseId);
      if (!clusters[fromClusterId].responseIds.length) delete clusters[fromClusterId];
    }
    if (!to.responseIds.includes(responseId)) to.responseIds.push(responseId);
    unclustered = unclustered.filter((r) => r !== responseId);
    eventPayload = { responseId, fromClusterId: fromClusterId || null, toClusterId };
  }

  if (action === 'confirm') {
    const cluster = clusters[payload.clusterId];
    if (!cluster) return { ok: false, error: 'CLUSTER_NOT_FOUND' };
    cluster.teacherConfirmed = true;
    cluster.confirmedAt = Date.now();
    // Confirmed cluster ichidagi response'lar → CONFIRMED state
    eventPayload = { clusterId: payload.clusterId, responseIds: cluster.responseIds };
  }

  return {
    ok: true,
    next: { clusters, unclustered },
    event: { action, at: Date.now(), payload: eventPayload },
  };
}

/**
 * Manual action'ni persist qilish + event log (item 11).
 * @returns {Promise<{ok:boolean, error?:string, event?:object}>}
 */
export async function applyManualAction({ sessionId, runId, action, payload = {}, actorId = null, commandId }) {
  const data = await getOrbData(sessionId, runId);
  const res = applyManualActionPure(
    { responses: data.responses, clusters: data.clusters, unclustered: data.unclustered },
    action,
    payload,
  );
  if (!res.ok) return { ok: false, error: res.error };

  const root = ORB_ROOT(sessionId, runId);
  // Cluster'lar va unclustered'ni persist. teacherConfirmed cluster'lar a'zolari
  // CONFIRMED state oladi (confirm ham, confirmed cluster'lar merge'i ham exemplar saqlaydi)
  for (const [cid, c] of Object.entries(res.next.clusters)) {
    await fb.set(`${root}/clusters/${cid}`, c);
    if (c.teacherConfirmed) {
      for (const rid of c.responseIds || []) {
        await fb.set(`${root}/responses/${rid}/state`, ORB_STATE.CONFIRMED);
      }
    }
  }
  // O'chirilgan cluster'lar (merge/split/move) — mavjud bo'lmaganlarini tozalash
  const clustersSnap = await fb.get(`${root}/clusters`);
  if (clustersSnap.exists()) {
    const existingIds = Object.keys(clustersSnap.val());
    for (const cid of existingIds) {
      if (!res.next.clusters[cid]) await fb.remove(`${root}/clusters/${cid}`);
    }
  }
  const metaSnap = await fb.get(`${root}/meta`);
  const meta = metaSnap.exists() ? metaSnap.val() : {};
  await fb.set(`${root}/meta`, { ...meta, unclustered: res.next.unclustered });

  // Event log (seq-managed)
  const seqSnap = await fb.get(`${root}/events`);
  const seq = seqSnap.exists() ? Object.keys(seqSnap.val()).length + 1 : 1;
  const event = { ...res.event, seq, actorId, commandId };
  await fb.set(`${root}/events/${seq}`, event);
  return { ok: true, event };
}

/** Event log'ni o'qish (director-private). */
export async function listOrbEvents(sessionId, runId) {
  const snap = await fb.get(`${ORB_ROOT(sessionId, runId)}/events`);
  return snap.exists() ? Object.values(snap.val()) : [];
}

// ── Projector safe projection (item 12-13) ──

/**
 * Projector uchun board — FAQAT teacherConfirmed cluster'lar.
 * Identity (participantId), flags, priority, raw response ro'yxati yo'q.
 * @returns {Promise<{clusters:Array, totalResponses:number, confirmedClusters:number}>}
 */
export async function buildProjectorBoard(sessionId, runId) {
  const data = await getOrbData(sessionId, runId);
  const responses = data.responses;
  const clusters = Object.values(data.clusters).filter((c) => c && c.teacherConfirmed);
  const safe = clusters.map((c) => {
    let exemplar = '';
    for (const rid of c.responseIds || []) {
      const r = responses[rid];
      if (r && r.state === ORB_STATE.CONFIRMED) {
        exemplar = String(r.text || '').slice(0, ORB_EXEMPLAR_MAX);
        break;
      }
    }
    return {
      id: c.id,
      label: c.label,
      count: (c.responseIds || []).length,
      exemplar,
    };
  });
  return {
    clusters: safe,
    totalResponses: Object.keys(responses).length,
    confirmedClusters: safe.length,
  };
}

// ── Deletion hook (item 17) + retention ──

/**
 * ORB'ni o'chirish. External provider supportsDeletion bo'lsa provider-side
 * deletion'ga xabar yuboriladi (best-effort), keyin lokal ma'lumot o'chiriladi.
 * @returns {Promise<{ok:boolean, providerNotified:boolean}>}
 */
export async function deleteOrb({ sessionId, runId, providerId = 'local', fetchImpl = null }) {
  let providerNotified = false;
  const provider = getClusteringProvider(providerId);
  if (provider && providerSupportsDeletion(providerId) && providerId !== 'local') {
    const url = process.env.CAST_CLUSTERING_DELETE_URL;
    const apiKey = process.env.CAST_CLUSTERING_API_KEY;
    const fetchFn = fetchImpl || globalThis.fetch;
    if (url && apiKey && typeof fetchFn === 'function') {
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ runId, reason: 'retention_deletion' }),
        });
        providerNotified = Boolean(res && res.ok);
      } catch (_) {
        providerNotified = false; // best-effort — lokal o'chirish davom etadi
      }
    }
  }
  await fb.remove(ORB_ROOT(sessionId, runId));
  return { ok: true, providerNotified };
}

/** Retention chegarasidan oshgan ORB'larni topish (purge job uchun). */
export async function listExpiredOrbs(sessionId, maxAgeDays = 14) {
  const snap = await fb.get(`cast_private/${sessionId}/orb`);
  if (!snap.exists()) return [];
  const all = snap.val();
  const cutoff = Date.now() - maxAgeDays * 86400000;
  return Object.entries(all)
    .filter(([, v]) => !v.openedAt || v.openedAt < cutoff)
    .map(([runId]) => runId);
}

export default {
  ORB_STATE,
  ORB_MANUAL_ACTIONS,
  ORB_RESPONSE_MAX,
  ORB_EXEMPLAR_MAX,
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
  listExpiredOrbs,
};
