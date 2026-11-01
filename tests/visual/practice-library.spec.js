import { expect } from '@playwright/test';
import { test, loginAsAdminUI, loginAsUserUI } from './visual.helper.js';

const TARGET_PROJECTS = new Set(['app-desktop', 'app-mobile', 'app-mobile-small']);

/** End-to-end gate: non-VIP personal practice is visible, navigable and usable. */
test('Mock fanlar and Subtestlar are available in the personal library', async ({ browser, page }, testInfo) => {
  test.skip(!TARGET_PROJECTS.has(testInfo.project.name), 'desktop and phone QA projects only');

  const stamp = Date.now().toString(36);
  const mockName = `QA Mock ${stamp}`;
  const groupTitle = `QA Subtest group ${stamp}`;
  const mockQuestion = `Mock practice access check ${stamp}: 2 + 2?`;
  const subtestQuestion = `Subtest practice access check ${stamp}: 3 + 3?`;

  let userContext = null;
  let fanKey = null;
  let groupKey = null;

  try {
    // Seed isolated fixtures through the authenticated admin APIs.
    await loginAsAdminUI(page);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => location.pathname === '/admin/dashboard'
      && typeof window.__CSRF_TOKEN === 'string' && window.__CSRF_TOKEN.length > 0);
    const saved = await page.evaluate(async ({ mockName, groupTitle, mockQuestion, subtestQuestion }) => {
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN };
      const options = (wrong, right) => [
        { text: wrong, letter: 'A', isCorrect: false },
        { text: right, letter: 'B', isCorrect: true },
      ];
      const fanResponse = await fetch('/admin/api/fans/save', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: mockName,
          questions: [{ num: 1, text: mockQuestion, correctLetter: 'B', correctText: '4', options: options('3', '4') }],
        }),
      });
      const fan = await fanResponse.json();
      const groupResponse = await fetch('/admin/api/pre-groups/save', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: groupTitle,
          chunks: [{
            id: 'qa_part_1',
            name: 'QA subtest',
            questions: [{ num: 1, text: subtestQuestion, correctLetter: 'B', correctText: '6', options: options('5', '6') }],
          }],
        }),
      });
      const group = await groupResponse.json();
      return {
        fan: { status: fanResponse.status, body: fan },
        group: { status: groupResponse.status, body: group },
      };
    }, { mockName, groupTitle, mockQuestion, subtestQuestion });

    fanKey = saved.fan.body.key || null;
    groupKey = saved.group.body.key || null;
    expect(saved.fan.status, JSON.stringify(saved.fan.body)).toBe(200);
    expect(saved.fan.body.success).toBe(true);
    expect(saved.group.status, JSON.stringify(saved.group.body)).toBe(200);
    expect(saved.group.body.success).toBe(true);

    userContext = await browser.newContext({ viewport: page.viewportSize(), colorScheme: 'light' });
    await userContext.addInitScript(() => {
      try { localStorage.setItem('deborah-theme-state', 'light'); } catch (_) {}
    });
    const userPage = await userContext.newPage();
    await loginAsUserUI(userPage, { username: 'user', password: 'user' });

    // The seeded `user` account is non-VIP; both categories must still render.
    const meResponse = await userPage.evaluate(async () => {
      const response = await fetch('/user/api/me');
      return response.json();
    });
    expect(Boolean(meResponse.user?.isVip)).toBe(false);
    await expect(userPage.locator('#practice-library')).toBeVisible();
    await expect(userPage.locator('#mock-fanlar')).toContainText(mockName);
    await expect(userPage.locator('#subtestlar')).toContainText(groupTitle);
    await expect(userPage.locator('#mock-fanlar [data-start-sinov]')).toHaveCount(1);
    await expect(userPage.locator('#subtestlar [data-start-sinov]')).toHaveCount(1);
    await expect(userPage.locator('[data-practice-nav="mock"]')).toHaveAttribute('href', '/user/panel#mock-fanlar');
    await expect(userPage.locator('[data-practice-nav="subtests"]')).toHaveAttribute('href', '/user/panel#subtestlar');

    const lightCard = await userPage.locator('.prep-card').first().evaluate((el) => getComputedStyle(el).backgroundImage);
    const themeButton = userPage.locator('#panelThemeBtn');
    await expect(themeButton).toHaveAttribute('aria-pressed', 'false');
    await themeButton.click();
    await expect(userPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(themeButton).toHaveAttribute('aria-pressed', 'true');
    const darkCard = await userPage.locator('.prep-card').first().evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(darkCard).not.toBe(lightCard);
    await themeButton.click();
    await expect(userPage.locator('html')).toHaveAttribute('data-theme', 'light');

    // Sidebar anchors remain reachable in the compact drawer used on phones.
    if ((page.viewportSize()?.width || 1440) <= 640) {
      await userPage.locator('[data-shell-open]').click();
      await userPage.locator('#shell-sidebar [data-practice-nav="mock"]').click();
      await userPage.waitForURL('**/user/panel#mock-fanlar');
      await userPage.locator('[data-shell-open]').click();
      await userPage.locator('#shell-sidebar [data-practice-nav="subtests"]').click();
      await userPage.waitForURL('**/user/panel#subtestlar');
    }

    // Both personal-practice sources launch the existing solo quiz flow.
    await userPage.goto('/user/panel');
    await userPage.locator('#mock-fanlar [data-start-sinov]').click();
    await expect(userPage.locator('#start-modal')).toHaveClass(/open/);
    await userPage.locator('#start-modal [data-act="start"]').click();
    await userPage.waitForURL((url) => url.pathname === '/user/practice' && url.searchParams.get('source') === 'mock');
    await expect(userPage.locator('.pr-title')).toHaveText(mockName);
    await expect(userPage.locator('#quiz')).toContainText(mockQuestion);

    await userPage.goto('/user/panel');
    await userPage.locator('#subtestlar [data-start-sinov]').click();
    await expect(userPage.locator('#start-modal')).toHaveClass(/open/);
    await userPage.locator('#start-modal [data-act="start"]').click();
    await userPage.waitForURL((url) => url.pathname === '/user/practice'
      && url.searchParams.get('source') === 'pre'
      && url.searchParams.get('chunk') === 'qa_part_1');
    await expect(userPage.locator('.pr-title')).toHaveText(`${groupTitle} — QA subtest`);
    await expect(userPage.locator('#quiz')).toContainText(subtestQuestion);

    // The second user workspace theme toggle also exposes its selected state.
    await userPage.goto('/user/tests');
    const libraryThemeButton = userPage.locator('#panelThemeBtn');
    await expect(libraryThemeButton).toHaveAttribute('aria-pressed', 'false');
    await libraryThemeButton.click();
    await expect(userPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(libraryThemeButton).toHaveAttribute('aria-pressed', 'true');
    await libraryThemeButton.click();
    await expect(userPage.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(libraryThemeButton).toHaveAttribute('aria-pressed', 'false');
  } finally {
    if (fanKey || groupKey) {
      await page.evaluate(async ({ fanKey, groupKey }) => {
        const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN };
        const requests = [];
        if (fanKey) requests.push(fetch('/admin/api/fans/delete', {
          method: 'POST', headers, body: JSON.stringify({ key: fanKey }),
        }));
        if (groupKey) requests.push(fetch('/admin/api/pre-groups/delete', {
          method: 'POST', headers, body: JSON.stringify({ key: groupKey }),
        }));
        await Promise.allSettled(requests);
      }, { fanKey, groupKey }).catch(() => {});
    }
    if (userContext) await userContext.close();
  }
});
