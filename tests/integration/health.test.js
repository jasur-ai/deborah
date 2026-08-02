/**
 * Edikit — Integration Tests: Health & Readiness Endpoints
 *
 * Tests the /health and /ready endpoints added in Prompt 02.
 * Uses the app factory (no server start needed for GET routes).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createApp } from '../../server.js';

let app;
let request;

beforeAll(async () => {
  const result = await createApp();
  app = result.app;
  const supertest = await import('supertest');
  request = supertest.default(app);
});

describe('GET /health', () => {
  it('should return 200 with status ok', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('node');
    expect(res.body).toHaveProperty('env');
    expect(res.body).toHaveProperty('features');
  });

  it('should include feature flags', async () => {
    const res = await request.get('/health');
    expect(res.body.features).toBeDefined();
    expect(res.body.features.vip).toBeDefined();
    expect(res.body.features.vip.enabled).toBe(true);
    expect(res.body.features.arena).toBeDefined();
  });
});

describe('GET /ready', () => {
  it('should return 200 with status ready', async () => {
    const res = await request.get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('Server startup with config', () => {
  it('should still serve existing routes', async () => {
    const res = await request.get('/');
    expect(res.status).toBe(200);
  });
});
