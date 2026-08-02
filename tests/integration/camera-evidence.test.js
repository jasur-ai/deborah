/**
 * Edikit — Integration Tests: Camera Evidence Pilot (Prompt 37)
 *
 * Contract tests against the real HTTP server (createApp factory):
 *   - Admin policy API auth guards (GET → 401; PUT without CSRF → 401/403)
 *   - Student status/consent API auth guards
 *   - Evidence ingest auth guard
 *   - Flag threshold / device-throttle contract (pure layer through HTTP)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';

let httpServer;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  restoreDb();
  return new Promise((resolve) => {
    if (httpServer && httpServer.listening) httpServer.close(() => resolve());
    else resolve();
  });
});

describe('Camera — admin pilot policy API (auth guard)', () => {
  it('GET /api/admin/camera/policy without admin session → 401 JSON', async () => {
    const req = await createRequest();
    const res = await req.get('/api/admin/camera/policy');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('PUT /api/admin/camera/policy without admin session → rejected (CSRF first)', async () => {
    const req = await createRequest();
    const res = await req
      .put('/api/admin/camera/policy')
      .send({ pilotEnabled: true, fpsMin: 2, fpsMax: 5 });
    expect([401, 403]).toContain(res.status);
  });
});

describe('Camera — student API (auth guard)', () => {
  it('GET status without session → 401 JSON', async () => {
    const req = await createRequest();
    const res = await req.get('/api/student/assignments/1/camera/status');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('POST consent without session → rejected (CSRF first)', async () => {
    const req = await createRequest();
    const res = await req.post('/api/student/assignments/1/camera/consent').send({});
    expect([401, 403]).toContain(res.status);
  });

  it('POST evidence without session → rejected (CSRF first)', async () => {
    const req = await createRequest();
    const res = await req
      .post('/api/student/attempts/1/camera/evidence')
      .send({ samples: [{ client_seq: 1, flags: { phone_detected: true } }] });
    expect([401, 403]).toContain(res.status);
  });

  it('POST evidence with non-array samples → 400', async () => {
    const req = await createRequest();
    const res = await req
      .post('/api/student/attempts/1/camera/evidence')
      .send({ samples: 'nope' });
    expect([401, 403, 400]).toContain(res.status);
  });
});

describe('Camera — flag threshold / device-throttle contract (pure layer through HTTP)', () => {
  it('threshold triggers on consecutive window hits', async () => {
    const { evaluateConsecutiveWindow } = await import('../../src/modules/camera/camera.schema.js');
    const t0 = 1_700_000_000_000;
    const r = evaluateConsecutiveWindow({
      samples: [
        { captured_at: t0, flags: { phone_detected: true } },
        { captured_at: t0 + 1200, flags: { phone_detected: true } },
        { captured_at: t0 + 2400, flags: { phone_detected: true } },
      ],
      flag: 'phone_detected',
      windowMs: 3000,
      minCount: 3,
    });
    expect(r.triggered).toBe(true);
    expect(r.count).toBe(3);
  });

  it('threshold stays silent when hits are throttled beyond the window', async () => {
    const { evaluateConsecutiveWindow } = await import('../../src/modules/camera/camera.schema.js');
    const t0 = 1_700_000_000_000;
    // 2 FPS → 500ms spacing; window 3000ms → within window it would trigger,
    // but a 4s gap resets the run.
    const r = evaluateConsecutiveWindow({
      samples: [
        { captured_at: t0, flags: { freeze_detected: true } },
        { captured_at: t0 + 500, flags: { freeze_detected: true } },
        { captured_at: t0 + 4500, flags: { freeze_detected: true } },
      ],
      flag: 'freeze_detected',
      windowMs: 3000,
      minCount: 2,
    });
    expect(r.triggered).toBe(false);
  });

  it('forbidden fields are rejected end-to-end at schema level', async () => {
    const { validateEvidenceFlags } = await import('../../src/modules/camera/camera.schema.js');
    const v = validateEvidenceFlags({ face_present: true, honesty_score: 0.85 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/forbidden/);
  });
});
