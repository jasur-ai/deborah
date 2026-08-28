/**
 * Deborah — Integration Tests: HTTP Routes
 *
 * Tests critical HTTP routes without starting a server.
 * Uses createApp() factory → supertest.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createApp } from '../../server.js';

let app;

beforeAll(async () => {
  const result = await createApp();
  app = result.app;
});

describe('Landing page', () => {
  it('GET / should return 200', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Deborah');
  });
});

describe('Play page', () => {
  it('GET /play should return 200', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/play');
    expect(res.status).toBe(200);
    expect(res.text).toContain('O\'yin');
  });
});

describe('Login pages', () => {
  it('GET /user/login should return 200', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/user/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Kirish');
  });

  it('GET /admin/login should return 200', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/admin/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Admin');
  });
});

describe('Auth pages redirect when not logged in', () => {
  it('GET /user/panel → 401 JSON (API client, Accept: json)', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/user/panel').set('Accept', 'application/json');
    // BUG-076: json clientlar uchun 401 JSON saqlanadi
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('redirect', '/user/login');
  });

  it('GET /user/panel → 302 login (brauzer, Accept: html — BUG-076)', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/user/panel').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/user/login');
  });

  it('GET /admin/dashboard → 401 JSON (API client, Accept: json)', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/admin/dashboard').set('Accept', 'application/json');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('redirect', '/admin/login');
  });
});

describe('Error pages', () => {
  it('GET /nonexistent should return 404', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/this-does-not-exist-12345');
    expect(res.status).toBe(404);
  });
});
