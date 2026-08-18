/**
 * Edikit — Cast Support Bundle (C5-08)
 * ------------------------------------
 * Diagnostic bundle: incident debugging uchun PII-safe snapshot.
 *
 * Tugallanish sharti (plan):
 *   - Support bundle RAW RESPONSE, ANSWER KEY, TOKEN va ROSTER OLIB YURMAYDI.
 *
 * Bundle tarkibi:
 *   - config fingerprint (hashConfig — config qiymatlari emas, hash)
 *   - safe event summary (faqat revision/type/at — payload yo'q)
 *   - browser/device, latency, reconnect, failed request ID'lar
 *   - SEV classification + bundle expiry
 *
 * PURE + FB adapter: session ma'lumotlarini o'qish uchun event-store'ga
 * tayanadi; hech qachon answer/raw content yozmaydi.
 */

import { hashConfig } from './config-schema.js';
import { getEventsAfter } from './event-store.js';
import { sanitizeLog, redactFreeText, teacherHealthStatus } from './telemetry.js';

export const BUNDLE_VERSION = 'cast_bundle_v1';
export const BUNDLE_TTL_MS = 24 * 60 * 60 * 1000; // 24h auto-expiry (item 9)

/** SEV classification (item 11) — SEV-0 eng og'ir. */
export const SEV_LEVELS = Object.freeze({
  SEV0: 'SEV-0', // answer-key exposure / personal-data incident — darhol
  SEV1: 'SEV-1', // to'liq xizmat uzilishi (all participants disconnect, region)
  SEV2: 'SEV-2', // qisman degradation (ACK spike, Redis outage)
  SEV3: 'SEV-3', // minor (wrong reveal, moderation outage)
});

/** Signals → SEV mapping (rule-based; ops qo'lda o'zgartirishi mumkin). */
export function classifySev(signals = {}) {
  if (signals.answerKeyExposure || signals.personalDataIncident) return SEV_LEVELS.SEV0;
  if (signals.allParticipantsDisconnected || signals.regionOutage || signals.cdnOutage) return SEV_LEVELS.SEV1;
  if (signals.redisOutage || signals.dbFailure || signals.ackSpike || signals.retryStorm) return SEV_LEVELS.SEV2;
  if (signals.wrongReveal || signals.moderationOutage || signals.deletionFailure) return SEV_LEVELS.SEV3;
  return SEV_LEVELS.SEV3;
}

/** Safe event summary — faqat revision/type/at; payload SANSIQLANADI. */
export function safeEventSummary(events = []) {
  return events.map((ev) => {
    const type = ev && (ev.type || ev.eventType || 'unknown');
    const t = typeof type === 'string' ? type.toLowerCase() : '';
    // Answer event'larida faqat son — hech qachon option/raw yo'q
    return {
      revision: ev && (ev.revision ?? ev.r ?? ev.seq ?? null),
      type: t,
      at: ev && (ev.at ?? ev.ts ?? null),
      summary: ev && ev.summary ? redactFreeText(String(ev.summary).slice(0, 60)) : null,
    };
  });
}

/**
 * Build a PII-safe support bundle for a session.
 * @param {object} input
 * @param {string} input.sessionId
 * @param {object} [input.config] — config object → faqat hash saqlanadi
 * @param {Array}  [input.events] — raw events (fetch qilinadi, faqat summary chiqadi)
 * @param {object} [input.client] — { browser, device, platform } (user-agent bo'laklari)
 * @param {object} [input.runtime] — { lagMs, dbQueue, backpressureLevel, recovering, reconnectCount, failedRequestIds, latencyMs }
 */
export async function buildSupportBundle(input = {}) {
  const {
    sessionId,
    config,
    events,
    client = {},
    runtime = {},
  } = input;

  const configFingerprint = config ? hashConfig(config) : null;
  const eventSummary = safeEventSummary(events || (await getEventsAfter(sessionId, 0)));

  const created = Date.now();
  return {
    version: BUNDLE_VERSION,
    bundleId: `bnd_${cryptoRandomHex(12)}`,
    sessionId,
    createdAt: created,
    expiresAt: created + BUNDLE_TTL_MS,
    sev: classifySev(runtime.signals || {}),
    config: { fingerprint: configFingerprint, schemaVersion: config?.schemaVersion || null },
    // sanitized client info — user-agent to'liq emas, bo'laklar
    client: sanitizeLog({
      browser: client.browser || null,
      device: client.device || null,
      platform: client.platform || null,
    }),
    runtime: sanitizeLog({
      latencyMs: runtime.latencyMs || null,
      lagMs: runtime.lagMs || null,
      dbQueue: runtime.dbQueue || null,
      backpressureLevel: runtime.backpressureLevel || 'normal',
      recovering: !!runtime.recovering,
      reconnectCount: runtime.reconnectCount || 0,
      failedRequestIds: (runtime.failedRequestIds || []).slice(0, 20),
    }),
    health: {
      teacher: teacherHealthStatus({
        backpressureLevel: runtime.backpressureLevel || 'normal',
        lagMs: runtime.lagMs || 0,
        recovering: !!runtime.recovering,
      }),
    },
    events: eventSummary.slice(0, 300),
    // Eksplicit: bundle'da HECh QACHON quyidagilar yo'q
    safetyDeclaration: {
      containsAnswerKey: false,
      containsRawResponse: false,
      containsTokens: false,
      containsRoster: false,
      containsStudentPII: false,
    },
  };
}

/**
 * Deep-scan bundle — tugallanish shartini assert qiladi (test + route guard).
 * Bundle'da sensitive content topilsa throw qiladi.
 */
export function assertBundleSafe(bundle) {
  const unsafe = findSensitiveContent(bundle);
  if (unsafe.length) {
    throw new Error(`UNSAFE_BUNDLE: ${unsafe.join(', ')}`);
  }
  return true;
}

const UNSAFE_KEYS = [
  /(^|[._-])(answer[_ -]?key|correct|raw|essay|submission|camera|capture|roster)([._-]|$)/i,
  /(token|password|secret|authorization|cookie|jwt|csrf)/i,
  /(^|[._-])session[_ -]?(token|key|secret)([._-]|$)/i,
  /(email|phone|address|passport|name|full[_ -]?name|birth)/i,
];

// Cast sessionId — bu xavfsiz (join URL'da ochiq ko'rinadi, user session token emas)
const SAFE_EXACT_KEYS = new Set(['sessionId', 'bundleId']);

function findSensitiveContent(node, path = '') {
  const hits = [];
  if (node === null || node === undefined) return hits;
  if (Array.isArray(node)) {
    node.forEach((x, i) => { hits.push(...findSensitiveContent(x, `${path}[${i}]`)); });
    return hits;
  }
  if (typeof node !== 'object') {
    // Raw response uzun text / token-like string bundle'da bo'lmasligi kerak
    if (typeof node === 'string' && node.length > 80) hits.push(`${path}:long-string`);
    return hits;
  }
  for (const [k, v] of Object.entries(node)) {
    const childPath = path ? `${path}.${k}` : k;
    // safetyDeclaration — bu O'ZI yo'qlik deklaratsiyasi (contains* = false)
    // Uning kalitlari (containsTokens va h.k.) scanner'ni trigger qilmasin.
    if (k === 'safetyDeclaration') continue;
    if (SAFE_EXACT_KEYS.has(k)) {
      hits.push(...findSensitiveContent(v, childPath));
      continue;
    }
    if (UNSAFE_KEYS.some((re) => re.test(k))) {
      hits.push(`${childPath}:${k}`);
      continue;
    }
    hits.push(...findSensitiveContent(v, childPath));
  }
  return hits;
}

/**
 * Short browser label from user-agent (PII-safe, ≤60 ch).
 * `sanitizeLog` 80+ ch string'larni redact qiladi — bundle browser info
 * uchun qisqa label kerak (item 7).
 * @param {string} ua
 */
export function browserLabel(ua) {
  if (typeof ua !== 'string' || !ua) return null;
  const m = ua.match(/(Firefox|Chrome|Safari|Edg|OPR|MSIE|Trident)[/ ]([\d.]+)/i);
  if (m) return `${m[1]} ${m[2].split('.')[0]}`.slice(0, 60);
  const label = ua.split(' ')[0] || 'unknown';
  return label.slice(0, 60);
}

/** Bundle hali yaroqlimi? (auto-expiry — item 9) */
export function isBundleExpired(bundle, now = Date.now()) {
  if (!bundle) return true;
  return now > (bundle.expiresAt || 0);
}

function cryptoRandomHex(len) {
  const bytes = Math.ceil(len / 2);
  let out = '';
  for (let i = 0; i < bytes; i += 1) {
    out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return out.slice(0, len);
}

export default {
  BUNDLE_VERSION,
  BUNDLE_TTL_MS,
  SEV_LEVELS,
  classifySev,
  safeEventSummary,
  buildSupportBundle,
  assertBundleSafe,
  isBundleExpired,
};
