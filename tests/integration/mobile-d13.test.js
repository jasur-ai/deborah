/**
 * AUTH D-13 — Mobile: autofill/keyboard input kontrakti + PWA ulanish (wsl qismi)
 * -------------------------------------------------------------------------------
 *  - §07 autofill: username → autocomplete=username, parol → current/new-password,
 *    email → autocomplete=email, OTP → one-time-code.
 *  - §08 keyboard: username autocapitalize=off, email inputmode=email, OTP inputmode=numeric.
 *  - §14 PWA: manifest link + service-worker registratsiya + pwa-install.js (3-sessiya).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let app;
let httpServer;

beforeAll(async () => {
  snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await new Promise((r) => httpServer.close(r));
  restoreDb();
});

const base = () => `http://localhost:${httpServer.address().port}`;

describe('AUTH D-13 — autofill/keboard kontrakti (§07/§08)', () => {
  it('login: username autocapitalize=off + autocomplete="username webauthn"; password current-password', async () => {
    const res = await fetch(`${base()}/user/login`);
    const html = await res.text();
    // Username — mobil klaviatura katta harf yozmaydi (D-13 §08)
    expect(html).toMatch(/id="login-username"[^>]*autocapitalize="off"/);
    expect(html).toMatch(/id="login-username"[^>]*autocomplete="username webauthn"/);
    // Parol — native autofill (D-13 §07)
    expect(html).toMatch(/id="login-password"[^>]*autocomplete="current-password"/);
  });

  it('register: email inputmode=email, password new-password, username autocapitalize=off', async () => {
    const res = await fetch(`${base()}/user/register`);
    const html = await res.text();
    expect(html).toMatch(/id="reg-email"[^>]*inputmode="email"/);
    expect(html).toMatch(/id="reg-email"[^>]*autocomplete="email"/);
    expect(html).toMatch(/id="reg-password"[^>]*autocomplete="new-password"/);
    expect(html).toMatch(/id="reg-username"[^>]*autocapitalize="off"/);
  });

  it('forgot: username autocomplete=username + autocapitalize=off (mobil klaviatura)', async () => {
    const res = await fetch(`${base()}/user/forgot`);
    const html = await res.text();
    expect(html).toMatch(/id="forgot-username"[^>]*autocomplete="username"/);
    expect(html).toMatch(/id="forgot-username"[^>]*autocapitalize="off"/);
  });
});

describe('AUTH D-13 — PWA ulanish (§14)', () => {
  it('manifest link + service-worker registratsiya + pwa-install.js', async () => {
    const res = await fetch(`${base()}/user/login`);
    const html = await res.text();
    expect(html).toContain('rel="manifest" href="/manifest.json"');
    expect(html).toContain("serviceWorker.register('/service-worker.js'");
    expect(html).toContain('/js/pwa-install.js');
  });

  it('manifest.json — standalone + start_url + icons (PWA install sharti)', async () => {
    const res = await fetch(`${base()}/manifest.json`);
    expect(res.status).toBe(200);
    const manifest = await res.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });
});
