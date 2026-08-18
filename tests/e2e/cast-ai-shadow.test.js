/**
 * Edikit — Cast AI Co-host Shadow E2E (C5-11)
 * --------------------------------------------
 * Socket-only (browser kerak emas). Real server'da auth'li socket orqali:
 * - cohostMode off → shadow:run rad etiladi
 * - cohostMode shadow → shadow:run → cast:shadowSuggestion emit (director room)
 * - shadow:decide → accept/dismiss event yig'iladi
 * - shadow:gate → evaluation gate natijasi
 * - forbidden live action → suggestion hech qachon qabul qilinmaydi
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io } from 'socket.io-client';
import { startE2E, stopE2E, seedCastSession, serverUrl } from './cast-e2e.helper.js';

let socket;
let cookie = '';

// ── Login (fetch + cookie jar) — socket'ga extraHeaders orqali session yuborish ──
async function login(username = 'user', password = 'user') {
  const loginPage = await fetch(`${serverUrl}/user/login`, { redirect: 'manual' });
  const html = await loginPage.text();
  const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const setCookie = loginPage.headers.get('set-cookie') || '';
  const sess = (setCookie.split(';')[0] || '').split('=')[0];
  const initial = setCookie.split(';')[0];

  const res = await fetch(`${serverUrl}/user/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: initial,
    },
    body: new URLSearchParams({ username, password, _csrf: csrf, mode: 'login' }),
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  else cookie = initial;
}

async function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(serverUrl, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: cookie ? { cookie } : {},
  });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 8000);
  });
}

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

beforeAll(async () => {
  await startE2E();
  await login();
});

afterAll(async () => {
  if (socket) socket.disconnect();
  await stopE2E();
});

describe('C5-11 cast-ai-shadow: shadow flow', () => {
  it('cohostMode off → shadow:run rad etiladi', async () => {
    const { sessionId } = await seedCastSession({ title: 'Shadow off', owner: 'user:user', questionCount: 1 });
    await connectSocket();
    const ack = await emitAck(sessionId, 'cast:shadowRun', {});
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('INVALID_OPTION');
  });

  it('cohostMode shadow → shadow:run suggestion emit qiladi', async () => {
    const { sessionId } = await seedCastSession({
      title: 'Shadow on',
      owner: 'user:user',
      questionCount: 1,
      ai: { cohostMode: 'shadow', mayExecuteLiveActions: false, teacherApprovalRequired: true },
    });
    await connectSocket();
    // Director private room'ga join — shadow suggestion emit shu room'ga boradi
    await emitAck(sessionId, 'cast:directorJoin', {});

    const suggestionPromise = new Promise((resolve, reject) => {
      socket.once('cast:shadowSuggestion', (ev) => resolve(ev));
      setTimeout(() => reject(new Error('shadowSuggestion timeout')), 8000);
    });

    const runAck = await emitAck(sessionId, 'cast:shadowRun', {});
    expect(runAck.ok).toBe(true);
    expect(runAck.suggestionId).toBeTruthy();

    const ev = await suggestionPromise;
    expect(ev.suggestion).toBeTruthy();
    expect(ev.suggestion.message).toBeTruthy();
    expect(ev.suggestion.kind).toMatch(/^(intervention|question|pace|climate)$/);
    // Live action YO'Q — suggestion faqat allowed soft action bo'lishi mumkin
    expect(['answer:reveal', 'score:change', 'participant:punish', 'grade:final', 'participant:flag_misconduct', 'session:end']).not.toContain(ev.suggestion.action);
    expect(ev.provider).toMatch(/^(heuristic|llm)$/);
  });

  it('shadow:decide accepted/dismissed event yigiladi + gate ishlaydi', async () => {
    const { sessionId } = await seedCastSession({
      title: 'Shadow decide',
      owner: 'user:user',
      questionCount: 1,
      ai: { cohostMode: 'shadow', mayExecuteLiveActions: false, teacherApprovalRequired: true },
    });
    await connectSocket();
    await emitAck(sessionId, 'cast:directorJoin', {});

    const runAck = await emitAck(sessionId, 'cast:shadowRun', {});
    expect(runAck.ok).toBe(true);
    const suggestionId = runAck.suggestionId;

    // accepted
    const okAck = await emitAck(sessionId, 'cast:shadowDecide', { decision: 'accepted', suggestionId });
    expect(okAck.ok).toBe(true);

    // dismissed — yangi suggestion
    const runAck2 = await emitAck(sessionId, 'cast:shadowRun', {});
    expect(runAck2.ok).toBe(true);
    const dismissAck = await emitAck(sessionId, 'cast:shadowDecide', { decision: 'dismissed', suggestionId: runAck2.suggestionId });
    expect(dismissAck.ok).toBe(true);

    // noto'g'ri decision rad etiladi
    const badAck = await emitAck(sessionId, 'cast:shadowDecide', { decision: 'maybe', suggestionId });
    expect(badAck.ok).toBe(false);

    // Gate — runs bor, lekin min-runs (10) yetmaydi → pass false
    const gateAck = await emitAck(sessionId, 'cast:shadowGate', {});
    expect(gateAck.ok).toBe(true);
    expect(gateAck.pass).toBe(false);
    expect(gateAck.stats.runs).toBeGreaterThanOrEqual(2);
    expect(gateAck.reasons.some((r) => r.startsWith('min-runs'))).toBe(true);
  });

  it('authsiz socket → shadow:run NOT_AUTHORIZED (xavfsizlik)', async () => {
    const { sessionId } = await seedCastSession({
      title: 'Shadow anon',
      owner: 'user:user',
      questionCount: 1,
      ai: { cohostMode: 'shadow', mayExecuteLiveActions: false, teacherApprovalRequired: true },
    });
    if (socket) socket.disconnect();
    socket = io(serverUrl, { transports: ['websocket'], forceNew: true });
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('socket timeout')), 8000);
    });
    const ack = await emitAck(sessionId, 'cast:shadowRun', {});
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('NOT_AUTHORIZED');
  });
});
