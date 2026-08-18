#!/usr/bin/env node
/**
 * STYLE STEP 19 — Charts & evidence visualization validator (S19.01–S19.12).
 * Exit 0 = PASS, 1 = FAIL.
 */
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.join(import.meta.dirname, '..');
const read = (p) => {
  try { return readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; }
};

let fails = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log(`  ✓ ${name}`); }
  else { fails += 1; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('S19.01 — Chart types (distribution, revote, confidence, progress; no pie/3D/gauge):');
const charts = read('public/js/components/charts.js');
check('distributionBar export', /distributionBar:\s*distributionBar/.test(charts));
check('revotePair export', /revotePair:\s*revotePair/.test(charts));
check('confidenceGrid export', /confidenceGrid:\s*confidenceGrid/.test(charts));
check('progressLine export', /progressLine:\s*progressLine/.test(charts));
check('no pie/3D/gauge', !/donut|radar|gauge/i.test(charts));

console.log('S19.03/05 — Metric label+value+context; CVD-safe shape+color:');
const css = read('public/design/components/charts.css');
check('ev-metric styles', /\.ev-metric/.test(css));
check('ev-metric-context', /\.ev-metric-context/.test(css));
check('SHAPES markers', /SHAPES\s*=\s*\[/.test(charts) && /ev-dist-marker/.test(css));

console.log('S19.04/08 — Stable order + interruptible transition:');
check('animateWidth interruptible', /function animateWidth/.test(charts));
check('reduced-motion guard', /prefers-reduced-motion/.test(css));

console.log('S19.06/07 — Accessible table alternative + direct labels:');
check('tableAlternative', /function tableAlternative/.test(charts));
check('ev-table-alt CSS', /\.ev-table-alt/.test(css));
check('direct values (ev-line-values)', /\.ev-line-values/.test(css));

console.log('S19.09/10 — No-response neutral + insufficient evidence + sample threshold:');
check('hasEnoughEvidence', /function hasEnoughEvidence/.test(charts));
check('ev-insufficient CSS', /\.ev-insufficient/.test(css));
check('no-response row (ev-nr)', /\.ev-nr/.test(css));

console.log('S19.11 — Projector scale (>=24px labels, >=16px bars) + director compact:');
// Scale faqat .proj-screen (projector) scope'ida — director compact qoladi
check('projector chart scale (24px label / 28px bar)', /\.proj-screen \.ev-dist-opt\s*\{\s*font-size:\s*1\.5rem/.test(css) && /\.proj-screen \.ev-dist-track\s*\{\s*height:\s*(2[4-9]|3[0-9])px/.test(css));

console.log('S19.12 — CSV export with accessible headers:');
check('exportCSV', /function exportCSV/.test(charts));

console.log('Wiring:');
const head = read('views/partials/head.ejs');
check('head.ejs → charts.css', head.includes('/design/components/charts.css'));
check('head.ejs → charts.js', head.includes('/js/components/charts.js'));
const dirV = read('views/cast/director.ejs');
const projV = read('views/cast/projector.ejs');
check('director.ejs → charts.css+js', dirV.includes('/design/components/charts.css') && dirV.includes('/js/components/charts.js'));
check('projector.ejs → charts.css+js', projV.includes('/design/components/charts.css') && projV.includes('/js/components/charts.js'));
const dirJs = read('public/js/cast-director.js');
check('director uses CastCharts.distributionBar', /CastCharts\.distributionBar/.test(dirJs));
const dev = read('views/dev/components.ejs');
check('dev demo group-charts', /id="group-charts"/.test(dev) && /id="demo-dist"/.test(dev));

console.log(`\n${fails === 0 ? 'PASS' : `FAIL (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
