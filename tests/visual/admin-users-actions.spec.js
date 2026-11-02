import { test, expect } from '@playwright/test';

// API assertions below use page.route; service-worker-controlled fetches bypass routes.
test.use({ serviceWorkers: 'block' });

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
  await expect(page.locator('script[src*="admin-users-20261102-r2"]')).toHaveCount(1);
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
  expect(deleteRequests).toBe(1); // qaytgach yangi username tasdig'isiz avtomatik delete bo'lmaydi.
});

test('admin users next-page control loads the next 25-user page', async ({ page }) => {
  await signInAdmin(page);
  const requestedPages = [];
  await page.route(/\/admin\/api\/users(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const current = Number(url.searchParams.get('page')) || 1;
    requestedPages.push(current);
    const firstIndex = (current - 1) * 25;
    const users = Array.from({ length: Math.min(25, 26 - firstIndex) }, (_, index) => {
      const n = firstIndex + index + 1;
      return {
        key: `paged_user_${n}`,
        username: `paged-user-${n}`,
        name: `Paged User ${n}`,
        email: `paged${n}@example.test`,
        role: 'student',
        status: 'active',
        created_at: 1700000000000 - n,
        isVip: false,
      };
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ users, total: 26, page: current, pageSize: 25, pageCount: 2 }),
    });
  });

  await page.goto('/admin/users');
  await expect(page.locator('#users-page')).toHaveText('1 / 2');
  await expect(page.locator('#users-tbody .font-bold').first()).toHaveText('paged-user-1');
  const next = page.locator('#users-next');
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator('#users-page')).toHaveText('2 / 2');
  await expect(page.locator('#users-tbody .font-bold').first()).toHaveText('paged-user-26');
  await expect(next).toBeDisabled();
  expect(requestedPages).toEqual([1, 2]);
});

test('dashboard delete shortcut opens the same MFA-aware confirmation flow', async ({ page }) => {
  let deleteRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/admin/api/users/delete')) deleteRequests += 1;
  });
  await signInAdmin(page);
  await page.goto('/admin/dashboard?tab=danger');
  const row = page.locator('#pane-danger #users-tbody tr.dt-row').first();
  await expect(row).toBeVisible();
  const username = (await row.locator('.font-bold').textContent()).trim();
  await row.locator('[data-dashboard-action="user-manage-delete"]').click();
  await page.waitForURL(/\/admin\/users(?:\?|$)/);
  const dialog = page.getByRole('dialog', { name: "Foydalanuvchini o'chirish" });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#delete-user-label')).toHaveText(username);
  await expect(page.locator('#delete-confirm-input')).toHaveValue('');
  await expect(new URL(page.url()).searchParams.has('deleteKey')).toBe(false);
  expect(deleteRequests).toBe(0);
});

test('Mock and PRE admin sections show saved aggregate results', async ({ page }) => {
  await page.route('**/admin/api/fans', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ fans: [{
        key: 'fan-math', name: 'Matematika', count: 40,
        practiceResults: { attempts: 3, participants: 2, averagePercent: 76, bestPercent: 100 },
      }] }),
    });
  });
  await page.route('**/admin/api/pre-groups', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ groups: [{
        key: 'pre-physics', title: 'Fizika PRE', count: 2, total: 50,
        practiceResults: { attempts: 4, participants: 3, averagePercent: 68, bestPercent: 96 },
        chunkResults: [{
          id: 'pre-1', name: 'Subtest 1', count: 25,
          practiceResults: { attempts: 2, participants: 2, averagePercent: 90, bestPercent: 100 },
        }],
      }] }),
    });
  });

  await signInAdmin(page);
  await page.goto('/admin/dashboard?tab=fans');
  const fanSummary = page.locator('#fans-list .dashboard-result-summary').first();
  await expect(fanSummary).toContainText('3');
  await expect(fanSummary).toContainText('76%');
  await expect(fanSummary).toContainText('100%');

  await page.goto('/admin/dashboard?tab=pre');
  const preSummary = page.locator('#pre-list .dashboard-result-summary').first();
  await expect(preSummary).toContainText('4');
  await expect(preSummary).toContainText('68%');
  const breakdown = page.locator('#pre-list details.dashboard-subtest-results');
  await breakdown.locator('summary').click();
  await expect(breakdown.locator('.dashboard-subtest-result .dashboard-result-summary')).toContainText('90%');
});
