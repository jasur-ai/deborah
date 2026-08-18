import { describe, it, expect } from 'vitest';
import { countLegacyUsage, recordTrend, LEGACY_ALIASES } from '../../scripts/legacy-usage.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('STEP 40 — Legacy usage inventory', () => {
  it('LEGACY_ALIASES: asosiy aliaslar mavjud', () => {
    expect(LEGACY_ALIASES).toContain('--accent');
    expect(LEGACY_ALIASES).toContain('--bg');
    expect(LEGACY_ALIASES).toContain('--text');
    expect(LEGACY_ALIASES).toContain('--card');
    expect(LEGACY_ALIASES).toContain('--muted');
  });

  it('countLegacyUsage: baseline qayd etilgan va musbat', () => {
    const u = countLegacyUsage();
    expect(u.total).toBeGreaterThan(0);
    expect(u.cssSum).toBeGreaterThan(0);
    expect(u.perAlias['--accent']).toBeGreaterThan(0);
  });

  it('recordTrend: faylga yozadi, regression hisoblaydi', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edikit-legacy-'));
    const trendPath = join(dir, 'legacy-usage.json');
    const prev = { current: { total: 1000 }, history: [{ date: '2026-01-01', total: 1000 }] };
    writeFileSync(trendPath, JSON.stringify(prev));

    const r1 = recordTrend({ total: 900, cssSum: 300, viewInline: 600 }, trendPath);
    expect(r1.regression).toBe(-100); // kamaydi — yaxshi
    expect(r1.entry.total).toBe(900);
    expect(existsSync(trendPath)).toBe(true);
    const saved = JSON.parse(readFileSync(trendPath, 'utf8'));
    expect(saved.current.total).toBe(900);
    expect(saved.history.length).toBe(2);

    const r2 = recordTrend({ total: 950, cssSum: 300, viewInline: 650 }, trendPath);
    expect(r2.regression).toBe(50); // oshdi — regression
    expect(r2.prevTotal).toBe(900);
  });

  it('recordTrend: history 10 tadan oshmaydi', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edikit-legacy2-'));
    const trendPath = join(dir, 'legacy-usage.json');
    writeFileSync(trendPath, JSON.stringify({ current: { total: 1 }, history: [] }));
    let r;
    for (let i = 0; i < 15; i++) r = recordTrend({ total: 100 - i, cssSum: 30, viewInline: 70 - i }, trendPath);
    const saved = JSON.parse(readFileSync(trendPath, 'utf8'));
    expect(saved.history.length).toBeLessThanOrEqual(10);
    expect(r.entry.total).toBe(86);
  });
});
