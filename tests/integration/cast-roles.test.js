import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSession, upsertRole, getRole, generateSessionId, generateJoinCode } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';
import { can, assertCan, ACTIONS, CAST_ROLES } from '../../services/cast/permissions.js';
import { snapshotDb, restoreDb, startServer, stopServer, connectSocket, disconnectSocket } from '../helpers/setup.js';
import { CAST_COMMANDS } from '../../utils/cast-constants.js';

// T-02 item 5: real socket session auth — createApp server + websocket orqali.
let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
});

afterAll(async () => {
  restoreDb();
  await stopServer();
});

// Socket command yuborish + ack olish helper
function emitAck(socket, type, payload, sessionId) {
  return new Promise((resolve) => {
    socket.emit('cast:command', {
      commandId: `cmd-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      type,
      payload: payload || {},
      sentAtClient: Date.now(),
    }, (ack) => resolve(ack));
  });
}

describe('T-02: socket session auth (real server, item 5)', () => {
  it('unauthenticated socket is rejected on director join (NOT_AUTHORIZED)', async () => {
    // Session yaratamiz — hech qanday role yo'q
    const sid = generateSessionId();
    await createSession({
      sessionId: sid,
      joinCode: generateJoinCode(),
      meta: { title: 'Socket auth' },
      config: { scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'off' } },
      state: initialState({
        primaryDirectorId: 'user:director',
        questionIds: ['q_01'],
        questionCount: 1,
        choreography: null,
      }),
      privateQuestions: [{ id: 'q_01', correctOptionIds: ['o_a'] }],
      publicQuestions: [{ id: 'q_01', text: 'S', options: [{ id: 'o_a', text: 'A' }] }],
    });

    const socket = await connectSocket(serverUrl);
    const ack = await emitAck(socket, CAST_COMMANDS.DIRECTOR_JOIN, {}, sid);
    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('NOT_AUTHORIZED');
    await disconnectSocket(socket);
  });

  it('cast:getSnapshot without actor is safely rejected', async () => {
    const socket = await connectSocket(serverUrl);
    const ack = await emitAck(socket, CAST_COMMANDS.GET_SNAPSHOT, {}, 'cast_nonexistent');
    // session ham, actor ham yo'q — xavfsiz tarzda rad etiladi
    // (NOT_AUTHORIZED yoki internal xato — ikkalasi ham ok:false qaytaradi)
    expect(ack.ok).toBe(false);
    expect(ack.error).toBeDefined();
    await disconnectSocket(socket);
  });
});

// ═══════════════════════════════════════════════════════════════
// T-02 item 5+6: socket session auth + role boundary.
// Role persistence (upsertRole/getRole) real adapter'da; permission
// matritsasi can/assertCan orqali role boundary'ni yopadi.
// Socket session auth'ning HTTP qismi teskari — server faqat session
// cookie orqali auth qiladi; bu yerda role modeli to'liq tekshiriladi.
// ═══════════════════════════════════════════════════════════════

let sessionId;

const pubQ = [{ id: 'q_01', text: 'S', options: [{ id: 'o_a', text: 'A' }] }];
const privQ = [{ id: 'q_01', correctOptionIds: ['o_a'] }];
const config = { scoring: { scorePolicy: 'accuracy' }, timer: { mode: 'off' } };

beforeAll(async () => {
  snapshotDb();
  sessionId = generateSessionId();
  await createSession({
    sessionId,
    joinCode: generateJoinCode(),
    meta: { title: 'Roles test' },
    config,
    state: initialState({
      primaryDirectorId: 'user:director',
      questionIds: pubQ.map((q) => q.id),
      questionCount: pubQ.length,
      choreography: null,
    }),
    privateQuestions: privQ,
    publicQuestions: pubQ,
  });
});

afterAll(async () => {
  restoreDb();
});

describe('T-02: role persistence (real adapter)', () => {
  it('upsertRole + getRole roundtrip', async () => {
    await upsertRole(sessionId, {
      actorId: 'user:cohost',
      role: CAST_ROLES.CO_HOST,
      assignedAt: Date.now(),
      assignedBy: 'user:director',
    });
    const rec = await getRole(sessionId, 'user:cohost');
    expect(rec.role).toBe(CAST_ROLES.CO_HOST);
    expect(rec.assignedBy).toBe('user:director');
  });

  it('owner can perform any action', () => {
    for (const action of Object.values(ACTIONS)) {
      expect(can(CAST_ROLES.OWNER, action).allowed).toBe(true);
    }
  });

  it('co-host allowed question control, denied nothing in its set', () => {
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.QUESTION_OPEN).allowed).toBe(true);
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.QUESTION_REVEAL).allowed).toBe(true);
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.REMOVE_PARTICIPANT).allowed).toBe(true);
  });

  it('moderator cannot control question progression', () => {
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.MODERATE).allowed).toBe(true);
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.QUESTION_OPEN).allowed).toBe(false);
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.SESSION_END).allowed).toBe(false);
  });

  it('projector_only read-only boundary', () => {
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.PROJECTOR_VIEW).allowed).toBe(true);
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.ANSWER_SUBMIT).allowed).toBe(false);
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.MODERATE).allowed).toBe(false);
  });

  it('participant can answer and join only', () => {
    expect(can('participant', ACTIONS.ANSWER_SUBMIT).allowed).toBe(true);
    expect(can('participant', ACTIONS.JOIN).allowed).toBe(true);
    expect(can('participant', ACTIONS.QUESTION_OPEN).allowed).toBe(false);
    expect(can('participant', ACTIONS.SESSION_END).allowed).toBe(false);
  });

  it('assertCan throws for denied combinations', () => {
    expect(() => assertCan(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.MODERATE)).toThrow();
    expect(assertCan(CAST_ROLES.OWNER, ACTIONS.SESSION_END)).toBe(true);
  });

  it('unknown role is denied', () => {
    expect(can('hacker', ACTIONS.QUESTION_OPEN).allowed).toBe(false);
    expect(can('hacker', ACTIONS.JOIN).allowed).toBe(false);
  });
});
