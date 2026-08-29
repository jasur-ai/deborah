/**
 * STEP 16 REPRO — o'yin/arena qatlami bug'lari isboti (BUG-100..106). Run: node scripts/repro-step16.mjs (PORT 4616)
 */
const PORT = 4616;
const BASE = `http://localhost:${PORT}`;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s16repro.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const { normalizeQuestion } = await import('../utils/helpers.js');

// victim user (botAnswer traversal target)
const vk = safeKey('repro_s16_victim');
await fb.set(`users/${vk}`, { username: 'repro_s16_victim', email: 'v@test.uz', email_verified: true, role: 'student', role_version: 1, password: hashPass('parol-2026-x-uzun', vk), created_at: Date.now() });

// auth user (host sahifasi uchun)
const hk = safeKey('repro_s16_h');
await fb.set(`users/${hk}`, { username: 'repro_s16_h', email: 'h@test.uz', email_verified: true, role: 'teacher', role_version: 1, password: hashPass('parol-2026-x-uzun', hk), created_at: Date.now() });

const { spawn } = await import('node:child_process');
const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), ADMIN_USER: 'repro_admin', ADMIN_PASS: 'repro-pass-123', LOG_LEVEL: 'silent' },
  stdio: 'pipe',
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), 25000);
  const check = async () => { try { const r = await fetch(`${BASE}/health`); if (r.ok) { clearTimeout(t); resolve(); } } catch (_) { setTimeout(check, 400); } };
  setTimeout(check, 1500);
  srv.on('exit', (c) => reject(new Error('exited ' + c)));
});
console.log('server OK');

const { io } = await import('socket.io-client');
let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' (' + extra + ')' : ''}`); ok ? pass++ : fail++; };

// ── BUG-104: normalizeQuestion birlik darajasi ──
{
  const r1 = normalizeQuestion({ text: 'OK?', options: [{ text: 'A', isCorrect: true }, { text: 'B' }] });
  const r2 = normalizeQuestion({ text: 'OK?', options: [{ text: 'A' }, { text: 'B' }] }); // isCorrect YO'Q
  const r3 = normalizeQuestion({ text: '  ', options: ['a', 'b'], correct: 0 }); // matn yo'q
  const r4 = normalizeQuestion({ text: 'x', options: ['a'], correct: 0 }); // 1 variant
  const r5 = normalizeQuestion({ text: 'x', options: ['a', 'b', 'c'], correct: 99 }); // correct chiroqdan tashqari
  check(r1 && r1.correct === 0, 'BUG-104 PRE format sog\\u2018lom saqlanadi', JSON.stringify(r1));
  check(r2 === null, 'BUG-104 PRE format isCorrect siz → null (avval correct=-1)', String(r2));
  check(r3 === null && r4 === null, 'BUG-104 matnsiz/1-variantli → null', `${r3}/${r4}`);
  check(r5 && r5.correct === 2, 'BUG-104 correct=99 → clamp 2 (avval 99 saqlanardi)', String(r5 && r5.correct));
}

// ── Socket ulanish ──
const hostS = io(BASE, { transports: ['websocket'] });
await new Promise((r) => hostS.on('connect', r));
const emitP = (sock, ev, data, ackEv, timeout = 6000) => new Promise((resolve) => {
  const t = setTimeout(() => resolve({ __timeout: true }), timeout);
  sock.once(ackEv, (d) => { clearTimeout(t); resolve(d); });
  sock.emit(ev, data);
});

// ── BUG-100: /arena/api/check-session traversal (public HTTP) ──
{
  const r = await fetch(`${BASE}/arena/api/check-session?code=${encodeURIComponent('../users')}`);
  const j = await r.json();
  check(j.exists === false, 'BUG-100 check-session ?code=../users → exists:false (avval true — oracle)', JSON.stringify(j));
  const r2 = await fetch(`${BASE}/arena/api/check-session?code=..%2F..%2Fusers`);
  const j2 = await r2.json();
  check(j2.exists === false, 'BUG-100 check-session boshqa traversal shakli → false', JSON.stringify(j2));
}

// ── BUG-101: socket code traversal ──
{
  const d = await emitP(hostS, 'player:checkCode', { code: '../users' }, 'code:checked');
  check(d.exists === false, 'BUG-101 player:checkCode traversal → false', JSON.stringify(d));
  const d2 = await emitP(hostS, 'player:rejoin', { code: '../users' }, 'rejoin:state');
  check(d2.status === 'expired', 'BUG-101 player:rejoin traversal → expired', JSON.stringify(d2));
  const d3 = await emitP(hostS, 'player:checkName', { code: '../users', name: '../../../x' }, 'name:checked');
  check(d3.available === false, 'BUG-101 player:checkName traversal name → false', JSON.stringify(d3));
}

// ── BUG-105: host:create bounds ──
{
  const big = Array.from({ length: 301 }, (_, i) => ({ text: 'q' + i, options: ['a', 'b'], correct: 0 }));
  const d = await emitP(hostS, 'host:create', { testName: 'x'.repeat(400), questions: big, hostName: 'H' }, 'error', 8000);
  check(d && d.message && d.message.includes('300'), 'BUG-105 301 savol → xato', d && d.message);
  const d2 = await emitP(hostS, 'host:create', { testName: 'T', questions: [{ text: 'faqat matn', options: ['a'] }], hostName: 'H' }, 'error');
  check(d2 && d2.message && d2.message.includes('yaroqsiz'), 'BUG-105/104 buxoro savol → xato', d2 && d2.message);
}

// ── Baxtli yo'l + qolgan buglar (haqiqiy sessiya bilan) ──
const QUESTIONS = [
  { text: '2+2=?', options: ['3', '4', '5'], correct: 1 },
  { text: 'Poytaxt?', options: ['Samarqand', 'Toshkent'], correct: 1 },
];
let gameCode = null;
{
  const created = await emitP(hostS, 'host:create', { testName: 'S16 repro', questions: QUESTIONS, hostName: 'Host16', settings: { timePerQ: 10, type: 'score', auto: true } }, 'host:created');
  gameCode = created.code;
  check(/^\d{5}$/.test(gameCode) && created.session.questions.length === 2, 'host:create oddiy → OK', String(gameCode));
  check(created.session.settings.time_per_q === 10, 'BUG-105 settings time 10 qabul (whitelist)', String(created.session.settings.time_per_q));

  const pl = io(BASE, { transports: ['websocket'] });
  await new Promise((r) => pl.on('connect', r));
  const badJoin = await emitP(pl, 'player:join', { code: '../users', playerName: 'X', emoji: '😀' }, 'error');
  check(badJoin && badJoin.message && badJoin.message.includes('kod'), 'BUG-101 player:join traversal code → xato', badJoin && badJoin.message);
  const joined = await emitP(pl, 'player:join', { code: gameCode, playerName: 'O\'yinchi1', emoji: '😀' }, 'player:joined');
  check(joined && joined.playerName === 'O\'yinchi1', 'player:join oddiy → OK', JSON.stringify(joined));

  // host:end cleanup timers; start
  const started = await new Promise((resolve) => {
    let done = false;
    pl.once('game:questionActive', (d) => { if (!done) { done = true; resolve(d); } });
    hostS.emit('host:start', { code: gameCode });
    setTimeout(async () => {
      if (!done) { done = true; resolve(await fb.get(`game_sessions/${gameCode}`) ? { __late: true } : null); }
    }, 9000);
  });
  check(started && started.qIndex === 0 && Array.isArray(started.qOptions), 'host:start → savol aktiv (preview 3s)', started && started.qText);

  // BUG-103: optionIndex=999
  const ackBad = await emitP(pl, 'player:answer', { code: gameCode, qIndex: 0, optionIndex: 999 }, 'answer:ack');
  check(ackBad.status === 'rejected_invalid', 'BUG-103 optionIndex=999 → rejected_invalid (avval qabul qilinardi)', ackBad.status + '/' + (ackBad.reason || ''));

  // to'g'ri javob (correct=1)
  const ack = await emitP(pl, 'player:answer', { code: gameCode, qIndex: 0, optionIndex: 1, idempotencyKey: 'k1' }, 'answer:ack');
  check(ack.status === 'accepted', 'to\\u2018g\\u2018ri javob qabul', ack.status);

  // idempotency replay
  const replay = await emitP(pl, 'player:answer', { code: gameCode, qIndex: 0, optionIndex: 1, idempotencyKey: 'k1' }, 'answer:ack');
  check(replay.status === 'accepted' && replay.serverTimeMs === ack.serverTimeMs, 'idempotency replay bir xil ACK', replay.status);

  // BUG-102: botAnswer traversal playerName
  const botAck = await emitP(hostS, 'arena:botAnswer', { code: gameCode, qIndex: 0, playerName: '../../../../../../users/' + vk, optionIndex: 0 }, 'arena:botAck', 4000);
  const victimSnap = await fb.get(`users/${vk}`);
  const victimAfter = victimSnap && typeof victimSnap.val === 'function' ? victimSnap.val() : victimSnap;
  check(!!victimAfter && victimAfter.username === 'repro_s16_victim' && typeof victimAfter.password === 'string' && victimAfter.password.length >= 32, 'BUG-102 botAnswer traversal → victim BUTUNLAY SAQLANDI (avval yozilardi)', JSON.stringify(victimAfter).slice(0, 90));
  check(botAck && botAck.status === 'rejected_invalid', 'BUG-102 botAck rejected qaytdi', JSON.stringify(botAck).slice(0, 60));

  // leaderboard: hammasi javob berdi (1 player) → auto advance
  const lb = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 8000);
    pl.once('game:leaderboard', (d) => { clearTimeout(t); resolve(d); });
  });
  check(lb && lb.leaderboard && lb.leaderboard[0] && lb.leaderboard[0].score >= 100, 'leaderboard ball hisoblandi (o\'yin mantiq butun)', lb && JSON.stringify(lb.leaderboard[0]));

  // host:end
  const ended = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 6000);
    pl.once('game:ended', (d) => { clearTimeout(t); resolve(d); });
    hostS.emit('host:end', { code: gameCode });
  });
  check(ended && Array.isArray(ended.leaderboard), 'host:end → o\'yin yakuni', ended && String(ended.leaderboard.length));
  pl.disconnect();
}

// ── BUG-106: /game/host/:code traversal (auth) ──
{
  const { default: Supertest } = await import('supertest');
  const agent = Supertest.agent(BASE);
  const seen = new Map();
  const collect = (r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });
  const pg = await agent.get('/user/login?lang=uz'); collect(pg);
  const csrf0 = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const li = await agent.post('/user/login').type('form').send({ mode: 'login', username: 'repro_s16_h', password: 'parol-2026-x-uzun', _csrf: csrf0, lang: 'uz' }); collect(li);
  collect(await agent.get('/user/panel'));
  const r1 = await agent.get('/host/abc');
  check(r1.status === 302, 'BUG-106 /host/abc (kod formati emas) → redirect (avval fb.get+render)', String(r1.status));
  const r2 = await agent.get(`/host/${gameCode}`);
  check(r2.status === 200, 'BUG-106 haqiqiy kod bilan host sahifa → 200', String(r2.status));
}

hostS.disconnect();
srv.kill();
console.log(`\n${fail === 0 ? '_HAMMASI OK (STEP 16)' : 'XATOLAR BOR: ' + fail} — ${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
