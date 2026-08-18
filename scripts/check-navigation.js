#!/usr/bin/env node
/**
 * STEP 17 validator — App shell, navigation va responsive wayfinding.
 * Checks S17.01–S17.12 against source files.
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

const navCss = read('public/design/components/navigation.css');
const navJs = read('public/js/components/navigation.js');
const sidebar = read('views/partials/sidebar.ejs');
const navEjs = read('views/partials/nav.ejs');
const headEjs = read('views/partials/head.ejs');
const styleCss = read('public/css/style.css');

console.log('STEP 17 — Navigation validator');
console.log('── Role-based IA (S17.01/03) ──');
check('sidebar.ejs role-aware (teacher branch)', sidebar.includes("_role === 'teacher'"));
check('sidebar.ejs role-aware (admin branch)', sidebar.includes("_role === 'admin'"));
check('sidebar.ejs role-aware (student branch)', sidebar.includes("_role === 'student'"));
check('sidebar.ejs role-aware (proctor branch)', sidebar.includes("_role === 'proctor'"));
check('sidebar.ejs role-aware (marker branch)', sidebar.includes("_role === 'marker'"));
check('sidebar.ejs role-aware (board branch)', sidebar.includes("_role === 'board'"));

console.log('── Public nav IA (S17.02) ──');
check('nav.ejs Product link', /nav-link[^>]*>.*Product/i.test(navEjs));
check('nav.ejs Teachers link', /nav-link[^>]*>.*Teachers/i.test(navEjs));
check('nav.ejs Cast link', /nav-link[^>]*>.*Cast/i.test(navEjs));
check('nav.ejs Ready tests link', /nav-link[^>]*>.*Ready tests/i.test(navEjs));
check('nav.ejs Resources link', /nav-link[^>]*>.*Resources/i.test(navEjs));
check('nav.ejs Login + CTA (login branch)', navEjs.includes('/user/login'));
check('nav.ejs CTA primary', navEjs.includes('nav-btn--primary'));
check('nav.ejs hech qanday /admin/ href yoq', !/\/admin\//.test(navEjs));

console.log('── Teacher nav: Characters/VIP emas (S17.04) ──');
const teacherSection = sidebar.split("_role === 'teacher'")[1] || '';
check('teacher sidebar Character/VIP yoq', !/Character|VIP/i.test(teacherSection));

console.log('── Active state (S17.05) ──');
check('active soft fill + text weight (CSS)', /\.shell-nav-link\.active\s*\{[\s\S]*?font-weight:\s*700/.test(navCss));
check('active indicator (box-shadow inset)', /\.shell-nav-link\.active\s*\{[\s\S]*?box-shadow:\s*inset/.test(navCss));
check('hover != active (hover font-weight 600)', /\.shell-nav-link:hover\s*\{[\s\S]*?font-weight:\s*600/.test(navCss));

console.log('── Mobile replacement (S17.06) ──');
check('mobile drawer media query', /@media \(max-width:\s*768px\)[\s\S]*?\.nav-links/.test(navCss));
check('drawer translateX transition', /transform:\s*translateX\(100%\)/.test(navCss));
check('shell drawer (style.css)', /body\.shell-open \.shell-sidebar\s*\{ transform:\s*translateX\(0\)/.test(styleCss));

console.log('── Drawer a11y (S17.07) ──');
check('navigation.js focus trap', /focusables/.test(navJs) && /e\.key !== 'Tab'/.test(navJs));
check('navigation.js Escape close', /e\.key === 'Escape'/.test(navJs));
check('navigation.js overlay close', /data-shell-close/.test(navJs));
check('navigation.js trigger focus restore', /prevFocus/.test(navJs));
// No duplicated inline drawer JS in role views:
const roleViews = ['student', 'teacher', 'proctor', 'marker', 'board'];
let dupInline = false;
for (const r of roleViews) {
  const v = read(`views/role/${r}.ejs`);
  if (v.includes('data-shell-open') && /var b=document\.querySelector\('\[data-shell-open\]'\)/.test(v)) dupInline = true;
}
check('role views inline drawer JS yoq (5 fayl)', !dupInline);

console.log('── Sticky header tokens (S17.08) ──');
check('scroll-margin-top token', /scroll-margin-top:\s*calc/.test(navCss));
check('safe-area env()', /env\(safe-area-inset/.test(navCss));

console.log('── Breadcrumb (S17.09) ──');
const crumb = read('views/partials/breadcrumb.ejs');
check('breadcrumb partial exists', crumb.length > 0);
check('breadcrumb aria-label', crumb.includes('aria-label'));
check('breadcrumb aria-current', crumb.includes('aria-current'));
check('breadcrumb CSS', /\.crumb/.test(navCss));

console.log('── Keyboard tab order + skip link (S17.10) ──');
check('skip-link exists (style.css)', /\.skip-link/.test(styleCss));
check('sidebar skip-link href main-content', sidebar.includes('href="#main-content"'));
check('focus-visible outline', /:focus-visible/.test(navCss));

console.log('── Account menu (S17.11) ──');
check('shell account button', sidebar.includes('shell-account-btn'));
check('shell account aria-expanded', sidebar.includes('aria-expanded="false"'));
check('account menu logout grouped', sidebar.includes('shell-account-menu-item--logout'));
check('account theme control included', sidebar.includes("include('theme-control')") || sidebar.includes('theme-control'));
check('navigation.js account menu init', /initAccountMenu/.test(navJs));

console.log('── head.ejs wiring (S17.12 infra) ──');
check('navigation.css linked', headEjs.includes('navigation.css'));
check('navigation.js linked', headEjs.includes('navigation.js'));

console.log(ok ? '\n✅ Navigation validator: PASS' : '\n❌ Navigation validator: FAIL');
process.exit(ok ? 0 : 1);
