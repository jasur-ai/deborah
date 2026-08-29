/**
 * Deborah — Ochiq ma'lumotlar: OTM ro'yxati + talabalar soni (AUTH A-13)
 * --------------------------------------------------------------------
 * Landing stats uchun HAQIQIY raqamlar (hech qachon yolg'on emas):
 *   - Manba (tartib bilan): data.gov.uz dataset 14037 (CSV/JSON), hemis.uz/universities.
 *   - Cache: lokal DB (fb) — 24 soat TTL + schemaVersion; failure → eski cache (fail-soft).
 *   - Live fetch bo'lmasa → bundled haqiqiy dataset (data/opendata/universities.json,
 *     rasmiy e'lonlardan, manba + litsenziya + asOf bilan).
 *
 * Security (§13): SSRF himoyasi — fetch faqat allowlist domainlarga; timeout + retry;
 * redirect'dan keyin ham hostname tekshiriladi. PII yo'q — faqat ochiq yig'indi.
 * Litsenziya (§11) hurmat: manba + litsenziya havolasi har doim payload'da.
 * Toggle (§25): OPEN_DATA_ENABLED env (default true) — o'chirilganda stats berilmaydi.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fb } from '../../../firebase/admin.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import CONFIG from '../../config/env.js';

const CACHE_PATH = 'opendata_cache';
const CACHE_KEY = 'universities';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // §10: 24 soat
export const SCHEMA_VERSION = 1;

// §13 SSRF allowlist — faqat shu hostlar fetch qilinishi mumkin
export const ALLOWED_HOSTS = new Set(['hemis.uz', 'data.gov.uz', 'static.data.gov.uz', 'www.hemis.uz']);

const FETCH_TIMEOUT_MS = 8000; // §29: timeout
const FETCH_RETRIES = 1; // §29: retry
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
// Review fix: muvaffaqiyatsiz refresh'da takroriy fetch spam bo'lmasin —
// jonli manbalarga urinish faqat force yoki 15 daqiqada bir marta.
const REFRESH_COOLDOWN_MS = 15 * 60 * 1000;
let lastRefreshAttemptAt = 0;

// Jonli manbalar (tartib bilan sinab ko'riladi; geofence → bundled ga tushadi)
const LIVE_SOURCES = [
  {
    name: 'data.gov.uz dataset 14037',
    url: 'https://data.gov.uz/uz/datasets/14037',
    kind: 'csv',
  },
  {
    name: 'hemis.uz/universities',
    url: 'https://hemis.uz/universities',
    kind: 'json',
  },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadBundled() {
  const raw = fs.readFileSync(path.resolve(__dirname, '../../../data/opendata/universities.json'), 'utf8');
  return JSON.parse(raw);
}

// ═══════════════════════════════════════════════════════════════════
// SSRF-xavfsiz fetch (§13, §29)
// ═══════════════════════════════════════════════════════════════════

/** Streaming body reader — 5MB cheklov chunked (content-length yo'q) ham amal qiladi. */
async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new OpenDataError('too_large', 'Response exceeds size limit');
    }
    return text;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {}); // oqimni to'xtatamiz — xotira portlashining oldi
      throw new OpenDataError('too_large', 'Response exceeds size limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** URL hosti allowlist'da ekanini tekshiradi (subdomain + exact). */
export function isAllowedHost(urlOrHost) {
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    /* treat as bare hostname */
  }
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (ALLOWED_HOSTS.has(h)) return true;
  return [...ALLOWED_HOSTS].some((allowed) => h.endsWith(`.${allowed}`));
}

/** Timeout + retry + allowlist guard bilan fetch. */
export async function fetchDatasetUrl(url, { timeoutMs = FETCH_TIMEOUT_MS, retries = FETCH_RETRIES } = {}) {
  if (!isAllowedHost(url)) {
    throw new OpenDataError('ssrf_blocked', `Host not allowed: ${new URL(url).hostname}`);
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      // Redirect'dan keyin ham allowlist tekshiruvi
      if (!isAllowedHost(res.url || url)) {
        throw new OpenDataError('ssrf_redirect', 'Redirected to non-allowlisted host');
      }
      if (!res.ok) throw new OpenDataError('http_error', `HTTP ${res.status}`);
      // content-length pre-check + streaming cap (chunked ham himoyalangan)
      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > MAX_RESPONSE_BYTES) throw new OpenDataError('too_large', 'Response too large');
      return await readCapped(res);
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') lastErr = new OpenDataError('timeout', `Fetch timeout (${timeoutMs}ms)`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════════════════════════
// Normalizatsiya (§07, §08, §26)
// ═══════════════════════════════════════════════════════════════════

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).replace(/\s/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Bundled JSON shape → canonical. */
function normalizeBundled(raw, meta) {
  return {
    stats: {
      universities: toInt(raw.stats?.universities) || null,
      studentsTotal: toInt(raw.stats?.studentsTotal) || null,
      studentsBachelor: toInt(raw.stats?.studentsBachelor) ?? null,
      studentsMaster: toInt(raw.stats?.studentsMaster) ?? null,
    },
    universities: (raw.universities || []).map((u) => ({
      id: String(u.id || ''),
      nameUz: String(u.nameUz || u.name || ''),
      nameRu: String(u.nameRu || ''),
      bachelor: toInt(u.bachelor) ?? null,
      master: toInt(u.master) ?? null,
    })),
    meta: {
      source: raw.meta?.source || meta?.source || 'bundled',
      sourceUrl: raw.meta?.sourceUrl || meta?.sourceUrl || '',
      license: raw.meta?.license || '',
      licenseUrl: raw.meta?.licenseUrl || '',
      asOf: raw.meta?.asOf || '',
    },
  };
}

/** HEMIS-ish JSON ({success, data:[...]}) → canonical. */
function normalizeHemisJson(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const universities = list.map((u, i) => ({
    id: String(u.id || u.code || `otm-${i}`),
    nameUz: String(u.name_uz || u.nameUz || u.name || ''),
    nameRu: String(u.name_ru || u.nameRu || u.name || ''),
    bachelor: toInt(u.bakalavriat ?? u.bachelor ?? u.students_bachelor ?? null),
    master: toInt(u.magistratura ?? u.master ?? u.students_master ?? null),
  })).filter((u) => u.nameUz);
  const bachelorSum = universities.reduce((a, u) => a + (u.bachelor || 0), 0);
  const masterSum = universities.reduce((a, u) => a + (u.master || 0), 0);
  return {
    stats: {
      universities: universities.length || null,
      studentsTotal: bachelorSum + masterSum || null,
      studentsBachelor: bachelorSum || null,
      studentsMaster: masterSum || null,
    },
    universities,
    meta: {
      source: 'hemis.uz/universities',
      sourceUrl: 'https://hemis.uz/universities',
      license: 'Ochiq ma\'lumotlar litsenziyasi',
      licenseUrl: 'https://data.gov.uz/uz/pages/license',
      asOf: 'jonli yuklab olingan',
    },
  };
}

/** data.gov.uz CSV → canonical (ustunlar: nom, bakalavriat, magistratura). */
function normalizeCsv(csvText) {
  const lines = String(csvText || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new OpenDataError('empty_csv', 'CSV is empty');
  const headers = lines[0].split(';').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
  const colIdx = (aliases) => {
    for (const a of aliases) {
      const i = headers.findIndex((h) => h.includes(a));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iName = colIdx(['nomi', 'nazvanie', 'name', 'муассаса', 'муасса']);
  const iBach = colIdx(['bakalavriat', 'bakalavr']);
  const iMast = colIdx(['magistratura', 'magistr']);
  if (iName < 0) throw new OpenDataError('csv_schema', 'Name column not found');

  const universities = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!cells[iName]) continue;
    universities.push({
      id: `csv-${r}`,
      nameUz: cells[iName],
      nameRu: cells[iName],
      bachelor: iBach >= 0 ? toInt(cells[iBach]) : null,
      master: iMast >= 0 ? toInt(cells[iMast]) : null,
    });
  }
  if (universities.length === 0) throw new OpenDataError('empty_csv', 'No rows parsed');
  const b = universities.reduce((a, u) => a + (u.bachelor || 0), 0);
  const m = universities.reduce((a, u) => a + (u.master || 0), 0);
  return {
    stats: { universities: universities.length, studentsTotal: b + m || null, studentsBachelor: b || null, studentsMaster: m || null },
    universities,
    meta: { source: 'data.gov.uz dataset 14037', sourceUrl: 'https://data.gov.uz/uz/datasets/14037', license: 'Ochiq ma\'lumotlar litsenziyasi (data.gov.uz)', licenseUrl: 'https://data.gov.uz/uz/pages/license', asOf: 'jonli yuklab olingan' },
  };
}

/** Har qanday manba → canonical dataset (schemaVersion qo'shiladi). */
export function normalizeDataset(raw, { source = 'unknown', kind = 'bundled', meta = {} } = {}) {
  let canon;
  if (kind === 'csv') canon = normalizeCsv(raw);
  else if (kind === 'json') canon = normalizeHemisJson(raw);
  else canon = normalizeBundled(raw, meta);
  if (!canon.stats.universities && canon.universities.length === 0) {
    throw new OpenDataError('no_data', 'Dataset contains no usable data');
  }
  return { ...canon, schemaVersion: SCHEMA_VERSION };
}

// ═══════════════════════════════════════════════════════════════════
// Cache + refresh (§10: 24h, scheduled, fail-soft)
// ═══════════════════════════════════════════════════════════════════

let refreshInFlight = null;

export function isEnabled() {
  return CONFIG.OPEN_DATA_ENABLED !== false;
}

async function readCache() {
  const snap = await fb.get(`${CACHE_PATH}/${CACHE_KEY}`);
  return snap.exists() ? snap.val() : null;
}

async function writeCache(dataset, { isLive, fetchedAt }) {
  await fb.set(`${CACHE_PATH}/${CACHE_KEY}`, {
    schemaVersion: dataset.schemaVersion,
    stats: dataset.stats,
    universities: dataset.universities,
    meta: dataset.meta,
    isLive,
    fetchedAt,
  });
}

/**
 * Live manbalarni tartib bilan sinaydi → normalize → cache.
 * Hech qachon throw qilmaydi (fail-soft): muvaffaqiyatsizlikda eski holat saqlanadi.
 */
export async function refreshDataset({ force = false, fetchImpl = fetchDatasetUrl } = {}) {
  if (refreshInFlight && !force) return refreshInFlight;
  // Review fix: muvaffaqiyatsiz urinishdan so'ng 15 daqiqa kutish —
  // landing'ning har bir ochilishida takroriy fetch spam bo'lmaydi.
  if (!force && Date.now() - lastRefreshAttemptAt < REFRESH_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown', dataset: null };
  }
  lastRefreshAttemptAt = Date.now();
  const run = (async () => {
    if (!isEnabled()) return { ok: false, reason: 'disabled' };
    let lastErr = null;
    for (const src of LIVE_SOURCES) {
      try {
        const text = await fetchImpl(src.url);
        const dataset = normalizeDataset(text, { source: src.name, kind: src.kind });
        await writeCache(dataset, { isLive: true, fetchedAt: Date.now() });
        await audit(AUDIT_ACTIONS.OPENDATA_REFRESH, {
          actor: 'system',
          target: 'opendata_cache',
          detail: { source: src.name, universities: dataset.stats.universities, schemaVersion: dataset.schemaVersion },
        });
        return { ok: true, source: src.name, dataset };
      } catch (err) {
        lastErr = err;
      }
    }
    // Barcha live manbalar muvaffaqiyatsiz → fail-soft (eski cache yoki bundled)
    return { ok: false, error: lastErr?.message || 'all sources failed', dataset: null };
  })();
  refreshInFlight = run;
  try {
    return await run;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Public stats — yolg'on raqam yo'q (§09):
 * faqat haqiqiy yig'indi + manba/litsenziya/asOf bilan.
 */
export async function getStats({ fetchImpl = fetchDatasetUrl, enabled } = {}) {
  if ((enabled ?? isEnabled()) === false) return { enabled: false };

  const cached = await readCache();
  const fresh = cached && Date.now() - (cached.fetchedAt || 0) < CACHE_TTL_MS;

  // Background refresh: eskirgan yoki yo'q → async yangilash (landing bloklanmaydi)
  if (!fresh) refreshDataset({ fetchImpl }).catch(() => {});

  if (cached) {
    // §10 fail-soft: eski cache ham real raqamlar — yolg'on emas
    return publicStats(cached);
  }

  // Cache yo'q → bundled (real, manba bilan)
  const bundled = normalizeDataset(loadBundled(), { source: 'bundled', kind: 'bundled' });
  await writeCache(bundled, { isLive: false, fetchedAt: Date.now() });
  return publicStats(bundled);
}

function publicStats(dataset) {
  const { stats, meta, universities } = dataset;
  return {
    enabled: true,
    schemaVersion: dataset.schemaVersion || SCHEMA_VERSION,
    isLive: !!dataset.isLive,
    stats: {
      universities: stats.universities,
      studentsTotal: stats.studentsTotal,
      studentsBachelor: stats.studentsBachelor ?? null,
      studentsMaster: stats.studentsMaster ?? null,
    },
    universities: (universities || []).map((u) => ({
      id: u.id,
      nameUz: u.nameUz,
      nameRu: u.nameRu,
      bachelor: u.bachelor ?? null,
      master: u.master ?? null,
    })),
    source: meta?.source || '',
    sourceUrl: meta?.sourceUrl || '',
    license: meta?.license || '',
    licenseUrl: meta?.licenseUrl || '',
    asOf: meta?.asOf || '',
    fetchedAt: dataset.fetchedAt || null,
  };
}

/** Custom error with stable code. */
export class OpenDataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OpenDataError';
    this.code = code;
  }
}
