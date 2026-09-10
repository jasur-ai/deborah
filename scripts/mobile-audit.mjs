/**
 * Deborah — Mobile audit (390×844, iPhone 14 o'lchami)
 * -----------------------------------------------------
 * Har bir sahifani telefon viewport'ida ochib, quyidagilarni o'lchaydi:
 *   1) gorizontal overflow (scrollWidth > innerWidth) — sahifa yon tomonga
 *      surilib ketishi mobil uchun eng og'ir bug;
 *   2) ekrandan chiqib ketgan elementlar (viewport'dan tashqari, ko'rinadigan);
 *   3) tap-target o'lchamlari: tugma / input / havola-ish tugmalari < 44px;
 *   4) 12px'dan kichik matnlar (o'qish qiyin);
 *   5) bir-biriga yopishgan (overlap) fixed elementlar (navbar/footer).
 *
 * Ishlatish:  node scripts/mobile-audit.mjs [--json /tmp/mobile.json]
 * Chiqish: har sahifa uchun topilgan muammolar + yakuniy xulosa.
 */

import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { snapshotDb, restoreDb } from '../tests/helpers/setup.js';
import { seedCastSession } from '../tests/e2e/cast-e2e.helper.js';

const VIEWPORT = { width: 390, height: 844 };
const JSON_OUT = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null;

// --only=<regex> — faqat mos sahifalarni tekshirish (tez iteratsiya uchun)
const ONLY = (() => {
  const a = process.argv.find((x) => x.startsWith('--only='));
  return a ? new RegExp(a.slice('--only='.length)) : null;
})();

const PAGES = [
  { name: 'landing', path: '/', public: true },
  { name: 'login', path: '/user/login', public: true },
  { name: 'register', path: '/user/register', public: true },
  { name: 'legal', path: '/legal', public: true },
  { name: 'panel', path: '/user/panel' },
  { name: 'tests', path: '/user/tests' },
  { name: 'presentations', path: '/user/presentations' },
  { name: 'practice-history', path: '/user/practice-history' },
  { name: 'profile', path: '/user/profile' },
  { name: 'notifications', path: '/user/notifications' },
  { name: 'settings', path: '/user/settings' },
  { name: 'security-profile', path: '/user/security-profile' },
  { name: 'assignments', path: '/user/assignments' },
  { name: 'ai-studio', path: '/user/ai-studio', gated: true },
  { name: 'practice', path: '/user/practice?source=user&key=ut1' },
  { name: 'admin-dashboard', path: '/admin/dashboard', admin: true },
  { name: 'admin-canva', path: '/admin/canva', admin: true },
  { name: 'admin-users', path: '/admin/users', admin: true },
  { name: 'cast-participant', cast: 'participant' },
  { name: 'cast-director', cast: 'director' },
  { name: 'cast-projector', cast: 'projector' },
];

const SELECTED_PAGES = ONLY ? PAGES.filter((p) => ONLY.test(p.name)) : PAGES;

const AUDIT_JS = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && parseFloat(st.opacity) > 0.05)) return false;
    // Asosan ekrandan tashqarida (yopiq drawer, sirg'aluvchi banner) — tap-target emas
    const vw = window.innerWidth;
    const visW = Math.min(r.right, vw) - Math.max(r.left, 0);
    if (visW <= 0 || visW / r.width < 0.5) return false;
    // Fokusda ko'rinadigan skip-link — tap-target emas
    if (el.closest('.skip-link')) return false;
    if (el.classList.contains('skip-link') && document.activeElement !== el) return false;
    // Screen-reader-only
    if (el.closest('.sr-only')) return false;
    // Yopiq off-canvas drawer (sidebar) — transform bilan chetda turadi, xato emas
    const drawer = el.closest('.shell-sidebar, .adm-sidebar, .admin-sidebar, #shell-sidebar, .nav-links');
    if (drawer) {
      const open = document.body.classList.contains('shell-open') || document.body.classList.contains('nav-open') || drawer.classList.contains('open') || drawer.getAttribute('data-open') === 'true';
      if (!open) return false;
    }
    return true;
  };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42);
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''} — "${t}"`;
  };

  // 1) overflow — HAQIQIY scroll (html scrollWidth + scrollTo sinovi).
  // body scrollWidth yopiq drawer/fixed panel tufayli katta bo'lishi mumkin;
  // foydalanuvchi uchun muhimi — sahifa yon tomonga siljiy oladimi.
  const docEl = document.documentElement;
  const beforeX = window.scrollX;
  window.scrollTo(400, window.scrollY);
  const canScrollX = window.scrollX > beforeX + 1;
  window.scrollTo(beforeX, window.scrollY);
  const overflowPx = canScrollX ? (docEl.scrollWidth - vw) : 0;

  // overflow'ga sabab bo'lgan elementlar (viewport'dan o'ngga chiqqan)
  const offenders = [];
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    if (!visible(el)) continue;
    if (el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 || r.left < -2) {
      // faqat eng tashqi (ota-onasi ham chiqqan bo'lsa, bolasini yozmaymiz)
      const p = el.parentElement;
      const pr = p ? p.getBoundingClientRect() : null;
      if (pr && (pr.right > vw + 2 || pr.left < -2)) continue;
      offenders.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
    }
    if (offenders.length >= 8) break;
  }

  // 2) tap targets (< 44px balandlik yoki < 44px kenglik, interaktiv)
  const small = [];
  const interactive = document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], .qbtn, [data-act]');
  for (const el of interactive) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height >= 43.5 && r.width >= 43.5) continue;
    // inline matn havolalari (paragraf ichida) — istisno
    const p = el.parentElement;
    if (el.tagName === 'A' && p && /^(P|LI|SPAN|SMALL|LABEL)$/.test(p.tagName) && r.height <= 28) continue;
    // matn havolasi: balandligi yetarli bo'lsa, kengligi matn uzunligiga bog'liq (WCAG 2.5.8)
    if (el.tagName === 'A' && (el.textContent || '').trim().length > 1 && r.height >= 43.5) continue;
    small.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    if (small.length >= 12) break;
  }

  // 3) kichik matnlar (< 12px)
  const tiny = [];
  const textNodes = document.querySelectorAll('p, span, li, td, div, small, h1, h2, h3, h4, label, button, a');
  for (const el of textNodes) {
    if (!visible(el)) continue;
    if (!(el.textContent || '').trim()) continue;
    if (el.children.length && !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs && fs < 12) {
      tiny.push({ el: label(el), fs: +fs.toFixed(1) });
      if (tiny.length >= 10) break;
    }
  }

  // 4) yopishib qolgan fixed elementlar (bir-birining ustiga tushishi)
  const fixed = Array.from(document.querySelectorAll('body *')).filter((el) => {
    const st = getComputedStyle(el);
    return st.position === 'fixed' && visible(el) && el.getBoundingClientRect().height > 8;
  });
  const overlaps = [];
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i].getBoundingClientRect();
      const b = fixed[j].getBoundingClientRect();
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const peA = getComputedStyle(fixed[i]).pointerEvents;
      const peB = getComputedStyle(fixed[j]).pointerEvents;
      if (peA === 'none' || peB === 'none') continue; // bosilmaydigan konteyner — to'siq emas
      if (ix > 4 && iy > 4) overlaps.push({ a: label(fixed[i]), b: label(fixed[j]), ix: Math.round(ix), iy: Math.round(iy) });
    }
  }

  // 5) meta viewport borligi
  const vpMeta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';

  return {
    vw, vh,
    scrollWidth: docEl.scrollWidth,
    canScrollX,
    overflowPx, offenders, small, tiny, overlaps, vpMeta,
    h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 60),
  };
};

async function run() {
  snapshotDb();
  const { httpServer } = await createApp();
  const serverUrl = await new Promise((resolve) => {
    httpServer.listen(0, () => resolve(`http://localhost:${httpServer.address().port}`));
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const results = [];

  // login (user)
  const userCtx = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const lp = await userCtx.newPage();
  await lp.goto(`${serverUrl}/user/login`, { waitUntil: 'domcontentloaded' });
  await lp.fill('input[name="username"]', 'user');
  await lp.fill('input[name="password"]', 'user');
  await Promise.all([lp.waitForURL('**/user/panel', { timeout: 15000 }).catch(() => {}), lp.click('button[type="submit"]')]);
  await lp.close();

  // login (admin)
  const adminCtx = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const ap = await adminCtx.newPage();
  await ap.goto(`${serverUrl}/admin/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const hasAdminForm = await ap.locator('input[name="username"]').count();
  if (hasAdminForm) {
    await ap.fill('input[name="username"]', process.env.ADMIN_USER || 'admin');
    await ap.fill('input[name="password"]', process.env.ADMIN_PASS || 'admin');
    await Promise.all([ap.waitForLoadState('domcontentloaded'), ap.click('button[type="submit"]')]);
  }
  await ap.close();

  // ── Cast sessiyasi (ishtirokchi/direktor/proyektor — telefon-first sahifalar) ──
  let castIds = null;
  if (SELECTED_PAGES.some((p) => p.cast)) {
    try {
      const seeded = await seedCastSession({ title: 'Mobile audit', owner: 'user:user', questionCount: 1 });
      castIds = { id: seeded.sessionId, code: seeded.joinCode };
      console.log('  cast seed:', castIds.id, castIds.code);
    } catch (e) {
      console.log('  cast seed xato:', e.message.slice(0, 120));
    }
  }

  for (const spec of SELECTED_PAGES) {
    const ctx = spec.admin ? adminCtx : (spec.public ? userCtx : userCtx);
    if (spec.cast) {
      if (!castIds) { results.push({ name: spec.name, path: spec.cast, error: 'cast seed yo‘q' }); continue; }
      if (spec.cast === 'director') spec.path = `/cast/${castIds.id}/director`;
      else if (spec.cast === 'projector') spec.path = `/cast/${castIds.id}/projector`;
      else spec.path = `/play?code=${castIds.code}`;
    }
    const page = await ctx.newPage();
    let res;
    try {
      const resp = await page.goto(`${serverUrl}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const status = resp ? resp.status() : 0;
      await page.waitForTimeout(350);
      if (spec.gated && status === 403) {
        results.push({ name: spec.name, path: spec.path, status, skipped: 'feature gated (VIP)' });
      } else if (status >= 400) {
        results.push({ name: spec.name, path: spec.path, status, error: `HTTP ${status}` });
      } else {
        const r = await page.evaluate(AUDIT_JS);
        results.push({ name: spec.name, path: spec.path, status, ...r });
      }
    } catch (e) {
      results.push({ name: spec.name, path: spec.path, error: e.message.slice(0, 120) });
    }
    await page.close().catch(() => {});
  }

  await browser.close();
  await new Promise((r) => httpServer.close(r));
  restoreDb();

  // ── Report ──
  let totalIssues = 0;
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  DEBORAH — MOBILE AUDIT (390×844)                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  for (const r of results) {
    if (r.skipped) { console.log(`\n⊘ ${r.name} (${r.path}) — o‘tkazib yuborildi (${r.skipped})`); continue; }
    if (r.skipped) { console.log(`\n⊘ ${r.name} (${r.path}) — o‘tkazib yuborildi (${r.skipped})`); continue; }
    if (r.error) { console.log(`\n✗ ${r.name} (${r.path}) — ${r.error}`); totalIssues += 1; continue; }
    if (!r.offenders) { console.log(`\n✗ ${r.name} (${r.path}) — o‘lchanmadi`); totalIssues += 1; continue; }
    const issues = [];
    if (r.overflowPx > 2) issues.push(`gorizontal overflow +${r.overflowPx}px (scrollWidth ${r.scrollWidth})`);
    if (r.offenders.length) issues.push(`viewport'dan chiqqan: ${r.offenders.map((o) => `${o.el} [${o.left}..${o.right}]`).join(' | ')}`);
    if (r.small.length) issues.push(`kichik tap-target (${r.small.length}): ${r.small.slice(0, 5).map((s) => `${s.el} ${s.w}×${s.h}`).join(' | ')}`);
    if (r.tiny.length) issues.push(`<12px matn (${r.tiny.length}): ${r.tiny.slice(0, 5).map((t) => `${t.el} ${t.fs}px`).join(' | ')}`);
    if (r.overlaps.length) issues.push(`fixed overlap: ${r.overlaps.map((o) => `${o.a} ✕ ${o.b}`).join(' | ')}`);
    if (!/width=device-width/.test(r.vpMeta || '')) issues.push('meta viewport yo‘q/noto‘g‘ri');
    totalIssues += issues.length;
    if (issues.length === 0) console.log(`\n✓ ${r.name} (${r.path}) — muammo yo‘q`);
    else {
      console.log(`\n⚠ ${r.name} (${r.path}) — ${issues.length} muammo`);
      for (const i of issues) console.log(`    · ${i}`);
    }
  }
  console.log(`\n──────────────────────────────────────────────────────────────\n  Jami: ${totalIssues} muammo, ${results.length} sahifa\n`);
  if (JSON_OUT) {
    const { writeFileSync } = await import('fs');
    writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
    console.log(`  JSON: ${JSON_OUT}`);
  }
  // Toza yopilish (aks holda HTTP server + sessiya taymeri event loop'ni tirik
  // ushlab qoladi va CLI hech qachon chiqmaydi) + gate exit kodi.
  await new Promise((r) => httpServer.close(r));
  restoreDb();
  if (totalIssues > 0) console.log('FAIL — mobil muammolar topildi');
  else console.log('PASS — barcha sahifalar mobil toza');
  process.exit(totalIssues > 0 ? 1 : 0);
}

run().catch((e) => { console.error('audit failed:', e); process.exit(1); });
