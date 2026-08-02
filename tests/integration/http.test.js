/**
 * Edikit — Integration Tests: HTTP Routes
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
    expect(res.text).toContain('Edikit');
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
  it('GET /user/panel should return 401 (JSON) when not logged in', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/user/panel');
    // Middleware returns 401 JSON when request accepts JSON (supertest default)
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('redirect', '/user/login');
  });

  it('GET /admin/dashboard should return 401 (JSON) when not logged in', async () => {
    const supertest = await import('supertest');
    const res = await supertest.default(app).get('/admin/dashboard');
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
