#!/usr/bin/env node
/**
 * STYLE STEP 37 — Design lint gate (S37.01–S37.07, S37.11)
 * --------------------------------------------------------
 * Component/context CSS va view'larni lint qiladi:
 *   S37.01  Raw hex/rgb/rgba — components/contexts'da taqiqlangan
 *           (token fallback'lar, --prop ta'riflari va data-theme override'lari allow).
 *   S37.02  transition: all — hard error.
 *   S37.03  Infinite animation — loading/approved allowlistdan tashqari error.
 *   S37.04  Operational font-size < .75rem — error (badge/legal/metadata allowlist).
 *   S37.05  Inline visual style= — static HTML'da color/background/shadow error;
 *           JS template'lar (dynamic) warn + metric.
 *   S37.06  outline:none (kompensatsiyasiz), z-index diapazon, fixed-height text.
 *   S37.07  Deprecated token aliases — warning (migration treki).
 *   S37.11  Metric trend report (raw colors, inline, !important, tiny, motion).
 *
 * Run:  node scripts/design-lint.js            # xulosa
 *       node scripts/design-lint.js --json     # JSON report
 *       node scripts/design-lint.js --gen      # faqat metric/allowlist ko'rsatish
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DESIGN_DIRS = [
  'public/design/components',
  'public/design/contexts',
  'public/design/foundations',
];
const CSS_EXTRA = ['public/css']; // legacy — faqat metric
const VIEWS_DIR = 'views';
const JS_DIRS = ['public/js'];

const ALLOW_INFINITE_ANIMS = new Set([
  'btn-spin', 'deborah-spin', 'cast-spin', 'dir-spin', 'spin', // loading spinner
  'deborah-skeleton-shimmer', // skeleton (loading)
  'deborah-progress-glow', // aria-busy progress
  'switch-pulse', // toggle affordance (approved)
  'tb-pulse', // save-state indicator (approved)
  'sr-pulse', 'rm-flicker', // brand live indicators (approved milestone)
  'offline-blink', // offline reconnect indicator (approved)
]);

// S37.04 — document qilingan tiny-text istisnolari (badge/legal/metadata/decorative-demo)
const TINY_SELECTOR_ALLOW = [
  /\.badge\b/,
  /\.auth-/,
  /\.lang-/,
  /\.caps-/,
  /\.err-text/,
  /\.hint\b/,
  /\.tb-outline-item|\.tb-step-num|\.tb-hint/, // test-builder meta labels
  /\.trust\b|\.oidc-|\.strength-/, // auth meta/hints
  /\.ld-crop-pill/,
  /dt-density/, // density toggle (documented)
  /\.tbl-th|\.table-th/, // table header metadata
];

// S37.01 — o'z palitrasiga ega tematik manbalar (documented exceptions):
//   projector.css  — mustaqil proyeksiya ekrani, lokal --proj-* token namespace + own theme/contrast overrides
//   theme.css      — theme source fayli (forced-colors/print overrides ham shu yerda)
const RAW_COLOR_SOURCE_FILES = [
  'public/design/contexts/projector.css',
  'public/design/foundations/theme.css',
];
// Functional tint overlays (alpha < .5) — selection/scrollbar/focus glow
const TINT_SELECTOR_ALLOW = /selection|scrollbar|focus/;

// S37.06 — outline:none faqat kompensatsiya (focus-visible/box-shadow/border-color) bilan
const INLINE_ALLOWED_PROPS = new Set([
  'display', 'position', 'inset', 'top', 'right', 'bottom', 'left',
  'transform', 'translate', 'width', 'height', 'max-width', 'min-width',
  'max-height', 'min-height', 'opacity', 'z-index', 'flex', 'gap',
  'align-items', 'justify-content', 'align-self', 'cursor', 'overflow',
  'object-fit', 'accent-color', 'vertical-align', 'white-space', 'resize',
  'float', 'pointer-events', 'aspect-ratio', 'grid', 'grid-template-columns',
]);
const INLINE_WARN_PROPS = new Set([
  'margin', 'padding', 'font-size', 'font-weight', 'border-radius',
  'letter-spacing', 'line-height', 'transition', 'animation', 'text-align',
  'border-width', 'border-style',
]);
const INLINE_ERROR_PROPS = ['color', 'background', 'box-shadow', 'text-shadow', 'font-family'];

const metrics = {
  rawColors: 0,
  transitionAll: 0,
  infiniteMotion: 0,
  tinyText: 0,
  inlineStaticError: 0,
  inlineAllowlisted: 0,
  inlineWarn: 0,
  important: 0,
  deprecatedAliases: 0,
  zIndexRaw: 0,
  zIndexOutOfRange: 0,
  outlineNone: 0,
  fixedHeightText: 0,
};
const errors = [];
const warnings = [];

// S37.05 — legacy inline visual style allowlist (migration deadlini bilan):
//   { "inlineStyle": ["file::styleBody", ...], "deadline": "2027-01-01" }
const ALLOWLIST_FILE = 'design-lint.allowlist.json';
let allowlist = { inlineStyle: [] };
try {
  allowlist = JSON.parse(readFileSync(path.join(ROOT, ALLOWLIST_FILE), 'utf8'));
} catch (_) { /* allowlist yo'q — yangi tizim */ }
const allowlistSet = new Set(allowlist.inlineStyle || []);
const generatedStatic = []; // --gen-allowlist uchun (file::styleBody)

function collectCssFiles(dirs) {
  const out = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (f.endsWith('.css')) out.push({ path: path.join(d, f), legacy: d === 'public/css' });
    }
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

// ── S37.01 raw colors ──────────────────────────────────────────────
function lintRawColors(file, src) {
  const css = stripComments(src);
  // S37.01 documented exceptions: tematik manba fayllar o'z palitrasini belgilaydi
  if (RAW_COLOR_SOURCE_FILES.includes(file)) {
    const m = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([0-9.]+,[^)]*\)/g);
    if (m) metrics.rawColors += m.length; // metric'da ko'rinadi, gate bloklamaydi
    return;
  }
  // data-theme / data-contrast override bloklarini maskalash (theme palitrasi = token source)
  const masked = css.replace(/\[data-(theme|contrast)[^\]]*\][^{]*\{[^{}]*\}/g, ' TOKENBLOCK ');
  // var(--x, #fallback) fallback'larni maskalash
  const noFallback = masked.replace(/var\(--[a-z0-9-]+,[^)]*\)/g, ' varFALLBACK ');
  // --prop: <color> ta'riflarini maskalash
  const noProps = noFallback.replace(/--[a-z0-9-]+\s*:\s*[^;{}]+;/g, ' PROPDEF ');
  // box-shadow/text-shadow ichidagi ranglarni ajratish (S37.06 shadow metrikasi)
  const noShadows = noProps.replace(/(box-shadow|text-shadow)\s*:[^;}]+;/g, ' SHADOW ');
  // ::selection / ::-webkit-scrollbar / :focus-visible rgba tint'lari (functional overlay)
  const noTints = noShadows.replace(
    new RegExp('(?:' + TINT_SELECTOR_ALLOW.source + ')[^{]*\\{[^}]*rgba?\\([0-9.]+\\s*,\\s*[0-9.]+\\s*,\\s*[0-9.]+\\s*,\\s*0\\.?[0-4][0-9]?[^}]*\\}', 'g'),
    ' TINT ',
  );
  const hexRe = /#[0-9a-fA-F]{3,8}\b|rgba?\([0-9.]+,[^)]*\)|hsla?\([0-9.]+,[^)]*\)/g;
  let m;
  const hits = [];
  while ((m = hexRe.exec(noTints))) hits.push(m[0]);
  if (hits.length) {
    metrics.rawColors += hits.length;
    errors.push(`S37.01 ${file}: ${hits.length} ta raw color (${hits.slice(0, 4).join(', ')}) — token ishlating`);
  }
}

// ── S37.02 transition: all ─────────────────────────────────────────
function lintTransitionAll(file, src) {
  const css = stripComments(src);
  const re = /transition(-[a-z]+)?\s*:\s*all\b/g;
  let m;
  const hits = [];
  while ((m = re.exec(css))) hits.push(m[0]);
  if (hits.length) {
    metrics.transitionAll += hits.length;
    errors.push(`S37.02 ${file}: transition: all taqiqlangan (${hits.length} ta)`);
  }
}

// ── S37.03 infinite animation ──────────────────────────────────────
function lintInfiniteAnim(file, src) {
  const css = stripComments(src);
  const re = /animation:\s*([a-z0-9-]+)[^;{]*infinite|animation-iteration-count\s*:\s*infinite/g;
  let m;
  const hits = [];
  while ((m = re.exec(css))) {
    const name = m[1] || (css.slice(Math.max(0, m.index - 200), m.index).match(/animation-name\s*:\s*([a-z0-9-]+)/) || [])[1] || '';
    if (name && ALLOW_INFINITE_ANIMS.has(name)) continue;
    hits.push(m[0]);
  }
  // animation-name + iteration-count juftligi
  const byName = /animation-name\s*:\s*([a-z0-9-]+);[^}]*animation-iteration-count\s*:\s*infinite/g;
  while ((m = byName.exec(css))) {
    if (!ALLOW_INFINITE_ANIMS.has(m[1])) hits.push(`animation-name: ${m[1]} infinite`);
  }
  if (hits.length) {
    metrics.infiniteMotion += hits.length;
    errors.push(`S37.03 ${file}: ruxsat etilmagan infinite animation (${hits.join('; ')})`);
  }
}

// ── S37.04 tiny font-size ──────────────────────────────────────────
function lintTinyText(file, src) {
  const css = stripComments(src);
  const re = /font-size\s*:\s*(0\.[0-7][0-9]?rem|0?\.?[0-9]+px)\b/g;
  let m;
  const hits = [];
  while ((m = re.exec(css))) {
    const val = m[1];
    let px = null;
    if (val.endsWith('rem')) px = parseFloat(val) * 16;
    else px = parseFloat(val);
    if (px >= 12) continue; // .75rem
    // selector konteksti — oxirgi { dan keyingi matn
    const selStart = css.lastIndexOf('}', m.index) + 1;
    const selector = css.slice(selStart, css.lastIndexOf('{', m.index));
    const allowed = TINY_SELECTOR_ALLOW.some((reSel) => reSel.test(selector));
    if (allowed) continue;
    hits.push(`${val} [${selector.trim().slice(0, 60)}]`);
  }
  if (hits.length) {
    metrics.tinyText += hits.length;
    errors.push(`S37.04 ${file}: ${hits.length} ta < 0.75rem (${hits.slice(0, 3).join('; ')})`);
  }
}

// ── S37.05 inline style ────────────────────────────────────────────
function htmlRegions(src) {
  // EJS tag'lari va <script> bloklarini olib tashlab, faqat statik HTML qoldiradi
  return src
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<%[\s\S]*?%>/g, ' ');
}

function styleProps(body) {
  const props = [];
  for (const part of body.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const idx = p.indexOf(':');
    if (idx < 0) continue;
    props.push({ name: p.slice(0, idx).trim().toLowerCase(), value: p.slice(idx + 1).trim() });
  }
  return props;
}

/** S37.05 — inline style body'ni klassifikatsiya qiladi (test/allowlist uchun). */
export function classifyStyleBody(body) {
  if (/--[a-z0-9-]+\s*:/.test(body)) return { customProp: true, err: [], warn: [] };
  const props = styleProps(body);
  return {
    customProp: false,
    err: props.filter((p) => INLINE_ERROR_PROPS.includes(p.name)).map((p) => p.name),
    warn: props.filter((p) => INLINE_WARN_PROPS.has(p.name) || !INLINE_ALLOWED_PROPS.has(p.name)).map((p) => p.name),
  };
}

export { INLINE_ALLOWED_PROPS, INLINE_WARN_PROPS, INLINE_ERROR_PROPS, ALLOW_INFINITE_ANIMS, TINY_SELECTOR_ALLOW, DEPRECATED_ALIASES };

function lintInlineStyles(src, file, isHtml) {
  // Ikkala quote turi — aks holda style='...' bypass bo'ladi
  const re = /style\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[2] !== undefined ? m[2] : m[3];
    if (/--[a-z0-9-]+\s*:/.test(body)) continue; // data-driven custom property
    const props = styleProps(body);
    const errProps = props.filter((p) => INLINE_ERROR_PROPS.includes(p.name));
    const warnProps = props.filter((p) => INLINE_WARN_PROPS.has(p.name) || !INLINE_ALLOWED_PROPS.has(p.name));
    if (isHtml && errProps.length) {
      const key = `${file}::${body}`;
      if (allowlistSet.has(key)) {
        metrics.inlineAllowlisted++;
        continue; // legacy debt — allowlist'da, yangilari bloklanadi
      }
      metrics.inlineStaticError++;
      generatedStatic.push(key);
      errors.push(`S37.05 ${file}: statik HTML inline visual style (${errProps.map((p) => p.name).join(',')})`);
      continue;
    }
    if (warnProps.length) {
      metrics.inlineWarn++;
      warnings.push(`S37.05 ${file}: inline style warn (${warnProps.slice(0, 4).map((p) => p.name).join(',')}) — migratsiya`);
    }
  }
}

// ── S37.06 outline / z-index / fixed-height text ───────────────────
function lintOutline(file, src) {
  const css = stripComments(src);
  // :focus-visible compensatsiya fayl darajasida bo'lsa ham qabul qilinadi (focus.css pattern)
  const fileHasFocusVisible = /:focus-visible/.test(css);
  const re = /([^{}]*)\{\s*([^}]*outline\s*:\s*(?:none|0)\b[^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1];
    const block = m[2];
    const compensated = fileHasFocusVisible || /:focus-visible|box-shadow|border-color|outline-offset/.test(block);
    if (!compensated) {
      metrics.outlineNone++;
      errors.push(`S37.06 ${file}: outline:none kompensatsiyasiz (${selector.trim().slice(0, 60)})`);
    }
  }
}

function lintZIndex(file, src) {
  const css = stripComments(src);
  const re = /z-index\s*:\s*(-?[0-9]+)/g;
  let m;
  while ((m = re.exec(css))) {
    const v = parseInt(m[1], 10);
    if (v > 1000 || v < 0) {
      metrics.zIndexOutOfRange++;
      errors.push(`S37.06 ${file}: z-index ${v} diapazondan tashqari (0..1000)`);
    } else {
      metrics.zIndexRaw++;
    }
  }
}

function lintFixedHeightText(file, src) {
  const css = stripComments(src);
  const re = /([^{}]*text[^{}]*)\{\s*([^}]*height\s*:\s*[0-9.]+px[^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const block = m[2];
    if (/\b(line-clamp|min-height|max-height)\b/.test(block)) continue;
    if (/\b(font-size|line-height)\b/.test(block) && /overflow/.test(block)) {
      metrics.fixedHeightText++;
      warnings.push(`S37.06 ${file}: fixed-height text container (${m[1].trim().slice(0, 50)})`);
    }
  }
}

// ── S37.07 deprecated aliases + !important metric ──────────────────
const DEPRECATED_ALIASES = /\bvar\(--(muted|surf|surface|bg|text|card|border|accent|green|blue|gold|purple|radius|cyan|white|black)[ ,)]/g;

function countAliases(src) {
  const m = src.match(DEPRECATED_ALIASES);
  return m ? m.length : 0;
}
function countImportant(src) {
  const m = src.match(/!important\b/g);
  return m ? m.length : 0;
}

// ── Main ───────────────────────────────────────────────────────────
function main() {
  const jsonOnly = process.argv.includes('--json');

  // CSS lint (S37.01-04, 06)
  const cssFiles = [
    ...collectCssFiles(DESIGN_DIRS),
    ...collectCssFiles(CSS_EXTRA).map((f) => ({ ...f, legacy: true })),
  ];
  for (const f of cssFiles) {
    const src = readFileSync(path.join(ROOT, f.path), 'utf8');
    if (f.legacy) {
      metrics.important += countImportant(src);
      metrics.deprecatedAliases += countAliases(src);
      continue; // legacy public/css — faqat metric
    }
    metrics.important += countImportant(src);
    metrics.deprecatedAliases += countAliases(src);
    lintRawColors(f.path, src);
    lintTransitionAll(f.path, src);
    lintInfiniteAnim(f.path, src);
    lintTinyText(f.path, src);
    lintOutline(f.path, src);
    lintZIndex(f.path, src);
    lintFixedHeightText(f.path, src);
  }

  // Inline style (S37.05)
  const viewFiles = [];
  (function walk(dir) {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (f.endsWith('.ejs')) viewFiles.push(p);
    }
  })(path.join(ROOT, VIEWS_DIR));
  const jsFiles = [];
  for (const d of JS_DIRS) {
    (function walkJs(dir) {
      if (!existsSync(dir)) return;
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        const st = statSync(p);
        if (st.isDirectory()) walkJs(p);
        else if (f.endsWith('.js')) jsFiles.push(p);
      }
    })(path.join(ROOT, d));
  }
  for (const p of viewFiles) {
    const rel = path.relative(ROOT, p);
    const src = readFileSync(p, 'utf8');
    lintInlineStyles(htmlRegions(src), rel, true); // statik HTML — error darajasi
    lintInlineStyles(src, rel, false); // script ichidagi — warn darajasi
  }
  for (const p of jsFiles) {
    const rel = path.relative(ROOT, p);
    lintInlineStyles(readFileSync(p, 'utf8'), rel, false);
  }

  if (process.argv.includes('--gen-allowlist')) {
    // barcha statik HTML inline visual style'lar allowlist'ga yig'iladi (legacy freeze)
    const out = {
      _comment: 'S37.05 legacy inline visual style debt — migratsiya deadline: 2027-01-01. Yangi inline visual style qo\'shish taqiqlangan (gate bloklaydi).',
      deadline: '2027-01-01',
      inlineStyle: [...new Set(generatedStatic)].sort(),
    };
    writeFileSync(path.join(ROOT, ALLOWLIST_FILE), JSON.stringify(out, null, 2) + '\n');
    console.log(`allowlist yozildi: ${ALLOWLIST_FILE} (${out.inlineStyle.length} entry)`);
    return;
  }
  if (jsonOnly) {
    process.stdout.write(JSON.stringify({ metrics, errors, warnings: warnings.slice(0, 30) }, null, 2) + '\n');
  } else {
    console.log('── STEP 37 design lint ─────────────────────────────');
    console.log(`  raw colors (S37.01):    ${metrics.rawColors}`);
    console.log(`  transition: all (S37.02): ${metrics.transitionAll}`);
    console.log(`  infinite motion (S37.03): ${metrics.infiniteMotion}`);
    console.log(`  tiny text (S37.04):     ${metrics.tinyText}`);
    console.log(`  inline static (S37.05): ${metrics.inlineStaticError}  (allowlist: ${metrics.inlineAllowlisted}, warn: ${metrics.inlineWarn})`);
    console.log(`  outline:none (S37.06):  ${metrics.outlineNone}`);
    console.log(`  z-index raw: ${metrics.zIndexRaw}  out-of-range: ${metrics.zIndexOutOfRange}`);
    console.log(`  fixed-height text:      ${metrics.fixedHeightText}`);
    console.log(`  deprecated aliases:     ${metrics.deprecatedAliases}`);
    console.log(`  !important:             ${metrics.important}`);
    console.log('────────────────────────────────────────────────────');
    for (const e of errors) console.log('  ✗ ' + e);
    if (warnings.length) console.log(`  ⚠ ${warnings.length} ta warn (migratsiya treki)`);
    if (errors.length) {
      console.log(`\n${errors.length} ta hard error`);
      process.exit(1);
    }
    console.log('\nPASS — design lint');
  }
}

main();
