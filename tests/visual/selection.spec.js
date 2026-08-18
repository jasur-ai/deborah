/**
 * STEP 14 — Selection, tabs va accordion E2E (S14.01–S14.12)
 * ------------------------------------------------------------
 * Sahifa: /_dev/components (#group-selection, #group-tabs, #group-accordion)
 *  - S14.01/02: native semantics + selectable card
 *  - S14.03: selected state — 2px cobalt border + marker (color-only emas)
 *  - S14.04: disabled — aria-describedby inline explanation (opacity-only emas)
 *  - S14.07: tabs arrow-key nav, Home/End, roving tabindex
 *  - S14.09/10: accordion button + aria-expanded/controls; reduced-motion
 *  - S14.12: keyboard + high-contrast
 */
import { test, expect } from '@playwright/test';
import { openThemedContext, stabilize } from './visual.helper.js';

const THEME_LIST = ['light', 'dark'];

test.describe('Selection preview', () => {
  for (const theme of THEME_LIST) {
    test(`S14: radio/checkbox/switch/card states — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S14.01: native semantics — radio checked works (label click = real user)
      await expect(page.locator('input[name="s14-radio"][value="a"]')).toBeChecked();
      await page.locator('label.choice:has(input[name="s14-radio"][value="b"])').click();
      await expect(page.locator('input[name="s14-radio"][value="b"]')).toBeChecked();
      await expect(page.locator('input[name="s14-radio"][value="a"]')).not.toBeChecked();

      // checkbox independent
      const cb = page.locator('input[name="s14-check"]');
      await expect(cb).toBeChecked();
      await page.locator('label.choice:has(input[name="s14-check"])').click();
      await expect(cb).not.toBeChecked();

      // switch role=switch
      await expect(page.locator('#s14-switch')).toHaveAttribute('role', 'switch');

      // S14.03: selectable card — selected 2px cobalt border (not color-only):
      // border-width 2px + marker visible on selected card
      const selCard = page.locator('input[name="s14-card"][value="compact"] + .select-card__body');
      const selBorder = await selCard.evaluate((el) => getComputedStyle(el).borderTopWidth);
      expect(parseFloat(selBorder)).toBeGreaterThanOrEqual(2);
      const marker = await selCard.locator('.select-card__mark').evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(marker).not.toBe('rgba(0, 0, 0, 0)');

      // S14.04: disabled card — aria-describedby + explanation visible (not opacity-only)
      await expect(page.locator('input[name="s14-card"][value="disabled"]')).toBeDisabled();
      await expect(page.locator('input[name="s14-card"][value="disabled"]')).toHaveAttribute('aria-describedby', 's14-card-disabled-note');
      await expect(page.locator('#s14-card-disabled-note')).toBeVisible();

      // S14.11: no interactive link inside select-card label
      const nested = await page.locator('.select-card a, .select-card button').count();
      expect(nested).toBe(0);

      await expect(page).toHaveScreenshot(`selection--preview--${theme}--desktop.png`, { fullPage: true });
      await ctx.close();
    });

    test(`S14: tabs arrow-nav + accordion — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, theme, 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S14.07: tablist roles + roving tabindex
      await expect(page.locator('#group-tabs [role="tablist"]')).toHaveCount(1);
      await expect(page.locator('#t-a')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#t-a')).toHaveJSProperty('tabIndex', 0);
      await expect(page.locator('#t-b')).toHaveJSProperty('tabIndex', -1);

      // Arrow-key navigation — focus moves, selection follows on Enter
      await page.locator('#t-a').focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#t-b')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('#t-b')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#tp-b')).not.toBeHidden();
      await expect(page.locator('#tp-a')).toBeHidden();

      // Home/End
      await page.keyboard.press('End');
      await expect(page.locator('#t-c')).toBeFocused();
      await page.keyboard.press('Home');
      await expect(page.locator('#t-a')).toBeFocused();

      // S14.09: accordion button + aria-expanded + aria-controls
      const trig1 = page.locator('#acc-1').locator('xpath=preceding-sibling::h3').locator('button.accordion__trigger');
      await expect(trig1).toHaveAttribute('aria-expanded', 'true');
      await expect(trig1).toHaveAttribute('aria-controls', 'acc-1');
      // Toggle close
      await trig1.click();
      await expect(trig1).toHaveAttribute('aria-expanded', 'false');

      // S14.10: no div onclick (header is a button)
      const divClickAccordion = await page.locator('[data-accordion] div[onclick]').count();
      expect(divClickAccordion).toBe(0);

      await ctx.close();
    });

    test(`S14: high-contrast marks — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-desktop', 'desktop only');
      const ctx = await openThemedContext(browser, 'high-contrast-light', 'app-desktop');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S14.05: forced-colors — marks still visible (border paint)
      const mark = page.locator('input[name="s14-radio"][value="a"] + .choice__mark').first();
      const border = await mark.evaluate((el) => getComputedStyle(el).borderColor);
      expect(border).not.toBe('rgba(0, 0, 0, 0)');

      await ctx.close();
    });

    test(`S14: keyboard only tabs (no mouse) — ${theme}`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'app-mobile', 'mobile only');
      const ctx = await openThemedContext(browser, theme, 'app-mobile');
      const page = await ctx.newPage();
      await page.goto('/_dev/components', { waitUntil: 'domcontentloaded' });
      await stabilize(page);

      // S14.12: touch — choices 48px min-height
      const radio = page.locator('.choice').first();
      const box = await radio.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(48);

      // Space activates tab
      await page.locator('#t-a').focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press(' ');
      await expect(page.locator('#t-b')).toHaveAttribute('aria-selected', 'true');

      await ctx.close();
    });
  }
});
