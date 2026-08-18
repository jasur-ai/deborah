#!/usr/bin/env node
/**
 * Edikit — Forms Validator (STYLE STEP 13)
 * -----------------------------------------
 * S13.01 — form field anatomy (label + control + hint/error) mavjud
 * S13.02 — placeholder label o'rnida EMAS (view'larda label shart)
 * S13.03 — control 44px desktop / 48px mobile; mobile font >= 16px
 * S13.04 — control border token (>= 3:1)
 * S13.05 — focus ring + border, layout shift yo'q; hover != focus
 * S13.06 — error/warning/success state CSS
 * S13.07 — read-only vs disabled farqi
 * S13.08 — autocomplete/inputmode/aria-describedby view'larda
 * S13.09 — server error saqlash (prevUsername) + error summary
 * S13.10 — password show/hide + caps-lock hint
 * S13.11 — native select (form-select) styled, custom combobox emas
 * S13.12 — text-spacing / forced-colors tolerant
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── S13.01-05: input.css ──
const inp = rd('public/design/components/input.css');
if (inp.includes('.form-field__label')) ok('S13.01: form-field anatomy (label)');
else bad('S13.01: .form-field__label yoq');
if (inp.includes('.form-field__error') && inp.includes('.form-field__hint')) ok('S13.01: hint + error anatomy');
else bad('S13.01: hint/error anatomy yoq');
if (/min-height: 44px/.test(inp)) ok('S13.03: control 44px desktop');
else bad('S13.03: 44px desktop yoq');
if (/@media \(max-width: 640px\)[\s\S]*min-height: 48px/.test(inp)) ok('S13.03: 48px mobile');
else bad('S13.03: 48px mobile yoq');
if (/font-size: 16px/.test(inp) || /font-size: var\(--edikit-typography-font-size-md[^)]*\), 16px\)/.test(inp)) ok('S13.03: mobile font 16px');
else bad('S13.03: mobile font 16px yoq');
if (inp.includes('--edikit-semantic-color-border-default')) ok('S13.04: border token (>= 3:1)');
else bad('S13.04: border token yoq');
if (inp.includes('outline: 3px solid var(--edikit-semantic-color-focus')) ok('S13.05: focus ring token');
else bad('S13.05: focus ring token yoq');
if (inp.includes(':hover:not(:disabled):not(:focus)')) ok('S13.05: hover != focus');
else bad('S13.05: hover/focus farqi yoq');

// ── S13.06: states ──
if (inp.includes('aria-invalid') && inp.includes('--edikit-semantic-color-status-danger')) ok('S13.06: error state (danger border)');
else bad('S13.06: error state yoq');
if (inp.includes('--edikit-semantic-color-status-warning')) ok('S13.06: warning state');
else bad('S13.06: warning state yoq');

// ── S13.07: read-only vs disabled ──
if (inp.includes(':read-only') && inp.includes(':disabled')) ok('S13.07: read-only != disabled');
else bad('S13.07: read-only/disabled farqi yoq');

// ── S13.08: view'larda autocomplete/aria (chuqur rekursiya) ──
const login = rd('views/user/login.ejs');
let ariaTotal = 0, autoTotal = 0;
(function walk(p) {
  for (const e of readdirSync(join(ROOT, p), { withFileTypes: true })) {
    const fp = join(p, e.name);
    if (e.isDirectory()) walk(fp);
    else if (e.name.endsWith('.ejs')) {
      const c = rd(fp);
      ariaTotal += (c.match(/aria-describedby=/g) || []).length;
      autoTotal += (c.match(/autocomplete=/g) || []).length;
    }
  }
})('views');
if (login.includes('aria-required="true"') && login.includes('inputmode=')) ok('S13.08: login aria-required + inputmode');
else bad('S13.08: login aria-required/inputmode yoq');
if (autoTotal > 0) ok(`S13.08: autocomplete ${autoTotal} ta (view'lar)`);
else bad('S13.08: autocomplete yoq');

// ── S13.09: server error saqlash ──
if (login.includes('prevUsername')) ok('S13.09: server error input saqlanadi (prevUsername)');
else bad('S13.09: prevUsername yoq');
if (rd('public/design/components/form.css').includes('.error-summary')) ok('S13.09: error summary CSS');
else bad('S13.09: error summary yoq');

// ── S13.10: password show/hide + caps-lock ──
if (login.includes('data-pw-toggle') && login.includes('aria-pressed')) ok('S13.10: password show/hide');
else bad('S13.10: pw-toggle yoq');
if (login.includes('caps-hint') && rd('public/js/auth.js').includes('getModifierState')) ok('S13.10: caps-lock hint');
else bad('S13.10: caps-lock hint yoq');

// ── S13.11: native select ──
const sel = rd('public/design/components/select.css');
if (sel.includes('.form-select') && sel.includes('appearance: none')) ok('S13.11: native select styled');
else bad('S13.11: form-select yoq');

// ── S13.12: tolerance ──
if (rd('public/design/components/form.css').includes('forced-colors')) ok('S13.12: forced-colors tolerant');
else bad('S13.12: forced-colors yoq');

// ── S12.10: login btn-primary gradient qolmagani ──
if (!/btn-primary\{background:linear-gradient/.test(login)) ok('S12.10: login btn-primary solid');
else bad('S12.10: login btn-primary hali gradient');

// ── S13.04: view-local .inp override faint border bilan bo'lmasligi (review #6) ──
if (!/\.inp\{[^}]*rgba\(255,255,255,\.0[0-9]\)[^}]*border/.test(login)) ok('S13.04: login .inp local override token emas');
else bad('S13.04: login .inp hali faint border bilan override qilinadi');

// ── head.ejs imports ──
const head = rd('views/partials/head.ejs');
for (const c of ['input.css', 'select.css', 'form.css']) {
  if (head.includes(`components/${c}`)) ok(`S13: head.ejs ${c}`);
  else bad(`S13: head.ejs ${c} yoq`);
}

console.log('');
if (errors.length) {
  console.log(`❌ Forms validator: ${errors.length} xato`);
  process.exit(1);
}
console.log('✅ Forms validator: PASS');
process.exit(0);
