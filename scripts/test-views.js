#!/usr/bin/env node
/**
 * Edikit — All-View EJS Compile Gate (STEP 02 / S02.03–S02.05, S02.10)
 * ---------------------------------------------------------------------
 * Har bir `views/` ichidagi .ejs faylni `ejs.compile()` orqali compile qiladi.
 * Syntax xato topilsa fayl + qator + xabarni chiqarib exit 1 qaytaradi.
 *
 * - Include'lar `filename` orqali resolve bo'ladi (S02.04).
 * - Dynamic local talab qiladigan viewlar fixture registry'dan qo'shimcha
 *   fixture oladi (S02.05). Compile faqat syntax'ni tekshiradi — render emas,
 *   shuning uchun `undefined` local'lar compile'ni buzmaydi (faqat render).
 *
 * Ishga tushirish: node scripts/test-views.js   (yoki npm run test:views)
 * Exit: 0 = hammasi compile bo'ldi; 1 = xato bor.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VIEWS = join(ROOT, 'views');

// ── Fixture registry (S02.05) — compile uchun zarur bo'lgan local'lar ──
// ejs.compile() faqat syntax tekshiradi, shuning uchun ko'p local'lar shart
// emas. Lekin `<%- include(...) %>` va ba'zi guard'lar uchun minimal to'plam.
const FIXTURE_ICON = () => '';
const BASE_FIXTURES = {
  icon: FIXTURE_ICON,
  icons: {},
  lang: 'uz',
  copy: {},
  user: null,
  admin: null,
  csrfToken: 'test-csrf',
  title: 'Test',
  siteUrl: '',
  path: '/',
};

// View nomi → qo'shimcha fixture (dynamic local talab qiladiganlar)
const VIEW_FIXTURES = {
  'index.ejs': { LANDING_COPY: {}, LANDING_LANGS: ['uz'], lang: 'uz' },
  'user/login.ejs': {
    AUTH_LANGS: ['uz', 'uz-cyrl', 'ru', 'en'],
    copy: { login: {}, register: {}, errors: {}, footer: {}, forgot: {} },
    mode: 'login',
    oidcEnabled: false,
  },
  'user/forgot.ejs': { AUTH_LANGS: ['uz', 'uz-cyrl', 'ru', 'en'], copy: { forgot: {}, errors: {}, footer: {} } },
  'user/reset.ejs': { AUTH_LANGS: ['uz', 'uz-cyrl', 'ru', 'en'], copy: { reset: {}, login: {}, register: {}, errors: {}, footer: {} }, state: 'valid' },
  'admin/login.ejs': { error: null },
  'error.ejs': { status: 404, message: 'test' },
};

function collectEjs(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) collectEjs(full, acc);
    else if (e.endsWith('.ejs')) acc.push(full);
  }
  return acc;
}

function compileOne(file) {
  const rel = file.replace(ROOT + '/', '');
  const src = readFileSync(file, 'utf-8');
  // Include'lar filename orqali resolve bo'ladi (S02.04)
  const opts = {
    filename: file,
    locals: { ...BASE_FIXTURES, ...(VIEW_FIXTURES[rel] || {}) },
  };
  try {
    ejs.compile(src, opts);
    return { ok: true, rel };
  } catch (err) {
    // Qator raqamini xabardan ajratib olamiz
    const lineMatch = err.message.match(/line\s+(\d+)/i);
    return {
      ok: false,
      rel,
      line: lineMatch ? lineMatch[1] : '?',
      msg: err.message.split('\n')[0].slice(0, 160),
    };
  }
}

const files = collectEjs(VIEWS);
const results = files.map(compileOne);
const failed = results.filter((r) => !r.ok);

console.log(`\nEJS compile gate: ${files.length} view tekshirildi`);
if (failed.length) {
  console.log(`\n❌ ${failed.length} view compile bo'lmadi:\n`);
  for (const f of failed) {
    console.log(`  ✗ ${f.rel}:${f.line} — ${f.msg}`);
  }
  process.exit(1);
}
console.log(`✅ Barcha ${files.length} view compile bo'ldi`);
process.exit(0);
