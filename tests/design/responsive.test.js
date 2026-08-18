import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const resp = read('public/design/foundations/responsive.css');
const layout = read('public/design/foundations/layout.css');
const head = read('views/partials/head.ejs');

describe('STEP 20 — Responsive, container queries, safe areas', () => {
  describe('S20.01: Media query + container + preference features', () => {
    it('container-type foundation', () => {
      expect(resp).toMatch(/container-type:\s*inline-size/);
    });
    it('preference media features (reduced-motion)', () => {
      expect(resp).toMatch(/prefers-reduced-motion/);
    });
    it('head.ejs wires responsive.css', () => {
      expect(head).toContain('/design/foundations/responsive.css');
    });
  });

  describe('S20.02: Container breakpoints (cards + toolbar)', () => {
    it('test-card container breakpoint', () => {
      expect(resp).toMatch(/cq-test-card/);
      expect(resp).toMatch(/@container \(max-width: 360px\)/);
    });
    it('metric-card + mode-card + toolbar containers', () => {
      expect(resp).toMatch(/cq-metric-card/);
      expect(resp).toMatch(/cq-mode-card/);
      expect(resp).toMatch(/cq-toolbar/);
    });
  });

  describe('S20.03: Dynamic viewport height', () => {
    it('100svh progressive enhancement in cast + app CSS', () => {
      expect(resp).toMatch(/100svh/);
      expect(read('public/css/cast-participant.css')).toMatch(/min-height: 100vh; min-height: 100svh/);
      expect(read('public/css/cast-projector.css')).toMatch(/min-height: 100vh; min-height: 100svh/);
      expect(read('public/css/style.css')).toMatch(/min-height: 100vh; min-height: 100svh/);
      expect(read('public/design/components/dialog.css')).toMatch(/height: 100vh; height: 100svh/);
    });
  });

  describe('S20.04: Safe areas', () => {
    it('bottom controls + FAB safe-area', () => {
      expect(read('public/css/cast-participant.css')).toMatch(/bottom: calc\(18px \+ env\(safe-area-inset-bottom/);
      expect(read('public/css/cast-projector.css')).toMatch(/bottom: calc\(24px \+ env\(safe-area-inset-bottom/);
    });
    it('viewport-fit=cover on all cast views', () => {
      for (const v of ['director', 'participant', 'projector', 'quality-lab', 'replay', 'results']) {
        expect(read(`views/cast/${v}.ejs`)).toMatch(/viewport-fit=cover/);
      }
    });
  });

  describe('S20.05: Input modality', () => {
    it('hover only on fine pointer', () => {
      expect(resp).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/);
    });
    it('coarse pointer larger targets', () => {
      expect(resp).toMatch(/@media \(pointer: coarse\)/);
      expect(resp).toMatch(/min-height:\s*48px/);
    });
  });

  describe('S20.08: Ultra-wide guard', () => {
    it('workspace max 1440-1600px + reading 65ch', () => {
      expect(layout).toMatch(/--edikit-container-workspace-wide,\s*1440px/);
      expect(layout).toMatch(/--edikit-container-reading,\s*65ch/);
    });
    it('ultra-wide clamps workspace', () => {
      expect(resp).toMatch(/@media \(min-width: 1600px\)/);
    });
  });

  describe('S20.09: Mobile replacement (no functionality loss)', () => {
    it('table reflow + nav drawer + full dialog exist', () => {
      expect(read('public/design/components/table.css')).toMatch(/is-reflow/);
      expect(read('public/design/components/navigation.css')).toMatch(/translateX/);
      expect(read('public/design/components/dialog.css')).toMatch(/\.dialog--full/);
    });
  });

  describe('S20.11/12: Zoom guard + mobile-first default', () => {
    it('zoom-safe util', () => {
      expect(resp).toMatch(/\.zoom-safe/);
      expect(resp).toMatch(/overflow-wrap:\s*anywhere/);
    });
    it('container enhancements guarded by @supports (mobile-first)', () => {
      expect(resp).toMatch(/@supports \(container-type: inline-size\)/);
    });
  });
});
