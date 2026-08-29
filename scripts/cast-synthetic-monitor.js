/**
 * Deborah — Cast Synthetic Monitor (C5-08, item 13)
 * -------------------------------------------------
 * Real Cast flow'ni periodik tekshiradi:
 *   login → preflight → session → director open → join → answer → close → reveal
 * Xato bo'lsa SEV'li xabar chiqaradi (ops alert uchun exit code).
 *
 * Ishlatish:
 *   node scripts/cast-synthetic-monitor.js                # bir marta
 *   node scripts/cast-synthetic-monitor.js --interval 60  # har 60s
 *   CAST_FEATURE_SYNTHETICMONITOR=off node server.js      # server'da o'chirish
 *
 * Kerakli env:
 *   CAST_SYNTHETIC_BASE_URL   (default http://localhost:PORT)
 *   CAST_SYNTHETIC_USER       (default teacher)
 *   CAST_SYNTHETIC_PASS       (default teacher34)
 *   CAST_SYNTHETIC_SOURCE     (default mock)
 *   CAST_SYNTHETIC_KEY        (default fizika_mexanika)
 */

/* eslint-disable no-console */

import { io } from 'socket.io-client';
import { isFeatureEnabled } from '../services/cast/feature-switches.js';

const BASE = process.env.CAST_SYNTHETIC_BASE_URL || `http://localhost:${process.env.PORT || 3457}`;
const USER = process.env.CAST_SYNTHETIC_USER || 'teacher';
const PASS = process.env.CAST_SYNTHETIC_PASS || 'teacher34';
const SOURCE = { type: process.env.CAST_SYNTHETIC_SOURCE || 'mock', key: process.env.CAST_SYNTHETIC_KEY || 'fizika_mexanika' };
const INTERVAL = parseInt(process.env.CAST_SYNTHETIC_INTERVAL || '0', 10);

// ── Mini cookie jar ──
const cookieJar = {};

function storeCookies(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookieJar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}

function cookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(),
      ...(opts.headers || {}),
    },
  });
  storeCookies(res);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json();
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

function emitAck(socket, event, payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error(`${event}-timeout`)); }, timeoutMs);
    // Envelope: dispatcher `data.type` o'qiydi — event nomi payload'ga ham yoziladi
    const envelope = {
      type: event,
      sessionId: payload.sessionId,
      payload: payload.payload || {},
      sentAtClient: Date.now(),
    };
    socket.emit(event, envelope, (ack) => {
      clearTimeout(timer);
      if (!ack || !ack.ok) {
        socket.close();
        reject(new Error(`${event}-ack:${ack?.error?.code || 'no-ack'}`));
        return;
      }
      resolve(ack);
    });
  });
}

/**
 * Run one synthetic flow: login→preflight→session→director open→join→answer→close→reveal.
 * @returns {Promise<{ok: boolean, steps: string[], error?: string}>}
 */
export async function runSyntheticCastFlow() {
  const steps = [];
  try {
    // 1. Login (teacher session cookie)
    //    Login sahifasining SET-COOKIE'sini SAQLAYMIZ — aks holda POST yangi
    //    sessiya ochadi va CSRF mos kelmaydi (403).
    const loginPageRes = await fetch(`${BASE}/user/login`, { headers: { Cookie: cookieHeader() } });
    storeCookies(loginPageRes);
    const loginPage = await loginPageRes.text();
    const loginCsrf = csrfFrom(loginPage);
    if (!loginCsrf) throw new Error('login-csrf');
    const loginRes = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(),
      },
      body: new URLSearchParams({ username: USER, password: PASS, _csrf: loginCsrf }),
      redirect: 'manual',
    });
    storeCookies(loginRes);
    if (![200, 302].includes(loginRes.status)) throw new Error(`login:${loginRes.status}`);
    steps.push('login');

    // 2. CSRF token — panel'da req.session.csrfToken render qilinadi (64 hex)
    const panel = await (await fetch(`${BASE}/user/panel`, { headers: { Cookie: cookieHeader() } })).text();
    const csrf = csrfFrom(panel) || (panel.match(/[a-f0-9]{64}/) || [])[0];
    if (!csrf) throw new Error('panel-csrf');
    const csrfHeaders = { 'x-csrf-token': csrf };

    // 3. Preflight
    const pre = await fetchJson('/api/cast/preflight', {
      method: 'POST',
      headers: csrfHeaders,
      body: JSON.stringify({ source: SOURCE }),
    });
    if (!pre.ok) throw new Error('preflight');
    steps.push('preflight');
    const pfId = pre.preflightId;

    // 4. Session create
    const sess = await fetchJson('/api/cast/sessions', {
      method: 'POST',
      headers: csrfHeaders,
      body: JSON.stringify({ preflightId: pfId, source: SOURCE, presetId: 'responsive_accuracy', overrides: {} }),
    });
    if (!sess.ok || !sess.sessionId) throw new Error('session');
    const sid = sess.sessionId;
    steps.push(`session:${sid}`);

    // 5. Director socket — session boshqaruvi (session cookie bilan)
    //    NOTE: socket.io-client extraHeaders faqat POLLING transport'da yuboriladi
    //    (websocket handshake'da Cookie header tushmaydi) — shuning uchun
    //    polling birinchi bo'lib ishlatiladi.
    const directorSock = io(BASE, { transports: ['polling', 'websocket'], reconnection: false, extraHeaders: { Cookie: cookieHeader() } });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('director-connect-timeout')), 10000);
      directorSock.on('connect', async () => {
        clearTimeout(timer);
        try {
          await emitAck(directorSock, 'cast:directorJoin', { sessionId: sid });
          steps.push('directorJoin');
          resolve();
        } catch (e) { directorSock.close(); reject(e); }
      });
      directorSock.on('connect_error', () => { clearTimeout(timer); reject(new Error('director-connect-error')); });
    });

    // 6. Participant join — LOBBY ochiq holda (sessionStart keyin lobby'ni yopadi)
    const joinCode = sess.joinCode;
    const playerSock = io(BASE, { transports: ['polling', 'websocket'], reconnection: false });
    let participantId = null;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('player-timeout')), 15000);
      playerSock.on('connect', async () => {
        try {
          const joinAck = await emitAck(playerSock, 'cast:join', { sessionId: sid, payload: { joinCode, displayName: 'Synthetic', avatarId: 'synth', delivery: 'remote' } });
          steps.push('join');
          participantId = joinAck.participantId || null;
          resolve();
        } catch (e) { playerSock.close(); clearTimeout(timer); reject(e); }
      });
      playerSock.on('connect_error', () => { clearTimeout(timer); reject(new Error('player-connect-error')); });
    });

    // 7. Director: session start + question open
    await emitAck(directorSock, 'cast:sessionStart', { sessionId: sid });
    steps.push('sessionStart');

    // 8. Savol ochilishini kuting — preset'da thinkSeconds > 0 bo'lishi mumkin,
    //    shuning uchun cast:questionOpened broadcast event'i kelguncha kutamiz.
    //    Savollar seed bilan aralashtiriladi — haqiqiy questionId va option id'lar
    //    event payload'idan olinadi (q_01/o_a hardcode ishlamaydi).
    //    IMPORTANT: listener questionOpen yuborilishidan OLDIN o'rnatiladi —
    //    thinkSeconds=0 bo'lsa broadcast ack'dan oldin keladi va yo'qoladi (race).
    let openQuestion = null;
    const openedPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { playerSock.close(); reject(new Error('opened-event-timeout')); }, 15000);
      playerSock.once('cast:questionOpened', (ev) => {
        clearTimeout(timer);
        openQuestion = ev && ev.question ? ev.question : null;
        resolve();
      });
    });

    await emitAck(directorSock, 'cast:questionOpen', { sessionId: sid, payload: {} });
    steps.push('questionOpen');
    await openedPromise;

    if (!openQuestion || !openQuestion.questionId || !openQuestion.options || openQuestion.options.length === 0) {
      throw new Error('opened-event-malformed');
    }
    const answerQuestionId = openQuestion.questionId;
    const answerOptionId = openQuestion.options[0].id;

    // 9. Answer (opened savol, birinchi option)
    await emitAck(playerSock, 'cast:answerSubmit', { sessionId: sid, payload: { questionId: answerQuestionId, selectedOptionIds: [answerOptionId], attemptNo: 1 } });
    steps.push('answer');
    playerSock.close();

    // 10. Director close + reveal

    // 10. Director close + reveal
    await emitAck(directorSock, 'cast:questionClose', { sessionId: sid, payload: {} });
    steps.push('close');
    await emitAck(directorSock, 'cast:questionReveal', { sessionId: sid, payload: {} });
    steps.push('reveal');
    directorSock.close();

    return { ok: true, steps };
  } catch (err) {
    return { ok: false, steps, error: err.message };
  }
}

async function main() {
  if (!isFeatureEnabled('syntheticMonitor')) {
    console.log('[cast-synthetic-monitor] OFF (CAST_FEATURE_SYNTHETICMONITOR=off)');
    process.exit(0);
  }
  const run = async () => {
    const result = await runSyntheticCastFlow();
    const tag = result.ok ? '✅ OK' : '❌ FAIL';
    console.log(`[cast-synthetic-monitor] ${tag} steps=[${result.steps.join(', ')}]${result.error ? ' error=' + result.error : ''}`);
    if (!result.ok) process.exitCode = 1;
  };
  await run();
  if (INTERVAL > 0) {
    console.log(`[cast-synthetic-monitor] interval=${INTERVAL}s`);
    setInterval(run, INTERVAL * 1000);
  }
}

// Direct run (import qilinganda ham ishlaydi — test uchun)
if (process.argv[1] && process.argv[1].endsWith('cast-synthetic-monitor.js')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export default { runSyntheticCastFlow };
