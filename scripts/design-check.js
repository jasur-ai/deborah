#!/usr/bin/env node
/**
 * STYLE STEP 37/38 — `npm run design:check` umbrella gate.
 * -------------------------------------------------------------
 * Bir buyruq: tokens validatsiyasi + kontrast + design lint + perf budget
 * + EJS compile.
 *   --full  → qo'shimcha visual (playwright) + axe a11y audit.
 *
 * Run:
 *   node scripts/design-check.js          # fast gate
 *   node scripts/design-check.js --full   # CI gate (visual + axe)
 */
import { spawnSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';

// Windows fix: new URL().pathname → '/D:/...' noto'g'ri — fileURLToPath ishlatamiz
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const full = process.argv.includes('--full');
const VISUAL_PORT = 3477; // playwright.config.js bilan sinxron

const steps = [];

/** Playwright step'lari orasida webServer port'i bo'shashini kutar (port handoff). */
function waitPortFree(port, timeoutMs) {
  const script = `
    const net = require('net');
    const deadline = Date.now() + ${timeoutMs};
    (function poll() {
      const s = net.connect(${port}, 'localhost');
      s.on('connect', () => {
        s.destroy();
        if (Date.now() < deadline) setTimeout(poll, 300);
        else { console.error('port ${port} band qoldi'); process.exit(1); }
      });
      s.on('error', () => { s.destroy(); process.exit(0); });
    })();
  `;
  const res = spawnSync('node', ['-e', script], { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs + 5000 });
  return res.status === 0;
}
function run(name, cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: opts.timeout || 120000, shell: true });
  const ok = res.status === 0;
  steps.push({ name, ok });
  const tail = (res.stdout || '').trim().split('\n').slice(-2).join(' | ');
  console.log(`${ok ? '✓' : '✗'} ${name}${tail ? ' — ' + tail : ''}`);
  if (!ok) {
    // Playwright list reporter'idagi fail test nomlarini ko'rsatish (CI debug):
    // "N failed" summary blokidan keyingi test qatorlari to'liq chiqariladi.
    const lines = (res.stdout || '').split('\n');
    let out = [];
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\d+ failed\s*$/.test(lines[i])) idx = i;
    }
    if (idx >= 0) out = lines.slice(idx, idx + 40);
    else out = lines.filter((l) => /✘|Error:|failed/.test(l)).slice(-14);
    if (out.length) console.log(`   └─ ${out.join('\n   └─ ')}`);
  }
  if (!ok && !opts.warn) process.exitCode = 1;
  return res;
}

// 1. Token validatsiyasi + build
run('tokens', 'node scripts/validate-design-tokens.js && node scripts/build-design-tokens.js');

// 2. Kontrast (design gate'ning bir qismi — fail hard)
run('contrast', 'node scripts/check-contrast.js');

// 3. Design lint (S37.01–07)
run('lint', 'node scripts/design-lint.js');

// 3b. Performance & asset budget (S38.02/03/04/06/10/12)
run('perf-budget', 'node scripts/performance-budget.js');

// 3c. Legacy usage trend (S40.03) — regression bo'lsa fail; --check yozmaydi
run('legacy-usage', 'node scripts/legacy-usage.js --check', [], { warn: true });

// 4. EJS compile (barcha view'lar render bo'lishi mumkin)
try {
  let compiled = 0;
  let bad = 0;
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ejs')) {
        try {
          ejs.compile(readFileSync(p, 'utf8'), { filename: p });
          compiled++;
        } catch (e) {
          bad++;
          console.error(`  ✗ EJS_ERR ${path.relative(ROOT, p)}: ${e.message.slice(0, 90)}`);
        }
      }
    }
  })(path.join(ROOT, 'views'));
  steps.push({ name: `ejs-compile (${compiled})`, ok: bad === 0 });
  console.log(`${bad === 0 ? '✓' : '✗'} ejs-compile — ${compiled} view OK${bad ? `, ${bad} xato` : ''}`);
  if (bad) process.exitCode = 1;
} catch (e) {
  console.error('EJS compile skaner xatosi:', e.message);
  process.exitCode = 1;
}

if (full) {
  // 5. Axe a11y audit
  run('axe', 'NODE_ENV=test npx playwright test --project=a11y-audit tests/a11y/', [], { timeout: 600000 });
  // Port handoff — axe step'ining webServer'i yopilishini kutar
  const freed = waitPortFree(VISUAL_PORT, 20000);
  if (!freed) steps.push({ name: 'port-handoff', ok: false });
  // 6. Visual regression gate
  const vis = run(
    'visual',
    'NODE_ENV=test npx playwright test tests/visual/critical-pages.spec.js tests/visual/foundations.spec.js tests/visual/components.spec.js',
    [],
    { timeout: 600000 },
  );
  if (vis.status !== 0) waitPortFree(VISUAL_PORT, 15000);
}

const failed = steps.filter((s) => !s.ok);
console.log(`\n${failed.length ? `✗ ${failed.length} ta step xato` : '✓ design:check PASS'}`);
process.exit(process.exitCode || 0);
