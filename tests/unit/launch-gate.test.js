import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('STEP 41 — Final launch governance evidence', () => {
  it('S41.11: governance docs mavjud', () => {
    expect(existsSync(join(ROOT, 'docs/design-system/governance.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'CODEOWNERS'))).toBe(true);
    expect(existsSync(join(ROOT, 'CHANGELOG.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'docs/final-acceptance.md'))).toBe(true);
  });

  it('Final acceptance: 41 step qayd etilgan', () => {
    const status = require('fs').readFileSync(join(ROOT, 'implementation-status.md'), 'utf8');
    const steps = (status.match(/^## STYLE STEP/gm) || []).length;
    expect(steps).toBeGreaterThanOrEqual(41);
  });

  it("S41.11: governance doc'da owner + contribution + deprecation + audit bor", () => {
    const src = require('fs').readFileSync(join(ROOT, 'docs/design-system/governance.md'), 'utf8');
    expect(src).toMatch(/Design System Owner/i);
    expect(src).toMatch(/Kontribyutsiya/i);
    expect(src).toMatch(/Deprecation/i);
    expect(src).toMatch(/Quarterly audit/i);
    expect(src).toMatch(/Exception/i);
  });

  it('S41.07: brand assetlar mavjud', () => {
    for (const f of ['evidence-mark.svg', 'wordmark-horizontal.svg', 'wordmark-compact.svg', 'evidence-mark-monochrome.svg', 'evidence-mark-inverse.svg', 'evidence-mark-high-contrast.svg']) {
      expect(existsSync(join(ROOT, `public/images/brand/${f}`))).toBe(true);
    }
  });

  it('S41.06: docs current', () => {
    expect(existsSync(join(ROOT, 'docs/accessibility.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'docs/brand-assets.md'))).toBe(true);
  });

  it('S41.08: research kit mavjud', () => {
    expect(existsSync(join(ROOT, 'research/design-study-plan.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'research/consent.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'research/report.md'))).toBe(true);
  });

  it('S41.12: release-signoff script mavjud va launch-gate uni chaqiradi', () => {
    expect(existsSync(join(ROOT, 'scripts/release-signoff.js'))).toBe(true);
    const gate = require('fs').readFileSync(join(ROOT, 'scripts/launch-gate.js'), 'utf8');
    expect(gate).toMatch(/release-signoff/);
  });

  it('S41: launch-gate script 12 gate + non-negotiables qamraydi', () => {
    const gate = require('fs').readFileSync(join(ROOT, 'scripts/launch-gate.js'), 'utf8');
    for (const id of ['S41.01', 'S41.02', 'S41.03', 'S41.04', 'S41.05', 'S41.06', 'S41.07', 'S41.08', 'S41.09', 'S41.10', 'S41.11', 'S41.12']) {
      expect(gate).toMatch(id);
    }
    expect(gate).toMatch(/non-negotiables|Non-neg/i);
  });

  it('CHANGELOG: launch entry mavjud', () => {
    const log = require('fs').readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    expect(log).toMatch(/2\.1\.0/);
    expect(log).toMatch(/Design Launch/);
  });
});
