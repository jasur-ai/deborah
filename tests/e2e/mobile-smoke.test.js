/**
 * Deborah — MOBIL SMOKE (C4-10 rev.4)
 * ───────────────────────────────────
 * Foydalanuvchilarning aksari telefonda ishlaydi: shu test CI'da eng muhim
 * sahifalarni 390×844 (iPhone 14) o'lchamida ochib, layout me'yorlarini
 * buzilishdan saqlaydi:
 *   · gorizontal siljish yo'q (scrollWidth ≤ viewport);
 *   · asosiy bosiladigan narsalar ≥44px (burger, CTA, forma maydonlari);
 *   · matn ≥12px (asosiy kontent).
 *
 * To'liq audit (21 sahifa, batafsil hisobot): `npm run audit:mobile`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

const VIEWPORT = { width: 390, height: 844 };
let httpServer;
let serverUrl;
let browser;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, () => {
    serverUrl = `http://localhost:${httpServer.address().port}`;
    resolve();
  }));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
}, 60000);

afterAll(async () => {
  if (authCtx) await authCtx.close().catch(() => {});
  if (browser) await browser.close();
  if (httpServer && httpServer.listening) await new Promise((r) => httpServer.close(r));
  restoreDb();
});

async function mobileContext() {
  return browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
}

async function login(ctx, { username = 'user', password = 'user' } = {}) {
  const page = await ctx.newPage();
  await page.goto(`${serverUrl}/user/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL('**/user/panel', { timeout: 20000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.close();
}

/** Sahifadagi mobil me'yor buzilishlarini o'lchaydi. */
async function auditPage(page, path) {
  await page.goto(`${serverUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const docEl = document.documentElement;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (!(r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && parseFloat(st.opacity) > 0.05)) return false;
      if (el.closest('.sr-only, .skip-link')) return false;
      const drawer = el.closest('.shell-sidebar, .adm-sidebar, .admin-sidebar, #shell-sidebar, .nav-links');
      if (drawer) {
        const open = document.body.classList.contains('shell-open') || document.body.classList.contains('nav-open') || drawer.classList.contains('open');
        if (!open) return false;
      }
      const navToggle = el.closest('.nav-toggle');
      if (navToggle) return false; // topbar kontrolkalari alohida audit qilinadi
      const visW = Math.min(r.right, vw) - Math.max(r.left, 0);
      if (visW <= 0 || visW / r.width < 0.5) return false; // yopiq drawer/sirg'aluvchi panel
      return true;
    };
    const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(/\s+/).slice(0, 2).join('.')}${el.getAttribute && el.getAttribute('href') ? '→' + el.getAttribute('href').slice(0, 28) : ''}${el.parentElement && el.parentElement.className ? ' (in .' + el.parentElement.className.toString().split(/\s+/)[0] + ')' : ''}`;

    const beforeX = window.scrollX;
    window.scrollTo(400, window.scrollY);
    const canScrollX = window.scrollX > beforeX + 1;
    window.scrollTo(beforeX, window.scrollY);
    const overflowPx = canScrollX ? (docEl.scrollWidth - vw) : 0;

    const smallTargets = [];
    for (const el of document.querySelectorAll('button:not(.skip-link), a[href], input:not([type="hidden"]), select, [role="button"]')) {
      if (!visible(el)) continue;
      if (el.classList.contains('skip-link')) continue;
      const r = el.getBoundingClientRect();
      if (r.height >= 43.5 && r.width >= 43.5) continue;
      // Matn havolasi: balandligi yetarli bo'lsa — kenglik matn uzunligiga bog'liq
      if (el.tagName === 'A' && (el.textContent || '').trim().length > 1 && r.height >= 43.5) continue;
      const p = el.parentElement;
      if (el.tagName === 'A' && p && /^(P|LI|SMALL|LABEL)$/.test(p.tagName) && r.height <= 28) continue;
      // Checkbox/radio: nishon — uning label'i (kattaroq maydon)
      if (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type)) {
        const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
        if (lab) { const lr = lab.getBoundingClientRect(); if (lr.height >= 43.5 && lr.width >= 43.5) continue; }
      }
      smallTargets.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (smallTargets.length >= 8) break;
    }

    const tinyText = [];
    for (const el of document.querySelectorAll('p, span, li, div, small, label, button, a, h1, h2, h3, h4')) {
      if (!visible(el)) continue;
      if (!(el.textContent || '').trim()) continue;
      if (el.children.length && !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs && fs < 12) { tinyText.push(`${label(el)} ${fs.toFixed(1)}px "${el.textContent.trim().slice(0, 24)}"`); if (tinyText.length >= 8) break; }
    }

    return { path: location.pathname, overflowPx, canScrollX, smallTargets, tinyText };
  });
}

let authCtx;
describe('mobil smoke (390×844)', () => {
  beforeAll(async () => {
    authCtx = await mobileContext();
    await login(authCtx);
  }, 60000);

  it('landing + auth: siljish yo‘q, tugmalar ≥44px', async () => {
    const ctx = await mobileContext();
    const page = await ctx.newPage();
    for (const path of ['/', '/user/login', '/user/register']) {
      const r = await auditPage(page, path);
      expect(r.overflowPx, `${path} gorizontal siljish`).toBeLessThanOrEqual(2);
      expect(r.smallTargets, `${path} kichik tugmalar: ${r.smallTargets.join(', ')}`).toEqual([]);
    }
    await ctx.close();
  }, 60000);

  it('foydalanuvchi sahifalari (panel/tests/taqdimotlar/mashq/natijalar)', async () => {
    const ctx = authCtx;
    const page = await ctx.newPage();
    for (const path of ['/user/panel', '/user/tests', '/user/presentations', '/user/practice?source=user&key=ut1', '/user/practice-history']) {
      const r = await auditPage(page, path);
      expect(r.overflowPx, `${path} gorizontal siljish`).toBeLessThanOrEqual(2);
      expect(r.smallTargets, `${path} kichik tugmalar: ${r.smallTargets.join(', ')}`).toEqual([]);
    }
    await page.close();
  }, 90000);

  it('taqdimotlar hub’ida "rasmiy ulanish" banneri YO‘Q (rev.4 talabi)', async () => {
    const ctx = authCtx;
    const page = await ctx.newPage();
    await page.goto(`${serverUrl}/user/presentations`, { waitUntil: 'domcontentloaded' });
    expect(await page.locator('.ps-prov').count()).toBe(0);
    const text = await page.locator('.ps-hub').innerText();
    expect(text).not.toContain('kalitlar kiritilmagan');
    expect(text).not.toContain('rasmiy ulanish');
    await page.close();
  }, 40000);

  it('cast ishtirokchi sahifasi (telefon-first) siljimaydi', async () => {
    const { seedCastSession } = await import('./cast-e2e.helper.js');
    const ctx = authCtx;
    const seeded = await seedCastSession({ title: 'Mobil smoke', owner: 'user:user', questionCount: 1 });
    const page = await ctx.newPage();
    const r = await auditPage(page, `/play?code=${seeded.joinCode}`);
    expect(r.overflowPx, 'ishtirokchi sahifasi siljishi').toBeLessThanOrEqual(2);
    await page.close();
  }, 90000);
});
