#!/usr/bin/env node
/**
 * STEP 18 validator — Table, filter, search va density components.
 * Checks S18.01–S18.12 against source files.
 * Exit 0 = PASS, 1 = FAIL.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => {
  const f = path.join(ROOT, p);
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
};

let ok = true;
const check = (label, cond, detail = '') => {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    ok = false;
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
  }
};

const tableCss = read('public/design/components/table.css');
const filterCss = read('public/design/components/filter-bar.css');
const dtJs = read('public/js/components/data-table.js');
const headEjs = read('views/partials/head.ejs');
const dashboard = read('views/admin/dashboard.ejs');
const dev = read('views/dev/components.ejs');

console.log('STEP 18 — Tables validator');
console.log('── Semantic anatomy (S18.01/02) ──');
check('table.css .dt shell', /\.dt\s*\{/.test(tableCss));
check('sortable header button', /\.dt-sort/.test(tableCss));
check('aria-sort handled (JS)', /aria-sort/.test(dtJs));
check('th scope in dashboard', dashboard.includes('<th scope="col"'));
check('data-sort attr in dashboard', dashboard.includes('data-sort="name"'));
check('data-sort attr in CSS/JS', /data-sort/.test(dtJs));

console.log('── Alignment (S18.03) ──');
check('numeric right + tabular-nums', /\.dt-num\s*\{[\s\S]*?text-align:\s*right[\s\S]*?tabular-nums/.test(tableCss));
check('actions last column right', /\.dt-actions\s*\{\s*text-align:\s*right/.test(tableCss));
check('timestamp style', /\.dt-ts/.test(tableCss));

console.log('── Density (S18.04) ──');
check('default + compact density vars', /data-density="default"[\s\S]*?--dt-row-pad-y:\s*11px/.test(tableCss));
check('compact 36-40px', /data-density="compact"[\s\S]*?--dt-row-pad-y:\s*6px/.test(tableCss));
check('density switcher UI', /\.dt-density/.test(tableCss));
check('density pref localStorage (JS)', /localStorage\.(getItem|setItem)\(DENSITY_KEY/.test(dtJs));

console.log('── Row states (S18.05) ──');
check('hover + focus-within', /\.dt-row:hover[\s\S]*?\.dt-row:focus-within/.test(tableCss));
check('selected + pending + error', /is-selected[\s\S]*?is-pending[\s\S]*?is-error/.test(tableCss));

console.log('── Search (S18.06) ──');
check('debounce 150-250ms (200)', /DEBOUNCE_MS\s*=\s*200/.test(dtJs));
check('result count', /dt-count/.test(filterCss) && /dt-count/.test(dtJs));
check('loading status + clear', /dt-search-status/.test(filterCss) && /dt-search-clear/.test(filterCss));

console.log('── Filter chips (S18.07) ──');
check('removable chips', /dt-chip/.test(filterCss));
check('clear all', /dt-clear-all/.test(filterCss));
check('chips render JS', /_renderChips/.test(dtJs));

console.log('── URL/query state (S18.08) ──');
check('query param persist', /URLSearchParams/.test(dtJs) && /replaceState/.test(dtJs));

console.log('── Mobile reflow (S18.09/10) ──');
check('reflow at <=640px', /@media \(max-width:\s*640px\)[\s\S]*?\.dt-wrap\.is-reflow/.test(tableCss));
check('card grid reflow', /grid-template-columns:\s*1fr auto/.test(tableCss));
check('overflow affordance', /\.dt-wrap::after/.test(tableCss));
check('sticky header', /\.dt thead th\s*\{\s*position:\s*sticky/.test(tableCss));

console.log('── Loading/empty/error rows (S18.11) ──');
check('status row semantics', /\.dt-row-status/.test(tableCss));

console.log('── Wiring (S18.12 infra) ──');
check('table.css linked', headEjs.includes('table.css'));
check('filter-bar.css linked', headEjs.includes('filter-bar.css'));
check('data-table.js linked', headEjs.includes('data-table.js'));
check('dev demo data-dt', dev.includes('data-dt='));
check('dashboard DataTable init', dashboard.includes('new window.DataTable'));

console.log(ok ? '\n✅ Tables validator: PASS' : '\n❌ Tables validator: FAIL');
process.exit(ok ? 0 : 1);
