import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('STEP 12 — Base component library (F2)', () => {
  describe('button.css', () => {
    const css = rd('public/design/components/button.css');

    it('S12.01: barcha variantlar mavjud', () => {
      for (const v of ['.btn-primary', '.btn-secondary', '.btn-quiet', '.btn-danger', '.btn-link']) {
        expect(css).toContain(v);
      }
    });

    it('S12.02: size disiplinasi — 32/44/48px (S36.09: base 44px, WCAG 2.5.8)', () => {
      expect(css).toMatch(/min-height: 32px/);
      expect(css).toMatch(/min-height: 44px/);
      expect(css).toMatch(/min-height: 48px/);
      expect(css).not.toMatch(/min-height: 40px/); // 40px qoldi — S36.09 da 44px'ga ko'tarildi
    });

    it('S12.03: microstates — hover/active/focus-visible/loading/disabled/selected', () => {
      expect(css).toContain(':hover');
      expect(css).toContain(':active');
      expect(css).toContain(':focus-visible');
      expect(css).toContain('.is-loading');
      expect(css).toContain(':disabled');
      expect(css).toContain('.is-selected');
    });

    it('S12.04: loading holatida label saqlanadi (width barqaror)', () => {
      expect(css).toContain('.is-loading .btn-label');
    });

    it('S12.05: focus ring token bilan', () => {
      expect(css).toMatch(/focus-visible[^}]*--deborah-semantic-color-focus|outline: 3px/);
    });

    it('S12.06: danger — status-danger semantic token, gradient emas', () => {
      expect(css).toMatch(/btn-danger[^}]*status-danger/);
      expect(css).not.toMatch(/btn-danger[^}]*linear-gradient/);
    });
  });

  describe('icon-button.css', () => {
    const css = rd('public/design/components/icon-button.css');

    it('S12.07: 44px hit area + tooltip', () => {
      expect(css).toMatch(/width: 44px/);
      expect(css).toContain('[data-tip]');
    });

    it('S12.08: aria-pressed + selected marker', () => {
      expect(css).toMatch(/aria-pressed=['"]true['"]/);
      expect(css).toContain('::after');
    });
  });

  describe('badge.css', () => {
    const css = rd('public/design/components/badge.css');

    it('S12.09: 5 variant — neutral/info/success/warning/danger', () => {
      for (const v of ['badge-neutral', 'badge-info', 'badge-success', 'badge-warning', 'badge-danger']) {
        expect(css).toContain(`.${v}`);
      }
    });
  });

  describe('S12.10 — gradient-free primary buttonlar', () => {
    it('style.css .btn-primary solid (gradient emas)', () => {
      const css = rd('public/css/style.css');
      const m = css.match(/\.btn-primary\s*\{[^}]*\}/);
      expect(m).toBeTruthy();
      expect(m[0]).not.toContain('linear-gradient');
    });

    it('landing.css .ld-btn-primary solid', () => {
      const css = rd('public/css/landing.css');
      const m = css.match(/\.ld-btn-primary\s*\{[^}]*\}/);
      expect(m).toBeTruthy();
      expect(m[0]).not.toContain('linear-gradient');
    });

    it('admin.css da gradient button yoq', () => {
      const css = rd('public/css/admin.css');
      expect(css.match(/btn[^{]*\{[^}]*linear-gradient/g) || []).toHaveLength(0);
    });
  });

  describe('S12.11 — emoji → SVG family', () => {
    it('icons.js dice/rocket iconlari qoshildi', () => {
      const icons = rd('utils/icons.js');
      expect(icons).toMatch(/dice:/);
      expect(icons).toMatch(/rocket:/);
      expect(icons).toMatch(/refresh:/);
    });

    it('cast view funksional buttonlarida emoji yoq (mood-indicator mustasno)', () => {
      for (const f of readdirSync(join(ROOT, 'views/cast')).filter((x) => x.endsWith('.ejs'))) {
        const c = rd(`views/cast/${f}`);
        const stripped = c.replace(/<button[^>]*class="[^"]*conf-(btn|signal-btn)[^"]*"[^>]*>[\s\S]*?<\/button>/g, '');
        const hits = stripped.match(/<button[^>]*>.*?[\u{1F300}-\u{1FAFF}\u270F\uFE0F].*?<\/button>/gu) || [];
        expect(hits, `${f} emoji button qoldi`).toHaveLength(0);
      }
    });
  });

  describe('S12.13 — $3 sed qoldiqlari yoq', () => {
    it('public/css da $3 qoldig-i yoq', () => {
      for (const f of readdirSync(join(ROOT, 'public/css')).filter((x) => x.endsWith('.css'))) {
        const css = rd(`public/css/${f}`);
        expect(css.match(/\$3/g) || [], `${f} $3 qoldigi`).toHaveLength(0);
      }
    });
  });

  describe('head.ejs component importlar', () => {
    it('button/icon-button/badge.css head.ejs da', () => {
      const head = rd('views/partials/head.ejs');
      for (const c of ['button.css', 'icon-button.css', 'badge.css']) {
        expect(head).toContain(`components/${c}`);
      }
    });
  });
});
