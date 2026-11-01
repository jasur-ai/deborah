import { expect } from '@playwright/test';
import { test, loginAsAdminUI, loginAsUserUI } from './visual.helper.js';

const TARGET_PROJECTS = new Set(['app-desktop', 'app-mobile', 'app-mobile-small']);

/** End-to-end gate: non-VIP personal practice is visible, navigable and usable. */
test('Mock fanlar and Subtestlar are available in the personal library', async ({ browser, page }, testInfo) => {
  test.skip(!TARGET_PROJECTS.has(testInfo.project.name), 'desktop and phone QA projects only');

  const stamp = Date.now().toString(36);
  const mockName = `QA Mock ${stamp}`;
  const groupTitle = `QA Subtest group ${stamp}`;
  const mockQuestionPrefix = `Mock practice access check ${stamp}`;
  const mockQuestions = Array.from({ length: 30 }, (_, index) => ({
    num: index + 1,
    text: `${mockQuestionPrefix} ${index + 1}: 2 + 2?`,
    correctLetter: 'B',
    correctText: '4',
    options: [
      { text: '3', letter: 'A', isCorrect: false },
      { text: '4', letter: 'B', isCorrect: true },
    ],
  }));
  const subtestQuestion = `Subtest practice access check ${stamp}: 3 + 3?`;
  const subtestChunks = Array.from({ length: 14 }, (_, index) => ({
    id: `qa_part_${index + 1}`,
    name: index === 0 ? 'QA subtest' : `QA subtest ${index + 1}`,
    questions: [{
      num: 1,
      text: index === 0 ? subtestQuestion : `${subtestQuestion} #${index + 1}`,
      correctLetter: 'B',
      correctText: '6',
      options: [
        { text: '5', letter: 'A', isCorrect: false },
        { text: '6', letter: 'B', isCorrect: true },
      ],
    }],
  }));

  let userContext = null;
  let fanKey = null;
  let groupKey = null;

  try {
    // Seed isolated fixtures through the authenticated admin APIs.
    await loginAsAdminUI(page);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => location.pathname === '/admin/dashboard'
      && typeof window.__CSRF_TOKEN === 'string' && window.__CSRF_TOKEN.length > 0);
    // Let the session store finish persisting the freshly issued CSRF token before fixture writes.
    await page.waitForTimeout(150);
    const saved = await page.evaluate(async ({ mockName, groupTitle, mockQuestions, subtestChunks }) => {
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN };
      const fanResponse = await fetch('/admin/api/fans/save', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: mockName,
          questions: mockQuestions,
        }),
      });
      const fan = await fanResponse.json();
      const groupResponse = await fetch('/admin/api/pre-groups/save', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: groupTitle,
          chunks: subtestChunks,
        }),
      });
      const group = await groupResponse.json();
      return {
        fan: { status: fanResponse.status, body: fan },
        group: { status: groupResponse.status, body: group },
      };
    }, { mockName, groupTitle, mockQuestions, subtestChunks });

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
    const mockItem = userPage.locator('#mock-fanlar .prep-item').filter({ hasText: mockName });
    const mockLaunch = mockItem.locator('[data-start-sinov]');
    await expect(mockItem.locator('.prep-item-meta')).toContainText('30');
    await expect(mockLaunch).toHaveAttribute('data-count', '25');

    const accordion = userPage.locator('#subtestlar [data-subtest-group]').filter({ hasText: groupTitle });
    await expect(accordion).toHaveCount(1);
    await expect(accordion.locator('.prep-group-meta')).toContainText('14');
    await expect(accordion.locator('.prep-item')).toHaveCount(14);
    expect(await accordion.evaluate((details) => details.open)).toBe(false);
    await expect(accordion.locator('[data-start-sinov]').first()).toBeHidden();
    await accordion.locator('summary').click();
    await expect(accordion).toHaveAttribute('open', '');
    await expect(accordion.locator('[data-start-sinov]')).toHaveCount(14);
    await expect(accordion.locator('[data-start-sinov]').first()).toBeVisible();

    await expect(userPage.locator('[data-practice-nav="mock"]')).toHaveAttribute('href', '/user/panel#mock-fanlar');
    await expect(userPage.locator('[data-practice-nav="subtests"]')).toHaveAttribute('href', '/user/panel#subtestlar');

    const lightCard = await userPage.locator('.prep-card').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const themeButton = userPage.locator('#panelThemeBtn');
    await expect(themeButton).toHaveAttribute('aria-pressed', 'false');
    await themeButton.click();
    await expect(userPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(themeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(userPage.locator('html')).toHaveClass(/theme-transitioning/);
    const sweepName = await userPage.locator('html').evaluate((element) => getComputedStyle(element, '::before').animationName);
    expect(sweepName).toBe('theme-satin-sweep');
    const darkCard = await userPage.locator('.prep-card').first().evaluate((el) => getComputedStyle(el).backgroundColor);
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
    await mockLaunch.click();
    await expect(userPage.locator('#start-modal')).toHaveClass(/open/);
    await expect(userPage.locator('#start-modal-sub')).toContainText('25');
    await userPage.locator('#start-modal [data-act="start"]').click();
    await userPage.waitForURL((url) => url.pathname === '/user/practice' && url.searchParams.get('source') === 'mock');
    await expect(userPage.locator('.pr-title')).toHaveText(mockName);
    await expect(userPage.locator('#qpos')).toHaveText('1 / 25');
    await expect(userPage.locator('#dots .pr-dot')).toHaveCount(25);
    await expect(userPage.locator('#quiz')).toContainText(mockQuestionPrefix);
    await userPage.evaluate(() => {
      for (let index = 0; index < 25; index += 1) {
        const correctOption = document.querySelector('#quiz .opt[data-j="1"]');
        if (!correctOption) throw new Error(`Missing correct option at session question ${index + 1}`);
        correctOption.click();
        const next = document.querySelector(index < 24 ? '#next' : '#finish');
        if (!next) throw new Error(`Missing navigation at session question ${index + 1}`);
        next.click();
      }
    });
    const gradeResponsePromise = userPage.waitForResponse((response) =>
      response.url().endsWith('/user/api/practice/grade') && response.request().method() === 'POST');
    await userPage.locator('[data-rv-done]').click();
    const mockGradeResponse = await gradeResponsePromise;
    const mockGrade = await mockGradeResponse.json();
    expect(mockGradeResponse.status()).toBe(200);
    expect(mockGrade.total).toBe(25);
    expect(mockGrade.correct).toBe(25);
    expect(mockGrade.saved).toBe(false);

    await userPage.goto('/user/panel');
    await accordion.locator('summary').click();
    await accordion.locator('[data-start-sinov]').first().click();
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
