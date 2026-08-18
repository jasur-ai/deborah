#!/usr/bin/env node
/**
 * S40.12 — Legacy CSS alias migratsiyasi
 *
 * `var(--accent)` kabi eski alias'larni DTCG semantic token'larga almashtiradi.
 * Ushbu mapping dark-tema qiymatlarida tasdiqlangan ekvivalentlarga asoslanadi
 * (design-audit/legacy-usage.json baseline 1375 → maqsad: sezilarli pasayish).
 *
 * QAMROV:
 *   - views/ ichidagi barcha .ejs (views/game/ ISTISNO — o'z lokal `:root`'ini belgilaydi)
 *   - public/css/*.css  (style.css :root DEF'lari alohida REBIND qilinadi)
 *   - public/design/ ichidagi barcha .css (public/design/generated/ ISTISNO)
 *   - public/js/*.js    (dinamik style'lar)
 *
 * CHEKLANGAN (semantic ekvivalenti yo'q — alias sifatida qoladi):
 *   --accent-glow, --accent-bright, --accent-purple, --accent-amber,
 *   --gold, --info, --green, --bg-deep, --bg-elevated, --bg-overlay,
 *   --bg-card-hover, --opt-a..e
 *
 * ISHLATISH:
 *   node scripts/migrate-legacy.js          # qo'llaydi
 *   node scripts/migrate-legacy.js --dry    # faqat hisobot, yozmaydi
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry');

// ── alias → semantic token (uzundan qisqaga tartiblangan) ──
const MAP = [
  ['--text-disabled', '--edikit-semantic-color-text-disabled'],
  ['--text-secondary', '--edikit-semantic-color-text-secondary'],
  ['--text-primary', '--edikit-semantic-color-text-primary'],
  ['--text-muted', '--edikit-semantic-color-text-muted'],
  ['--border-strong', '--edikit-semantic-color-border-strong'],
  ['--border-medium', '--edikit-semantic-color-border-default'],
  ['--border-light', '--edikit-semantic-color-border-subtle'],
  ['--border-subtle', '--edikit-semantic-color-border-subtle'],
  ['--bg-surface', '--edikit-semantic-color-surface-input'],
  ['--bg-primary', '--edikit-semantic-color-surface-default'],
  ['--bg-card', '--edikit-semantic-color-surface-raised'],
  ['--accent-dark', '--edikit-semantic-color-action-primary-hover'],
  ['--accent-deep', '--edikit-semantic-color-action-primary-active'],
  ['--accent', '--edikit-semantic-color-action-primary'],
  ['--bg', '--edikit-semantic-color-surface-default'],
  ['--card', '--edikit-semantic-color-surface-raised'],
  ['--surf', '--edikit-semantic-color-surface-raised'],
  ['--text', '--edikit-semantic-color-text-primary'],
  ['--muted', '--edikit-semantic-color-text-muted'],
  ['--border', '--edikit-semantic-color-border-default'],
  ['--success', '--edikit-semantic-color-status-success'],
  ['--danger', '--edikit-semantic-color-status-danger'],
  ['--warning', '--edikit-semantic-color-status-warning'],
].sort((a, b) => b[0].length - a[0].length);

// ── style.css :root DEF rebinding (hex → var(token, hex)) ──
const REBIND = new Map(MAP); // bir xil mapping

/** Fayllar ro'yxati (views + css + js), istisnolardan tashqari. */
function files() {
  const out = [];
  const walk = (dir, skip = []) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || skip.includes(name)) continue;
      const p = join(dir, name);
      if (existsSync(p) && statSync(p).isDirectory()) walk(p, skip);
      else if (/\.(ejs|css|js)$/.test(name)) out.push(p);
    }
  };
  walk(join(ROOT, 'views'), ['game']);
  walk(join(ROOT, 'public/css'));
  walk(join(ROOT, 'public/design'), ['generated']);
  walk(join(ROOT, 'public/js'));
  return out;
}

function migrateUsages(src) {
  let count = 0;
  let out = src;
  for (const [alias, token] of MAP) {
    const re = new RegExp(`var\\(${alias.replace(/[-]/g, '\\-')}(?=[ ,)])`, 'g');
    out = out.replace(re, () => { count += 1; return `var(${token}`; });
  }
  return { out, count };
}

/** style.css :root alias def'larini semantic'ga bog'laydi (fallback hex saqlanadi). */
function rebindDefs(src) {
  let count = 0;
  let out = src;
  for (const [alias, token] of REBIND) {
    const re = new RegExp(`^(\\s*)(${alias.replace(/[-]/g, '\\-')}):\\s*([^;]+);`, 'gm');
    out = out.replace(re, (m, indent, name, value) => {
      if (/var\(/.test(value)) return m; // allaqachon bog'langan
      count += 1;
      return `${indent}${name}: var(${token}, ${value.trim()});`;
    });
  }
  return { out, count };
}

const allFiles = files();
const perAlias = new Map();
let totalMigrated = 0;
let totalRebound = 0;

for (const f of allFiles) {
  const rel = relative(ROOT, f);
  const src = readFileSync(f, 'utf8');
  let { out, count } = migrateUsages(src);

  if (rel === 'public/css/style.css') {
    const r = rebindDefs(out);
    out = r.out;
    totalRebound += r.count;
  }

  totalMigrated += count;
  for (const [alias] of MAP) {
    const re = new RegExp(`var\\(${alias.replace(/[-]/g, '\\-')}`, 'g');
    const n = (src.match(re) || []).length;
    if (n) perAlias.set(alias, (perAlias.get(alias) || 0) + n);
  }

  if (out !== src) {
    if (!DRY) writeFileSync(f, out);
    console.log(`${DRY ? '[dry]' : '[ok ]'} ${rel}  (${count} use${count === 1 ? '' : 's'})`);
  }
}

console.log('\n── S40.12 migratsiya hisoboti ──');
console.log(`Fayllar: ${allFiles.length} skaner, o'zgargan: ${DRY ? 'dry-run' : 'yozildi'}`);
console.log(`Migratsiya qilingan var() ishlatish: ${totalMigrated}`);
console.log(`style.css :root def rebind: ${totalRebound}`);
console.log('\nAlias bo\'yicha (oldin):');
for (const [a, n] of [...perAlias.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${a.padEnd(18)} ${String(n).padStart(5)}`);
}
console.log('\nBajarildi:', DRY ? '— dry-run (hech narsa yozilmadi)' : '— barcha fayllarga qo\'llandi');
