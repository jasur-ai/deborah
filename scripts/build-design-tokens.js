#!/usr/bin/env node
/**
 * Edikit — Design Token Build (STYLE STEP 04 / S04.07-09)
 * ----------------------------------------------------------
 * DTCG token fayllarini o'qiydi, alias'larni resolve qiladi va:
 *   1. public/design/generated/tokens.css          — deterministic CSS custom props
 *   2. public/design/generated/tokens.flat.json     — flat map (JS/CI uchun)
 *   3. design-audit/contrast-fixture.json           — contrast-test fixture
 *
 * Generated fayl banner comment bilan belgilanadi — qo'lda tahrir
 * qilinmasligi shart (S04.07). Validator avval ishlaydi (S04.06).
 *
 * Ishga tushirish: node scripts/build-design-tokens.js
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateTokens } from './validate-design-tokens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOKENS_DIR = resolve(ROOT, 'public/design/tokens');
const GENERATED_DIR = resolve(ROOT, 'public/design/generated');
const AUDIT_DIR = resolve(ROOT, 'design-audit');

// ── 1. Validator (S04.05-06) ──
const validation = validateTokens(TOKENS_DIR);
if (!validation.ok) {
  console.error(`❌ Token validatsiya o'tmadi — build to'xtatildi (${validation.errors.length} xato):`);
  for (const e of validation.errors) console.error(`   - ${e}`);
  process.exit(1);
}

// ── 2. Load (deterministic sort — S04.07) ──
const tokenFiles = readdirSync(TOKENS_DIR).filter((f) => f.endsWith('.json')).sort();
const byFile = {};
for (const file of tokenFiles) {
  byFile[file] = JSON.parse(readFileSync(resolve(TOKENS_DIR, file), 'utf-8'));
}

// ── 3. Flatten ──
function flattenInto(node, prefix, out) {
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const path = [...prefix, key];
    if (val && typeof val === 'object' && '$value' in val) {
      out[path.join('.')] = { $type: val.$type, $value: val.$value, $description: val.$description, $oklch: val.$oklch };
    } else if (val && typeof val === 'object') {
      flattenInto(val, path, out);
    }
  }
}

const all = {}; // path → { $type, $value, $description }
for (const file of tokenFiles) {
  flattenInto(byFile[file], [], all);
}

// ── 4. Alias resolve ──
function resolveValue(value, seen = new Set()) {
  if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) return value;
  const ref = value.slice(1, -1);
  if (seen.has(ref)) throw new Error(`Alias cycle: ${ref}`);
  seen.add(ref);
  const target = all[ref];
  if (!target) throw new Error(`Unresolved alias: ${ref}`);
  if (typeof target.$value === 'string' && target.$value.startsWith('{')) {
    return resolveValue(target.$value, seen);
  }
  return target.$value;
}

const resolved = {};
for (const [path, tok] of Object.entries(all)) {
  resolved[path] = { ...tok, $value: resolveValue(tok.$value) };
}

// OKLCH master map: resolved sRGB hex → oklch (S06.02)
// Primitive'lardagi $oklch qiymatlaridan quriladi; semantic alias'lar
// primitive hex'ga resolve bo'lgani uchun ham ular oklch oladi.
const oklchByHex = {};
for (const [path, tok] of Object.entries(resolved)) {
  if (tok.$oklch && typeof tok.$value === 'string' && tok.$value.startsWith('#')) {
    oklchByHex[tok.$value.toLowerCase()] = tok.$oklch;
  }
}

// ── 5. CSS nomlash ──
// edikit.primitive.cobalt.cobalt-500 → --edikit-primitive-cobalt-cobalt-500
// edikit.semantic.color.action.primary → --edikit-semantic-color-action-primary
function cssVarName(path) {
  return '--' + path.split('.').join('-').replace(/([A-Z0-9]+)/g, '-$1').toLowerCase().replace(/--+/g, '-');
}

function cssValue(v) {
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0] !== null) {
      // shadow: [{x,y,blur,spread,color}] → css box-shadow string
      return v.map((s) => `${s.x} ${s.y} ${s.blur} ${s.spread} ${s.color}`).join(', ');
    }
    // cubicBezier / fontFamily: number|string array → join
    return v.join(', ');
  }
  return v;
}

// ── 6. CSS bloklari ──
const THEME_SELECTORS = {
  'semantic.light.json': '[data-theme="light"], body.theme-light',
  'semantic.dark.json': '[data-theme="dark"]',
  'semantic.high-contrast.json': '[data-theme="high-contrast"]',
};
// Default (dark) qatlam — primitive + typography + layout + semantic.dark
const DEFAULT_THEME = 'semantic.dark.json';

const lines = [
  '/* ═══════════════════════════════════════════════════════════════',
  '   ⚠️ GENERATED FILE — DO NOT EDIT BY HAND (S04.07)',
  '   Source: public/design/tokens/*.json',
  '   Regenerate: npm run design:tokens:build',
  '   ═══════════════════════════════════════════════════════════════ */',
  '',
];

function varBlock(selector, vars) {
  const sorted = Object.keys(vars).sort();
  const body = sorted.map((k) => `  ${k}: ${cssValue(vars[k])};`);
  return [`${selector} {`, ...body, '}', ''];
}

// OKLCH override bloki — brand sRGB qiymatlarini oklch() ga almashtiradi (S06.02).
// Selector'ni saqlaydi (cascade to'g'ri ishlashi uchun) va sRGB fallback
// qatoridan so'ng darhol chiqadi — brauzer oklch() ni bilmasa sRGB turadi.
function oklchOverrideBlock(selector, vars) {
  const overrides = {};
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value === 'string' && value.startsWith('#') && oklchByHex[value.toLowerCase()]) {
      overrides[name] = oklchByHex[value.toLowerCase()];
    }
  }
  if (!Object.keys(overrides).length) return [];
  const sorted = Object.keys(overrides).sort();
  return [
    `@supports (color: oklch(0% 0 0)) {`,
    `${selector} {`,
    ...sorted.map((k) => `  ${k}: ${overrides[k]};`),
    '}',
    '}',
    '',
  ];
}

// a) :root — primitive + typography + layout + default semantic (dark)
// Diqqat: `all` map'da oxirgi fayl (semantic.light.json) semantic path'larini
// override qiladi (S11 bug fix) — default semantic qiymatlar DEFAULT_THEME
// faylidan to'g'ridan-to'g'ri olinadi.
const rootVars = {};
for (const [path, tok] of Object.entries(resolved)) {
  if (path.startsWith('edikit.semantic')) continue; // dark bloki quyida
  rootVars[cssVarName(path)] = tok.$value;
}
if (byFile[DEFAULT_THEME]?.edikit?.semantic) {
  const defaultSemantic = {};
  flattenInto(byFile[DEFAULT_THEME].edikit.semantic, ['edikit', 'semantic'], defaultSemantic);
  for (const [path, tok] of Object.entries(defaultSemantic)) {
    rootVars[cssVarName(path)] = resolveValue(tok.$value);
  }
}
lines.push(...varBlock(':root', rootVars));
lines.push(...oklchOverrideBlock(':root', rootVars));

// b) Theme bloklari — semantic (light/high-contrast)
for (const file of tokenFiles.sort()) {
  const selector = THEME_SELECTORS[file];
  if (!selector || file === DEFAULT_THEME) continue;
  const themeVars = {};
  const semantic = byFile[file]?.edikit?.semantic;
  if (!semantic) continue;
  const t = {};
  flattenInto(semantic, ['edikit', 'semantic'], t);
  for (const [path, tok] of Object.entries(t)) {
    themeVars[cssVarName(path)] = resolveValue(tok.$value);
  }
  lines.push(...varBlock(selector, themeVars));
  lines.push(...oklchOverrideBlock(selector, themeVars));
}

// c) Legacy backward alias'lar (S04.08)
lines.push('/* ── Backward-compatible legacy aliases (S04.08) ──');
lines.push('/* ⚠️ DEPRECATED — yangi code semantic token ishlatishi kerak:  */');
lines.push('/*    color.action.primary, color.surface.default, ...          */');
lines.push(':root {');
lines.push('  --accent: var(--edikit-semantic-color-action-primary);');
lines.push('  --bg: var(--edikit-semantic-color-surface-default);');
lines.push('  --card: var(--edikit-semantic-color-surface-raised);');
lines.push('  --text: var(--edikit-semantic-color-text-primary);');
lines.push('  --muted: var(--edikit-semantic-color-text-muted);');
lines.push('}');
lines.push('');


mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(resolve(GENERATED_DIR, 'tokens.css'), lines.join('\n'), 'utf-8');

// ── 7. Flat map (S04.09) ──
const flat = {};
for (const [path, tok] of Object.entries(resolved)) {
  flat[path] = tok.$value;
}
writeFileSync(resolve(GENERATED_DIR, 'tokens.flat.json'), JSON.stringify(flat, null, 2), 'utf-8');

// ── 8. Contrast fixture (S04.09) ──
const contrastPairs = [];
for (const themeFile of ['semantic.light.json', 'semantic.dark.json', 'semantic.high-contrast.json']) {
  const semantic = byFile[themeFile]?.edikit?.semantic;
  if (!semantic) continue;
  const t = {};
  flattenInto(semantic, ['edikit', 'semantic'], t);
  const g = (p) => resolveValue(t[p]?.$value);
  contrastPairs.push({
    theme: themeFile.replace('semantic.', '').replace('.json', ''),
    pairs: [
      { fg: g('edikit.semantic.color.text.primary'), bg: g('edikit.semantic.color.surface.default'), target: 4.5, note: 'text.primary on surface' },
      { fg: g('edikit.semantic.color.text.muted'), bg: g('edikit.semantic.color.surface.raised'), target: 4.5, note: 'text.muted on raised' },
      { fg: g('edikit.semantic.color.action.primary'), bg: g('edikit.semantic.color.surface.raised'), target: 3.0, note: 'action.primary on raised (UI)' },
    ],
  });
}
const contrastFixture = {
  generated: new Date().toISOString(),
  source: 'public/design/tokens',
  pairs: contrastPairs,
};
mkdirSync(AUDIT_DIR, { recursive: true });
writeFileSync(resolve(AUDIT_DIR, 'contrast-fixture.json'), JSON.stringify(contrastFixture, null, 2), 'utf-8');

// ── 9. Natija ──
const tokenCount = Object.keys(all).length;
const generatedCss = resolve(GENERATED_DIR, 'tokens.css');
let cssBytes = 0;
try { cssBytes = statSync(generatedCss).size; } catch { /* ignore */ }
console.log(`✅ Design tokens build:
   - ${tokenCount} token (source)
   - ${Object.keys(resolved).length} resolved
   - ${tokenFiles.length} fayl (${tokenFiles.join(', ')})
   - public/design/generated/tokens.css (${cssBytes} B)
   - public/design/generated/tokens.flat.json
   - design-audit/contrast-fixture.json`);
