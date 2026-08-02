#!/usr/bin/env node
/**
 * Edikit — Answer-Key Secret Scanner (Gate 0 CI Gate)
 *
 * Scans EJS views for unprotected correct-answer fields that should
 * only exist in private scoring paths.
 *
 * Usage:
 *   node scripts/answer-key-scan.js
 *
 * Exit codes:
 *   0 — All clean (no leaks found)
 *   1 — Leaks detected
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const ROOT = join(__dirname, '..');

// ── File paths that are entirely exempt (admin-only or privileged) ──
const EXEMPT_PATHS = [
  '/admin/',
  '/dashboard',
  '/vip/',
];

// ── Line-content patterns that are SAFE (false-positive overrides) ──
const EXEMPT_LINE_PATTERNS = [
  /qCorrect is NOT sent/,       // Security comment explaining absence
  /lastCorrectIdx/,              // Post-scoring answer reveal (enter.ejs)
  /lastCorrectText/,             // Post-scoring answer reveal (enter.ejs)
  /correctOptionIndex/,          // Post-scoring answer reveal
  /correctText/,                 // Post-scoring answer reveal
  /answerReveal/,                // Explicit answer-reveal event
  /\.opt-host\.correct/,         // CSS class name (host view)
  /st\.q_correct/,               // Single-player test-arena (user sees own result)
  /correctLetter/,               // Admin panel preview
  /correctText:/,                // Admin panel preview
  /isCorrect/,                   // Admin panel preview
  /privateCorrect/,              // Private scoring helper name
];

// ── Patterns that indicate answer-key leakage ──
const DANGEROUS_PATTERNS = [
  /\bq_correct\b/g,
  /\bqCorrect\b/g,
  /\bcorrectAnswer\b/g,
  /\bcorrect_answer\b/g,
  /\banswerKey\b/g,
  /\banswer_key\b/g,
];

// ── Scan a single file ──
function scanFile(filePath, content) {
  const relPath = filePath.replace(ROOT, '').replace(/^\//, '');

  // 1. Check path exemption
  const isPathExempt = EXEMPT_PATHS.some(p => relPath.includes(p));
  if (isPathExempt) return [];

  const lines = content.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 2. Check line exemption (before pattern matching)
    const isLineExempt = EXEMPT_LINE_PATTERNS.some(p => line.match(p));
    if (isLineExempt) continue;

    for (const pattern of DANGEROUS_PATTERNS) {
      const matches = line.match(pattern);
      if (matches) {
        const lineNum = i + 1;
        findings.push(`Line ${lineNum}: ${pattern.source} — ${line.trim().substring(0, 120)}`);
      }
    }
  }

  return findings;
}

// ── Walk views directory recursively ──
function scanViews() {
  const viewsDir = join(ROOT, 'views');
  const results = [];

  function walkDir(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith('.ejs')) {
        const content = readFileSync(fullPath, 'utf-8');
        const findings = scanFile(fullPath, content);
        if (findings.length > 0) {
          const relPath = fullPath.replace(ROOT, '').replace(/^\//, '');
          results.push({ file: relPath, findings });
        }
      }
    }
  }

  walkDir(viewsDir);
  return results;
}

// ── Scan socket handlers for public emit events with answer data ──
function scanSocketHandlers() {
  const socketFile = join(ROOT, 'socket', 'game-handler.js');
  if (!statSync(socketFile, { throwIfNoEntry: false })) return [];

  const content = readFileSync(socketFile, 'utf-8');
  const lines = content.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('socket.emit(') || line.includes('io.to(')) {
      const isLineExempt = EXEMPT_LINE_PATTERNS.some(p => line.match(p));
      if (isLineExempt) continue;

      const hasDanger = DANGEROUS_PATTERNS.some(p => line.match(p));
      if (hasDanger) {
        findings.push(`Line ${i + 1}: ${line.trim().substring(0, 120)}`);
      }
    }
  }

  return findings;
}

// ── Main ──
let hasLeak = false;

console.log('╔═══════════════════════════════════════════════════════╗');
console.log('║   🔍 Answer-Key Secret Scanner — Gate 0 CI Gate    ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

// 1. Scan views
const viewResults = scanViews();
console.log(`📁 Scanned views/ directory\n`);

if (viewResults.length === 0) {
  console.log('✅ All views clean — no answer-key leaks detected!\n');
} else {
  hasLeak = true;
  console.log('❌ ANSWER-KEY LEAKS DETECTED:\n');
  for (const { file, findings } of viewResults) {
    console.log(`  📄 ${file}:`);
    for (const f of findings) {
      console.log(`    ${f}`);
    }
    console.log();
  }
}

// 2. Scan socket handlers
const socketFindings = scanSocketHandlers();
if (socketFindings.length > 0) {
  hasLeak = true;
  console.log('⚠️  SOCKET HANDLER LEAKS:\n');
  for (const f of socketFindings) {
    console.log(`  ${f}`);
  }
  console.log();
}

// 3. Summary
if (!hasLeak) {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   ✅ PASS: No answer-key leaks detected!           ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  process.exit(0);
} else {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   ❌ FAIL: Answer-key leaks detected!              ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  process.exit(1);
}
