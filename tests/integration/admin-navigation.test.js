/* Admin navigation regression tests:
 * - menu labels and destinations come from one explicit catalogue;
 * - dashboard tab shortcuts must open the matching panel, never a stale hash;
 * - common admin entry routes remain reachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { ADMIN_DASHBOARD_TABS, ADMIN_NAVIGATION, flattenAdminNavigation } from '../../data/admin-navigation.js';

let app;
let httpServer;

beforeAll(async () => {
  snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  if (httpServer?.listening) await new Promise((resolve) => httpServer.close(resolve));
  restoreDb();
});

function getCsrf(html) {
  const found = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return found ? found[1] : '';
}

async function adminAgent() {
  const agent = supertest.agent(app);
  const page = await agent.get('/admin/login');
  await agent.post('/admin/login').type('form').send({
    _csrf: getCsrf(page.text),
    username: 'testadmin',
    password: 'testpass',
  });
  return agent;
}

describe('Admin navigation — catalog', () => {
  it('has unique IDs, explicit routes, and no old/wrong destination patterns', () => {
    const items = flattenAdminNavigation();
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(items.length).toBeGreaterThan(35);
    for (const item of items) {
      expect(item.href, item.id).toMatch(/^\/(admin|arena)(\/|\?|$)/);
      expect(item.href, item.id).not.toContain('#pane-');
      expect(item.href, item.id).not.toContain('/admin/source-pack');
      expect(item.href, item.id).not.toContain('/user/');
      if (item.tab) expect(ADMIN_DASHBOARD_TABS.has(item.tab), item.id).toBe(true);
    }
    expect(ADMIN_NAVIGATION.map((group) => group.label)).toContain('Testlar va natijalar');
  });

  it('renders the people link under the correct label and omits legacy misroutes', async () => {
    const agent = await adminAgent();
    const response = await agent.get('/admin/index');
    expect(response.status).toBe(200);
    const userLink = response.text.match(/<a href="\/admin\/users" data-name="([^"]+)"/);
    expect(userLink?.[1]).toContain('foydalanuvchilar');
    expect(response.text).toContain('Barcha funksiyalar');
    expect(response.text).toContain('Namuna fanlar');
    expect(response.text).not.toContain('/admin/source-pack');
    expect(response.text).not.toContain('/admin/dashboard#pane-');
    expect(response.text).not.toContain('/user/profile');
  });

  it('every catalogue destination resolves for an authenticated administrator', async () => {
    const agent = await adminAgent();
    const paths = [...new Set(flattenAdminNavigation().map((item) => item.href.split('?')[0]))];
    for (const path of paths) {
      const response = await agent.get(path);
      expect(response.status, `navigatsiya: ${path}`).toBe(200);
      if (path.startsWith('/admin')) {
        expect(response.text, `shared sidebar: ${path}`).toContain('id="admin-sidebar"');
      }
    }
  });

  it('standalone admin tools and profile share the responsive drawer shell', async () => {
    const agent = await adminAgent();
    const paths = [
      '/admin/board', '/admin/camera-review', '/admin/command-center', '/admin/consideration',
      '/admin/grading', '/admin/marking', '/admin/paper', '/admin/safe-submit', '/admin/scan',
      '/admin/scheduler', '/admin/seating', '/admin/profile',
    ];
    for (const path of paths) {
      const response = await agent.get(path);
      expect(response.status, path).toBe(200);
      expect(response.text, `shared sidebar: ${path}`).toContain('class="admin-sidebar admin-sidebar--legacy"');
      expect(response.text, `drawer trigger: ${path}`).toContain('aria-controls="admin-sidebar"');
      expect(response.text, `skip link: ${path}`).toContain('class="skip-link"');
    }
  });

  it('each dashboard shortcut opens its matching panel; invalid tabs safely return to overview', async () => {
    const agent = await adminAgent();
    for (const tab of ADMIN_DASHBOARD_TABS) {
      const response = await agent.get(`/admin/dashboard?tab=${encodeURIComponent(tab)}`);
      expect(response.status, `tab=${tab}`).toBe(200);
      expect(response.text, `tab=${tab}`).toMatch(new RegExp(`class="admin-tab-pane active" id="pane-${tab}"`));
    }
    const invalid = await agent.get('/admin/dashboard?tab=not-a-panel');
    expect(invalid.status).toBe(200);
    expect(invalid.text).toMatch(/class="admin-tab-pane active" id="pane-overview"/);
  });

  it('admin-role sidebar stays in admin: no student profile/logout or role-workspace links', async () => {
    const agent = await adminAgent();
    const response = await agent.get('/admin/observability');
    expect(response.status).toBe(200);
    expect(response.text).toContain('id="admin-sidebar"');
    expect(response.text).toContain('href="/admin/index"');
    expect(response.text).toContain('href="/admin/profile"');
    expect(response.text).toContain('action="/admin/logout"');
    expect(response.text).not.toContain('id="shell-sidebar"');
    expect(response.text).not.toContain('href="/user/profile"');

    // Legacy pages must use the exact same grouped admin sidebar, not a second shell.
    const legacy = await agent.get('/admin/resource-reco');
    expect(legacy.status).toBe(200);
    expect(legacy.text).toContain('class="admin-sidebar admin-sidebar--legacy"');
    expect(legacy.text).not.toContain('id="shell-sidebar"');

    // Secondary tools remain discoverable through the catalogue and visibly active.
    const toolPage = await agent.get('/admin/accessibility');
    expect(toolPage.status).toBe(200);
    expect(toolPage.text).toMatch(/href="\/admin\/index"\s+class="admin-side-btn active"/);
    expect(response.text).not.toContain('action="/user/logout"');
    expect(response.text).not.toContain('href="/student"');
    expect(response.text).not.toContain('href="/teacher"');
  });

  it('legacy /admin entry routes to the single dashboard', async () => {
    const agent = await adminAgent();
    const response = await agent.get('/admin');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin/dashboard');
  });
});
