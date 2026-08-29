import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const tableCss = read('public/design/components/table.css');
const filterCss = read('public/design/components/filter-bar.css');
const dtJs = read('public/js/components/data-table.js');
const dashboard = read('views/admin/dashboard.ejs');

describe('STEP 18 — Table components', () => {
  describe('S18.01/02: Semantic anatomy', () => {
    it('th scope + data-sort in dashboard', () => {
      expect(dashboard).toMatch(/<th scope="col"/);
      expect(dashboard).toMatch(/data-sort="name"/);
      expect(dashboard).toMatch(/data-sort="tests"/);
    });
    it('sortable button creates aria-sort', () => {
      expect(dtJs).toMatch(/setAttribute\('aria-sort'/);
    });
    it('aria-sort asc/desc values', () => {
      expect(dtJs).toMatch(/'ascending'/);
      expect(dtJs).toMatch(/'descending'/);
    });
  });

  describe('S18.03: Alignment', () => {
    it('numeric right + tabular-nums', () => {
      const block = tableCss.match(/\.dt-num\s*\{([\s\S]*?)\}/)[1];
      expect(block).toMatch(/text-align:\s*right/);
      expect(block).toMatch(/tabular-nums/);
    });
    it('actions right', () => {
      expect(tableCss).toMatch(/\.dt-actions\s*\{\s*text-align:\s*right/);
    });
  });

  describe('S18.04: Density', () => {
    it('default 44-48px / compact 36-40px', () => {
      expect(tableCss).toMatch(/data-density="default"[\s\S]*?--dt-row-h:\s*46px/);
      expect(tableCss).toMatch(/data-density="compact"[\s\S]*?--dt-row-h:\s*38px/);
    });
    it('localStorage preference', () => {
      expect(dtJs).toMatch(/localStorage\.getItem\(DENSITY_KEY\)/);
      expect(dtJs).toMatch(/localStorage\.setItem\(DENSITY_KEY/);
    });
    it('aria-pressed density buttons', () => {
      expect(dtJs).toMatch(/aria-pressed/);
    });
  });

  describe('S18.05: Row states', () => {
    it('hover + focus-within + selected + pending + error', () => {
      expect(tableCss).toMatch(/\.dt-row:hover/);
      expect(tableCss).toMatch(/\.dt-row:focus-within/);
      expect(tableCss).toMatch(/is-selected/);
      expect(tableCss).toMatch(/is-pending/);
      expect(tableCss).toMatch(/is-error/);
    });
  });

  describe('S18.06: Search', () => {
    it('debounce 200ms (150-250 range)', () => {
      expect(dtJs).toMatch(/DEBOUNCE_MS\s*=\s*200/);
    });
    it('result count + clear action', () => {
      expect(filterCss).toMatch(/\.dt-count/);
      expect(dtJs).toMatch(/dt-search-clear/);
    });
    it('loading status element', () => {
      expect(dtJs).toMatch(/dt-search-status/);
    });
  });

  describe('S18.07: Filter chips', () => {
    it('removable chips + clear-all + visible state', () => {
      expect(filterCss).toMatch(/\.dt-chip/);
      expect(filterCss).toMatch(/\.dt-clear-all/);
      expect(dtJs).toMatch(/removeFilterChip/);
      expect(dtJs).toMatch(/clearFilters/);
    });
  });

  describe('S18.08: URL/query state', () => {
    it('persists sort+search to query, back-nav safe', () => {
      expect(dtJs).toMatch(/URLSearchParams/);
      expect(dtJs).toMatch(/history\.replaceState/);
      expect(dtJs).toMatch(/_persist/);
    });
  });

  describe('S18.09/10: Mobile reflow + overflow', () => {
    it('reflow at 640px with card grid', () => {
      const mq = tableCss.match(/@media \(max-width:\s*640px\)([\s\S]*?)\n\}/);
      expect(mq[1]).toMatch(/is-reflow/);
      expect(mq[1]).toMatch(/grid-template-columns:\s*1fr auto/);
    });
    it('overflow affordance + sticky header', () => {
      expect(tableCss).toMatch(/\.dt-wrap::after/);
      expect(tableCss).toMatch(/\.dt thead th\s*\{\s*position:\s*sticky/);
    });
  });

  describe('S18.11: Status rows', () => {
    it('loading/empty/error row semantics', () => {
      expect(tableCss).toMatch(/\.dt-row-status/);
    });
  });

  describe('S18.12: Long content + zoom', () => {
    it('nowrap default with overflow wrapper', () => {
      expect(tableCss).toMatch(/white-space:\s*nowrap/);
      expect(tableCss).toMatch(/overflow-x:\s*auto/);
    });
  });
});
