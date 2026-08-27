/**
 * AUTH D-14 §09 — Critical auth journey (e2e, Playwright headless)
 * -----------------------------------------------------------------
 *  - Register (student) → login → panel
 *  - Teacher register → teacher-approval sahifasi
 *  - Admin login → dashboard (KPI render)
 *  - Mobile 390px: login CTA above fold (D-13)
 * webServer: playwright.config.js (fresh temp DB, test credential'lar).
 */
import { test, expect } from '@playwright/test';

const UNIQ = Date.now() % 1000000;

test.describe('AUTH D-14 — critical journey', () => {
  test('student: register → login → panel', async ({ page }) => {
    const username = `e2e_s${UNIQ}`;
    const password = 'parol-2026-x-uzun';

    // Register
    await page.goto('/user/register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-email', `${username}@test.uz`);
    await page.fill('#reg-password', password);
    await page.check('#reg-consent'); // AUTH D-24: qonuniy rozilik majburiy
    await page.click('#form-reg .auth-submit');
    // Register muvaffaqiyati → panel (sessiya o'rnatiladi)
    await page.waitForURL(/\/(user\/(login|panel)|panel)/, { timeout: 20000 });
    // Agar panelga tushgan bo'lsak, logout qilamiz (login oqimini ham tekshiramiz)
    if (page.url().includes('/panel')) {
      await page.goto('/user/logout'); // logout → bosh sahifa (sessiya tozalanadi)
      await page.locator('#logout-confirm-btn').click().catch(() => {}); // BUG-032: POST tasdiq
    }

    // Login
    await page.goto('/user/login');
    await page.fill('#login-username', username);
    await page.fill('#login-password', password);
    await page.click('.auth-submit');
    await page.waitForURL(/\/user\/panel/, { timeout: 20000 });
    await expect(page.locator('#main-content, .panel, .greeting').first()).toBeVisible({ timeout: 15000 });
  });

  test('teacher: register → teacher-approval sahifasi', async ({ page }) => {
    const username = `e2e_t${UNIQ}`;
    await page.goto('/user/register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-email', `${username}@test.uz`);
    await page.fill('#reg-password', 'parol-2026-x-uzun');
    await page.check('#reg-consent'); // AUTH D-24: qonuniy rozilik majburiy
    // B-03: rol tanlovi radio (checkbox emas) — radio ustida .role-ico span
    // yopib turibdi, shuning uchun label'ni bosamiz (radio togglenadi)
    await page.locator('label.role-card:has(input[value="teacher"])').click();
    // Teacher maydonlari (B-29) ko'rinadigan bo'ladi
    await page.fill('#reg-university', 'TATU');
    await page.fill('#reg-subject', 'Informatika');
    await page.fill('#reg-reason', 'Dars beraman');
    await page.click('#form-reg .auth-submit');
    await page.waitForURL(/\/user\/teacher-approval/, { timeout: 20000 });
    await expect(page.locator('.ta-main, .ta-title, main').first()).toBeVisible({ timeout: 15000 });
  });

  test('admin: login → dashboard KPI', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('#username, input[name="username"]', 'admin');
    await page.fill('#password, input[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 20000 });
    await expect(page.locator('.stat-num').first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('AUTH D-13/§14 — mobile', () => {
  test('login CTA 390px viewportda above fold', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/user/login');
    const btn = page.locator('.auth-submit').first();
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    // CTA viewport ichida (above fold) — 844px balandlikda
    expect(box.y + box.height).toBeLessThan(844);
  });
});
