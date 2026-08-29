/**
 * MFA journey (e2e, Playwright headless) — 2026-08-27 YANGI SPEKS
 * -----------------------------------------------------------------
 * Foydalanuvchi qarori: Authenticator (MFA) FAQAT admin va o'qituvchi
 * uchun. Oddiy (student/VIP) user:
 *   - parol bilan kiradi (MFA challenge YO'Q)
 *   - security-profile'da MFA kartasi o'rniga "kerak emas" matni
 *   - /api/mfa/totp/setup → 403 mfa_not_allowed
 *   - Profilim: zaxira kodlar bo'limi "kerak emas" matni
 * (Teacher/admin MFA challenge UI — /user/mfa digits — integration
 *  qamrovda: tests/integration/auth-a26.test.js)
 */
import { test, expect } from '@playwright/test';

const UNIQ = Date.now() % 1000000;

test.describe('MFA — student uchun yo\u2018q (yangi spec)', () => {
  test('register → parol bilan panel → MFA UI/API bloklangan', async ({ page }) => {
    const username = `e2e_st${UNIQ}`;
    const password = 'parol-2026-x-uzun';

    // Register
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

    // 1) API: talaba MFA yoqolmaydi
    const setupStatus = await page.evaluate(async () => {
      const r = await fetch('/api/mfa/totp/setup', { method: 'POST' });
      return { status: r.status, body: await r.json() };
    });
    expect(setupStatus.status).toBe(403);
    expect(setupStatus.body.error).toBe('mfa_not_allowed');

    // 2) security-profile: MFA kartasi o'rniga "kerak emas" matni
    await page.goto('/user/security-profile');
    await expect(page.getByText(/kerak emas/i).first()).toBeVisible({ timeout: 10000 });
    // MFA kartasi (talaba uchun) yo'q
    await expect(page.locator('#mfa-card')).toHaveCount(0);

    // 3) Profilim: zaxira kodlar bo'limida ham "kerak emas"
    await page.goto('/user/profile');
    await expect(page.getByText(/kerak emas/i).first()).toBeVisible({ timeout: 10000 });

    // 4) Logout → parol bilan kirish MFA challengesiz panelga
    // S28: GET /user/logout — darhol chiqish (D-17 §06), confirm tugmasi yo'q
    await page.goto('/user/logout');
    await page.goto('/user/login');
    await page.fill('#login-username', username);
    await page.fill('#login-password', password);
    await page.click('.auth-submit');
    await page.waitForURL(/\/user\/panel/, { timeout: 20000 });
    await expect(page).toHaveURL(/\/user\/panel/);
  });
});
