import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const charts = read('public/js/components/charts.js');
const chartCss = read('public/design/components/charts.css');
const tokens = read('public/design/generated/tokens.css');
const head = read('views/partials/head.ejs');
const director = read('public/js/cast-director.js');
const directorV = read('views/cast/director.ejs');
const projectorV = read('views/cast/projector.ejs');
const dev = read('views/dev/components.ejs');

describe('STEP 19 — Charts & evidence visualization', () => {
  describe('S19.01/02: Chart types', () => {
    it('exports distributionBar, revotePair, confidenceGrid, progressLine', () => {
      expect(charts).toMatch(/distributionBar:\s*distributionBar/);
      expect(charts).toMatch(/revotePair:\s*revotePair/);
      expect(charts).toMatch(/confidenceGrid:\s*confidenceGrid/);
      expect(charts).toMatch(/progressLine:\s*progressLine/);
    });
    it('no donut/radar/gauge charts', () => {
      expect(charts).not.toMatch(/donut|radar|gauge/i);
    });
  });

  describe('S19.03: Metric label + value + context', () => {
    it('metric header renders label and value', () => {
      expect(charts).toMatch(/ev-metric-label/);
      expect(charts).toMatch(/ev-metric-value/);
    });
    it('optional context slot', () => {
      expect(charts).toMatch(/data\.context\s*\?/);
      expect(chartCss).toMatch(/\.ev-metric-context/);
    });
  });

  describe('S19.04: Stable option order', () => {
    it('renders options in given array order (no sorting)', () => {
      expect(charts).toMatch(/opts\.forEach/);
      expect(charts).not.toMatch(/\.sort\(/);
    });
  });

  describe('S19.05: CVD-safe color + shape marker', () => {
    it('SHAPES array + marker span', () => {
      expect(charts).toMatch(/SHAPES\s*=\s*\[[^\]]*\]/);
      expect(charts).toMatch(/ev-dist-marker/);
    });
    it('series tokens in CSS', () => {
      expect(tokens).toMatch(/--deborah-data-viz-series-1:/);
      expect(charts).toMatch(/--deborah-data-viz-series-1/);
    });
  });

  describe('S19.06/07: Accessible table + direct labels', () => {
    it('tableAlternative with th scope', () => {
      expect(charts).toMatch(/function tableAlternative/);
      expect(charts).toMatch(/<th scope="col">/);
      expect(charts).toMatch(/<th scope="row">/);
    });
    it('direct values not hover-only', () => {
      expect(charts).toMatch(/ev-line-values/);
      expect(chartCss).toMatch(/\.ev-line-values/);
    });
  });

  describe('S19.08: Interruptible transition', () => {
    it('animateWidth uses performance.now + rAF', () => {
      expect(charts).toMatch(/function animateWidth/);
      expect(charts).toMatch(/requestAnimationFrame/);
    });
    it('reduced-motion disables transitions', () => {
      expect(chartCss).toMatch(/prefers-reduced-motion/);
    });
  });

  describe('S19.09/10: No-response + insufficient evidence + sample threshold', () => {
    it('hasEnoughEvidence threshold check', () => {
      expect(charts).toMatch(/function hasEnoughEvidence/);
      expect(charts).toMatch(/total >= \(threshold/);
    });
    it('insufficient state UI', () => {
      expect(charts).toMatch(/ev-insufficient/);
      expect(chartCss).toMatch(/\.ev-insufficient/);
    });
    it('no-response neutral line', () => {
      expect(charts).toMatch(/data\.noResponse != null/);
      expect(chartCss).toMatch(/\.ev-nr/);
    });
  });

  describe('S19.11: Projector scale', () => {
    it('projector scope (.proj-screen) scales labels >= 1.5rem (24px) and bars >= 24px', () => {
      expect(chartCss).toMatch(/\.proj-screen \.ev-dist-opt\s*\{\s*font-size:\s*1\.5rem/);
      expect(chartCss).toMatch(/\.proj-screen \.ev-dist-track\s*\{\s*height:\s*(2[4-9]|3[0-9])px/);
    });
    it('director stays compact (no data-cast-theme scale leak)', () => {
      expect(chartCss).not.toMatch(/\[data-cast-theme\] \.ev-dist-opt/);
      expect(chartCss).not.toMatch(/\[data-cast-theme\] \.ev-dist-track/);
    });
  });

  describe('S19.12: CSV export', () => {
    it('exportCSV with headers and escaping', () => {
      expect(charts).toMatch(/function exportCSV/);
      expect(charts).toMatch(/text\/csv/);
    });
  });

  describe('Wiring & integration', () => {
    it('head.ejs wires charts css + js', () => {
      expect(head).toContain('/design/components/charts.css');
      expect(head).toContain('/js/components/charts.js');
    });
    it('cast views wire charts css + js', () => {
      expect(directorV).toContain('/design/components/charts.css');
      expect(directorV).toContain('/js/components/charts.js');
      expect(projectorV).toContain('/design/components/charts.css');
      expect(projectorV).toContain('/js/components/charts.js');
    });
    it('director uses CastCharts.distributionBar with sample threshold', () => {
      expect(director).toMatch(/CastCharts\.distributionBar/);
      expect(director).toMatch(/sampleThreshold:\s*3/);
    });
    it('dev demo renders all four charts', () => {
      expect(dev).toMatch(/id="group-charts"/);
      expect(dev).toMatch(/demo-dist/);
      expect(dev).toMatch(/demo-revote/);
      expect(dev).toMatch(/demo-conf/);
      expect(dev).toMatch(/demo-progress/);
    });
  });
});
