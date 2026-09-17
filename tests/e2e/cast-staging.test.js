/**
 * Deborah — Cast E2E: Staging (C4-08) 3-sekund qoidasi
 * -----------------------------------------------------
 * 09/2026 (user qarori): savol ochilishida (think/preview) SAVOL + VARIANTLAR
 * darhol ko'rinadi ("3s" countdown yozuv yo'q — jimjit progress chiziq);
 * variantlar questionOpened'dan keyin bosiladi (server thinkSeconds).
 * CLASSIC_LIVE preset'ida thinkSeconds=3.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io } from 'socket.io-client';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';
import { createSession, generateSessionId, generateJoinCode, upsertRole } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';

let ctx;

beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); });
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

describe('T-03 cast-staging: 3s rule', () => {
  it('preview: savol + variantlar (disabled); opened: variantlar active', async () => {
    const sessionId = generateSessionId();
    const joinCode = generateJoinCode();
    const qid = 'q_01';
    await createSession({
      sessionId, joinCode,
      meta: { title: 'Stage E2E', tier: 'S' },
      config: {
        scoring: { scorePolicy: 'accuracy' },
        timer: { mode: 'soft', defaultSeconds: 30 },
        playback: { thinkSeconds: 3 },
        participation: { paperCardMode: false },
        ai: { cohostMode: 'off', mayExecuteLiveActions: false, teacherApprovalRequired: true },
      },
      state: initialState({ primaryDirectorId: 'user:user', questionIds: [qid], questionCount: 1, choreography: null }),
      privateQuestions: [{ id: qid, correctOptionIds: ['o_a'], options: ['o_a', 'o_b', 'o_c', 'o_d'].map((id) => ({ id })) }],
      publicQuestions: [{ id: qid, text: 'Staging test savol', options: [
        { id: 'o_a', text: 'Variant A' }, { id: 'o_b', text: 'Variant B' },
        { id: 'o_c', text: 'Variant C' }, { id: 'o_d', text: 'Variant D' },
      ] }],
    });
    await upsertRole(sessionId, { actorId: 'user:user', role: 'owner', assignedAt: Date.now(), assignedBy: 'user:user' });

    const page = await newPage(ctx);
    await page.goto(`${serverUrl}/play?code=${joinCode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#join-form');
    // QR join: ?code= bo'lsa input readonly+qulflangan — faqat bo'sh bo'lsa to'ldiramiz
    if (!(await page.inputValue('#join-code'))) await page.fill('#join-code', joinCode);
    await page.fill('#join-name', 'Bot');
    await page.click('#join-form button[type="submit"], #join-form button');
    await page.waitForTimeout(2000);

    const cookies = await ctx.cookies();
    const sock = io(serverUrl, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } });
    await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(() => rej(new Error('socket timeout')), 8000); });
    const emit = (type, payload = {}) => new Promise((r) => { sock.emit('cast:command', { commandId: `c-${Math.random().toString(36).slice(2, 8)}`, sessionId, type, payload, sentAtClient: Date.now() }, (a) => r(a)); });
    expect((await emit('cast:sessionStart', {})).ok).toBe(true);
    expect((await emit('cast:questionOpen', {})).ok).toBe(true);

    // Staging: savol matni + 4 variant KO'RINADI (bosilmaydi — disabled),
    // "3s" countdown yozuv yo'q (jimjit progress chiziq)
    await page.waitForFunction(() => {
      const qEl = document.getElementById('part-question');
      return qEl && !qEl.hidden && document.querySelectorAll('#part-options .cast-option').length === 4;
    }, { timeout: 7000 });
    const during = await page.evaluate(() => ({
      qText: document.getElementById('part-q-text')?.textContent,
      optBtns: document.querySelectorAll('#part-options .cast-option').length,
      disabledBtns: document.querySelectorAll('#part-options .cast-option[disabled]').length,
      noCountdownText: !(document.getElementById('part-question')?.textContent || '').match(/Fikrlash vaqti|^\s*[123]\s*$/m),
      oldChipGone: !document.getElementById('part-stage-cd'),
    }));
    expect(during.qText).toContain('Staging test savol');
    expect(during.optBtns).toBe(4);
    expect(during.disabledBtns).toBe(4);
    expect(during.noCountdownText).toBe(true);
    expect(during.oldChipGone).toBe(true);

    // 3s o'tgach: variantlar active (bosiladi), taymer yuradi
    await page.waitForFunction(() => {
      return document.querySelectorAll('#part-options .cast-option:not([disabled])').length === 4;
    }, { timeout: 9000 });
    const after = await page.evaluate(() => ({
      activeBtns: document.querySelectorAll('#part-options .cast-option:not([disabled])').length,
      timer: document.getElementById('part-timer')?.textContent,
    }));
    expect(after.activeBtns).toBe(4);
    expect(after.timer).toBeTruthy();
    sock.disconnect();
    await page.close();
  }, 60000);
});
