/**
 * AUTH A-13 — Ochiq ma'lumotlar: OTM stats (P1) — integration
 * -------------------------------------------------------------------
 * Qamrov (guide §17-18):
 *  - GET /api/opendata/stats → 200 real stats (yolg'on emas; manba+litsenziya)
 *  - Admin refresh: unauth/non-admin → 401/403
 *  - Landing "/" → ld-stats bloki haqiqiy raqamlar bilan
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
}, 90000);

afterAll(async () => {
  await stopServer();
  restoreDb();
});

describe('AUTH A-13 — stats API', () => {
  it('GET /api/opendata/stats → 200, real stats, source + license', async () => {
    const res = await fetch(`${serverUrl}/api/opendata/stats`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enabled).toBe(true);
    expect(data.schemaVersion).toBe(1);
    // Review fix: jonli data mavjud bo'lsa raqamlar o'zgarishi mumkin —
    // aniq qiymatga bog'lanmaymiz, faqat haqiqiy/shape'ni tekshiramiz.
    expect(typeof data.stats.universities).toBe('number');
    expect(data.stats.universities).toBeGreaterThan(0);
    expect(data.stats.studentsTotal === null || data.stats.studentsTotal > 0).toBe(true);
    expect(data.sourceUrl).toContain('data.gov.uz');
    expect(data.licenseUrl).toContain('data.gov.uz');
    expect(data.asOf.length).toBeGreaterThan(3);
    // Yolg'on raqam yo'q — barcha sonlar number yoki null (hech qachon string/bo'sh)
    for (const v of Object.values(data.stats)) {
      if (v !== null && v !== undefined) expect(typeof v).toBe('number');
    }
  });

  it('POST /api/admin/opendata/refresh — admin bo\'lmasa 401/403', async () => {
    const res = await fetch(`${serverUrl}/api/admin/opendata/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect([401, 403, 302]).toContain(res.status);
  });

  it('landing "/" — ld-stats bloki haqiqiy (musbat) raqam bilan render qilinadi', async () => {
    const res = await fetch(`${serverUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('ld-stats');
    // Aniq qiymatga bog'lanmaymiz — musbat son render bo'lganini tekshiramiz
    expect(html).toMatch(/data-stat="universities">\d+</);
    expect(html).toMatch(/data-stat="students">[\d\s.,]+</);
    expect(html).toContain('data.gov.uz'); // manba havolasi (§30)
  });
});
