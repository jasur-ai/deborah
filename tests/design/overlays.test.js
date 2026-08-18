// ── STYLE STEP 15 — Dialog, popover, tooltip, toast ──
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const root = process.cwd();
const rd = (p) => readFileSync(join(root, p), 'utf8');

const dlgCss = rd('public/design/components/dialog.css');
const toastCss = rd('public/design/components/toast.css');
const popCss = rd('public/design/components/popover.css');
const tipCss = rd('public/design/components/tooltip.css');
const ovJs = rd('public/js/components/overlays.js');
const mainJs = rd('public/js/main.js');
const head = rd('views/partials/head.ejs');
const panel = rd('views/user/panel.ejs');
const dev = rd('views/dev/components.ejs');
const workspaceLibraryJs = rd('public/js/workspace-library.js');

const css = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('S15.01-03: dialog shell + variants + anatomy', () => {
  it('uses native <dialog> + showModal', () => {
    expect(ovJs).toMatch(/createElement\('dialog'\)|document\.createElement\("dialog"\)/);
    expect(ovJs).toMatch(/showModal\(\)/);
  });

  it('has sm/md/lg/full variants', () => {
    for (const v of ['dialog--sm', 'dialog--md', 'dialog--lg', 'dialog--full']) {
      expect(css(dlgCss)).toContain(v);
    }
  });

  it('close button 44px, body scroll, sticky footer', () => {
    expect(css(dlgCss)).toMatch(/\.dialog__close[\s\S]{0,200}44px/);
    expect(css(dlgCss)).toMatch(/overflow-y:\s*auto/);
    expect(css(dlgCss)).toMatch(/position:\s*sticky/);
  });
});

describe('S15.04-05: focus policy + dismiss', () => {
  it('initial focus on cancel, not danger action', () => {
    expect(ovJs).toMatch(/data-no/);
    expect(ovJs).toMatch(/\.focus\(\)/);
  });

  it('Escape (cancel event) + overlay click + trigger restore', () => {
    expect(ovJs).toMatch(/'cancel'/);
    expect(ovJs).toMatch(/e\.target === dlg/);
    expect(ovJs).toMatch(/__trigger/);
    expect(ovJs).toMatch(/prev\.focus/);
  });
});

describe('S15.06: dialog motion', () => {
  it('enter 200-220ms, exit 140-160ms, reduced-motion', () => {
    expect(css(dlgCss)).toMatch(/200ms|220ms/);
    expect(css(dlgCss)).toMatch(/150ms|140ms|160ms/);
    expect(css(dlgCss)).toMatch(/prefers-reduced-motion/);
  });
});

describe('S15.07: popover/menu', () => {
  it('trigger aria-expanded, arrow nav, Escape, outside click', () => {
    expect(ovJs).toMatch(/aria-expanded/);
    expect(ovJs).toMatch(/ArrowDown|ArrowUp/);
    expect(ovJs).toMatch(/'Escape'/);
    expect(ovJs).toMatch(/outside|!target\.contains\(e\.target\)/);
  });

  it('popover items + separator in CSS', () => {
    expect(css(popCss)).toMatch(/\.popover__item/);
    expect(css(popCss)).toMatch(/\.popover__sep/);
  });
});

describe('S15.08: tooltip', () => {
  it('non-interactive, aria-describedby, supplemental only', () => {
    expect(css(tipCss)).toMatch(/pointer-events:\s*none/);
    expect(ovJs).toMatch(/aria-describedby/);
    expect(css(tipCss)).toMatch(/max-width/);
  });
});

describe('S15.09-10: toast', () => {
  it('4 variants + critical error role=alert', () => {
    for (const v of ['toast--success', 'toast--info', 'toast--warning', 'toast--error']) {
      expect(css(toastCss)).toContain(v);
    }
    expect(ovJs).toMatch(/role', 'alert'|role.*alert/);
  });

  it('desktop top-right, mobile bottom safe-area, max 3', () => {
    expect(css(toastCss)).toMatch(/top:\s*16px/);
    expect(css(toastCss)).toMatch(/right:\s*16px/);
    expect(css(toastCss)).toMatch(/safe-area-inset-bottom/);
    expect(ovJs).toMatch(/children\.length >= 3|children\.length>=3/);
  });
});

describe('S15.11: inline CSS/HTML ko\'chirilgan', () => {
  it('main.js has no inline visual cssText', () => {
    expect(mainJs).not.toMatch(/style\.cssText/);
    expect(mainJs).not.toMatch(/function showToast|function showConfirm/);
  });

  it('overlays.js is loaded after main.js in head', () => {
    const mainIdx = head.indexOf('/js/main.js');
    const ovIdx = head.indexOf('components/overlays.js');
    expect(mainIdx).toBeGreaterThan(-1);
    expect(ovIdx).toBeGreaterThan(mainIdx);
  });
});

describe('S15.12: panel.ejs migrated + demo', () => {
  it('panel.ejs eski confirm-modal olib tashlandi, global showConfirm ishlatiladi', () => {
    expect(panel).not.toMatch(/id="confirm-modal"/);
    // S26.04: Delete confirmation workspace-library.js'ga ko'chdi
    // (global showConfirm orqali) — panel'da eski inline confirm yo'q.
    expect(workspaceLibraryJs).toMatch(/showConfirm\(/);
    expect(panel).not.toMatch(/await showConfirm\(/);
  });

  it('dev preview has overlay demos', () => {
    expect(dev).toMatch(/data-popover/);
    expect(dev).toMatch(/data-tooltip/);
    expect(dev).toMatch(/data-toast-success/);
    expect(dev).toMatch(/data-confirm-demo/);
  });
});
