/**
 * Deborah — E2E C4-10 rev.3: hub banner, yakka mashq ekrani, panel ranglari
 * ---------------------------------------------------------------------------
 * 1) /user/presentations hub'ida Canva/Google rasmiy-ulanish holati banneri
 *    (kalitlar yo'q — halol xabar, student uchun /admin havolalari yo'q).
 * 2) Yakka mashq: variantlar 2×2 grid, iliq ranglar (ko'k yo'q), eski seed
 *    test variantlari ([object Object] emas) to'g'ri ko'rinadi.
 * 3) /user/panel: bitta karta ochilganda faqat o'sha kengayadi; iliq ranglar
 *    (malla emas) va dark-mode'da oq bloklar yo'q.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';

let ctx;
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'wave3-pages-shots');
fs.mkdirSync(SHOTS, { recursive: true });

// C4-10 rev.3 — ko'k YO'Q (iliq palitra talabi rang assertlarida)

beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); }, 60000);
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

describe('C4-10 rev.3 sahifalar', () => {
  it('hub banner + yakka mashq qstage ro‘yxat + panel faqat-bitta-kengayadi va iliq/dark ranglar', async () => {
    // ── Hub: rev.4 — "rasmiy ulanish" banneri OLIB TASHLANDI (talab) ──
    const hub = await newPage(ctx);
    await hub.goto(`${serverUrl}/user/presentations`, { waitUntil: 'domcontentloaded' });
    const iconHref = await hub.locator('link[rel="icon"]').first().getAttribute('href');
    expect(iconHref, 'favicon yangi logo').toContain('logo-icon.svg');
    expect(await hub.locator('.ps-prov').count(), 'rasmiy-ulanish banneri yo‘q').toBe(0);
    const hubText = await hub.locator('.ps-hub').innerText();
    expect(hubText, 'kalit haqidagi gap yo‘q').not.toContain('kalitlar kiritilmagan');
    await hub.screenshot({ path: `${SHOTS}/hub-presentations.png`, fullPage: false }).catch(() => {});
    await hub.close().catch(() => {});

    // ── Yakka mashq: ut1 (09/2026 user qarori: kirish dashboard'dagi qstage — vertikal ro'yxat) ──
    const pr = await newPage(ctx);
    await pr.goto(`${serverUrl}/user/practice?source=user&key=ut1`, { waitUntil: 'domcontentloaded' });
    await pr.waitForSelector('.qstage .opt', { timeout: 10000 });
    const tiles = await pr.$$eval('.qstage .opt', (els) => els.slice(0, 4).map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const label = (el.textContent || '').trim().replace(/^[A-DА-Г]\.?\s*/, '');
      return { bg: cs.backgroundColor, border: cs.borderColor, x: Math.round(r.x), y: Math.round(r.y), label };
    }));
    expect(tiles.length, 'variantlar borki').toBeGreaterThanOrEqual(2);
    // qstage: variantlar vertikal ro'yxat (bir xil x, o'suvchi y)
    for (let i = 1; i < tiles.length; i++) {
      expect(tiles[i].x, 'qstage vertikal ro‘yxat (x bir xil)').toBe(tiles[0].x);
      expect(tiles[i].y, 'qstage vertikal ro‘yxat (y o‘sadi)').toBeGreaterThan(tiles[i - 1].y);
    }
    for (const t of tiles) {
      expect(t.bg, 'ko‘k (reklama) rangi yo‘q').not.toBe('rgb(31, 111, 214)');
      expect(t.border, 'chegara ko‘k emas').not.toBe('rgb(31, 111, 214)');
      expect(t.label, 'variant matni [object Object] emas').not.toContain('[object Object]');
    }
    expect(tiles[0].label, 'ut1 birinchi variant (Toshkent)').toBe('Toshkent');
    await pr.screenshot({ path: `${SHOTS}/practice-grid.png` }).catch(() => {});
    await pr.close().catch(() => {});

    // ── Panel: bitta karta kengayadi, iliq/dark, malla emas ──
    const panel = await newPage(ctx);
    await panel.goto(`${serverUrl}/user/panel`, { waitUntil: 'domcontentloaded' });
    await panel.waitForSelector('.ov-card', { timeout: 8000 });
    // yorug' rejim ranglari
    const light = await panel.evaluate(() => {
      const t = document.querySelector('.ov-title');
      const c = document.querySelector('.ov-card');
      const cs = getComputedStyle(c);
      return { title: getComputedStyle(t).color, bg: cs.backgroundImage };
    });
    expect(light.title, 'umumiy ma‘lumot sarlavhasi malla emas — oltin-jigarrang').toBe('rgb(91, 67, 23)');
    expect(light.bg, 'karta qaymoq gradient').toContain('rgb(251, 244, 226)');
    expect(light.bg, 'oq blok yo‘q').not.toContain('rgb(255, 255, 255)');
    // faqat bosilgan karta ochiladi
    const h0 = await panel.evaluate(() => {
      const p = document.getElementById('ov-xpand-pres');
      const t = document.getElementById('ov-xpand-tests');
      return { pres: p.getBoundingClientRect().height, tests: t.getBoundingClientRect().height };
    });
    await panel.locator('#ov-xpand-pres summary').click();
    await panel.waitForFunction(() => document.getElementById('ov-xpand-pres').open, null, { timeout: 5000 });
    const h1 = await panel.evaluate(() => {
      const p = document.getElementById('ov-xpand-pres');
      const t = document.getElementById('ov-xpand-tests');
      return { pres: p.getBoundingClientRect().height, tests: t.getBoundingClientRect().height };
    });
    expect(h1.pres, 'bosilgan karta kengaydi').toBeGreaterThan(h0.pres + 8);
    expect(Math.abs(h1.tests - h0.tests), 'boshqa kartalar cho‘zilmadi').toBeLessThan(3);
    expect(await panel.locator('#ov-xpand-tests').evaluate((el) => el.open), 'testlar kartasi ochilmadi').toBe(false);
    // dark rejim
    await panel.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
    await panel.screenshot({ path: `${SHOTS}/panel-dark.png` }).catch(() => {});
    const dark = await panel.evaluate(() => {
      const t = document.querySelector('.ov-title');
      const c = document.querySelector('.ov-card');
      return { title: getComputedStyle(t).color, bg: getComputedStyle(c).backgroundImage };
    });
    expect(dark.title, 'dark sarlavha och krem').toBe('rgb(240, 226, 196)');
    expect(dark.bg, 'dark karta to‘q iliq (oq emas)').toContain('rgb(74, 58, 32)');
    await panel.evaluate(() => { document.documentElement.removeAttribute('data-theme'); });
    const shotP = await panel.locator('.ov-sec').screenshot({ path: `${SHOTS}/panel-light.png` }).catch(() => {});
    expect(shotP, 'panel light screenshot').toBeTruthy();
    await panel.close().catch(() => {});
  }, 120000);
});
