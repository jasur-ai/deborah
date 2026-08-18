/**
 * AUTH D-12 — axe-core automated scan (WCAG 2.2 AA, §11/§16)
 * -----------------------------------------------------------------
 *  Auth ekranlarining server-render HTML'ini jsdom'ga yuklab, axe.run
 *  bilan scan qilamiz → 0 critical/serious violation (CI guard).
 *  Sabablar: color-contrast jsdom'da CSS hisoblamaydi (to'liq browser
 *  testi @axe-core/playwright E2E'da), shuning uchun contrast rule
 *  faqat browser E2E uchun; bu yerda strukturaviy rule'lar tekshiriladi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

// axe-core'ni jsdom window ichida yuklash (window scope'da ishlashi uchun)
const AXE_SOURCE = readFileSync(new URL('../../node_modules/axe-core/axe.js', import.meta.url), 'utf8');

let app;
let httpServer;
let base;

beforeAll(async () => {
  snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
  base = `http://localhost:${httpServer.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => httpServer.close(r));
  restoreDb();
});

/** HTML'ni jsdom'ga yuklab axe.run — violations qaytaradi. */
async function scanPage(path) {
  const res = await fetch(`${base}${path}`);
  expect([200, 401, 302]).toContain(res.status);
  const html = await res.text();
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  // axe-core'ni window ichida yuklash (UMD — window.axe o'rnatadi)
  dom.window.eval(AXE_SOURCE);
  const axeRun = dom.window.axe.run.bind(dom.window.axe);
  const results = await axeRun(dom.window.document, {
    rules: {
      // jsdom CSS hisoblamaydi — contrast browser E2E uchun
      'color-contrast': { enabled: false },
      // jsdom'da viewport yo'q
      'target-size': { enabled: false },
    },
  });
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

describe('AUTH D-12 — axe scan (0 critical/serious)', () => {
  it('login sahifasi', async () => {
    const v = await scanPage('/user/login?lang=uz');
    expect(v.map((x) => x.id)).toEqual([]);
  });

  it('register sahifasi', async () => {
    const v = await scanPage('/user/register?lang=uz');
    expect(v.map((x) => x.id)).toEqual([]);
  });

  it('forgot sahifasi', async () => {
    const v = await scanPage('/user/forgot?lang=uz');
    expect(v.map((x) => x.id)).toEqual([]);
  });

  it('reset sahifasi (authsiz redirect — 302 qabul)', async () => {
    const res = await fetch(`${base}/user/reset?token=x`);
    expect([200, 302]).toContain(res.status);
  });

  it('admin login sahifasi', async () => {
    const v = await scanPage('/admin/login');
    expect(v.map((x) => x.id)).toEqual([]);
  });
});
