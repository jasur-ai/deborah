#!/usr/bin/env node
/**
 * Deborah — Contrast Checker (STYLE STEP 06 / S06.04-06, S06.07, S06.12)
 * ----------------------------------------------------------------------
 * Semantic token pairlarini WCAG 2.2 formula bilan tekshiradi:
 *   - Normal text            ≥ 4.5:1
 *   - Large text / UI control ≥ 3.0:1
 *   - Teacher/projector primary ≥ 7.0:1 (S06.05 — imkon qadar)
 *   - Alpha compositing: rgba token'lar canvas/surface/raised ustida
 *     REAL composited rang sifatida hisoblanadi (S06.06)
 *   - Buffer: threshold'ga 0.2–0.5 yaqin pairlar report'da belgilanadi (S06.12)
 *   - Gradient: text ustida eng yomon stop; solid scrim token tekshiriladi (S06.07)
 *
 * Chiqish: exit 0 = barcha pair pass, exit 1 = kamida bitta fail.
 * Report: design-audit/contrast-report.md
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOKENS_DIR = resolve(ROOT, 'public/design/tokens');
const AUDIT_DIR = resolve(ROOT, 'design-audit');

// ── Color utils ──
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/;

function hexToRgb(h) {
  let s = h.slice(1);
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function rgbaToRgb(str) {
  const m = RGBA_RE.exec(str);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

function rgbaAlpha(str) {
  const m = RGBA_RE.exec(str);
  if (!m) return null;
  return m[4] === undefined ? 1 : parseFloat(m[4]);
}

function parseColor(v) {
  if (typeof v !== 'string') return null;
  if (HEX_RE.test(v)) return { rgb: hexToRgb(v), alpha: 1 };
  if (RGBA_RE.test(v)) {
    const rgb = rgbaToRgb(v);
    return rgb ? { rgb, alpha: rgbaAlpha(v) } : null;
  }
  return null;
}

/** sRGB → linear (WCAG 2.2) */
function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio */
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha compositing — rgba fg over opaque bg (S06.06) */
export function composite(fgRgb, alpha, bgRgb) {
  return fgRgb.map((c, i) => Math.round(alpha * c + (1 - alpha) * bgRgb[i]));
}

// ── Token loading + alias resolve ──
// Semantic theme fayllari bir xil path'larni qayta ishlatadi (parity) —
// shuning uchun umumiy map'da bir-birini overwrite qiladi. Yechim:
// primitive/typography/layout yagona map, semantic esa har theme uchun
// alohida resolve qilinadi.
function loadTokens() {
  const files = readdirSync(TOKENS_DIR).filter((f) => f.endsWith('.json')).sort();
  const themeFiles = files.filter((f) => f.startsWith('semantic.'));
  const baseFiles = files.filter((f) => !f.startsWith('semantic.'));
  const base = {}; // primitive/typography/layout → resolved
  for (const file of baseFiles) {
    const parsed = JSON.parse(readFileSync(resolve(TOKENS_DIR, file), 'utf-8'));
    flattenInto(parsed, [], file, base);
  }
  const baseResolved = {};
  for (const [path, tok] of Object.entries(base)) {
    baseResolved[path] = { ...tok, $value: resolveValue(tok.$value, base) };
  }
  // Har theme semantic → resolved map
  const themes = {};
  for (const file of themeFiles) {
    const parsed = JSON.parse(readFileSync(resolve(TOKENS_DIR, file), 'utf-8'));
    const t = {};
    flattenInto(parsed.deborah?.semantic || {}, ['deborah', 'semantic'], file, t);
    const tResolved = {};
    // resolve: avval shu theme ichida, keyin base'da
    const lookup = (ref) => t[ref]?.$value ?? baseResolved[ref]?.$value;
    for (const [path, tok] of Object.entries(t)) {
      const val = resolveValueFlex(tok.$value, lookup);
      tResolved[path] = { $type: tok.$type, $value: val, file };
    }
    themes[file] = tResolved;
  }
  return { themes, baseResolved };
}

function resolveValueFlex(value, lookup, seen = new Set()) {
  if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) return value;
  const ref = value.slice(1, -1);
  if (seen.has(ref)) return value;
  seen.add(ref);
  const next = lookup(ref);
  if (next === undefined) return value;
  return resolveValueFlex(next, lookup, seen);
}

function flattenInto(node, prefix, file, out) {
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const path = [...prefix, key];
    if (val && typeof val === 'object' && '$value' in val) {
      out[path.join('.')] = { $type: val.$type, $value: val.$value, $oklch: val.$oklch, file };
    } else if (val && typeof val === 'object') {
      flattenInto(val, path, file, out);
    }
  }
}

function resolveValue(value, all, seen = new Set()) {
  if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) return value;
  const ref = value.slice(1, -1);
  if (seen.has(ref)) return value;
  seen.add(ref);
  const target = all[ref];
  if (!target) return value;
  return resolveValue(target.$value, all, seen);
}

const g = (t, p) => t[p]?.$value;

// ── Pair spec ──
// { fg, bg, target, note, large? } — target: 4.5 normal / 3.0 UI / 7.0 teacher
const PAIRS = [
  { fg: 'deborah.semantic.color.text.primary', bg: 'deborah.semantic.color.surface.default', target: 4.5, note: 'text.primary on surface' },
  { fg: 'deborah.semantic.color.text.secondary', bg: 'deborah.semantic.color.surface.default', target: 4.5, note: 'text.secondary on surface' },
  { fg: 'deborah.semantic.color.text.muted', bg: 'deborah.semantic.color.surface.default', target: 4.5, note: 'text.muted on surface' },
  { fg: 'deborah.semantic.color.text.primary', bg: 'deborah.semantic.color.surface.raised', target: 4.5, note: 'text.primary on raised' },
  { fg: 'deborah.semantic.color.text.muted', bg: 'deborah.semantic.color.surface.raised', target: 4.5, note: 'text.muted on raised' },
  { fg: 'deborah.semantic.color.action.primary', bg: 'deborah.semantic.color.surface.raised', target: 3.0, note: 'action.primary on raised (UI)', large: true },
  { fg: 'deborah.semantic.color.action.on-action', bg: 'deborah.semantic.color.action.primary', target: 4.5, note: 'on-action text on primary button' },
  { fg: 'deborah.semantic.color.text.primary', bg: 'deborah.semantic.color.surface.default', target: 7.0, soft: true, note: 'teacher/projector primary — ≥7:1 soft target (S06.05)' },
  { fg: 'deborah.semantic.color.text.inverse', bg: 'deborah.semantic.color.action.primary', target: 4.5, note: 'text.inverse on primary action' },
  { fg: 'deborah.semantic.color.status.success', bg: 'deborah.semantic.color.surface.raised', target: 3.0, note: 'status.success indicator (UI)', large: true },
  { fg: 'deborah.semantic.color.status.warning', bg: 'deborah.semantic.color.surface.raised', target: 3.0, note: 'status.warning indicator (UI)', large: true },
  { fg: 'deborah.semantic.color.status.danger', bg: 'deborah.semantic.color.surface.raised', target: 3.0, note: 'status.danger indicator (UI)', large: true },
  { fg: 'deborah.semantic.color.border.strong', bg: 'deborah.semantic.color.surface.default', target: 3.0, note: 'border.strong vs surface (UI boundary)', large: true },
];

// ── Main ──
const { themes } = loadTokens();
const themeList = ['semantic.light.json', 'semantic.dark.json', 'semantic.high-contrast.json'];

const rows = [];   // report rows
const fails = [];
let checks = 0;

for (const themeFile of themeList) {
  const t = themes[themeFile];
  const themeName = themeFile.replace('semantic.', '').replace('.json', '');
  const bgCache = {};
  const getColor = (path) => {
    const raw = g(t, path);
    if (raw === undefined) return null;
    const parsed = parseColor(raw);
    if (!parsed) return null;
    return { raw, ...parsed };
  };
  // Compositing bg uchun: agar bg alpha'li bo'lsa, canvas ustida composite (S06.06)
  const getBg = (path) => {
    if (bgCache[path]) return bgCache[path];
    const c = getColor(path);
    if (!c) return null;
    let rgb = c.rgb;
    let alpha = c.alpha;
    if (alpha < 1) {
      const canvas = getColor('deborah.semantic.color.surface.default');
      rgb = composite(c.rgb, alpha, canvas ? canvas.rgb : [255, 255, 255]);
    }
    bgCache[path] = { rgb, raw: alpha < 1 ? `composited(${c.raw})` : c.raw };
    return bgCache[path];
  };

  for (const spec of PAIRS) {
    const fg = getColor(spec.fg);
    const bg = getBg(spec.bg);
    if (!fg || !bg) {
      fails.push(`${themeName}: token topilmadi — ${spec.fg} / ${spec.bg}`);
      continue;
    }
    // S06.06: fg alpha'li bo'lsa ham real bg ustida composite (asymmetric emas)
    const fgRgb = fg.alpha < 1 ? composite(fg.rgb, fg.alpha, bg.rgb) : fg.rgb;
    checks++;
    const ratio = contrastRatio(fgRgb, bg.rgb);
    // Soft target (S06.05): 7:1 — imkon qadar; hard floor 4.5:1
    const hardTarget = spec.soft ? Math.min(spec.target, 4.5) : spec.target;
    const pass = ratio >= (spec.soft ? spec.target : hardTarget);
    const hardPass = ratio >= hardTarget;
    const margin = ratio - spec.target;
    const nearThreshold = !hardPass && margin >= -0.5 && margin < 0; // 0-0.5 pastda
    const nearPass = hardPass && margin < 0.5;                       // 0-0.5 yuqorida (buffer)
    const status = spec.soft
      ? (ratio >= spec.target ? 'PASS' : (ratio >= 4.5 ? 'SOFT' : 'FAIL'))
      : (hardPass ? 'PASS' : 'FAIL');
    if (status === 'FAIL') {
      fails.push(`${themeName}: ${spec.note} — ${ratio.toFixed(2)}:1 < ${hardTarget} (${fg.raw} / ${bg.raw})`);
    }
    rows.push({
      theme: themeName,
      note: spec.note,
      fg: fg.raw,
      bg: bg.raw,
      ratio: ratio.toFixed(2),
      target: spec.soft ? `${spec.target} (soft)` : spec.target,
      pass: status,
      buffer: nearThreshold || nearPass ? '⚠ near' : (hardPass ? 'ok' : ''),
    });
  }
}

// ── Gradient worst-stop + scrim (S06.07) ──
// Gradient ustida text ishlatilganda eng yomon stop eng qorong'i rang;
// solid scrim token mavjud bo'lsa, eng yomon stop scrim bilan 4.5:1
// ta'minlashi tekshiriladi. Gradient (Oklch->sRGB) stops ixtiyoriy:
// oklchByHex dan olingan brand ranglar orasida eng qorong'isi worst-stop.
{
  const scrimPath = 'deborah.semantic.color.surface.scrim';
  const scrimRaw = g(themes['semantic.light.json'], scrimPath);
  const scrim = parseColor(scrimRaw);
  const hasScrim = !!scrim;
  checks++;
  if (hasScrim) {
    // Worst-stop test (S06.07): gradient'da eng qorong'i stop — hozircha
    // token'larda gradient stops yo'q, shuning uchun stand-in: insight-light
    // #9B5E00 @ 0.55 alpha scrim ustida. Haqiqiy gradient token qo'shilsa
    // bu yerda shu tokenlardan o'qiladi (hujjatlashgan stand-in).
    const worst = parseColor('#9B5E00');
    const scrimmed = composite(worst.rgb, 0.55, scrim.rgb);
    const ratio = contrastRatio([255, 255, 255], scrimmed);
    const pass = ratio >= 4.5;
    rows.push({
      theme: 'light',
      note: `gradient worst-stop (#9B5E00 stand-in) + scrim → white text ${ratio.toFixed(2)}:1 (S06.07)`,
      fg: '#FFFFFF', bg: `scrim(${scrimRaw})`, ratio: ratio.toFixed(2), target: '4.5', pass: pass ? 'PASS' : 'FAIL', buffer: '',
    });
    if (!pass) fails.push(`gradient worst-stop scrim bilan 4.5:1 emas (${ratio.toFixed(2)}:1) (S06.07)`);
  } else {
    rows.push({ theme: 'all', note: 'MISSING: color.surface.scrim solid token (S06.07)', fg: '—', bg: '—', ratio: 'FAIL', target: '4.5', pass: 'FAIL', buffer: '' });
    fails.push('color.surface.scrim solid token topilmadi (S06.07)');
  }
}

// ── Report (S06.12) ──
mkdirSync(AUDIT_DIR, { recursive: true });
const passCount = rows.filter((r) => r.pass === 'PASS').length;
const lines = [];
lines.push('# Deborah Contrast Report (S06.12)');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Pair check: ${checks} | PASS: ${passCount} | FAIL: ${fails.length} (buffer 0.2–0.5 near threshold)`)
lines.push('');
lines.push('| Theme | Pair | FG | BG | Ratio | Target | Status |');
lines.push('|-------|------|----|----|-------|--------|--------|');
for (const r of rows) {
  lines.push(`| ${r.theme} | ${r.note} | ${r.fg} | ${r.bg} | ${r.ratio} | ${r.target} | ${r.pass}${r.buffer ? ' ' + r.buffer : ''} |`);
}
lines.push('');
if (fails.length) {
  lines.push('## Failures');
  lines.push('');
  for (const f of fails) lines.push(`- ❌ ${f}`);
} else {
  lines.push('✅ Barcha tekshirilgan pairlar threshold\'dan o\'tdi.');
}
writeFileSync(resolve(AUDIT_DIR, 'contrast-report.md'), lines.join('\n') + '\n', 'utf-8');

if (fails.length) {
  console.error(`❌ Contrast: ${fails.length} fail (${checks} check)`);
  for (const f of fails) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ Contrast pass: ${passCount}/${checks} pair (buffer hisobga olingan)`);
