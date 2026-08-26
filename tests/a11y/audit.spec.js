/**
 * STYLE STEP 36 — WCAG 2.2 AA axe audit (S36.01/S36.02)
 * -----------------------------------------------------
 * Axe'ni critical flows'ga qo'llaymiz: landing, auth, panel, admin,
 * Cast Setup Studio, Director, Projector, Participant, error/offline.
 *
 * S36.02: Serious/Critical violation -> CI FAILURE.
 * Minor/Moderate -> triage (reported, fail emas).
 *
 * Run:  NODE_ENV=test npx playwright test --project=a11y-audit tests/a11y/
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Offline sahifa — S34.06 reconnect script online'da 600ms keyin reload qiladi,
 *  axe analyze'ni 'execution context destroyed' bilan buzadi. navigator.onLine
 *  false'ga sozlanadi — reload umuman rejalashtirilmaydi; keyingi navigation
 *  requestlari ham abort qilinadi (double safety). */
async function gotoOffline(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    } catch (_) { /* readonly bo'lsa ham zarar yo'q */ }
  });
  await page.goto('/offline');
  await page.route('**', (route) =>
    route.request().isNavigationRequest() ? route.abort() : route.continue(),
  );
}

/** Har bir sahifada axe scan: serious/critical = 0. */
async function scan(page, name) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const violations = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact),
  );

  // Minor/Moderate — triage uchun log (fail emas)
  const triage = results.violations.filter((v) =>
    ['minor', 'moderate'].includes(v.impact),
  );
  if (triage.length) {
    console.log(`[a11y:triage] ${name}: ${triage.map((v) => `${v.id}(${v.impact})`).join(', ')}`);
  }

  expect(violations, `${name}: serious/critical violationlar topildi — ${JSON.stringify(violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })), null, 2)}`).toEqual([]);
  return results;
}

test('S36.01 — Landing (/) axe audit', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await scan(page, 'landing');
});

test('S36.01 — User login (auth) axe audit', async ({ page }) => {
  await page.goto('/user/login');
  await scan(page, 'auth-login');
});

test('B-26 — Register (auth) axe audit', async ({ page }) => {
  await page.goto('/user/login?mode=reg');
  await page.waitForLoadState('networkidle');
  await scan(page, 'auth-register');
});

test('B-26 — Onboarding (auth) axe audit — keyboard journey', async ({ page }) => {
  // Register → onboarding (B-faza asosiy journey). Email verify onboarding'ni
  // bloklamaydi (B-17); onboarding stepper render bo'ladi.
  const uname = `a11y${Date.now()}`;
  await page.goto('/user/register');
  await page.waitForLoadState('networkidle');
  // Register formasi — #reg-* id'lar (B-03 alohida register sahifasi).
  await page.fill('#reg-username', uname);
  await page.fill('#reg-password', 'Str0ng!Pass2026!x'); // B-27: NIST min 15
  await page.fill('#reg-email', `${uname}@test.uz`);
  await page.fill('#reg-name', 'A11y User');
  await page.check('#reg-consent'); // D-24: qonuniy rozilik majburiy — bo'lmasa forma submit bo'lmaydi
  await page.click('#form-reg button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.goto('/onboarding?lang=uz');
  await page.waitForLoadState('networkidle');
  await scan(page, 'onboarding');
});

test('S36.01 — Error sahifasi axe audit', async ({ page }) => {
  const res = await page.goto('/bu-sahifa-yoq-404');
  expect(res.status()).toBe(404);
  await scan(page, 'error-404');
});

test('S36.01 — Offline sahifasi axe audit', async ({ page }) => {
  await gotoOffline(page);
  await scan(page, 'offline');
});

// S36.02: a11y-audit project default colorScheme LIGHT — dark theme ham skanlanadi,
// aks holda dark-only contrast regressiyalari CI'da sezilmay qoladi.
test('S36.02 — Dark theme: Landing axe audit', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await scan(page, 'landing-dark');
});

test('S36.02 — Dark theme: User login axe audit', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/user/login');
  await scan(page, 'auth-login-dark');
});

test('B-26 — Dark theme: Register axe audit', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/user/login?mode=reg');
  await page.waitForLoadState('networkidle');
  await scan(page, 'auth-register-dark');
});

test('S36.02 — Dark theme: Offline axe audit', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await gotoOffline(page);
  await scan(page, 'offline-dark');
});

test('S36.03 — Keyboard-only: play enter form focus trayekti', async ({ page }) => {
  await page.goto('/play');
  // Form'da keyboard focus hech qayerda qolib ketmaydi (BODY'ga tushmaydi)
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? (el.id || el.tagName + '.' + el.className) : 'BODY';
    });
    expect(active, 'Tab trayekti BODY\'da qolib ketdi').not.toBe('BODY');
  }
});

test('S36.06 — 200% zoom reflow: content to\'liq', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  // Hero + CTA hali ham ko'rinadi (function loss yo'q)
  const cta = page.locator('#fLogin button.btn-gold').first(); // cast landing CTA
  await expect(cta).toBeVisible();
});
