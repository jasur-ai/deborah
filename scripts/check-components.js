#!/usr/bin/env node
/**
 * Deborah — Components Validator (STYLE STEP 12)
 * ----------------------------------------------
 * S12.01 — button variantlar: primary/secondary/quiet/danger/link
 * S12.02 — size'lar: 32/40/44/48px
 * S12.03 — microstates: hover/active/focus-visible/loading/disabled/selected
 * S12.04 — loading width stable (.is-loading)
 * S12.06 — danger red semantic (gradient emas)
 * S12.07 — icon-btn 44px + aria-label + data-tip
 * S12.08 — aria-pressed + selected marker
 * S12.09 — badge 5 variant
 * S12.10 — gradient primary buttonlar YO'Q (solid)
 * S12.11 — emoji buttonlar YO'Q (SVG family)
 * S12.13 — $3 sed qoldiqlari YO'Q (STEP 09 bug fix)
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── S12.13: $3 qoldiqlari (STEP 09 sed bug) ──
let residue = 0;
for (const f of readdirSync(join(ROOT, 'public/css')).filter((x) => x.endsWith('.css'))) {
  residue += (rd(`public/css/${f}`).match(/\$3/g) || []).length;
}
if (residue === 0) ok('S12.13: $3 sed qoldiqlari yoq (0)');
else bad(`S12.13: ${residue} ta $3 qoldigi — padding invalid CSS!`);

// ── S12.01: variantlar ──
const btn = rd('public/design/components/button.css');
for (const v of ['.btn-primary', '.btn-secondary', '.btn-quiet', '.btn-danger', '.btn-link', '.btn-sm', '.btn-lg', '.btn-xl', '.is-loading', '.is-selected']) {
  if (btn.includes(v)) ok(`S12.01/03: ${v} mavjud`);
  else bad(`S12.01/03: ${v} yoq`);
}

// ── S12.02: size'lar (S36.09: 40px olib tashlandi — WCAG 2.5.8 base 44px) ──
if (/min-height: 32px/.test(btn)) ok('S12.02: 32px dense (exception)');
else bad('S12.02: 32px dense yoq');
if (/min-height: 44px/.test(btn)) ok('S12.02: 44px default');
else bad('S12.02: 44px default yoq');
if (/min-height: 48px/.test(btn)) ok('S12.02: 48px lg/xl');
else bad('S12.02: 48px lg/xl yoq');
if (/min-height: 40px/.test(btn)) bad('S12.02: 40px qolmadi (S36.09)');

// ── S12.04: loading width stable ──
if (btn.includes('.is-loading .btn-label')) ok('S12.04: loading label saqlanadi');
else bad('S12.04: loading label yoq');

// ── S12.06: danger red semantic ──
if (/btn-danger[^}]*status-danger/.test(btn)) ok('S12.06: danger status-danger token');
else bad('S12.06: danger status-danger emas');

// ── S12.07: icon-btn 44px + tooltip ──
const ico = rd('public/design/components/icon-button.css');
if (/width: 44px/.test(ico)) ok('S12.07: icon-btn 44px hit area');
else bad('S12.07: icon-btn 44px emas');
if (ico.includes('[data-tip]')) ok('S12.07: icon-btn tooltip');
else bad('S12.07: tooltip yoq');

// ── S12.08: aria-pressed + marker ──
if (/aria-pressed='true'/.test(ico) || /aria-pressed="true"/.test(ico)) ok('S12.08: aria-pressed');
else bad('S12.08: aria-pressed yoq');
if (ico.includes('::after')) ok('S12.08: selected marker dot');
else bad('S12.08: selected marker yoq');

// ── S12.09: badge 5 variant ──
const bdg = rd('public/design/components/badge.css');
for (const v of ['badge-neutral', 'badge-info', 'badge-success', 'badge-warning', 'badge-danger']) {
  if (bdg.includes(`.${v}`)) ok(`S12.09: ${v}`);
  else bad(`S12.09: ${v} yoq`);
}

// ── S12.10: gradient primary YO'Q ──
const styleCss = rd('public/css/style.css');
if (!/\.btn-primary\s*\{[^}]*linear-gradient/.test(styleCss)) ok('S12.10: style.css btn-primary solid');
else bad('S12.10: style.css btn-primary hali gradient');
if (!/\.ld-btn-primary\s*\{[^}]*linear-gradient/.test(rd('public/css/landing.css'))) ok('S12.10: landing btn-primary solid');
else bad('S12.10: landing btn-primary hali gradient');

// ── S12.11: emoji buttonlar YO'Q (mood-indicator conf/signal buttonlari mustasno) ──
let emojiHits = 0;
for (const f of readdirSync(join(ROOT, 'views/cast')).filter((x) => x.endsWith('.ejs'))) {
  const c = rd(`views/cast/${f}`);
  // conf-btn / conf-signal-btn — ishtirokchi MOOD belgilari (🤔😐😎), dizayn bo'yicha saqlanadi
  const stripped = c.replace(/<button[^>]*class="[^"]*conf-(btn|signal-btn)[^"]*"[^>]*>[\s\S]*?<\/button>/g, '');
  emojiHits += (stripped.match(/<button[^>]*>.*?[\u{1F300}-\u{1FAFF}\u270F\uFE0F].*?<\/button>/gu) || []).length;
}
if (emojiHits === 0) ok('S12.11: cast funksional buttonlarda emoji yoq (SVG family)');
else bad(`S12.11: ${emojiHits} ta emoji button qoldi (mood-indicator'dan tashqari)`);

// ── head.ejs component importlar ──
const head = rd('views/partials/head.ejs');
for (const c of ['button.css', 'icon-button.css', 'badge.css']) {
  if (head.includes(`components/${c}`)) ok(`S12: head.ejs ${c}`);
  else bad(`S12: head.ejs ${c} yoq`);
}

// ── S12.11: har bir icon('x') call icons.js'da mavjud bo'lishi shart ──
const iconsJs = rd('utils/icons.js');
const iconKeys = new Set([...iconsJs.matchAll(/^  ([a-zA-Z0-9]+):/gm)].map((m) => m[1]));
let missingIcons = [];
for (const dir of ['views', 'public/js']) {
  const walk = (p) => {
    for (const e of readdirSync(join(ROOT, p), { withFileTypes: true })) {
      const fp = join(p, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/.(ejs|js)$/.test(e.name)) {
        const c = rd(fp);
        for (const m of c.matchAll(/icon\('([a-zA-Z0-9]+)'/g)) {
          if (!iconKeys.has(m[1])) missingIcons.push(`${fp}: ${m[1]}`);
        }
      }
    }
  };
  walk(dir);
}
if (missingIcons.length === 0) ok(`S12.11: barcha icon() calllar icons.js'da mavjud (${iconKeys.size} icon)`);
else missingIcons.slice(0, 8).forEach((x) => bad(`S12.11: icon mavjud emas — ${x}`));

console.log('');
if (errors.length) {
  console.log(`❌ Components validator: ${errors.length} xato`);
  process.exit(1);
}
console.log('✅ Components validator: PASS');
process.exit(0);
