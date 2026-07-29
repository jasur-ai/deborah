/**
 * Edikit — Socket.io Game Handlers
 * 
 * Manages real-time game events:
 * - Player join/leave lobby
 * - Question preview/active states
 * - Answer submission
 * - Score calculation
 * - Leaderboard display
 * - Game end
 * 
 * 🔒 Security: Host events validate ownership via socket.data
 */

import { fb } from '../firebase/admin.js';
import { normalizeQuestion, calculatePoints, buildLeaderboard, generateGameCode } from '../utils/helpers.js';
import { GAME_SETTINGS, CARTOON_CHARS } from '../utils/constants.js';

// ── Valid character images (for XSS prevention) ──
const VALID_CHAR_PATHS = new Set(CARTOON_CHARS.map(c => c.image));

const activeTimers = new Map();

export function setupSocketHandlers(io, socket) {
  const log = (...args) => console.log(`[Socket ${socket.id.slice(0, 8)}]`, ...args);

  // ── HOST: Create game session ──
  socket.on('host:create', async (data) => {
    try {
      const { testName, questions, settings, hostName } = data;
      let code = generateGameCode();
      
      let exists = await fb.get(`game_sessions/${code}`);
      while (exists.exists()) {
        code = generateGameCode();
        exists = await fb.get(`game_sessions/${code}`);
      }

      const normalizedQuestions = (questions || []).map(normalizeQuestion).filter(Boolean);

      const sessionData = {
        host: hostName || 'Host',
        test_name: testName || 'Test',
        questions: normalizedQuestions,
        settings: {
          time_per_q: settings?.timePerQ || GAME_SETTINGS.DEFAULT_TIME,
          type: settings?.type || 'score',
          auto: settings?.auto !== false,
          bg: settings?.bg || 0,
        },
        players: {},
        state: { status: 'waiting', q_index: 0, q_started_at: 0 },
        created_at: Date.now(),
      };

      await fb.set(`game_sessions/${code}`, sessionData);

      socket.join(`game:${code}`);
      socket.data.code = code;
      socket.data.role = 'host';

      log(`Host created game: ${code}`);
      socket.emit('host:created', { code, session: sessionData });
    } catch (err) {
      log('Error creating game:', err.message);
      socket.emit('error', { message: 'Failed to create game session' });
    }
  });

  // ── PLAYER: Check if code exists ──
  socket.on('player:checkCode', async (data) => {
    try {
      const { code } = data;
      const snap = await fb.get(`game_sessions/${code}`);
      if (snap.exists()) {
        const session = snap.val();
        const status = session?.state?.status || 'waiting';
        socket.emit('code:checked', { exists: true, status });
      } else {
        socket.emit('code:checked', { exists: false });
      }
    } catch (err) {
      socket.emit('code:checked', { exists: false });
    }
  });

  // ── PLAYER: Check if name is available ──
  socket.on('player:checkName', async (data) => {
    try {
      const { code, name } = data;
      const snap = await fb.get(`game_sessions/${code}/players/${name}`);
      socket.emit('name:checked', { available: !snap.exists() });
    } catch (err) {
      socket.emit('error', { message: 'Server xatoligi. Qayta urinib koring.' });
    }
  });

  // ── PLAYER: Rejoin session ──
  socket.on('player:rejoin', async (data) => {
    try {
      const { code } = data;
      const snap = await fb.get(`game_sessions/${code}`);
      if (!snap.exists()) {
        socket.emit('rejoin:state', { status: 'expired' });
        return;
      }
      
      const session = snap.val();
      
      socket.join(`game:${code}`);
      socket.data.code = code;
      socket.data.playerName = data.name;
      socket.data.role = 'player';
      
      // Send current players list
      const playersSnap = await fb.get(`game_sessions/${code}/players`);
      const players = playersSnap.val() || {};
      const playerList = Object.entries(players).map(([n, p]) => ({
        name: n, emoji: p.emoji || '👤'
      }));
      socket.emit('players:update', { players: playerList });
    } catch (err) {
      log('Error rejoining:', err.message);
    }
  });

  // ── PLAYER: Join game (atomic name check) ──
  socket.on('player:join', async (data) => {
    try {
      const { code, playerName, emoji } = data;
      const snap = await fb.get(`game_sessions/${code}`);
      
      if (!snap.exists()) {
        return socket.emit('error', { message: 'Bunday kod bilan o\'yin topilmadi' });
      }

      const session = snap.val();
      if (session.state?.status !== 'waiting') {
        return socket.emit('error', { message: 'O\'yin allaqachon boshlangan' });
      }

      const safeName = playerName.trim().slice(0, 30);
      if (!safeName || /[.$#\[\]\/]/.test(safeName)) {
        return socket.emit('error', { message: 'Noto\'g\'ri ism formati' });
      }

      // 🛡️ Atomic-like name check: directly check the specific name, not the whole list
      const nameSnap = await fb.get(`game_sessions/${code}/players/${safeName}`);
      if (nameSnap.exists()) {
        return socket.emit('error', { message: 'Bu ism band. Boshqa ism tanlang' });
      }

      // 🛡️ Validate emoji — only allow known character paths or single emoji characters
      let safeEmoji = emoji || '👤';
      if (!VALID_CHAR_PATHS.has(safeEmoji) && !/^\p{Extended_Pictographic}$/u.test(safeEmoji)) {
        safeEmoji = '👤';
      }

      await fb.set(`game_sessions/${code}/players/${safeName}`, {
        emoji: safeEmoji, joined_at: Date.now(), score: 0, totalTime: 0,
      });

      socket.join(`game:${code}`);
      socket.data.code = code;
      socket.data.playerName = safeName;
      socket.data.role = 'player';

      log(`Player ${safeName} joined game ${code}`);

      const playersSnap = await fb.get(`game_sessions/${code}/players`);
      const players = playersSnap.val() || {};
      const playerList = Object.entries(players).map(([name, p]) => ({
        name, emoji: p.emoji || '👤'
      }));

      io.to(`game:${code}`).emit('players:update', { players: playerList });
      socket.emit('player:joined', { code, playerName: safeName });
    } catch (err) {
      log('Error joining game:', err.message);
      socket.emit('error', { message: 'O\'yinga qo\'shilishda xatolik' });
    }
  });

  // ── HOST: Start game (ownership check) ──
  socket.on('host:start', async (data) => {
    try {
      const { code } = data;
      // 🔒 Ownership check
      if (socket.data.role !== 'host' || socket.data.code !== code) {
        return socket.emit('error', { message: 'Siz bu o\'yinni boshqara olmaysiz' });
      }

      const snap = await fb.get(`game_sessions/${code}`);
      if (!snap.exists()) return;

      const session = snap.val();
      const questions = session.questions || [];

      if (!questions.length) {
        return socket.emit('error', { message: 'Savollar topilmadi' });
      }

      await showQuestionPreview(io, fb, code, 0, session);
    } catch (err) {
      log('Error starting game:', err.message);
    }
  });

  // ── HOST: Next question (ownership check) ──
  socket.on('host:next', async (data) => {
    try {
      const { code, currentIndex } = data;
      // 🔒 Ownership check
      if (socket.data.role !== 'host' || socket.data.code !== code) {
        return socket.emit('error', { message: 'Siz bu o\'yinni boshqara olmaysiz' });
      }

      const snap = await fb.get(`game_sessions/${code}`);
      if (!snap.exists()) return;

      const session = snap.val();
      const questions = session.questions || [];
      const nextIdx = currentIndex + 1;

      if (nextIdx >= questions.length) {
        await endGame(io, fb, code);
      } else {
        await showQuestionPreview(io, fb, code, nextIdx, session);
      }
    } catch (err) {
      log('Error advancing question:', err.message);
    }
  });

  // ── PLAYER: Submit answer ──
  socket.on('player:answer', async (data) => {
    try {
      const { code, qIndex, optionIndex, timeMs } = data;
      const playerName = socket.data.playerName;
      if (!playerName || !code) return;

      await fb.set(`game_sessions/${code}/answers/${qIndex}/${playerName}`, {
        option: optionIndex, time_ms: timeMs || 0,
      });

      const ansSnap = await fb.get(`game_sessions/${code}/answers/${qIndex}`);
      const answers = ansSnap.val() || {};
      const answerCount = Object.keys(answers).length;

      const playersSnap = await fb.get(`game_sessions/${code}/players`);
      const totalPlayers = Object.keys(playersSnap.val() || {}).length;

      io.to(`game:${code}`).emit('answer:count', {
        answered: answerCount, total: totalPlayers,
      });

      // Auto-advance if all answered
      const sessionSnap = await fb.get(`game_sessions/${code}`);
      const session = sessionSnap.val();
      if (session?.settings?.auto !== false && answerCount >= totalPlayers) {
        const timers = activeTimers.get(code);
        if (timers?.autoNext) clearTimeout(timers.autoNext);
        const autoTimer = setTimeout(async () => {
          await computeScoresAndShowLB(io, fb, code, qIndex);
        }, 800);
        activeTimers.set(code, { ...activeTimers.get(code), autoNext: autoTimer });
      }
    } catch (err) {
      log('Error submitting answer:', err.message);
    }
  });

  // ── HOST: Force next (ownership check) ──
  socket.on('host:forceNext', async (data) => {
    try {
      const { code } = data;
      // 🔒 Ownership check
      if (socket.data.role !== 'host' || socket.data.code !== code) {
        return socket.emit('error', { message: 'Siz bu o\'yinni boshqara olmaysiz' });
      }

      const timers = activeTimers.get(code);
      if (timers) {
        Object.values(timers).forEach(t => clearTimeout(t));
        activeTimers.delete(code);
      }
      await computeScoresAndShowLB(io, fb, code, data.currentIndex);
    } catch (err) {
      log('Error force next:', err.message);
    }
  });

  // ── HOST: End game (ownership check) ──
  socket.on('host:end', async (data) => {
    try {
      const { code } = data;
      // 🔒 Ownership check
      if (socket.data.role !== 'host' || socket.data.code !== code) {
        return socket.emit('error', { message: 'Siz bu o\'yinni boshqara olmaysiz' });
      }

      const timers = activeTimers.get(code);
      if (timers) {
        Object.values(timers).forEach(t => clearTimeout(t));
        activeTimers.delete(code);
      }
      // Compute scores for current question before ending
      const snap = await fb.get(`game_sessions/${code}/state`);
      if (snap.exists()) {
        const state = snap.val();
        if (state.status === 'question_active' || state.status === 'question_preview') {
          await computeScoresAndShowLB(io, fb, code, state.q_index || 0);
        }
      }
      await endGame(io, fb, code);
    } catch (err) {
      log('Error ending game:', err.message);
    }
  });

  // ── ARENA: Watch game state ──
  socket.on('arena:watch', async (data) => {
    try {
      const { code } = data;
      if (!code) return;
      
      socket.join(`game:${code}`);
      
      // Send current state immediately
      const snap = await fb.get(`game_sessions/${code}/state`);
      if (snap.exists()) {
        socket.emit('arena:stateUpdate', { state: snap.val() });
      }
    } catch (err) {
      log('Arena watch error:', err.message);
    }
  });

  // ── ARENA: Bot answer (simulated player) ──
  socket.on('arena:botAnswer', async (data) => {
    try {
      const { code, qIndex, playerName, optionIndex, timeMs } = data;
      if (!code || !playerName) return;
      // Validate socket is watching this game
      if (!socket.rooms?.has(`game:${code}`)) return;

      // Write answer to Firebase
      await fb.set(`game_sessions/${code}/answers/${qIndex}/${playerName}`, {
        option: optionIndex, time_ms: timeMs || 0,
      });

      // Count answers and broadcast
      const ansSnap = await fb.get(`game_sessions/${code}/answers/${qIndex}`);
      const answers = ansSnap.val() || {};
      const answerCount = Object.keys(answers).length;

      const playersSnap = await fb.get(`game_sessions/${code}/players`);
      const totalPlayers = Object.keys(playersSnap.val() || {}).length;

      // Emit to all players in the game (host sees real-time count)
      io.to(`game:${code}`).emit('answer:count', {
        answered: answerCount, total: totalPlayers,
      });

      // Auto-advance if all answered
      const sessionSnap = await fb.get(`game_sessions/${code}`);
      const session = sessionSnap.val();
      if (session?.settings?.auto !== false && answerCount >= totalPlayers) {
        const timers = activeTimers.get(code);
        if (timers?.autoNext) clearTimeout(timers.autoNext);
        const autoTimer = setTimeout(async () => {
          await computeScoresAndShowLB(io, fb, code, qIndex);
        }, 800);
        activeTimers.set(code, { ...activeTimers.get(code), autoNext: autoTimer });
      }
    } catch (err) {
      log('Arena bot answer error:', err.message);
    }
  });

  // ── ARENA: Leave ──
  socket.on('arena:leave', (data) => {
    const { code } = data;
    if (code) socket.leave(`game:${code}`);
  });

  // ── Disconnect ──
  socket.on('disconnect', async () => {
    const code = socket.data.code;
    const role = socket.data.role;
    const playerName = socket.data.playerName;

    if (code && role === 'player') {
      try {
        await fb.remove(`game_sessions/${code}/players/${playerName}`);
        const answersSnap = await fb.get(`game_sessions/${code}/answers`);
        if (answersSnap.exists()) {
          const answers = answersSnap.val();
          Object.keys(answers).forEach(qIdx => {
            if (answers[qIdx][playerName]) {
              fb.remove(`game_sessions/${code}/answers/${qIdx}/${playerName}`);
            }
          });
        }
        const playersSnap = await fb.get(`game_sessions/${code}/players`);
        const players = playersSnap.val() || {};
        const playerList = Object.entries(players).map(([n, p]) => ({
          name: n, emoji: p.emoji || '👤'
        }));
        io.to(`game:${code}`).emit('players:update', { players: playerList });
      } catch (err) {
        log('Error cleaning up disconnected player:', err.message);
      }
    }

    if (code && role === 'host') {
      // 🧹 Clean up timers on host disconnect
      const timers = activeTimers.get(code);
      if (timers) {
        Object.values(timers).forEach(t => clearTimeout(t));
        activeTimers.delete(code);
      }
      io.to(`game:${code}`).emit('host:disconnected', { message: 'Host disconnected' });
    }

    log(`Disconnected: ${role || 'unknown'} from ${code || 'unknown'}`);
  });
}

// ── Helper: Show question preview ──
async function showQuestionPreview(io, fb, code, idx, session) {
  const questions = session.questions || [];
  const q = questions[idx];
  if (!q) return;

  const qTime = session.settings?.time_per_q || GAME_SETTINGS.DEFAULT_TIME;

  await fb.set(`game_sessions/${code}/state`, {
    status: 'question_preview',
    q_index: idx,
    q_text: q.text || '',
    q_options: q.options || [],
    q_correct: q.correct,
    q_is_double: !!q.is_double,
    q_time: qTime,
    q_started_at: 0,
  });

  io.to(`game:${code}`).emit('game:questionPreview', {
    qIndex: idx,
    totalQuestions: questions.length,
    qText: q.text,
    qIsDouble: !!q.is_double,
    countdown: GAME_SETTINGS.PREVIEW_COUNTDOWN,
  });

  const timers = activeTimers.get(code) || {};
  timers.previewTimer = setTimeout(async () => {
    await activateQuestion(io, fb, code, idx, q, qTime);
  }, GAME_SETTINGS.PREVIEW_COUNTDOWN * 1000);
  activeTimers.set(code, timers);
}

// ── Helper: Activate question ──
async function activateQuestion(io, fb, code, idx, q, qTime) {
  const now = Date.now();

  await fb.update(`game_sessions/${code}/state`, {
    status: 'question_active',
    q_started_at: now,
  });

  io.to(`game:${code}`).emit('game:questionActive', {
    qIndex: idx, qText: q.text, qOptions: q.options,
    qCorrect: q.correct, qIsDouble: !!q.is_double,
    qTime: qTime, startedAt: now,
  });

  const timers = activeTimers.get(code) || {};
  timers.questionTimer = setTimeout(async () => {
    const sessionSnap = await fb.get(`game_sessions/${code}`);
    const session = sessionSnap.val();
    if (session?.settings?.auto !== false) {
      await computeScoresAndShowLB(io, fb, code, idx);
    }
  }, qTime * 1000 + 500);
  activeTimers.set(code, timers);
}

// ── Helper: Compute scores and show leaderboard ──
async function computeScoresAndShowLB(io, fb, code, qIdx) {
  const timers = activeTimers.get(code);
  if (timers?.autoNext) clearTimeout(timers.autoNext);

  try {
    const sessionSnap = await fb.get(`game_sessions/${code}`);
    if (!sessionSnap.exists()) return;
    const session = sessionSnap.val();
    const questions = session.questions || [];
    const q = questions[qIdx];
    if (!q) return;

    const answersSnap = await fb.get(`game_sessions/${code}/answers/${qIdx}`);
    const answers = answersSnap.val() || {};
    const playersSnap = await fb.get(`game_sessions/${code}/players`);
    const players = playersSnap.val() || {};

    const updates = [];
    const qTimeMs = (session.settings?.time_per_q || 20) * 1000;

    for (const [pname, ans] of Object.entries(answers)) {
      const isCorrect = ans.option === q.correct;
      const elapsed = ans.time_ms || 0;

      const curTime = players[pname]?.totalTime || 0;
      const newTime = curTime + elapsed;
      updates.push(fb.set(`game_sessions/${code}/players/${pname}/totalTime`, newTime));

      if (!isCorrect) continue;

      const pts = calculatePoints(elapsed, qTimeMs, isCorrect, q.is_double, session.settings?.type);
      const curScore = players[pname]?.score || 0;
      const newScore = curScore + pts;
      updates.push(fb.set(`game_sessions/${code}/players/${pname}/score`, newScore));
    }

    await Promise.all(updates);

    const updatedPlayersSnap = await fb.get(`game_sessions/${code}/players`);
    const updatedPlayers = updatedPlayersSnap.val() || {};
    const lb = buildLeaderboard(updatedPlayers);
    const isLast = qIdx >= (questions.length - 1);

    await fb.set(`game_sessions/${code}/state`, {
      status: 'leaderboard',
      q_index: qIdx,
      leaderboard: lb,
    });

    io.to(`game:${code}`).emit('game:leaderboard', {
      leaderboard: lb, isLast, qIndex: qIdx,
      autoNext: session.settings?.auto !== false,
      autoDelay: GAME_SETTINGS.AUTO_LB_DELAY,
    });
  } catch (err) {
    console.error('Score computation error:', err.message);
  }
}

// ── Helper: End game ──
async function endGame(io, fb, code) {
  // 🧹 Clean up all timers for this game
  const timers = activeTimers.get(code);
  if (timers) {
    Object.values(timers).forEach(t => clearTimeout(t));
    activeTimers.delete(code);
  }

  try {
    const playersSnap = await fb.get(`game_sessions/${code}/players`);
    const allPlayers = playersSnap.val() || {};
    const allSorted = buildLeaderboard(allPlayers);
    const top7 = allSorted.slice(0, GAME_SETTINGS.LEADERBOARD_TOP);

    const sessionSnap = await fb.get(`game_sessions/${code}`);
    const session = sessionSnap.val();

    await fb.set(`results/${code}`, {
      test_name: session?.test_name || 'Test',
      host: session?.host || '',
      date: Date.now(),
      totalPlayers: allSorted.length,
      leaderboard: top7,
    });

    await fb.update(`game_sessions/${code}/state`, {
      status: 'ended',
      leaderboard: allSorted,
      ended_at: Date.now(),
    });

    io.to(`game:${code}`).emit('game:ended', {
      leaderboard: allSorted,
      top7,
    });

    // 🧹 Schedule cleanup with TTL (5 minutes)
    setTimeout(async () => {
      try {
        // Also delete answers to free space
        await fb.remove(`game_sessions/${code}/answers`);
        await fb.remove(`game_sessions/${code}`);
        log(`Session ${code} cleaned up (TTL expired)`);
      } catch (_) {}
    }, 5 * 60 * 1000);
  } catch (err) {
    console.error('End game error:', err.message);
  }
}

// ── 🧹 Periodic cleanup of expired sessions ──
// Runs every 60 seconds and cleans up stale game sessions
const CLEANUP_INTERVAL = 60 * 1000;
setInterval(async () => {
  try {
    const sessionsSnap = await fb.get('game_sessions');
    if (!sessionsSnap.exists()) return;
    
    const sessions = sessionsSnap.val();
    const now = Date.now();
    let cleaned = 0;

    for (const [code, session] of Object.entries(sessions)) {
      // Clean up sessions older than 1 hour
      const created = session.created_at || 0;
      if (now - created > 60 * 60 * 1000) {
        // Clean up timers
        const timers = activeTimers.get(code);
        if (timers) {
          Object.values(timers).forEach(t => clearTimeout(t));
          activeTimers.delete(code);
        }
        await fb.remove(`game_sessions/${code}/answers`);
        await fb.remove(`game_sessions/${code}`);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`🧹 Session cleanup: ${cleaned} expired session(s) removed`);
    }
  } catch (_) {}
}, CLEANUP_INTERVAL);

console.log('   🧹 Periodic session cleanup active (every 60s)');
