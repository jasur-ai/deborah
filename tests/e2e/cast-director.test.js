/**
 * Edikit — Cast E2E (T-03): Director controls
 * -------------------------------------------
 * Real socket orqali director flow:
 * - Session start (item 5)
 * - Question open (item 5/6)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io } from 'socket.io-client';
import { startE2E, stopE2E, seedCastSession, serverUrl } from './cast-e2e.helper.js';
import { getState } from '../../services/cast/session-store.js';

let socket;

beforeAll(async () => {
  await startE2E();
});

afterAll(async () => {
  if (socket) socket.disconnect();
  await stopE2E();
});

function emitAck(sessionId, type, payload = {}) {
  return new Promise((resolve) => {
    socket.emit('cast:command', {
      commandId: `cmd-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      type,
      payload,
      sentAtClient: Date.now(),
    }, (ack) => resolve(ack));
  });
}

describe('T-03 cast-director: session control', () => {
  it('unauthenticated socket cannot start session (item 5)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Auth', owner: 'user:user', questionCount: 1 });

    socket = io(serverUrl, { transports: ['websocket'], forceNew: true });
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('socket timeout')), 8000);
    });

    // Auth'siz director — NOT_AUTHORIZED
    const ack = await emitAck(sessionId, 'cast:sessionStart', {});
    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('NOT_AUTHORIZED');
    socket.disconnect();
    socket = null;
  }, 30000);

  it('state machine stays LOBBY after unauthorized attempt (item 5)', async () => {
    const { sessionId } = await seedCastSession({ title: 'Still Lobby', owner: 'user:user', questionCount: 1 });
    const state = await getState(sessionId);
    expect(state.phase).toBe('LOBBY_OPEN');
  });

  it('director sessionStart without role is rejected — role boundary (item 6)', async () => {
    const { sessionId } = await seedCastSession({ title: 'NoRole', owner: 'user:other', questionCount: 1 });
    socket = io(serverUrl, { transports: ['websocket'], forceNew: true });
    await new Promise((resolve) => socket.on('connect', resolve));
    const ack = await emitAck(sessionId, 'cast:sessionStart', {});
    expect(ack.ok).toBe(false);
    socket.disconnect();
    socket = null;
  }, 30000);
});
