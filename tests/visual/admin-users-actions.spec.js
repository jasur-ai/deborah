import { test, expect } from '@playwright/test';

async function signInAdmin(page) {
  await page.goto('/admin/login');
  await page.locator('#admin-username').fill('admin');
  await page.locator('#admin-password').fill('admin');
  await page.locator('form.auth-form button[type="submit"]').click();
  await page.waitForURL(/\/admin\/dashboard(?:$|\?)/, { timeout: 15000 });
}

test('admin user actions menu and delete confirmation are accessible and viewport-safe', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await signInAdmin(page);
  await page.goto('/admin/users');
  const row = page.locator('#users-tbody tr.dt-row').first();
  await expect(row).toBeVisible({ timeout: 10000 });
  const username = (await row.locator('.font-bold').textContent()).trim();
  const primaryAction = row.locator('.user-primary-action');
  const trigger = row.locator('[data-users-action="toggle-user-menu"]');
  const menuId = await trigger.getAttribute('aria-controls');
  const menu = page.locator('#' + menuId);
  await expect(primaryAction).toHaveCount(1);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await row.locator('[onclick], [onchange]').count()).toBe(0);

  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(page.viewportSize().width + 1);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(menu).toBeVisible();
  await trigger.click();
  await expect(menu).toBeHidden();
  await trigger.click();
  await expect(menu).toBeVisible();
  await menu.locator('[data-user-action="delete"]').click();
  const dialog = page.getByRole('dialog', { name: "Foydalanuvchini o'chirish" });
  await expect(dialog).toBeVisible();
  const confirmation = dialog.locator('#delete-confirm-input');
  const confirmButton = dialog.locator('#delete-confirm');
  await confirmation.fill('not-the-username');
  await expect(confirmButton).toBeDisabled();
  await confirmation.fill(username);
  await expect(confirmButton).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  const viewportWidth = page.viewportSize().width;
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(viewportWidth + 1);
  expect(pageErrors).toEqual([]);
});

test('delete step-up uses server redirect and resumes confirmation after MFA', async ({ page }) => {
  let deleteRequests = 0;
  await page.route('**/admin/api/users/delete', async (route) => {
    deleteRequests += 1;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'mfa_stepup_required', redirect: '/admin/mfa/stepup' }),
    });
  });
  await page.route('**/api/admin/mfa/stepup', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await signInAdmin(page);
  await page.goto('/admin/users');
  const row = page.locator('#users-tbody tr.dt-row').first();
  await expect(row).toBeVisible();
  const username = (await row.locator('.font-bold').textContent()).trim();
  const userKey = await row.locator('.user-primary-action').getAttribute('data-user-key');
  const trigger = row.locator('[data-users-action="toggle-user-menu"]');
  await trigger.click();
  const menuId = await trigger.getAttribute('aria-controls');
  await page.locator('#' + menuId).locator('[data-user-action="delete"]').click();

  const deleteDialog = page.getByRole('dialog', { name: "Foydalanuvchini o'chirish" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.locator('#delete-confirm-input').fill(username);
  await deleteDialog.locator('#delete-confirm').click();
  await page.waitForURL(/\/admin\/mfa\/stepup\?/);
  await expect(page.getByText('Xavfsizlik uchun qayta tasdiqlang')).toBeVisible();
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('adminUsersPendingDeleteAfterMfa')));
  expect(pending.key).toBe(userKey);
  expect(pending.name).toBe(username);

  await page.locator('#code').fill('123456');
  await page.locator('#btn').click();
  await page.waitForURL(/\/admin\/users(?:\?|$)/);
  await expect(page.getByRole('dialog', { name: "Foydalanuvchini o'chirish" })).toBeVisible();
  await expect(page.locator('#delete-confirm-input')).toHaveValue('');
  await expect(page.locator('#delete-user-label')).toHaveText(username);
  expect(await page.evaluate(() => sessionStorage.getItem('adminUsersPendingDeleteAfterMfa'))).toBeNull();
  expect(deleteRequests).toBe(1); // MFA kechasi yana bir marta ochiqcha tasdiqlash kerak; auto-delete yo'q.
});
