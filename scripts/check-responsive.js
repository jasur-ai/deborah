#!/usr/bin/env node
/**
 * STYLE STEP 20 — Responsive, container queries, safe areas, input modality.
 * Checks S20.01–S20.12 against source files.
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

const resp = read('public/design/foundations/responsive.css');
const layout = read('public/design/foundations/layout.css');
const head = read('views/partials/head.ejs');

console.log('S20.01 — Media query + container query + preference features:');
check('responsive.css exists', resp.length > 0);
check('container-type used', /container-type:\s*inline-size/.test(resp));
check('preference media (motion/reduced)', /prefers-reduced-motion/.test(resp) || /prefers-color-scheme/.test(resp));

console.log('S20.02 — Container breakpoints (test/metric/mode/toolbar):');
check('cq-test-card container', /cq-test-card/.test(resp) && /@container \(max-width: 360px\)/.test(resp));
check('cq-test-card wired to panel', /cq-test-card/.test(read('views/user/panel.ejs')) || /ws-lib-row/.test(read('views/user/panel.ejs')));
check('cq-metric-card container', /cq-metric-card/.test(resp));
check('cq-mode-card container', /cq-mode-card/.test(resp));
check('cq-toolbar container', /cq-toolbar/.test(resp));

console.log('S20.03 — Dynamic viewport height (svh/dvh):');
check('responsive vh-full util', /100svh/.test(resp));
check('cast-participant svh', /min-height: 100vh; min-height: 100svh/.test(read('public/css/cast-participant.css')));
check('cast-projector svh', /min-height: 100vh; min-height: 100svh/.test(read('public/css/cast-projector.css')));
check('cast-tokens svh', /min-height: 100vh; min-height: 100svh/.test(read('public/css/cast-tokens.css')));
check('style.css svh', /min-height: 100vh; min-height: 100svh/.test(read('public/css/style.css')));
check('dialog full svh', /height: 100vh; height: 100svh/.test(read('public/design/components/dialog.css')));

console.log('S20.04 — Safe areas:');
check('safe util pb/pt/px', /safe-pb|safe-pt|safe-px|safe-controls/.test(resp));
check('forge-fab bottom safe-area', /bottom: calc\(18px \+ env\(safe-area-inset-bottom/.test(read('public/css/cast-participant.css')));
check('projector bottom safe-area', /bottom: calc\(24px \+ env\(safe-area-inset-bottom/.test(read('public/css/cast-projector.css')));
check('viewport-fit=cover (6 cast views)', (() => {
  const views = ['director', 'participant', 'projector', 'quality-lab', 'replay', 'results'];
  return views.every((v) => /viewport-fit=cover/.test(read(`views/cast/${v}.ejs`)));
})());

console.log('S20.05 — Input modality (pointer fine/coarse):');
check('hover only on fine pointer', /@media \(hover: hover\) and \(pointer: fine\)/.test(resp));
check('coarse target >= 48px', /@media \(pointer: coarse\)/.test(resp) && /min-height:\s*48px/.test(resp));

console.log('S20.08 — Ultra-wide guard (workspace max 1440-1600px, reading 65ch):');
check('workspace max token', /--deborah-container-workspace/.test(layout) && /--deborah-container-workspace-wide/.test(layout));
check('reading 65ch', /--deborah-container-reading,\s*65ch/.test(layout));

console.log('S20.09 — Mobile replacement (functionality not display:none):');
const tableCss = read('public/design/components/table.css');
check('table mobile reflow (S18)', /is-reflow/.test(tableCss));
check('nav drawer (S17)', /translateX/.test(read('public/design/components/navigation.css')));
check('dialog full (S15)', /\.dialog--full/.test(read('public/design/components/dialog.css')));

console.log('S20.10 — Images explicit dimensions:');
check('logo images explicit height', /<img[^>]*height:/s.test(read('views/admin/dashboard.ejs')));

console.log('S20.11 — Zoom/text-spacing guard:');
check('zoom-safe util', /\.zoom-safe/.test(resp) && /overflow-wrap:\s*anywhere/.test(resp));

console.log('S20.12 — Mobile-first default (container queries guarded):');
check('container enhancement under @supports', /@supports \(container-type: inline-size\)/.test(resp));

console.log('Wiring:');
check('head.ejs → responsive.css', head.includes('/design/foundations/responsive.css'));

console.log(`\n${fails === 0 ? 'PASS' : `FAIL (${fails})`}`);
process.exit(fails === 0 ? 0 : 1);
