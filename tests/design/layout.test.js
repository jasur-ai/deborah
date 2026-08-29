import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const layout = JSON.parse(readFileSync(join(ROOT, 'public/design/tokens/layout.json'), 'utf8'));
const tokensCss = readFileSync(join(ROOT, 'public/design/generated/tokens.css'), 'utf8');
const layoutCss = readFileSync(join(ROOT, 'public/design/foundations/layout.css'), 'utf8');
const headEjs = readFileSync(join(ROOT, 'views/partials/head.ejs'), 'utf8');

describe('S09.01 — 4px spacing scale', () => {
  const SPACING_SCALE = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96];
  const spacing = layout.deborah.spacing;
  const values = Object.values(spacing)
    .map((v) => parseInt(String(v.$value), 10))
    .filter((n) => !isNaN(n));

  it('barcha spacing qiymatlari 4px scale da', () => {
    for (const n of values) {
      expect(SPACING_SCALE, `${n}px 4px scale'da emas`).toContain(n);
    }
  });
  it('80px va 96px mavjud', () => {
    expect(values).toContain(80);
    expect(values).toContain(96);
  });
  it('generated tokens CSS da --deborah-spacing-20/24 bor', () => {
    expect(tokensCss).toContain('--deborah-spacing-20: 80px');
    expect(tokensCss).toContain('--deborah-spacing-24: 96px');
  });
});

describe('S09.02 — container tokenlar', () => {
  const c = layout.deborah.container;
  it('barcha container tokenlar mavjud', () => {
    expect(c.landing.$value).toBe('1200px');
    expect(c.workspace.$value).toBe('1280px');
    expect(c['workspace-wide'].$value).toBe('1440px');
    expect(c.reading.$value).toBe('65ch');
    expect(parseInt(c.auth.$value)).toBeGreaterThanOrEqual(420);
    expect(parseInt(c.auth.$value)).toBeLessThanOrEqual(460);
    expect(parseInt(c.studio.$value)).toBeGreaterThanOrEqual(880);
    expect(parseInt(c.studio.$value)).toBeLessThanOrEqual(960);
  });
});

describe('S09.03 — grid primitives', () => {
  const g = layout.deborah.grid;
  it('12/8/4 col + 24/20/16 gutter', () => {
    expect(g.cols.desktop.$value).toBe('12');
    expect(g.cols.tablet.$value).toBe('8');
    expect(g.cols.mobile.$value).toBe('4');
    expect(g.gutter.desktop.$value).toBe('24px');
    expect(g.gutter.tablet.$value).toBe('20px');
    expect(g.gutter.mobile.$value).toBe('16px');
  });
  it('layout.css grid media query lar bor', () => {
    expect(layoutCss).toContain('repeat(var(--grid-cols, 12)');
    expect(layoutCss).toContain('max-width: 640px');
  });
});

describe('S09.04 — radius grammar', () => {
  const r = layout.deborah.radius;
  it('control 8 / card 12 / modal 16 / pill 999', () => {
    expect(r.sm.$value).toBe('8px');
    expect(r.md.$value).toBe('12px');
    expect(r.lg.$value).toBe('16px');
    expect(r.pill.$value).toBe('999px');
  });
  it('bubble radius (22-32px) public/css da yo\'q', () => {
    const cssDir = join(ROOT, 'public/css');
    const { readdirSync } = require('fs');
    const re = /border-radius:\s*(2[2-9]|3[0-2])px/g;
    let total = 0;
    for (const f of readdirSync(cssDir).filter((x) => x.endsWith('.css'))) {
      const css = readFileSync(join(cssDir, f), 'utf8');
      total += (css.match(re) || []).length;
    }
    expect(total).toBe(0);
  });
});

describe('S09.06 — elevation + z-index layers', () => {
  const e = layout.deborah.elevation;
  const z = layout.deborah['z-index'];
  it('elevation qatlamlari', () => {
    for (const layer of ['canvas', 'surface', 'sticky', 'modal', 'toast']) {
      expect(e[layer], `elevation-${layer}`).toBeTruthy();
    }
  });
  it('z-index qatlamlari tartibli', () => {
    expect(z.sticky.$value).toBe('10');
    expect(z.dropdown.$value).toBe('20');
    expect(z.modal.$value).toBe('30');
    expect(z.toast.$value).toBe('40');
    expect(z.system.$value).toBe('60');
  });
  it('layout.css layer classlar bor', () => {
    expect(layoutCss).toContain('.layer-modal');
    expect(layoutCss).toContain('.layer-toast');
  });
});

describe('S09.09 — density', () => {
  const d = layout.deborah.density;
  it('comfortable + compact mavjud, compact kichikroq', () => {
    const ch = (x) => parseInt(d[x]['control-height'].$value);
    expect(ch('comfortable')).toBe(40);
    expect(ch('compact')).toBe(32);
    expect(ch('compact')).toBeLessThan(ch('comfortable'));
  });
  it('layout.css compact scoping — admin/teacher', () => {
    expect(layoutCss).toContain('[data-density="compact"]');
    expect(layoutCss).toContain('.admin-layout');
  });
});

describe('S09.12 — head.ejs ulanish', () => {
  it('layout.css head.ejs ga ulangan', () => {
    expect(headEjs).toContain('foundations/layout.css');
  });
  it('cast viewlar layout.css ulangan', () => {
    for (const v of ['director', 'participant', 'projector', 'quality-lab', 'replay', 'results']) {
      const view = readFileSync(join(ROOT, `views/cast/${v}.ejs`), 'utf8');
      expect(view, `${v}.ejs`).toContain('foundations/layout.css');
    }
  });
});
