// ── STYLE STEP 16 — Loading, progress, empty, error, offline states ──
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const root = process.cwd();
const rd = (p) => readFileSync(join(root, p), 'utf8');

const skCss = rd('public/design/components/skeleton.css');
const prCss = rd('public/design/components/progress.css');
const esCss = rd('public/design/components/empty-state.css');
const msgCss = rd('public/design/components/message.css');
const offCss = rd('public/design/components/offline.css');
const mainJs = rd('public/js/main.js');
const offJs = rd('public/js/components/offline-banner.js');
const errView = rd('views/error.ejs');
const errMw = rd('middleware/error.js');
const head = rd('views/partials/head.ejs');
const dev = rd('views/dev/components.ejs');

const css = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('S16.01-03: loader + skeleton', () => {
  it('inline spinner + determinate progress', () => {
    expect(css(prCss)).toMatch(/\.spinner/);
    expect(css(prCss)).toMatch(/\.progress__bar/);
  });

  it('skeleton structured contexts (card/list/table) only', () => {
    expect(css(skCss)).toMatch(/skeleton--card/);
    expect(css(skCss)).toMatch(/skeleton--list-item/);
    expect(css(skCss)).toMatch(/skeleton--table-row/);
  });

  it('shimmer off under reduced-motion', () => {
    expect(css(skCss)).toMatch(/prefers-reduced-motion/);
    expect(css(skCss)).toMatch(/animation:\s*none/);
  });
});

describe('S16.04: button pending state', () => {
  it('setPending keeps width + label, blocks duplicate submit', () => {
    expect(mainJs).toMatch(/function setPending/);
    expect(mainJs).toMatch(/minWidth/);
    expect(mainJs).toMatch(/disabled = true/);
    expect(mainJs).toMatch(/__pending/);
    expect(mainJs).toMatch(/aria-busy/);
  });
});

describe('S16.05-07: empty states', () => {
  it('5 tur: first-use/no-results/permission/system-error/completion', () => {
    expect(css(esCss)).toMatch(/\.empty-state/);
    expect(css(esCss)).toMatch(/empty-state--no-results/);
    expect(css(esCss)).toMatch(/empty-state--permission/);
    expect(css(esCss)).toMatch(/empty-state--system-error/);
    expect(css(esCss)).toMatch(/empty-state--completion/);
  });

  it('first-use: title + value + action; no-results: query + clear', () => {
    expect(css(esCss)).toMatch(/empty-state__title/);
    expect(css(esCss)).toMatch(/empty-state__actions/);
    expect(css(esCss)).toMatch(/empty-state__query/);
  });
});

describe('S16.08: error message format', () => {
  it('error format structure: title + actions', () => {
    expect(css(msgCss)).toMatch(/message__title/);
    expect(css(msgCss)).toMatch(/message__actions/);
    expect(css(msgCss)).toMatch(/message--error/);
  });

  it('raw stack only in dev, null in prod', () => {
    expect(errMw).toMatch(/process\.env\.NODE_ENV === 'production' \? null : err\.stack/);
    expect(errView).toMatch(/isDev/);
  });
});

describe('S16.09-10: offline', () => {
  it('pending ops saqlanadi, reconnect progress, retry/cancel', () => {
    expect(offJs).toMatch(/pendingOps/);
    expect(offJs).toMatch(/setProgress/);
    expect(offJs).toMatch(/retry/);
    expect(offJs).toMatch(/cancel/);
  });

  it('banner full-screen emas — fixed top', () => {
    expect(css(offCss)).toMatch(/position:\s*fixed/);
    expect(css(offCss)).toMatch(/top:\s*0/);
  });
});

describe('S16.11: aria semantics', () => {
  it('aria-busy + live status + progress semantics', () => {
    expect(mainJs).toMatch(/aria-busy/);
    expect(offJs).toMatch(/role', 'status'/);
    expect(dev).toMatch(/role="progressbar"/);
    expect(dev).toMatch(/aria-valuenow/);
  });
});

describe('S16.12: integration', () => {
  it('head.ejs imports all state assets', () => {
    for (const c of ['skeleton.css', 'progress.css', 'empty-state.css', 'message.css', 'offline.css', 'components/offline-banner.js']) {
      expect(head).toContain(c);
    }
  });

  it('dev preview renders all state demos', () => {
    expect(dev).toMatch(/group-states/);
    expect(dev).toMatch(/skeleton--title/);
    expect(dev).toMatch(/empty-state--no-results/);
    expect(dev).toMatch(/message--error/);
    expect(dev).toMatch(/data-offline-demo/);
  });
});
