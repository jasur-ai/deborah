/**
 * AUTH D-21 §06/§11/§27 — Deploy drill (wsl qismi): blue-green canary simulyatsiyasi.
 * ---------------------------------------------------------------------------
 *  - Server A (flag'lar OFF): /health 200 + status ok + features kontrakti —
 *    gradual rollout boshlang'ich bosqich (canary 1%, flag'lar default false).
 *  - Server B (FEATURE_AUTH_MFA_REQUIRED=true): /health'da flag ENABLED —
 *    rollout 100% bosqich simulyatsiyasi.
 *  - Rollback: server A'ga qaytish — flag'lar yana OFF (blue'ga switch, §08).
 *  - HERMETIC: LOCAL_DB_FILE=/tmp — data/db.json'ga TEGMAYDI (parallel-safe).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT_A = 3641; // unique port (server A — flags OFF)
const PORT_B = 3642; // unique port (server B — flag ON)
const DB_FILE = '/tmp/deborah-d21-drill-db.json';
const AUTH_FLAGS = ['authMfaRequired', 'authPasskeyLogin', 'authDeviceCheck'];

let serverA;
let serverB;

async function waitForHealth(url) {
  const deadline = Date.now() + 60000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server health check timed out: ${lastErr?.message || ''}`);
}

function spawnServer(port, extraEnv = {}) {
  return spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'ci-secret-for-d21-drill',
      PORT: String(port),
      LOCAL_DB_FILE: DB_FILE,
      LOG_LEVEL: 'silent',
      ...extraEnv,
    },
    stdio: 'ignore',
  });
}

beforeAll(async () => {
  rmSync(DB_FILE, { force: true });
  serverA = spawnServer(PORT_A);
  await waitForHealth(`http://localhost:${PORT_A}/health`);
}, 90000);

afterAll(async () => {
  for (const child of [serverA, serverB]) {
    if (child) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  rmSync(DB_FILE, { force: true });
});

describe('AUTH D-21 §11 — /health deploy drill (server A: flaglar OFF)', () => {
  it('1) /health → 200 + status ok + uptime/timestamp (kontrakt)', async () => {
    const res = await fetch(`http://localhost:${PORT_A}/health`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe('ok');
    expect(typeof j.uptime).toBe('number');
    expect(typeof j.timestamp).toBe('number');
  });

  it('2) features kontrakti: 3 auth flag registryda, default OFF (canary 1%)', async () => {
    const j = await (await fetch(`http://localhost:${PORT_A}/health`)).json();
    expect(j.features).toBeTruthy();
    for (const flag of AUTH_FLAGS) {
      expect(j.features[flag]).toBeTruthy();
      expect(j.features[flag].enabled).toBe(false); // gradual rollout OFF
    }
  });

  it('3) noma\'lum flag xavfsiz: registryda yo\'q flag mavjud emas (fail-closed)', async () => {
    const j = await (await fetch(`http://localhost:${PORT_A}/health`)).json();
    expect(j.features.authNopeFlag).toBeFalsy();
  });
});

describe('AUTH D-21 §06/§27 — rollout + rollback drill', () => {
  it('4) Server B (FEATURE_AUTH_MFA_REQUIRED=true) → /health flag ENABLED (rollout 100%)', async () => {
    serverB = spawnServer(PORT_B, { FEATURE_AUTH_MFA_REQUIRED: 'true' });
    await waitForHealth(`http://localhost:${PORT_B}/health`);
    const j = await (await fetch(`http://localhost:${PORT_B}/health`)).json();
    expect(j.features.authMfaRequired.enabled).toBe(true);
    // Qolgan flaglar OFF — faqat rollout qilingan flag yoqilgan
    expect(j.features.authPasskeyLogin.enabled).toBe(false);
    expect(j.features.authDeviceCheck.enabled).toBe(false);
  });

  it("5) Rollback drill: server A (blue) hamon OFF — switch'da flag qaytadi (§08)", async () => {
    // Server B yopiladi (rollback), server A'ga qaytish
    if (serverB) {
      serverB.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      serverB = null;
    }
    const j = await (await fetch(`http://localhost:${PORT_A}/health`)).json();
    expect(j.status).toBe('ok');
    expect(j.features.authMfaRequired.enabled).toBe(false); // eski holat
  });
});
