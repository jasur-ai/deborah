#!/usr/bin/env node
/**
 * Deborah — Auth Validator (STYLE STEP 24)
 * -----------------------------------------
 * S24.01 — split shell (product proof + 440px form), centered void EMAS
 * S24.02 — proper tab semantics (role=tablist/tab, aria-selected, tabindex)
 * S24.03 — visible labels / hint / autocomplete / inputmode
 * S24.04 — light theme semantic surface/border tokens, raw white alpha YO'Q
 * S24.05 — password show/hide + caps-lock (user + admin)
 * S24.06 — submit pending lock + duplicate-submit lock
 * S24.08 — admin link low-emphasis footer utility
 * S24.09 — theme control accessible (theme-segmented), floating circle YO'Q
 * S24.10 — 100dvh + overflow scroll (mobile keyboard)
 * S24.12 — admin distinct badge/title, no neon/security theater
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

const login = rd('views/user/login.ejs');
const admin = rd('views/admin/login.ejs');
const authCss = rd('public/design/contexts/auth.css');
const authJs = rd('public/js/auth.js');
const forgot = rd('views/user/forgot.ejs');
const reset = rd('views/user/reset.ejs');

// ── S24.01: split shell ──
if (login.includes('auth-shell') && authCss.includes('grid-template-columns: minmax(0, 1fr) 440px'))
  ok('S24.01: split shell — product proof + 440px form');
else bad('S24.01: split shell yoq (auth-shell / 440px grid)');
if (login.includes('auth-proof') && authCss.includes('.auth-proof h1'))
  ok('S24.01: product proof panel mavjud');
else bad('S24.01: product proof panel yoq');

// ── S24.02: proper tabs ──
if (login.includes('role="tablist"') && login.includes('role="tab"') &&
    login.includes('aria-selected=') && login.includes('tabindex='))
  ok('S24.02: proper tab semantics (tablist/tab/aria-selected/tabindex)');
else bad('S24.02: tab semantics toliq emas');
if (authJs.includes('ArrowRight') && authJs.includes('Home') && authJs.includes('End'))
  ok('S24.02: tab keyboard nav (arrows/Home/End)');
else bad('S24.02: tab keyboard nav yoq');

// ── S24.03: labels / autocomplete / inputmode ──
if (login.includes('class="lbl"') && login.includes('autocomplete="username"') &&
    login.includes('autocomplete="current-password"') && login.includes('inputmode='))
  ok('S24.03: visible labels + autocomplete + inputmode');
else bad('S24.03: labels/autocomplete/inputmode toliq emas');

// ── S24.04: no raw white alpha on light (semantic tokens) ──
if (!/rgba\(255,\s*255,\s*255,\s*0\.0[0-9]\)/.test(authCss) &&
    authCss.includes('--deborah-semantic-color-surface-input') === false &&
    authCss.includes('--deborah-semantic-color-border-default') &&
    authCss.includes('--deborah-semantic-color-surface-raised'))
  ok('S24.04: light theme semantic tokens (raw white alpha yoq)');
else bad('S24.04: hali raw white alpha yoki semantic token yoq');

// ── S24.05: pw toggle + caps both forms ──
if (login.includes('data-pw-toggle="login-password"') && login.includes('data-pw-toggle="reg-password"') &&
    login.includes('caps-hint') && admin.includes('data-pw-toggle="admin-password"') && admin.includes('caps-hint'))
  ok('S24.05: password show/hide + caps-lock (user login/reg + admin)');
else bad('S24.05: pw-toggle/caps biror formada yoq');

// ── S24.06: submit pending + duplicate lock ──
if (authJs.includes("form.dataset.submitting === '1'") && authJs.includes('is-pending') &&
    login.includes('auth-submit') && authCss.includes('.auth-submit.is-pending'))
  ok('S24.06: submit pending spinner + duplicate-submit lock');
else bad('S24.06: submit lock yoq');

// ── S24.07: enumeration-safe copy (copy bank orqali, hardcode yo'q) ──
const authI18n = rd('data/auth-i18n.js');
const routesAuth = rd('routes/auth.js');
const langs4 = ['uz', 'uz-cyrl', 'ru', 'en'].every((l) =>
  authI18n.includes(`userNotFound`) && authI18n.includes(`wrongPassword`));
const usesCopyKeys = routesAuth.includes('copy.errors.userNotFound') && routesAuth.includes('copy.errors.wrongPassword');
if (langs4 && usesCopyKeys)
  ok('S24.07: error copy copy bank orqali (userNotFound/wrongPassword)');
else bad('S24.07: copy bank yoki routes ishlatilishi toliq emas');

// ── S24.08: admin link low-emphasis footer utility ──
if (login.includes('footer-link--admin') && login.includes('/admin/login') &&
    authCss.includes('.footer-link--admin'))
  ok('S24.08: admin link low-emphasis footer utility');
else bad('S24.08: admin footer utility link yoq');

// ── S24.09: theme control accessible, floating circle YO'Q ──
if (!/theme-floating/.test(login) && !/theme-floating/.test(admin) && !/theme-floating/.test(forgot) && !/theme-floating/.test(reset))
  ok('S24.09: floating circle olib tashlandi (user/admin/forgot/reset)');
else bad('S24.09: hali theme-floating mavjud');
if (admin.includes("include('../partials/theme-control')"))
  ok('S24.09: admin theme control accessible menu');
else bad('S24.09: admin theme-control yoq');

// ── S24.10: 100dvh + overflow ──
if (authCss.includes('min-height: 100dvh') && authCss.includes('overflow-y: auto'))
  ok('S24.10: 100dvh + overflow scroll (mobile keyboard)');
else bad('S24.10: 100dvh/overflow yoq');

// ── S24.11: no-JS progressive (native form POST) ──
if (login.includes('method="POST"') && login.includes('name="_csrf"') && !login.includes('onclick='))
  ok('S24.11: no-JS native form (POST + CSRF, onclick yoq)');
else bad('S24.11: no-JS native form emas');

// ── S24.12: admin distinct badge, no neon ──
if (admin.includes('auth-admin-flag') && authCss.includes('.auth-admin-flag'))
  ok('S24.12: admin distinct badge/title');
else bad('S24.12: admin flag yoq');
if (!/linear-gradient\(135deg,\s*var\(--accent\)/.test(admin) && !/text-shadow:\s*0 0/.test(admin))
  ok('S24.12: admin no neon/gradient');
else bad('S24.12: admin hali neon/gradient');

console.log(errors.length ? `\n${errors.length} ta xato` : '\nPASS — STEP 24 barcha talablari bajarildi');
process.exit(errors.length ? 1 : 0);
