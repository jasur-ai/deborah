#!/usr/bin/env node
/**
 * Edikit — Security CI Gates (Prompt 70, item 09)
 *
 * Zero-dependency, runnable in CI without network:
 *
 *   1. SAST   — grep-based static scan of src/, routes/, socket/, middleware/
 *      for dangerous patterns (innerHTML sinks, eval, exec, hardcoded secrets,
 *      unsanitized template literals into DB paths, etc.).
 *   2. SCA    — scans package.json dependency list for a curated list of
 *      known-critical packages (placeholder registry — extend as advisories
 *      land; no network required).
 *   3. SECRETS— scans the repo for likely secret material (private keys,
 *      AWS/Google/Firebase tokens, generic high-entropy tokens) excluding
 *      node_modules, data, .git.
 *   4. SBOM   — generates a lightweight SBOM (JSON) with package name/version
 *      from package.json + lockfile-derived versions, written to
 *      reports/sbom.json and printed as a summary.
 *
 * Exit code: 0 when ALL gates pass; 1 otherwise (release gate, item 15 —
 * a red gate blocks production promotion).
 *
 * Usage:
 *   node scripts/security-ci.js            # run all gates
 *   node scripts/security-ci.js --sast     # run one gate
 *   node scripts/security-ci.js --json     # machine-readable output
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const only = process.argv.find((a) => a.startsWith('--')) || null;
const jsonOut = process.argv.includes('--json');

// ── Helpers ──
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'data') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 1. SAST — dangerous pattern scan
// ═══════════════════════════════════════════════════════════════════

const SAST_RULES = [
  { id: 'SAST-001', name: 'innerHTML sink (XSS)', severity: 'high', pattern: /\.innerHTML\s*[+\u003d]?=/ },
  { id: 'SAST-002', name: 'eval / Function constructor', severity: 'high', pattern: /\beval\(|new Function\(/ },
  { id: 'SAST-003', name: 'child_process exec/execSync', severity: 'high', pattern: /execSync?\(|spawnSync?\(/ },
  { id: 'SAST-004', name: 'hardcoded secret assignment', severity: 'critical', pattern: /(api[_-]?key|secret|password|token|credential)\s*[:=]\s*['"][A-Za-z0-9_\-]{8,}['"]/i },
  { id: 'SAST-005', name: 'crypto.subtle with user salt only (no pepper)', severity: 'low', pattern: /crypto\.subtle\.digest/ },
  { id: 'SAST-006', name: 'console.log of request body', severity: 'medium', pattern: /console\.(log|info)\([^)]*(req\.body|req\.query|req\.params)/ },
  { id: 'SAST-007', name: 'no-store cache on sensitive routes', severity: 'low', pattern: /res\.set\(['"]Cache-Control['"]\s*,\s*['"](?!no-store)/ },
];

function runSast() {
  const files = walk(path.join(ROOT, 'src'), ['.js', '.ts'])
    .concat(walk(path.join(ROOT, 'routes'), ['.js']))
    .concat(walk(path.join(ROOT, 'socket'), ['.js']))
    .concat(walk(path.join(ROOT, 'middleware'), ['.js']));
  const findings = [];
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    for (const rule of SAST_RULES) {
      const m = rule.pattern.exec(src);
      if (m) findings.push({ rule: rule.id, name: rule.name, severity: rule.severity, file: path.relative(ROOT, file), line: 1 + src.slice(0, m.index).split('\n').length });
    }
  }
  // Deduplicate per (rule,file)
  const seen = new Set();
  const unique = findings.filter((f) => {
    const k = `${f.rule}:${f.file}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const critical = unique.filter((f) => f.severity === 'critical');
  return { findings: unique, pass: critical.length === 0, critical: critical.length };
}

// ═══════════════════════════════════════════════════════════════════
// 2. SCA — known-vulnerable dependency registry (offline)
// ═══════════════════════════════════════════════════════════════════

// Curated advisory registry: package → [affected semver ranges] → advisory.
// EXTEND THIS as new advisories are published. `npm audit` remains the
// authoritative online check; this is the offline CI gate.
const SCA_ADVISORIES = [
  { pkg: 'express', versions: ['<4.19.0', '>=4.0.0 <4.19.0'], advisory: 'CVE-2024-29041 (path traversal)' },
  { pkg: 'ejs', versions: ['<3.1.10'], advisory: 'CVE-2022-29078 (RCE via template injection)' },
  { pkg: 'multer', versions: ['<1.4.4-lts.1'], advisory: 'CVE-2022-24434 (DoS)' },
  { pkg: 'jsonwebtoken', versions: ['<9.0.0'], advisory: 'CVE-2022-23529 (remote key disclosure)' },
  { pkg: 'ws', versions: ['<8.17.1'], advisory: 'CVE-2024-37890 (DoS via many headers)' },
  { pkg: 'socket.io', versions: ['<4.6.2'], advisory: 'CVE-2023-32695 (unhandled exception DoS)' },
  { pkg: 'undici', versions: ['<6.19.7'], advisory: 'CVE-2025-22150 (crlf injection)' },
];

function versionCompare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function satisfies(version, range) {
  const m = /^(>=?|<=?)?\s*([\d.]+)/.exec(range);
  if (!m) return false;
  const op = m[1] || '>=';
  const target = m[2];
  const cmp = versionCompare(version, target);
  if (op === '>=') return cmp >= 0;
  if (op === '>') return cmp > 0;
  if (op === '<=') return cmp <= 0;
  if (op === '<') return cmp < 0;
  if (op === '=') return cmp === 0;
  return false;
}

function runSca() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const findings = [];
  for (const [name, range] of Object.entries(deps)) {
    const cleanRange = String(range).replace(/^[\^~]/, '');
    for (const adv of SCA_ADVISORIES) {
      if (adv.pkg !== name) continue;
      if (adv.versions.some((v) => {
        const m = /^(>=?|<=?)?\s*([\d.]+)/.exec(v);
        return m && m[1] === '<' && satisfies(cleanRange, v);
      })) {
        findings.push({ pkg: name, installed: range, advisory: adv.advisory });
      }
    }
  }
  return { findings, pass: findings.length === 0, count: findings.length };
}

// ═══════════════════════════════════════════════════════════════════
// 3. SECRETS — repo secret-material scan
// ═══════════════════════════════════════════════════════════════════

const SECRET_PATTERNS = [
  { id: 'SEC-001', name: 'private RSA/PEM key', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'SEC-002', name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { id: 'SEC-003', name: 'Google API key', pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { id: 'SEC-004', name: 'Firebase config blob', pattern: /AIza[0-9A-Za-z\-_]{35}.{0,120}firebase/ },
  { id: 'SEC-005', name: 'GitHub token', pattern: /gh[pousr]_[0-9A-Za-z]{36,}/ },
  { id: 'SEC-006', name: 'Slack token', pattern: /xox[baprs]-[0-9A-Za-z\-]{10,}/ },
  { id: 'SEC-007', name: 'Stripe secret key', pattern: /sk_live_[0-9A-Za-z]{24,}/ },
  { id: 'SEC-008', name: 'Generic long token in env-example', pattern: /(SECRET|TOKEN|PASSWORD|API_KEY)\s*=\s*['"]?[A-Za-z0-9_\-]{24,}['"]?/ },
];

function runSecrets() {
  const files = walk(ROOT, ['.js', '.ts', '.ejs', '.json', '.env.example', '.env.sample', '.md', '.sh']);
  const findings = [];
  for (const file of files) {
    if (file.includes('reports') || file.includes('node_modules') || file.includes('package-lock')) continue;
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    // SEC-008 (generic long token in env) only applies to real env files —
    // test fixtures routinely contain SESSION_SECRET=/TOKEN= test values that
    // are NOT real secrets; scanning them produces false positives.
    const isEnvFile = /\.env(\.|$)/.test(path.basename(file));
    for (const rule of SECRET_PATTERNS) {
      if (rule.id === 'SEC-008' && !isEnvFile) continue;
      const m = rule.pattern.exec(src);
      if (m) findings.push({ rule: rule.id, name: rule.name, file: path.relative(ROOT, file), line: 1 + src.slice(0, m.index).split('\n').length });
    }
  }
  return { findings, pass: findings.length === 0, count: findings.length };
}

// ═══════════════════════════════════════════════════════════════════
// 4. SBOM — dependency inventory export
// ═══════════════════════════════════════════════════════════════════

function runSbom() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  let lockDeps = {};
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    if (lock.packages) {
      for (const [name, info] of Object.entries(lock.packages)) {
        if (name === '') continue;
        lockDeps[name.replace(/^node_modules\//, '')] = info.version || 'unknown';
      }
    }
  } catch (_) { /* no lockfile — fall back to package.json ranges */ }

  const components = Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
    .map(([name, range]) => ({
      type: 'library',
      name,
      version: lockDeps[name] || String(range).replace(/^[\^~]/, ''),
      scope: pkg.dependencies?.[name] ? 'runtime' : 'dev',
    }));

  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.4',
    serialNumber: `urn:uuid:${Date.now()}-${Math.random().toString(16).slice(2)}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'edikit', name: 'security-ci', version: '1.0.0' }],
      component: { type: 'application', name: pkg.name || 'edikit', version: pkg.version || '0.0.0' },
    },
    components,
  };

  const reportsDir = path.join(ROOT, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'sbom.json'), JSON.stringify(sbom, null, 2));

  return { pass: true, componentCount: components.length, file: 'reports/sbom.json' };
}

// ═══════════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════════

const gates = {
  sast: runSast,
  sca: runSca,
  secrets: runSecrets,
  sbom: runSbom,
};

const requestedGates = ['sast', 'sca', 'secrets', 'sbom'].filter((g) => process.argv.includes(`--${g}`));
const runAll = !only || only === '--json' || only === '--all' || requestedGates.length === 0;

const results = {};
let allPass = true;

for (const [name, fn] of Object.entries(gates)) {
  if (runAll || requestedGates.includes(name)) {
    results[name] = fn();
    allPass = allPass && results[name].pass;
  }
}

if (jsonOut) {
  console.log(JSON.stringify({ gates: results, pass: allPass }, null, 2));
} else {
  console.log('\n═══ Edikit Security CI Gates ═══');
  for (const [name, r] of Object.entries(results)) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    if (name === 'sast') console.log(`[${icon}] SAST — ${r.findings.length} findings (${r.critical} critical)`);
    else if (name === 'sca') console.log(`[${icon}] SCA — ${r.count} known-vuln advisories`);
    else if (name === 'secrets') console.log(`[${icon}] SECRETS — ${r.count} potential secrets`);
    else if (name === 'sbom') console.log(`[${icon}] SBOM — ${r.componentCount} components → ${r.file}`);
  }
  console.log(allPass ? '\n✅ ALL GATES PASS' : '\n❌ GATE FAILURE — release blocked');
}

process.exit(allPass ? 0 : 1);
