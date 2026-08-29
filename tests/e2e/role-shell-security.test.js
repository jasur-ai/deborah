/**
 * Deborah — Role-Aware Shell (e2e/security, Prompt 68)
 *
 * Keyboard / mobile / accessibility checks on the rendered shell:
 *   - Skip-link present and focusable (WCAG 2.2 keyboard nav)
 *   - Sidebar navigation landmarks + aria labels
 *   - Escape key closes mobile shell (client script present)
 *   - Mobile breakpoint CSS (shell sidebar hides off-canvas)
 *   - Reduced-motion respected (existing global rule still present)
 *   - Stealth: non-privileged roles get 404 (no feature leak)
 *   - CSRF still enforced on write endpoints (no regression)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

let app;
let httpServer;
let agent;
let csrfToken;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  app = result.app;
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));

  const supertest = (await import('supertest')).default;
  agent = supertest.agent(app);

  const page = await agent.get('/admin/login');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  await agent.post('/admin/login').type('form').send({
    username: CONFIG.ADMIN_USER,
    password: CONFIG.ADMIN_PASS,
    _csrf: m ? m[1] : '',
  });
  const dash = await agent.get('/admin/dashboard');
  const t = dash.text.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  csrfToken = t ? t[1] : '';
});

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  restoreDb();
});

// ═══════════════════════════════════════════════════════════════════
// ACCESSIBILITY (WCAG 2.2 AA targets)
// ═══════════════════════════════════════════════════════════════════

describe('a11y — keyboard navigation & landmarks', () => {
  it('renders a skip-link targeting #main-content', async () => {
    const res = await agent.get('/teacher');
    expect(res.text).toMatch(/href="#main-content"\s+class="skip-link"/);
    expect(res.text).toMatch(/id="main-content"/);
  });

  it('exposes a navigation landmark with aria-label', async () => {
    const res = await agent.get('/teacher');
    expect(res.text).toMatch(/role="navigation"/);
    expect(res.text).toContain('aria-label="Asosiy navigatsiya"');
  });

  it('marks the active nav link with aria-current', async () => {
    const res = await agent.get('/teacher');
    expect(res.text).toContain('aria-current="page"');
  });

  it('mobile shell opens with aria-expanded toggle + Escape close script', async () => {
    const res = await agent.get('/teacher');
    expect(res.text).toContain('data-shell-open');
    expect(res.text).toContain('aria-expanded="false"');
    // STEP 17: Escape close endi navigation.js componentida — sahifa haqiqatan
    // script tag orqali yuklayotganini ham assert qilamiz (end-to-end emas, lekin bog'langan)
    expect(res.text).toContain('/js/components/navigation.js');
    const navJs = readFileSync(resolve(ROOT, 'public/js/components/navigation.js'), 'utf-8');
    expect(navJs).toContain("e.key === 'Escape'");
    // Inline fallback (eski sahifalar) ham qo'llab-quvvatlanadi
    expect(res.text).toMatch(/e\.key\s*===?\s*'Escape'|data-shell-close/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MOBILE & REDUCED-MOTION
// ═══════════════════════════════════════════════════════════════════

describe('mobile & motion — responsive shell', () => {
  it('style.css has off-canvas mobile sidebar + burger + reduced-motion', () => {
    const cssPath = resolve(ROOT, 'public/css/style.css');
    expect(existsSync(cssPath)).toBe(true);
    const css = readFileSync(cssPath, 'utf-8');

    // Off-canvas mobile shell
    expect(css).toContain('body.shell-open .shell-sidebar');
    expect(css).toContain('.shell-burger');

    // Media queries for small screens exist
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain('@media (max-width: 480px)');

    // Reduced motion — STEP 17: navigation.css componentida (head.ejs orqali yuklanadi)
    const navCss = readFileSync(resolve(ROOT, 'public/design/components/navigation.css'), 'utf-8');
    expect(navCss).toContain('prefers-reduced-motion');
  });

  it('shell skip-link is off-screen until focused (keyboard only)', () => {
    const cssPath = resolve(ROOT, 'public/css/style.css');
    const css = readFileSync(cssPath, 'utf-8');
    expect(css).toContain('.skip-link:focus');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY — stealth & no regression
// ═══════════════════════════════════════════════════════════════════

describe('security — stealth & regression guards', () => {
  it('non-privileged role cannot reach proctor/marker/board (stealth 404)', async () => {
    // Register a fresh student via the register flow (db.json'da demo user'ga
    // tayanmaymiz — register har doim ishlaydi). Username 2-20 belgi regex
    // chegarasiga mos bo'lishi kerak (uzun timestamp nomi 200 qaytaradi).
    const s = (await import('supertest')).default.agent(app);
    const page = await s.get('/user/login');
    // CSRF token user login sahifasida hidden input'da (<%= csrfToken %>)
    const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
    const res = await s.post('/user/login').type('form').send({
      mode: 'reg', consent: 'on',
      username: 'st_' + String(Date.now()).slice(-8),
      email: 'st_' + String(Date.now()).slice(-8) + '@a18.test',
      password: 'test1234-uzun-parol', // AUTH A-22: NIST min 15
      _csrf: m ? m[1] : '',
    });
    // Redirect after successful registration → login OK (student role)
    expect(res.status).toBe(302);

    for (const path of ['/proctor', '/marker', '/board', '/teacher']) {
      // Browser Accept header — stealth 404 (HTML), API so'rov emas.
      // Supertest default Accept yubormaydi, shunda req.accepts('json')
      // truthy bo'lib 403 JSON qaytadi — brauzerda esa 404 chiqadi.
      const r = await s.get(path).set('Accept', 'text/html');
      expect(r.status).toBe(404); // stealth — page "does not exist"
    }
  });

  it('CSRF still enforced on state-changing endpoints (no regression)', async () => {
    const res = await agent.post('/api/tests/toggle-public').send({ key: 'x' });
    expect([400, 403]).toContain(res.status);
  });

  it('no role/nav secret DTO leaks into public landing', async () => {
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/\$argon2/i);
  });
});
