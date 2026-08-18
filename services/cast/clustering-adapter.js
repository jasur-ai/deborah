/**
 * Edikit — Cast Clustering Adapter (C3-12)
 * -----------------------------------------
 * Open-Response Semantic Board uchun semantic clustering adapter'lari.
 *
 * - ClusteringAdapter: provider-agnostic interface (item 5).
 * - localClustering: deterministik token-similarity (Jaccard + bigram) —
 *   offline, timeout'siz, har doim ishlaydi (item 14 fallback).
 * - httpClustering: ixtiyoriy external provider — strict schema parse
 *   (item 7), timeout (item 14), PII o'tmagan matn + opaque response ID
 *   yuboriladi (item 4, 6).
 * - runClustering: registry orqali dispatch — external fail bo'lsa LOCAL
 *   ga tushadi (item 14), yoki manual tag board (director UI) qoladi.
 *
 * SCORE/GRADE GUARD: clustering natijasi hech qachon score/final grade'ga
 * aylanmaydi (item 16) — faqat ta'limiy tahlil.
 */

import { getActiveClusteringProvider, CLUSTERING_PROVIDERS, providerRetentionDays } from './provider-registry.js';

// ── Defaults ──
export const CLUSTERING_DEFAULTS = {
  timeoutMs: 12000,
  similarityThreshold: 0.45,
  minClusterSize: 2,
  maxClusters: 20,
  maxResponsesPerRequest: 200,
};

// ── Provider interface (item 5) ──
export const ClusteringAdapter = {
  /** Adapter full contractni implement qilganini tekshiradi. */
  validate(adapter) {
    const required = ['name', 'cluster'];
    const missing = required.filter((k) => !adapter || typeof adapter[k] === 'undefined');
    if (missing.length) {
      return { ok: false, error: `ClusteringAdapter ${adapter?.name || '?'} missing: ${missing.join(', ')}` };
    }
    return { ok: true };
  },
};

// ── Token normalization ──
const STOPWORDS = new Set([
  'va', 'bilan', 'uchun', 'bu', 'shu', 'bir', 'ham', 'deb', 'the', 'and', 'of', 'to', 'in', 'a', 'is', 'it', 'for', 'on',
]);

export function normalizeTokens(text = '') {
  const t = String(text)
    .toLowerCase()
    .replace(/[’'`"“”]/g, '')
    .replace(/[^a-z0-9\u0400-\u04FF\u00E0-\u00FC\s]/g, ' ')
    .trim();
  const words = t.split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  // Qisqa matnlar uchun bigram'lar ham ishlatiladi
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) bigrams.push(`${words[i]} ${words[i + 1]}`);
  return [...new Set([...words, ...bigrams])];
}

/** Jaccard similarity over token sets (0..1). */
export function tokenJaccard(aTokens, bTokens) {
  if (!aTokens || !aTokens.length || !bTokens || !bTokens.length) return 0;
  const setB = new Set(bTokens);
  let inter = 0;
  for (const t of aTokens) if (setB.has(t)) inter++;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? inter / union : 0;
}

// ── Local deterministic clustering (item 14 fallback / default) ──

function hashId(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function buildCluster(members) {
  const freq = {};
  for (const m of members) {
    for (const t of normalizeTokens(m.text)) freq[t] = (freq[t] || 0) + 1;
  }
  const topTokens = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);
  const label = (topTokens.join(' ') || String(members[0]?.text || '').slice(0, 40)).slice(0, 120);
  const seed = members[0]?.responseId || 'c';
  return {
    id: `c_${hashId(seed + members.length)}`,
    label,
    responseIds: members.map((m) => m.responseId),
    confidence: Math.min(0.95, 0.55 + members.length * 0.08),
    teacherConfirmed: false,
    manual: false,
    count: members.length,
  };
}

/**
 * Deterministik greedy clustering.
 * @param {Array<{responseId:string, text:string}>} items
 * @returns {{clusters:Array, unclustered:string[], algorithm:string}}
 */
export function localClustering(items = [], opts = {}) {
  const threshold = Number(opts.similarityThreshold ?? CLUSTERING_DEFAULTS.similarityThreshold);
  const minSize = Math.max(2, Number(opts.minClusterSize ?? CLUSTERING_DEFAULTS.minClusterSize));
  const entries = items.map((it) => ({ item: it, tokens: normalizeTokens(it.text) }));
  const clusters = [];
  const unclustered = [];
  const used = new Set();

  for (let i = 0; i < entries.length; i++) {
    if (used.has(i)) continue;
    const members = [entries[i]];
    for (let j = i + 1; j < entries.length; j++) {
      if (used.has(j)) continue;
      if (tokenJaccard(entries[i].tokens, entries[j].tokens) >= threshold) {
        members.push(entries[j]);
        used.add(j);
      }
    }
    if (members.length >= minSize) {
      clusters.push(buildCluster(members.map((m) => m.item)));
      used.add(i);
    } else {
      // Yakka/qolgan response — teacher qo'lda yig'adi (manual tag board)
      unclustered.push(entries[i].item.responseId);
    }
  }
  // Deterministik tartib (input tartibiga bog'liq, ammo barqaror)
  return { clusters, unclustered, algorithm: 'local_jaccard', threshold };
}

// ── Strict provider response schema (item 7) ──

/**
 * Provider response'ni strict schema bilan parse qiladi.
 * Contract: { status: 'SUGGESTED', clusters: [{id,label,responseIds,confidence}], unclusteredResponseIds }
 * @returns {{ok:boolean, parsed?:object, error?:string}}
 */
export function parseClusterResponse(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'INVALID_SCHEMA' };
  if (raw.status !== 'SUGGESTED') return { ok: false, error: 'INVALID_STATUS' };
  if (!Array.isArray(raw.clusters)) return { ok: false, error: 'INVALID_CLUSTERS' };
  const clusters = [];
  for (const c of raw.clusters) {
    if (!c || typeof c !== 'object') return { ok: false, error: 'INVALID_CLUSTER_ITEM' };
    const id = String(c.id || '').trim().slice(0, 60);
    const label = String(c.label || '').trim().slice(0, 120);
    const responseIds = Array.isArray(c.responseIds) ? [...new Set(c.responseIds.map(String))] : [];
    const confidence = Number(c.confidence);
    if (!id || !label || !responseIds.length) return { ok: false, error: 'INVALID_CLUSTER_ITEM' };
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return { ok: false, error: 'INVALID_CONFIDENCE' };
    }
    clusters.push({ id, label, responseIds, confidence, teacherConfirmed: false, manual: false });
  }
  const unclustered = Array.isArray(raw.unclusteredResponseIds) ? raw.unclusteredResponseIds.map(String) : [];
  return { ok: true, parsed: { status: 'SUGGESTED', clusters, unclusteredResponseIds: unclustered } };
}

// ── External HTTP provider (item 3-4, 6, 14) ──

/**
 * External provider'ga clustering so'rovi. PII o'tmagan text + opaque
 * response ID yuboriladi (identity yo'q). Timeout → { ok:false, TIMEOUT }.
 * @param {Array<{responseId:string, text:string}>} items
 */
export async function httpClustering(items = [], opts = {}) {
  const url = opts.url || process.env.CAST_CLUSTERING_API_URL;
  const apiKey = opts.apiKey || process.env.CAST_CLUSTERING_API_KEY;
  if (!url || !apiKey) return { ok: false, error: 'NOT_CONFIGURED' };
  const timeoutMs = Number(opts.timeoutMs ?? CLUSTERING_DEFAULTS.timeoutMs);
  const fetchFn = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, error: 'FETCH_UNAVAILABLE' };
  const provider = getActiveClusteringProvider();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        runId: opts.runId || null,
        status: 'SUGGESTED',
        responses: items.slice(0, CLUSTERING_DEFAULTS.maxResponsesPerRequest).map((it) => ({
          responseId: it.responseId,
          text: it.text,
        })),
        policy: {
          trainingUse: false, // registry policy — training uchun yuborilmaydi (item 15)
          retentionDays: providerRetentionDays(provider.id),
        },
      }),
      signal: controller ? controller.signal : undefined,
    });
    if (!res || !res.ok) return { ok: false, error: `PROVIDER_HTTP_${res?.status || 'ERR'}` };
    let json;
    try {
      json = await res.json();
    } catch (_) {
      return { ok: false, error: 'INVALID_JSON' };
    }
    return parseClusterResponse(json);
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_ERROR' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Dispatch with fallback (item 14) ──

/**
 * Registry orqali clustering'ni ishga tushiradi. External fail (timeout/
 * invalid schema/network) bo'lsa LOCAL fallback ishlatiladi; director'ga
 * `usedFallback` + sabab ko'rsatiladi.
 * @returns {Promise<{provider:string, clusters:Array, unclustered:string[], usedFallback:boolean, fallbackReason?:string}>}
 */
export async function runClustering(items = [], opts = {}) {
  const provider = getActiveClusteringProvider();
  if (provider.id === CLUSTERING_PROVIDERS.EXTERNAL && provider.needsApiKey) {
    const ext = await httpClustering(items, opts);
    if (ext.ok) {
      return { provider: provider.id, ...ext.parsed, usedFallback: false };
    }
    // Timeout / invalid schema / network → LOCAL fallback
    const local = localClustering(items, opts);
    return {
      provider: CLUSTERING_PROVIDERS.LOCAL,
      ...local,
      usedFallback: true,
      fallbackReason: ext.error || 'PROVIDER_UNAVAILABLE',
    };
  }
  const local = localClustering(items, opts);
  return { provider: provider.id, ...local, usedFallback: false };
}

export default {
  CLUSTERING_DEFAULTS,
  ClusteringAdapter,
  normalizeTokens,
  tokenJaccard,
  localClustering,
  parseClusterResponse,
  httpClustering,
  runClustering,
};
