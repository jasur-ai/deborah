/**
 * Deborah — Test Setup Helper
 *
 * Provides:
 *   1. Shared app instance (createApp factory)
 *   2. HTTP supertest request helper
 *   3. Socket.IO test client helper
 *   4. Temp DB isolation
 *   5. Deterministic clock helper
 */

import { createApp } from '../../server.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const DATA_DIR = resolve(ROOT, 'data');
// LOCAL_DB_FILE — vitest config'da per-invocation temp faylga ishora qiladi
// (local-db.js bilan bir xil mantiq): testlar real data/db.json ga tegmagan
// holda izolyatsiya qilingan DB'da ishlaydi.
const DB_FILE = process.env.LOCAL_DB_FILE
  ? resolve(process.env.LOCAL_DB_FILE)
  : resolve(DATA_DIR, 'db.json');

// ── Shared app instance (lazy) ──
let _app = null;
let _httpServer = null;
let _io = null;

/**
 * Get or create the shared app instance.
 * Call once per test file in beforeAll().
 */
export async function getApp() {
  if (!_app) {
    const result = await createApp();
    _app = result.app;
    _httpServer = result.httpServer;
    _io = result.io;
  }
  return { app: _app, httpServer: _httpServer, io: _io };
}

/**
 * Start the HTTP server on a random port.
 * Returns the URL string.
 */
export async function startServer() {
  const { httpServer } = await getApp();
  return new Promise((resolve, reject) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      resolve(`http://localhost:${addr.port}`);
    });
    httpServer.on('error', reject);
  });
}

/**
 * Stop the HTTP server.
 */
export async function stopServer() {
  return new Promise((resolve) => {
    if (_httpServer && _httpServer.listening) {
      _httpServer.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// ── Cached module references ──
let _supertest = null;
let _ioc = null;

/**
 * Create a supertest request bound to the app.
 * Call inside test functions, not at module level.
 * Caches the supertest module after first load.
 */
export async function createRequest() {
  if (!_supertest) {
    const mod = await import('supertest');
    _supertest = mod.default;
  }
  const { app } = await getApp();
  return _supertest(app);
}

/**
 * Connect a Socket.IO client to the test server.
 * Returns the socket instance after connection.
 * Caches the socket.io-client module after first load.
 */
export async function connectSocket(serverUrl, opts = {}) {
  if (!_ioc) {
    const mod = await import('socket.io-client');
    _ioc = mod.io || mod.default;
  }
  return new Promise((resolve, reject) => {
    const socket = _ioc(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      ...opts,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('Socket connection timeout')), 5000);
  });
}

/**
 * Disconnect a socket and wait for cleanup.
 */
export async function disconnectSocket(socket) {
  return new Promise((resolve) => {
    if (socket && socket.connected) {
      socket.on('disconnect', () => resolve());
      socket.disconnect();
      setTimeout(resolve, 500); // fallback
    } else {
      resolve();
    }
  });
}

// ── Temp DB isolation ──
let _originalDbContent = null;

/**
 * Save a snapshot of the current DB state.
 * Call in beforeAll() or beforeEach().
 */
export function snapshotDb() {
  if (existsSync(DB_FILE)) {
    _originalDbContent = readFileSync(DB_FILE, 'utf-8');
  } else {
    _originalDbContent = null;
  }
}

/**
 * Restore the DB to the saved snapshot.
 * Call in afterAll() or afterEach().
 */
export function restoreDb() {
  if (_originalDbContent !== null) {
    writeFileSync(DB_FILE, _originalDbContent, 'utf-8');
  } else if (existsSync(DB_FILE)) {
    writeFileSync(DB_FILE, '{}', 'utf-8');
  }
}

// ── Deterministic clock helper ──
let _now = Date.now();

/**
 * Set the fake time for tests.
 */
export function setTestTime(timestamp) {
  _now = timestamp;
}

/**
 * Get the current fake time.
 */
export function getTestTime() {
  return _now;
}

/**
 * Advance the fake time by ms.
 */
export function advanceTime(ms) {
  _now += ms;
  return _now;
}
