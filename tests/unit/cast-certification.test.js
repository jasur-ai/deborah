/**
 * Deborah — Cast F4-F6 Certification Verifier testlari (C5-12)
 *
 * scripts/cast-certification.js logikasini tekshiradi:
 *  - F-tier → load-tier mapping (F4→L, F5→XL, F6→XXL)
 *  - certified snapshot validatsiyasi (certified flag, acceptedLoss, p95)
 *  - stale (30 kun) detection
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

// ── Script'ning core logikasini qayta yuklaymiz (CLI run'siz test qilish uchun
//    mapping va verify funksiyasini to'g'ridan-to'g'ri chaqiramiz) ──
import { spawnSync } from 'child_process';

const ROOT = path.resolve(process.cwd());
const SCRIPT = path.join(ROOT, 'scripts/cast-certification.js');

function runCli(args) {
  const res = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function makeSnapshot(dir, { tier, certified = true, results = [], certifiedAt = new Date().toISOString(), participants = 400 }) {
  const file = path.join(dir, `tier-${tier}.json`);
  writeFileSync(
    file,
    JSON.stringify({ certifiedAt, tier, concurrentParticipants: participants, results, certified }, null, 2)
  );
  return file;
}

describe('C5-12 cast-certification: mapping + CLI', () => {
  const tmp = fsTmpDir();
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('F4 → L mapping, valid snapshot → exit 0', () => {
    makeSnapshot(tmp, {
      tier: 'L',
      certified: true,
      results: [
        { scenario: 'gradualJoin', sloPass: true, measuredP95: 400, acceptedLoss: 0 },
        { scenario: 'answerBurst', sloPass: true, measuredP95: 500, acceptedLoss: 0 },
        { scenario: 'reconnectStorm', sloPass: true, measuredP95: 390, acceptedLoss: 0 },
        { scenario: 'soak', sloPass: true, measuredP95: 480, acceptedLoss: 0 },
      ],
    });
    const r = runCli(['--tier', 'F4', '--snapshot', path.join(tmp, 'tier-L.json')]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ALL CERTIFIED');
  });

  it('F5 → XL, snapshot yoq → exit 1', () => {
    const r = runCli(['--tier', 'F5', '--snapshot', path.join(tmp, 'missing-XL.json')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('no-snapshot');
  });

  it('certified:false snapshot → exit 1', () => {
    makeSnapshot(tmp, { tier: 'L', certified: false, results: [{ scenario: 'soak', sloPass: true, measuredP95: 400, acceptedLoss: 0 }] });
    const r = runCli(['--tier', 'F4', '--snapshot', path.join(tmp, 'tier-L.json')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('not-certified');
  });

  it('acceptedLoss > 0 → exit 1 (ground-truth guard)', () => {
    makeSnapshot(tmp, {
      tier: 'L',
      certified: true,
      results: [
        { scenario: 'gradualJoin', sloPass: true, measuredP95: 400, acceptedLoss: 0 },
        { scenario: 'answerBurst', sloPass: true, measuredP95: 500, acceptedLoss: 2 },
      ],
    });
    const r = runCli(['--tier', 'F4', '--snapshot', path.join(tmp, 'tier-L.json')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('accepted-loss');
  });

  it('p95 threshold oshsa → exit 1 (F4/L ≤750ms)', () => {
    makeSnapshot(tmp, {
      tier: 'L',
      certified: true,
      results: [{ scenario: 'soak', sloPass: false, measuredP95: 900, acceptedLoss: 0 }],
    });
    const r = runCli(['--tier', 'F4', '--snapshot', path.join(tmp, 'tier-L.json')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('p95-over');
  });

  it('stale snapshot (30 kun eski) → exit 1', () => {
    makeSnapshot(tmp, {
      tier: 'L',
      certified: true,
      certifiedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      results: [{ scenario: 'soak', sloPass: true, measuredP95: 400, acceptedLoss: 0 }],
    });
    const r = runCli(['--tier', 'F4', '--snapshot', path.join(tmp, 'tier-L.json')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('stale');
  });

  it('--all → F4/F5/F6 barchasi tekshiriladi', () => {
    const r = runCli(['--all', '--snapshot', path.join(tmp, 'none.json')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('F4');
    expect(r.stdout).toContain('F5');
    expect(r.stdout).toContain('F6');
  });

  it('noma\'lum tier → exit 1 (unknown-f-tier)', () => {
    const r = runCli(['--tier', 'F9']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('unknown-f-tier');
  });

  it('flag berilmasa → usage exit 2', () => {
    const r = runCli([]);
    expect(r.code).toBe(2);
  });
});

function fsTmpDir() {
  const dir = path.join(os.tmpdir(), `cast-cert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
