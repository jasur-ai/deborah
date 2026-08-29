#!/usr/bin/env node
/**
 * Deborah — Design Token Validator (STYLE STEP 04 / S04.05-06)
 * ------------------------------------------------------------
 * DTCG token fayllarini tekshiradi:
 *   - Alias cycle (S04.06)
 *   - Unresolved reference (S04.06)
 *   - Duplicate token (S04.06)
 *   - Invalid color-space (S04.06)
 *   - Theme path parity — light/dark/high-contrast bir xil semantic pathlar
 *     (S04.05)
 *   - Primitive'ni component'da to'g'ridan-to'g'ri ishlatish qoidasi (S04.03)
 *     — semantic fayllarda faqat alias yoki raw value; primitive'lar
 *     semantik faylda ishlatilmaydi (S04.03 nazorati: semantic fayl primitive
 *     guruhiga yozmasligi kerak — struktura darajasida)
 *
 * Chiqish: exit 0 = valid, exit 1 = xato (build failure).
 *
 * Ishga tushirish: node scripts/validate-design-tokens.js
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOKENS_DIR = resolve(ROOT, 'public/design/tokens');

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA_RE = /^rgba?\([^)]+\)$/;
const COLOR_SPACES = new Set(['srgb', 'display-p3', 'oklch', 'oklab', 'lab', 'lch', 'hsl', 'hwb', 'rgb', 'rgba', 'color']);

const errors = [];

export function validateTokens(dir = TOKENS_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) {
    errors.push(`Hech qanday token fayli topilmadi: ${dir}`);
    return { ok: errors.length === 0, errors };
  }

  // ── 1. Parse + flatten ──
  const all = {};           // path → { $type, $value }
  const byFile = {};
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'));
    } catch (e) {
      errors.push(`${file}: invalid JSON — ${e.message}`);
      continue;
    }
    byFile[file] = parsed;
    flattenInto(parsed, [], file, all);
  }

  // ── 2. Duplicate token (S04.06) ──
  const seen = new Map();
  for (const [path, tok] of Object.entries(all)) {
    if (seen.has(path)) {
      errors.push(`Duplicate token: ${path} (${seen.get(path)} vs ${tok.file})`);
    }
    seen.set(path, tok.file);
  }

  // ── 3. Alias cycle + unresolved (S04.06) ──
  const stack = [];
  const visited = new Set();
  function resolveCheck(value, path) {
    if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) return;
    const ref = value.slice(1, -1);
    if (stack.includes(ref)) {
      const cycle = [...stack.slice(stack.indexOf(ref)), ref].join(' → ');
      errors.push(`Alias cycle (${path}): ${cycle}`);
      return;
    }
    if (!all[ref]) {
      errors.push(`Unresolved alias (${path}): ${ref}`);
      return;
    }
    stack.push(ref);
    if (!visited.has(ref)) {
      visited.add(ref);
      resolveCheck(all[ref].$value, path);
    }
    stack.pop();
  }
  for (const [path, tok] of Object.entries(all)) {
    resolveCheck(tok.$value, path);
  }

  // ── 4. Invalid color-space (S04.06) ──
  for (const [path, tok] of Object.entries(all)) {
    if (tok.$type !== 'color') continue;
    const v = tok.$value;
    if (typeof v === 'string' && v.startsWith('{')) continue; // alias — tepada tekshirildi
    if (typeof v !== 'string' || v.startsWith('var(')) continue;
    const isHex = HEX_RE.test(v);
    const isRgba = RGBA_RE.test(v);
    const isNamed = /^[a-zA-Z]+$/.test(v); // 'white', 'black', 'transparent'
    const isColorFn = /^[a-z-]+\(/.test(v);
    if (isColorFn && !COLOR_SPACES.has(v.slice(0, v.indexOf('(')))) {
      errors.push(`Invalid color-space (${path}): ${v}`);
    }
    if (!isHex && !isRgba && !isNamed && !isColorFn) {
      errors.push(`Invalid color value (${path}): ${v}`);
    }
  }

  // ── 4b. OKLCH master + sRGB fallback (S06.02) ──
  // Brand primitive ranglar (cobalt/signal/insight/foundation) $oklch
  // master'ga ega bo'lishi shart; $oklch bo'lsa format valid bo'lsin.
  const OKLCH_RE = /^oklch\(\s*[\d.]+%\s+[\d.]+\s+[\d.]+\s*\)$/;
  for (const [path, tok] of Object.entries(all)) {
    if (tok.$type !== 'color') continue;
    const isBrand = /primitive\.(cobalt|signal|insight|foundation|status)\./.test(path) ||
      /primitive\.(canvas|sunken|section-alt|card|nested-surface|control-border|divider)$/.test(path);
    if (isBrand) {
      if (!tok.$oklch) {
        errors.push(`OKLCH master yo'q (${path}): brand rang $oklch talab qiladi (S06.02)`);
      } else if (!OKLCH_RE.test(tok.$oklch)) {
        errors.push(`OKLCH format xato (${path}): ${tok.$oklch} — oklch(L% C H)`);
      }
    }
  }

  // ── 5. Theme path parity (S04.05) ──
  const themeFiles = files.filter((f) => f.startsWith('semantic.'));
  if (themeFiles.length > 1) {
    const themePaths = new Map();
    for (const file of themeFiles) {
      const semantic = findSemantic(byFile[file]);
      if (!semantic) {
        errors.push(`${file}: deborah.semantic guruhi topilmadi`);
        continue;
      }
      const paths = new Set();
      collectLeafPaths(semantic, ['deborah', 'semantic'], paths);
      themePaths.set(file, paths);
    }
    const reference = themeFiles[0];
    const refSet = themePaths.get(reference) || new Set();
    for (const [file, paths] of themePaths) {
      for (const p of refSet) {
        if (!paths.has(p)) {
          errors.push(`Theme parity: ${reference} da '${p}' bor, lekin ${file} da yo'q`);
        }
      }
      for (const p of paths) {
        if (!refSet.has(p)) {
          errors.push(`Theme parity: ${file} da '${p}' bor, lekin ${reference} da yo'q`);
        }
      }
    }
  }

  // ── 6. S04.03: primitive'lar component'da to'g'ridan-to'g'ri — semantic
  //    fayllar faqat deborah.semantic ichida bo'lishi kerak ──
  for (const file of themeFiles) {
    const parsed = byFile[file];
    const keys = Object.keys(parsed.deborah || {});
    if (keys.length !== 1 || keys[0] !== 'semantic') {
      errors.push(`${file}: semantic theme fayl faqat deborah.semantic ichida bo'lishi kerak (S04.03) — topildi: ${keys.join(', ')}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Rekursiv flatten — path → { $type, $value, $description, file } */
function flattenInto(node, prefix, file, out) {
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const path = [...prefix, key];
    if (val && typeof val === 'object' && '$value' in val) {
      out[path.join('.')] = { $type: val.$type, $value: val.$value, $description: val.$description, $oklch: val.$oklch, file };
    } else if (val && typeof val === 'object') {
      flattenInto(val, path, file, out);
    }
  }
}

function findSemantic(node) {
  return node?.deborah?.semantic || null;
}

function collectLeafPaths(node, prefix, out) {
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const path = [...prefix, key];
    if (val && typeof val === 'object' && '$value' in val) {
      out.add(path.join('.'));
    } else if (val && typeof val === 'object') {
      collectLeafPaths(val, path, out);
    }
  }
}

// ── CLI ishga tushganda ──
const isCli = process.argv[1] && process.argv[1].endsWith('validate-design-tokens.js');
if (isCli) {
  const result = validateTokens();
  if (result.ok) {
    console.log('✅ Design tokens valid (alias cycle 0, theme parity 0, unresolved 0)');
    process.exit(0);
  }
  console.error(`❌ Design tokens xato: ${result.errors.length} ta`);
  for (const e of result.errors) console.error(`   - ${e}`);
  process.exit(1);
}

export default validateTokens;
