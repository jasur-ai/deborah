#!/usr/bin/env node
/**
 * Edikit — Teacher Workspace Validator (STYLE STEP 25)
 * ------------------------------------------------------
 * S25.01 — 820px single → 1280px workspace grid (shell + content)
 * S25.02 — header greeting + `Yangi test` primary + `Quick Prompt` secondary
 * S25.03 — first fold: resume card (Cast qilish/Sinov) YOKI first-use action
 * S25.04 — actionable metrics (attention/evidence/draft), generic stat emas
 * S25.05 — STEP 17 shell (sidebar), characters/decorative olib tashlandi
 * S25.07 — skeleton + inline retry + contextual empty
 * S25.08 — density preference (workspace.js localStorage)
 * S25.09 — metadata min 14px (0.875rem+)
 * S25.10 — logout shell-account da (primary actions emas)
 * S25.11 — live region cheklangan (ws-live, flood yo'q)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

const panel = rd('views/user/panel.ejs');
const wsCss = rd('public/design/contexts/workspace.css');
const wsJs = rd('public/js/workspace.js');

// ── S25.01: workspace grid + shell ──
if (wsCss.includes('max-width: 1280px') && panel.includes("include('../partials/sidebar'"))
  ok('S25.01: 1280px workspace grid + STEP 17 shell');
else bad('S25.01: workspace grid/shell yoq');
if (panel.includes('<main class="main"'))
  ok('S25.01: shell main strukturasi');
else bad('S25.01: main shell emas');

// ── S25.02: header actions ──
if (panel.includes('Yangi test') && panel.includes('Quick Prompt') && panel.includes('btn btn-primary'))
  ok('S25.02: header — primary (Yangi test) + secondary (Quick Prompt)');
else bad('S25.02: header actions toliq emas');

// ── S25.03: first fold ──
if (panel.includes('ws-resume') && panel.includes('Cast qilish'))
  ok('S25.03: resume card (first fold)');
else bad('S25.03: resume card yoq');
if (panel.includes('Birinchi testingizni yarating'))
  ok('S25.03: first-use action ham mavjud');
else bad('S25.03: first-use action yoq');

// ── S25.04: actionable metrics ──
if (panel.includes('ws-metrics') && panel.includes('ws-metric') &&
    /ws-metric-label/.test(panel) && /ws-metric-hint/.test(panel))
  ok('S25.04: actionable metrics (label+value+hint)');
else bad('S25.04: actionable metrics yoq');

// ── S25.05: characters olib tashlandi ──
if (!panel.includes('chars-panel') && !panel.includes('selectChar') && !panel.includes('Characters'))
  ok('S25.05: characters panel olib tashlandi');
else bad('S25.05: hali characters mavjud');

// ── S25.06: Signal Rail cheklangan ──
if (wsCss.includes('.ws-rail'))
  ok('S25.06: signal rail cheklangan (workspace.css)');
else bad('S25.06: signal rail yoq');

// ── S25.07: skeleton + retry + empty ──
if (panel.includes('ws-skeleton-card') && panel.includes('Qayta urinish') && panel.includes('ws-state'))
  ok('S25.07: skeleton + inline retry + contextual empty');
else bad('S25.07: loading/error/empty toliq emas');

// ── S25.08: density preference ──
if (wsJs.includes('edikit-ws-density') && wsCss.includes('data-ws-density'))
  ok('S25.08: density preference (localStorage)');
else bad('S25.08: density preference yoq');

// ── S25.09: metadata min 14px ──
if (wsCss.includes('0.875rem') && /\.ws-test-meta\s*\{[^}]*0\.875rem/.test(wsCss))
  ok('S25.09: metadata min 14px (0.875rem)');
else bad('S25.09: 14px metadata yoq');

// ── S25.10: logout shell-account da ──
if (!/logout[^"]*class="[^"]*nav-btn/.test(panel) && rd('views/partials/sidebar.ejs').includes('shell-account-menu-item--logout'))
  ok('S25.10: logout shell-account (destructive ajratilgan)');
else bad("S25.10: logout hali topbar'da");

// ── S25.11: live region cheklangan ──
if (panel.includes('id="ws-live"') && /aria-live="polite"/.test(panel))
  ok('S25.11: live region flood yoq (ws-live polite)');
else bad('S25.11: live region yoq');

console.log(errors.length ? `\n${errors.length} ta xato` : '\nPASS — STEP 25 barcha talablari bajarildi');
process.exit(errors.length ? 1 : 0);
