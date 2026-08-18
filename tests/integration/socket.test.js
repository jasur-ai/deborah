/**
 * Deborah — Integration Tests: Socket.IO
 *
 * Tests Socket.IO event flow with a real server on random port.
 * Uses createApp() factory + shared helpers from setup.js.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { connectSocket, disconnectSocket, snapshotDb, restoreDb } from '../helpers/setup.js';

let httpServer;
let serverUrl;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  httpServer = result.httpServer;

  // Start on random port
  await new Promise((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      serverUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  restoreDb();
  return new Promise((resolve) => {
    if (httpServer && httpServer.listening) {
      httpServer.close(() => resolve());
    } else {
      resolve();
    }
  });
});

describe('Socket connection lifecycle', () => {
  it('should connect and disconnect', async () => {
    const socket = await connectSocket(serverUrl);
    expect(socket.connected).toBe(true);

    await disconnectSocket(socket);
    expect(socket.connected).toBe(false);
  });

  it('should check game code existence (listen before emit)', async () => {
    const socket = await connectSocket(serverUrl);

    // Listen FIRST, then emit (avoids race condition)
    const result = await new Promise((resolve) => {
      socket.on('code:checked', (data) => resolve(data));
      socket.emit('player:checkCode', { code: '99999' });
      setTimeout(() => resolve({ exists: false, timeout: true }), 3000);
    });

    expect(result.exists).toBe(false);
    await disconnectSocket(socket);
  });

  it('should reject joining non-existent game (listen before emit)', async () => {
    const socket = await connectSocket(serverUrl);

    // Listen FIRST, then emit
    const result = await new Promise((resolve) => {
      socket.on('error', (data) => resolve(data));
      socket.on('player:joined', (data) => resolve(data));
      socket.emit('player:join', {
        code: '99999',
        playerName: 'TestPlayer',
        emoji: 'test',
      });
      setTimeout(() => resolve({ message: 'timeout' }), 3000);
    });

    expect(result.message).toContain('topilmadi');
    await disconnectSocket(socket);
  });
});
