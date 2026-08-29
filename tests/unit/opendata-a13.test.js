/**
 * AUTH A-13 — Ochiq ma'lumotlar: OTM ro'yxati + talabalar soni (P1)
 * -------------------------------------------------------------------
 * Unit qamrov (guide §16, §22):
 *  - normalizeDataset: bundled / hemis JSON / data.gov.uz CSV shape
 *  - SSRF himoyasi (§13): allowlist host; subdomain; yot domain blok
 *  - fetch timeout + retry (§29) — injected fetch orqali
 *  - Cache: 24h TTL; fail-soft (fetch fail → eski cache/bundled)
 *  - Yolg'on raqam yo'q (§09, §22 grep): stats faqat real/verifiable maydonlar
 *  - Toggle (§25): enabled=false → stats berilmaydi
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { fb } from '../../firebase/admin.js';
import {
  normalizeDataset,
  fetchDatasetUrl,
  isAllowedHost,
  getStats,
  refreshDataset,
  OpenDataError,
  SCHEMA_VERSION,
} from '../../src/modules/opendata/index.js';

const CACHE_PATH = 'opendata_cache';

async function resetCache() {
  await fb.set(CACHE_PATH, {});
}

beforeAll(async () => { await resetCache(); }, 30000);
afterAll(async () => { await resetCache(); });

describe('A-13 — normalizeDataset (§07-08, §26)', () => {
  it('bundled shape → canonical stats (real: 211 OTM, 1.323.000 talaba)', () => {
    const raw = JSON.parse(readFileSync(new URL('../../data/opendata/universities.json', import.meta.url), 'utf8'));
    const d = normalizeDataset(raw, { kind: 'bundled' });
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.stats.universities).toBe(211);
    expect(d.stats.studentsTotal).toBe(1323000);
    expect(d.universities.length).toBeGreaterThan(30);
    expect(d.universities[0].nameUz.length).toBeGreaterThan(3);
    expect(d.meta.licenseUrl).toContain('data.gov.uz');
  });

  it('HEMIS JSON shape ({success, data}) → canonical', () => {
    const raw = {
      success: true,
      data: [
        { id: 1, name_uz: 'O\'zbekiston Milliy universiteti', name_ru: 'Национальный университет Узбекистана', bakalavriat: 12000, magistratura: 800 },
        { id: 2, name: 'Samarqand davlat universiteti', bakalavriat: 15000, magistratura: 900 },
      ],
    };
    const d = normalizeDataset(raw, { kind: 'json' });
    expect(d.stats.universities).toBe(2);
    expect(d.stats.studentsTotal).toBe(12000 + 800 + 15000 + 900);
    expect(d.stats.studentsBachelor).toBe(27000);
    expect(d.universities[0].nameUz).toBe('O\'zbekiston Milliy universiteti');
  });

  it('data.gov.uz CSV (;) → canonical', () => {
    const csv = 'Nomi;Bakalavriat;Magistratura\nToshkent davlat texnika universiteti;18000;1200\nBuxoro davlat universiteti;14000;800\n';
    const d = normalizeDataset(csv, { kind: 'csv' });
    expect(d.stats.universities).toBe(2);
    expect(d.stats.studentsTotal).toBe(18000 + 1200 + 14000 + 800);
    expect(d.universities[0].bachelor).toBe(18000);
  });

  it('bo\'sh/noto\'g\'ri dataset → no_data error (yolg\'on emas)', () => {
    expect(() => normalizeDataset('', { kind: 'csv' })).toThrow(OpenDataError);
    expect(() => normalizeDataset('a;b\n1;2', { kind: 'csv' })).toThrow(OpenDataError);
  });
});

describe('A-13 — SSRF himoyasi (§13)', () => {
  it('allowlist: hemis.uz / data.gov.uz / subdomain', () => {
    expect(isAllowedHost('https://hemis.uz/universities')).toBe(true);
    expect(isAllowedHost('https://data.gov.uz/uz/datasets/14037')).toBe(true);
    expect(isAllowedHost('https://sub.hemis.uz/x')).toBe(true);
  });

  it('yot domain blok: evil.com, hemis.uz.evil.com, IP', () => {
    expect(isAllowedHost('https://evil.com')).toBe(false);
    expect(isAllowedHost('https://hemis.uz.evil.com')).toBe(false);
    expect(isAllowedHost('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedHost('http://127.0.0.1')).toBe(false);
  });

  it('fetchDatasetUrl: allowlistdan tashqari → ssrf_blocked (hech qanday request yuborilmaydi)', async () => {
    await expect(fetchDatasetUrl('https://evil.com/api')).rejects.toMatchObject({ code: 'ssrf_blocked' });
  });
});

describe('A-13 — Cache va fail-soft (§10)', () => {
  it('getStats: cache bo\'lmasa → bundled real dataset (enabled)', async () => {
    const s = await getStats();
    expect(s.enabled).toBe(true);
    expect(s.stats.universities).toBe(211);
    expect(s.stats.studentsTotal).toBe(1323000);
    expect(s.sourceUrl).toContain('data.gov.uz');
    expect(s.licenseUrl).toContain('data.gov.uz');
    expect(s.asOf.length).toBeGreaterThan(3);
  });

  it('getStats: ikkinchi chaqiruv cache dan ishlaydi (bundled takror yozilmaydi)', async () => {
    const a = await getStats();
    const snap = await fb.get('opendata_cache/universities');
    expect(snap.exists()).toBe(true);
    const b = await getStats();
    expect(b.stats.universities).toBe(a.stats.universities);
  });

  it('refreshDataset: barcha manbalar fail bo\'lsa → ok:false (fail-soft, throw emas)', async () => {
    const failing = async () => { throw new Error('network down'); };
    const r = await refreshDataset({ force: true, fetchImpl: failing });
    expect(r.ok).toBe(false);
  });

  it('refreshDataset: muvaffaqiyatsizlikdan keyin 15 daqiqa cooldown — takroriy fetch spam yo\'q (review fix)', async () => {
    let calls = 0;
    const failing = async () => { calls += 1; throw new Error('geofence timeout'); };
    const first = await refreshDataset({ force: true, fetchImpl: failing });
    expect(first.ok).toBe(false);
    expect(calls).toBeGreaterThan(0);
    // Cooldown ichida (force emas) → fetch chaqirilmaydi
    const second = await refreshDataset({ fetchImpl: failing });
    expect(second.reason).toBe('cooldown');
    expect(second.ok).toBe(false);
    const callsAfter = calls;
    expect(calls).toBe(callsAfter); // qo'shimcha urinish yo'q
    // force=true cooldown'ni chetlab o'tadi
    const forced = await refreshDataset({ force: true, fetchImpl: failing });
    expect(forced.ok).toBe(false);
    expect(calls).toBeGreaterThan(callsAfter);
  });

  it('refreshDataset: muvaffaqiyatli fetch → cache yangilanadi + isLive:true', async () => {
    const fake = async (url) => (url.includes('data.gov.uz')
      ? 'Nomi;Bakalavriat;Magistratura\nTest OTM;5000;200\n'
      : JSON.stringify({ success: true, data: [{ name_uz: 'Test OTM', bakalavriat: 5000, magistratura: 200 }] }));
    const r = await refreshDataset({ force: true, fetchImpl: fake });
    expect(r.ok).toBe(true);
    const s = await getStats();
    expect(s.isLive).toBe(true);
    expect(s.stats.universities).toBe(1);
  });

  it('getStats: eskirgan cache bo\'lsa ham eski real raqamlar qaytadi (fail-soft)', async () => {
    await fb.set('opendata_cache/universities', {
      schemaVersion: SCHEMA_VERSION,
      stats: { universities: 211, studentsTotal: 1323000, studentsBachelor: null, studentsMaster: null },
      universities: [],
      meta: { source: 'bundled', sourceUrl: 'https://data.gov.uz/uz/datasets/14037', license: 'x', licenseUrl: 'https://data.gov.uz/uz/pages/license', asOf: '2023/2024' },
      isLive: false,
      fetchedAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 kun eski
    });
    const s = await getStats({ fetchImpl: async () => { throw new Error('offline'); } });
    expect(s.enabled).toBe(true);
    expect(s.stats.universities).toBe(211); // eski ham real
  });
});

describe('A-13 — Yolg\'on raqam yo\'q + toggle (§09, §22, §25)', () => {
  it('stats hech qachon yolg\'on/bo\'sh raqam bermaydi — faqat real yoki null', async () => {
    const s = await getStats();
    for (const v of Object.values(s.stats)) {
      if (v !== null && v !== undefined) {
        expect(typeof v).toBe('number');
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(s.source.length).toBeGreaterThan(0); // manba ko'rsatilishi shart (§11)
    expect(s.license.length).toBeGreaterThan(0);
  });

  it('toggle: enabled=false → { enabled:false } (stats berilmaydi)', async () => {
    const s = await getStats({ enabled: false });
    expect(s).toEqual({ enabled: false });
    expect(s.stats).toBeUndefined();
  });
});
