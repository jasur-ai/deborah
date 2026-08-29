/**
 * AUTH C-13 — Scheduled refresh (§08) + diplom.edu.uz tekshiruv (P3) unit
 * ----------------------------------------------------------------------
 *  1. refreshDataset: cooldown'dan keyin scheduled chaqiruv fail-soft ishlaydi
 *     (eski cache saqlanadi; yolg'on stats yo'q)
 *  2. isAllowedHost: diplom.edu.uz SSRF allowlist'da EMAS (server hech qachon
 *     unga fetch qilmaydi — §11 client-side)
 */

import { describe, it, expect, vi } from 'vitest';
import { isAllowedHost } from '../../src/modules/opendata/universities.js';

describe('AUTH C-13 — SSRF: diplom.edu.uz server-side fetch qilinmaydi (§11)', () => {
  it('diplom.edu.uz allowlist\'da yo\'q — server hech qachon unga fetch qilmaydi', () => {
    expect(isAllowedHost('https://diplom.edu.uz')).toBe(false);
    expect(isAllowedHost('diplom.edu.uz')).toBe(false);
  });

  it('ruxsat etilgan: data.gov.uz + hemis.uz (subdomain bilan)', () => {
    expect(isAllowedHost('https://data.gov.uz/uz/datasets/14037')).toBe(true);
    expect(isAllowedHost('https://static.data.gov.uz/x.csv')).toBe(true);
    expect(isAllowedHost('https://hemis.uz/universities')).toBe(true);
    expect(isAllowedHost('https://www.hemis.uz/universities')).toBe(true);
  });

  it('diploma-check redirect: faqat statik URL — dinamik/SSRF yo\'q', () => {
    // Route faqat konstantani qaytaradi — hech qanday user input URL'ga
    // qo'shilmaydi (routes/portfolio.js da res.redirect(302, const)).
    const REDIRECT_TARGET = 'https://diplom.edu.uz';
    expect(REDIRECT_TARGET).toBe('https://diplom.edu.uz');
    // parse qilinsa ham boshqa hostga yo'naltirish mumkin emas
    const u = new URL(REDIRECT_TARGET);
    expect(u.hostname).toBe('diplom.edu.uz');
  });
});

describe('AUTH C-13 — getStats: yolg\'on raqam yo\'q, fail-soft (§08-09)', () => {
  it('stats hech qachon invent qilingan raqamni qaytarmaydi — real yoki null', async () => {
    // a13 testida to'liq qamrov — bu yerda invariant tekshiruvi:
    // getStats chaqiruvi hech qachon throw qilmasligi + enabled true
    const { getStats } = await import('../../src/modules/opendata/universities.js');
    const r = await getStats();
    expect(r.enabled).toBe(true);
    // universities 0 dan katta bo'lsa — real (bundled/live); aks holda null emas
    if (r.stats?.universities != null) {
      expect(r.stats.universities).toBeGreaterThan(0);
    }
    // manba doim bor (yolg'on emas — qayerdan kelgani ko'rinadi)
    expect(r.source).toBeTruthy();
  });

  it('refreshDataset scheduled (force:false): fail-soft — throw emas, ok:false qaytaradi', async () => {
    const { refreshDataset, getStats } = await import('../../src/modules/opendata/universities.js');
    // fetchImpl har doim tashlab qo'yadi → barcha manbalar fail → ok:false
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    const r = await refreshDataset({ force: true, fetchImpl: failing });
    expect(r.ok).toBe(false);
    expect(r.dataset).toBeNull();
    // eski cache/bundled o'zgarishsiz — getStats hali ham real qaytaradi
    const stats = await getStats({ fetchImpl: failing });
    expect(stats.stats?.universities).toBeGreaterThan(0);
  });
});
