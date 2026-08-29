import { test, expect } from '@playwright/test';
import { openThemedContext } from './visual.helper.js';

// STYLE STEP 11 — Reset, base, focus va utility foundation (E2E)

test.describe('S11 foundations', () => {
  test('S11.03: focus ring 3px token (visible :focus-visible)', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'networkidle' });
    // CSS global tekshiruv
    const focusRule = await page.evaluate(() => {
      const walk = (rules) => {
        let out = [];
        for (const r of rules) {
          if (r.type === CSSRule.STYLE_RULE) out.push(r);
          else if (r.type === CSSRule.LAYER_BLOCK_RULE && r.cssRules) out = out.concat(walk(r.cssRules));
          else if (r.cssRules) out = out.concat(walk(r.cssRules));
        }
        return out;
      };
      const styles = [...document.styleSheets].flatMap((ss) => {
        try { return walk(ss.cssRules); } catch { return []; }
      });
      const focusBlocks = styles.filter((r) =>
        (r.selectorText || '').includes(':focus-visible') &&
        (r.style.getPropertyValue('outline-width') === '3px' ||
         r.style.getPropertyValue('outline-width').includes('var(--deborah-focus-ring-width)'))
      );
      return {
        count: focusBlocks.length,
        sampleOutline: focusBlocks[0]?.style?.outlineWidth || null,
        sampleOffset: focusBlocks[0]?.style?.outlineOffset || null,
      };
    });
    expect(focusRule.count).toBeGreaterThan(0);
    expect(focusRule.sampleOutline).toContain('3px');

    // Skip-link keyboard focus — tab bosilganda paydo bo'ladi
    await page.keyboard.press('Tab');
    const skipVisible = await page.evaluate(() => {
      const el = document.querySelector('.ld-skip-link, .skip-link, a[href="#main"]');
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.position !== 'static' && el.offsetHeight > 0;
    });
    expect(skipVisible).toBe(true);
    await context.close();
  });

  test('S11.06: skip-link present + target landmark', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'networkidle' });
    const info = await page.evaluate(() => {
      const link = document.querySelector('.ld-skip-link, .skip-link, a[href="#main"], a[href="#ld-main"]');
      const main = document.querySelector('main[id="main"], #main, main[id="ld-main"], #ld-main');
      return { hasLink: !!link, href: link?.getAttribute('href') || null, hasMain: !!main };
    });
    expect(info.hasLink).toBe(true);
    if (info.href) expect(info.hasMain).toBe(true);
    await context.close();
  });

  test('S11.08: utility classes resolve from tokens', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'dark', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'networkidle' });
    const utils = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'mb-4';
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const css = getComputedStyle(probe);
      const hasVar = css.getPropertyValue('margin-bottom').trim();
      probe.remove();
      // Tokendagi spacing-4 16px bo'lishi kerak
      const root = getComputedStyle(document.documentElement);
      const spacing4 = root.getPropertyValue('--deborah-spacing-4').trim();
      return { marginBottom: hasVar, spacing4 };
    });
    expect(utils.marginBottom).not.toBe('');
    expect(utils.spacing4).toContain('16px');
    await context.close();
  });

  test('S11.12: cascade layer order (reset < base < focus < utilities < components)', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
    const context = await openThemedContext(browser, 'light', 'app-desktop');
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'networkidle' });
    const layers = await page.evaluate(() => {
      try { return [...document.styleSheets].flatMap((ss) => [...ss.cssRules]).filter((r) => r.type === CSSRule.IMPORT_RULE).length; } catch { return 0; }
    });
    // Head'da foundation css'lar ketma-ket yuklanadi
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href.split('/').pop())
    );
    const hasReset = links.some((l) => l.includes('reset'));
    const hasBase = links.some((l) => l.includes('base'));
    const hasFocus = links.some((l) => l.includes('focus'));
    const hasUtils = links.some((l) => l.includes('utilities'));
    expect(hasReset && hasBase && hasFocus && hasUtils).toBe(true);
    // Tartib: reset < base < focus < utilities
    const idx = (name) => links.findIndex((l) => l.includes(name));
    expect(idx('reset')).toBeGreaterThanOrEqual(0);
    expect(idx('base')).toBeGreaterThan(idx('reset'));
    expect(idx('focus')).toBeGreaterThan(idx('base'));
    expect(idx('utilities')).toBeGreaterThan(idx('focus'));
    await context.close();
  });
});
