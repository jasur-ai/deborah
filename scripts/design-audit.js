#!/usr/bin/env node
/**
 * Edikit — Visual Matrix Coverage Report (STYLE STEP 03 / S03.12)
 * -----------------------------------------------------------------
 * Har critical page barcha required theme/viewport/state kombinatsiyasiga
 * ega ekanini tekshiradi.
 *
 * Manba:
 *   - `design-audit/fixtures.json` — page → viewports + state → themes
 *   - `design-audit/screenshots/` — actual screenshot fayllari
 *     ({page}--{state}--{theme}--{viewport}.png — S03.08)
 *
 * Qo'shimcha:
 *   - Orphan screenshotlarni topadi (fixtures'da talab qilinmagan fayllar)
 *   - Chiqish: design-audit/visual-coverage.md + exit 0/1
 *
 * Ishga tushirish: node scripts/design-audit.js   (yoki npm run test:visual:audit)
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AUDIT_DIR = resolve(ROOT, 'design-audit');
const FIXTURES_FILE = resolve(AUDIT_DIR, 'fixtures.json');
const SCREENSHOT_DIR = resolve(AUDIT_DIR, 'screenshots');
const REPORT_FILE = resolve(AUDIT_DIR, 'visual-coverage.md');

// ── Required matrix (S03.12) — fixtures.json mavjud bo'lmasa default ──
const DEFAULT_FIXTURES = {
  landing: {
    viewports: ['desktop', 'small-desktop', 'tablet', 'mobile', 'mobile-small'],
    states: { rest: ['light', 'dark', 'reduced-motion'], hover: ['light', 'dark', 'reduced-motion'] },
  },
  login: {
    viewports: ['desktop', 'small-desktop', 'tablet', 'mobile', 'mobile-small'],
    states: { rest: ['light', 'dark', 'reduced-motion'], focus: ['light', 'dark'] },
  },
  play: {
    viewports: ['desktop', 'small-desktop', 'tablet', 'mobile', 'mobile-small'],
    states: { rest: ['light', 'dark', 'reduced-motion'] },
  },
  'user-panel': {
    viewports: ['desktop', 'small-desktop', 'tablet', 'mobile', 'mobile-small'],
    states: { rest: ['light', 'dark'] },
  },
  'admin-dashboard': {
    viewports: ['desktop', 'small-desktop', 'tablet', 'mobile', 'mobile-small'],
    states: { rest: ['light', 'dark'] },
  },
  'play-projector': {
    viewports: ['projector-hd', 'projector-720p', 'projector-xga'],
    states: { rest: ['light', 'dark'] },
    screenshotPrefix: 'play',
  },
};

function loadFixtures() {
  if (existsSync(FIXTURES_FILE)) {
    try {
      return JSON.parse(readFileSync(FIXTURES_FILE, 'utf-8'));
    } catch {
      // fallback
    }
  }
  return DEFAULT_FIXTURES;
}

function listScreenshots() {
  if (!existsSync(SCREENSHOT_DIR)) return [];
  return readdirSync(SCREENSHOT_DIR).filter((f) => f.endsWith('.png'));
}

// `{page}--{state}--{theme}--{viewport}.png` ni parse qiladi (S03.08)
function parseName(file) {
  const base = file.replace(/\.png$/, '');
  const parts = base.split('--');
  if (parts.length < 4) return null;
  return {
    file,
    page: parts[0],
    state: parts[1],
    theme: parts[2],
    viewport: parts.slice(3).join('--'),
  };
}

const fixtures = loadFixtures();
const shots = listScreenshots().map(parseName).filter(Boolean);

const rows = [];
const required = new Set();
const byPage = {};

for (const [page, spec] of Object.entries(fixtures)) {
  // S03.08: screenshot filename prefix — spec'da shotName() qanday prefix
  // bilan nomlanadi (masalan projector'da sahifa 'play' nomi bilan saqlanadi).
  const prefix = spec.screenshotPrefix || page;
  for (const [state, themes] of Object.entries(spec.states)) {
    for (const theme of themes) {
      for (const viewport of spec.viewports) {
        const expected = `${prefix}--${state}--${theme}--${viewport}.png`;
        required.add(expected);
        const found = shots.some(
          (s) => s.page === prefix && s.state === state && s.theme === theme && s.viewport === viewport
        );
        rows.push({ expected, found });
        byPage[page] = byPage[page] || { ok: 0, total: 0 };
        byPage[page].total++;
        if (found) byPage[page].ok++;
      }
    }
  }
}

// ── Orphan screenshotlar (reviewer: qolib ketgan eski baselinelar) ──
const orphans = shots.filter((s) => !required.has(s.file));

const missing = rows.filter((r) => !r.found).length;
const covered = rows.length - missing;

const md = [
  '# Visual Matrix Coverage (STYLE STEP 03 / S03.12)',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `| Kombinatsiya | Holat |`,
  `|-------------|-------|`,
  ...rows.map((r) => `| \`${r.expected}\` | ${r.found ? '✅' : '❌ yo\'q'} |`),
  '',
  `**Coverage: ${covered} covered / ${rows.length} required (${Math.round((covered / rows.length) * 100)}%)**`,
  '',
  '| Sahifa | Coverage |',
  '|--------|----------|',
  ...Object.entries(byPage).map(([page, s]) => `| ${page} | ${s.ok}/${s.total} |`),
  '',
];

if (orphans.length) {
  md.push('## Orphan screenshotlar (fixtures\'da talab qilinmaydi)', '');
  for (const o of orphans) md.push(`- \`${o.file}\``);
  md.push('');
}

writeFileSync(REPORT_FILE, md.join('\n'), 'utf-8');

console.log(`📊 Visual coverage: ${covered}✅ / ${rows.length} required (${Math.round((covered / rows.length) * 100)}%)`);
console.log(`   Report: ${REPORT_FILE.replace(ROOT + '/', '')}`);
let exit = 0;
if (missing > 0) {
  console.log(`   ❌ ${missing} kombinatsiya yo'q — 'npm run test:visual:update' ishga tushiring`);
  exit = 1;
} else {
  console.log('   ✅ Barcha required kombinatsiya mavjud');
}
if (orphans.length) {
  console.log(`   ⚠️ ${orphans.length} orphan screenshot — olib tashlash tavsiya: rm design-audit/screenshots/{fayl}`);
  exit = 1;
}
process.exit(exit);
