/**
 * AUTH D-18 §06 — MFA journey (e2e, Playwright headless)
 * -----------------------------------------------------------------
 *  - Register (student) → panel
 *  - MFA enable (API orqali — UI modal mavjud, lekin e2e'da API yetarli)
 *  - Logout → login → MFA challenge sahifasi (6 xonali single-digit input)
 *  - To'g'ri TOTP → panel; xato kod → inline error (role=alert)
 * webServer: playwright.config.js (fresh temp DB).
 */
import { test, expect } from '@playwright/test';
import { generate } from 'otplib';

const UNIQ = Date.now() % 1000000;

test.describe('AUTH D-18 — MFA journey', () => {
  test('register → MFA enable → login challenge → TOTP → panel', async ({ page }) => {
    const username = `e2e_mfa${UNIQ}`;
    const password = 'parol-2026-x-uzun';

    // Register
    await page.goto('/user/register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-email', `${username}@test.uz`);
    await page.fill('#reg-password', password);
    await page.check('#reg-consent'); // D-24: qonuniy rozilik
    await page.click('#form-reg .auth-submit');
    // Register muvaffaqiyati → panel yoki login (session-regenerate race)
    await page.waitForURL(/\/(user\/(login|panel)|panel)/, { timeout: 20000 });
    if (page.url().includes('/login')) {
      await page.fill('#login-username', username);
      await page.fill('#login-password', password);
      await page.click('.auth-submit');
      await page.waitForURL(/\/user\/panel/, { timeout: 20000 });
    }

    // MFA setup (API — window.fetch CSRF avtomatik)
    const secret = await page.evaluate(async () => {
      const r = await fetch('/api/mfa/totp/setup', { method: 'POST' });
      const j = await r.json();
      return j.ok ? j.secret : null;
    });
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    const code = await generate({ secret });
    const enableOk = await page.evaluate(async (token) => {
      const r = await fetch('/api/mfa/totp/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      return (await r.json()).ok === true;
    }, code);
    expect(enableOk).toBe(true);

    // Logout → login → MFA challenge
    await page.goto('/user/logout');
    await page.goto('/user/login');
    await page.fill('#login-username', username);
    await page.fill('#login-password', password);
    await page.click('.auth-submit');
    await page.waitForURL(/\/user\/mfa/, { timeout: 20000 });

    // 6 xonali single-digit input'larga kod
    const digits = code.split('');
    const inputs = page.locator('#mfa-digits .digit');
    await expect(inputs).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(digits[i]);
    }
    await page.click('#mfa-submit');

    // Muvaffaqiyat → panel
    await page.waitForURL(/\/user\/panel/, { timeout: 20000 });
    await expect(page.locator('#main-content, .panel, .greeting').first()).toBeVisible({ timeout: 15000 });
  });

  test('noto\'g\'ri TOTP → inline xato (role=alert), challenge saqlanadi', async ({ page }) => {
    const username = `e2e_mfa2${UNIQ}`;
    const password = 'parol-2026-x-uzun';

    await page.goto('/user/register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-email', `${username}@test.uz`);
    await page.fill('#reg-password', password);
    await page.check('#reg-consent'); // D-24: qonuniy rozilik
    await page.click('#form-reg .auth-submit');
    await page.waitForURL(/\/(user\/(login|panel)|panel)/, { timeout: 20000 });
    if (page.url().includes('/login')) {
      await page.fill('#login-username', username);
      await page.fill('#login-password', password);
      await page.click('.auth-submit');
      await page.waitForURL(/\/user\/panel/, { timeout: 20000 });
    }
    const secret = await page.evaluate(async () => {
      const r = await fetch('/api/mfa/totp/setup', { method: 'POST' });
      const j = await r.json();
      return j.ok ? j.secret : null;
    });
    const code = await generate({ secret });
    await page.evaluate(async (token) => {
      const r = await fetch('/api/mfa/totp/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      return (await r.json()).ok === true;
    }, code);

    await page.goto('/user/logout');
    await page.goto('/user/login');
    await page.fill('#login-username', username);
    await page.fill('#login-password', password);
    await page.click('.auth-submit');
    await page.waitForURL(/\/user\/mfa/, { timeout: 20000 });

    // Xato kod
    const inputs = page.locator('#mfa-digits .digit');
    const bad = '000000'.split('');
    for (let i = 0; i < 6; i++) await inputs.nth(i).fill(bad[i]);
    await page.click('#mfa-submit');

    // Inline xato (role=alert) ko'rinadi; sahifa o'zgarmaydi
    await expect(page.locator('#mfa-error')).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/user\/mfa/);

    // To'g'ri kod bilan davom etish mumkin (challenge saqlangan)
    const good = code.split('');
    for (let i = 0; i < 6; i++) await inputs.nth(i).fill(good[i]);
    await page.click('#mfa-submit');
    await page.waitForURL(/\/user\/panel/, { timeout: 20000 });
  });
});
