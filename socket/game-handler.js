/**
 * Deborah — Socket.io Game Handlers
 * 
 * Manages real-time game events:
 * - Player join/leave lobby
 * - Question preview/active states
 * - Answer submission
 * - Score calculation
 * - Leaderboard display
 * - Game end
 * 
 * 🔒 Security: Host events validate ownership via socket.data + Firebase host grant
 * 🔒 Rate limiting: Optional per-event throttling via rateLimiter.wrap()
 * 🔒 Identity: HMAC-signed tickets + persistent host grants for reconnect
 */

import { fb } from '../firebase/admin.js';
import { normalizeQuestion, calculatePoints, buildLeaderboard, generateGameCode } from '../utils/helpers.js';
import { GAME_SETTINGS, CARTOON_CHARS } from '../utils/constants.js';

// ── Valid character images (for XSS prevention) ──
const VALID_CHAR_PATHS = new Set(CARTOON_CHARS.map(c => c.image));

// ── S16 BUG-100/101/102: kirish validatsiyasi ──
// fb lokal adapter '..' segmentlarni resolve QILADI (S15 BUG-093'dan ma'lum):
// socket 'code' parametri whitelist'siz fb path'ga tushardi — mavjudlik orakli
// (check-session/checkCode), arb. yo'l o'qish (rejoin/watch) va botAnswer'da
// playerName traversal bilan IXTIYORIY node'ga yozish mumkin edi.
const GAME_CODE_RE = /^\d{5}$/; // generateGameCode: 10000..99999
function validGameCode(code) {
  return typeof code === 'string' && GAME_CODE_RE.test(code) ? code : null;
}
function validPlayerName(name) {
  const s = typeof name === 'string' ? name.trim().slice(0, 30) : '';
  return (s && !/[.$#\[\]\/]/.test(s)) ? s : null;
}

const activeTimers = new Map();

export function setupSocketHandlers(io, socket, rateLimiter, identity) {
  const rl = rateLimiter || null; // Optional rate limiter
  const wrap = (event, handler) => rl ? rl.wrap(event, handler) : handler;
  const log = (...args) => console.log(`[Socket ${socket.id.slice(0, 8)}]`, ...args);

  // ABAC ownership check — uses identity middleware + host grant
  async function requireOwnership(code) {
    if (identity && typeof identity.checkOwnership === 'function') {
      const result = await identity.checkOwnership(socket, code);
      if (!result.authorized) {
        socket.emit('error', { message: result.reason || 'Siz bu o\'yinni boshqara olmaysiz' });
        return false;
      }
      return true;
    }
    // Fallback: legacy socket.data check
    if (socket.data.role === 'host' && socket.data.code === code) return true;
    socket.emit('error', { message: 'Siz bu o\'yinni boshqara olmaysiz' });
    return false;
  }

  // ── HOST: Create game session ──
  socket.on('host:create', wrap('host:create', async (data) => {
    try {
      const { settings } = data;
      // S16 BUG-105: socket orqali kelgan payload chegaralanmagan edi —
      // megabaytlab savol/matn saqlash (resurs). BUG-014 siyosati bilan izchil.
      const testName = String(data.testName || 'Test').trim().slice(0, 300) || 'Test';
      const hostName = String(data.hostName || 'Host').trim().slice(0, 60) || 'Host';
      const questions = Array.isArray(data.questions) ? data.questions : null;
      if (!questions || !questions.length) {
        return socket.emit('error', { message: 'Savollar yuborilmadi' });
      }
      if (questions.length > 300) {
        return socket.emit('error', { message: 'Test juda katta (≤300 savol)' });
      }
      let code = generateGameCode();
      
      let exists = await fb.get(`game_sessions/${code}`);
      while (exists.exists()) {
        code = generateGameCode();
        exists = await fb.get(`game_sessions/${code}`);
      }

      // S16 BUG-104: normalizeQuestion endi buxoro savollarni tashlaydi
      const normalizedQuestions = questions.map(normalizeQuestion).filter(Boolean);
      if (!normalizedQuestions.length) {
        return socket.emit('error', { message: "Savollar formati yaroqsiz (matn + kamida 2 variant + to'g'ri javob shart)" });
      }

      const sessionData = {
        host: hostName || 'Host',
        test_name: testName || 'Test',
        questions: normalizedQuestions,
        settings: {
          // S16 BUG-105: faqat ruxsat etilgan vaqt/tur qiymatlari
          time_per_q: GAME_SETTINGS.TIME_OPTIONS.includes(Number(settings?.timePerQ)) ? Number(settings.timePerQ) : GAME_SETTINGS.DEFAULT_TIME,
          type: ['score', 'speed'].includes(settings?.type) ? settings.type : 'score',
          auto: settings?.auto !== false,
          bg: Number.isInteger(+settings?.bg) ? Math.max(0, Math.min(8, +settings.bg)) : 0,
        },
        players: {},
        state: { status: 'waiting', q_index: 0, q_started_at: 0 },
        created_at: Date.now(),
      };

      await fb.set(`game_sessions/${code}`, sessionData);

      // Create persistent host grant for reconnect
      let hostTicket = null;
      if (identity && typeof identity.createHostGrant === 'function') {
        const grant = await identity.createHostGrant(code, hostName || 'Host');
        hostTicket = grant.ticket;
      }

      socket.join(`game:${code}`);
      socket.data.code = code;
      socket.data.role = 'host';

      log(`Host created game: ${code}`);
      socket.emit('host:created', { code, session: sessionData, hostTicket });
    } catch (err) {
      log('Error creating game:', err.message);
      socket.emit('error', { message: 'Failed to create game session' });
    }
  }));

  // ── PLAYER: Check if code exists ──
  socket.on('player:checkCode', wrap('player:checkCode', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      if (!code) return socket.emit('code:checked', { exists: false });
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
  }));

  // ── PLAYER: Check if name is available ──
  socket.on('player:checkName', wrap('player:checkName', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      const name = validPlayerName(data.name);
      if (!code || !name) return socket.emit('name:checked', { available: false });
      const snap = await fb.get(`game_sessions/${code}/players/${name}`);
      socket.emit('name:checked', { available: !snap.exists() });
    } catch (err) {
      socket.emit('error', { message: 'Server xatoligi. Qayta urinib koring.' });
    }
  }));

  // ── PLAYER: Rejoin session ──
  socket.on('player:rejoin', wrap('player:rejoin', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      if (!code) return socket.emit('rejoin:state', { status: 'expired' });
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
        name: n, emoji: p.emoji || '\u{1F464}'
      }));
      socket.emit('players:update', { players: playerList });
    } catch (err) {
      log('Error rejoining:', err.message);
    }
  }));

  // ── PLAYER: Join game (atomic name check) ──
  socket.on('player:join', wrap('player:join', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      if (!code) {
        return socket.emit('error', { message: "Noto'g'ri o'yin kodi" });
      }
      const { emoji } = data;
      const snap = await fb.get(`game_sessions/${code}`);
      
      if (!snap.exists()) {
        return socket.emit('error', { message: 'Bunday kod bilan o\'yin topilmadi' });
      }

      const session = snap.val();
      if (session.state?.status !== 'waiting') {
        return socket.emit('error', { message: 'O\'yin allaqachon boshlangan' });
      }

      const safeName = validPlayerName(data.playerName);
      if (!safeName) { // S16: validPlayerName regex bilan (traversal '.' ham yopilgan)
        return socket.emit('error', { message: 'Noto\'g\'ri ism formati' });
      }

      // Atomic-like name check: directly check the specific name, not the whole list
      const nameSnap = await fb.get(`game_sessions/${code}/players/${safeName}`);
      if (nameSnap.exists()) {
        return socket.emit('error', { message: 'Bu ism band. Boshqa ism tanlang' });
      }

      // Validate emoji — only allow known character paths or single emoji characters
      let safeEmoji = emoji || '\u{1F464}';
      if (!VALID_CHAR_PATHS.has(safeEmoji) && !/^\p{Extended_Pictographic}$/u.test(safeEmoji)) {
        safeEmoji = '\u{1F464}';
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
        name, emoji: p.emoji || '\u{1F464}'
      }));

      io.to(`game:${code}`).emit('players:update', { players: playerList });
      socket.emit('player:joined', { code, playerName: safeName });
    } catch (err) {
      log('Error joining game:', err.message);
      socket.emit('error', { message: 'O\'yinga qo\'shilishda xatolik' });
    }
  }));

  // ── HOST: Start game (ownership check) ──
  socket.on('host:start', wrap('host:start', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      if (!code) return;
      // ABAC ownership check
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

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
  }));

  // ── HOST: Next question (ownership check) ──
  socket.on('host:next', wrap('host:next', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      if (!code) return;
      const currentIndex = Number.isInteger(data.currentIndex) ? data.currentIndex : -1;
      // ABAC ownership check
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

      const snap = await fb.get(`game_sessions/${code}`);
      if (!snap.exists()) return;

      const session = snap.val();
      const questions = session.questions || [];
      const nextIdx = currentIndex + 1;

      if (nextIdx >= questions.length) {
        await endGame(io, fb, code, identity);
      } else {
        await showQuestionPreview(io, fb, code, nextIdx, session);
      }
    } catch (err) {
      log('Error advancing question:', err.message);
    }
  }));

  // ── PLAYER: Submit answer (server-authoritative) ──
  // SECURITY:
  //   - Server calculates elapsed time (client timeMs is IGNORED)
  //   - First answer is final (duplicates rejected via existence check)
  //   - Late/stale epoch answers rejected
  //   - Every answer gets a deterministic ACK
  socket.on('player:answer', wrap('player:answer', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      const { optionIndex, idempotencyKey } = data;
      const qIndex = Number.isInteger(data.qIndex) ? data.qIndex : -1;
      const playerName = socket.data.playerName;
      if (!playerName || !code || qIndex < 0) return;

      // 1. Validate answer format
      if (typeof optionIndex !== 'number' || optionIndex < 0) {
        return socket.emit('answer:ack', {
          status: 'rejected_invalid', qIndex,
          serverTimeMs: 0,
          reason: 'Noto\'g\'ri variant indeksi',
        });
      }

      // 2. Epoch check: verify the question is currently active
      const stateSnap = await fb.get(`game_sessions/${code}/state`);
      if (!stateSnap.exists()) {
        return socket.emit('answer:ack', {
          status: 'rejected_epoch', qIndex,
          serverTimeMs: 0,
          reason: 'O\'yin sessiyasi topilmadi',
        });
      }
      const state = stateSnap.val();
      if (state.status !== 'question_active' || state.q_index !== qIndex) {
        return socket.emit('answer:ack', {
          status: 'rejected_epoch', qIndex,
          serverTimeMs: 0,
          reason: 'Bu savol uchun javob qabul qilinmaydi',
        });
      }

      // 3. Server-authoritative time (ignore client timeMs)
      const serverTimeMs = Math.max(0, Date.now() - (state.q_started_at || Date.now()));

      // 4. Late check: reject if question time has expired
      const sessionSnap = await fb.get(`game_sessions/${code}`);
      if (!sessionSnap.exists()) return;
      const session = sessionSnap.val();
      const qTimeMs = (session.settings?.time_per_q || 20) * 1000;
      if (serverTimeMs > qTimeMs + 1000) { // 1s grace period
        return socket.emit('answer:ack', {
          status: 'rejected_late', qIndex,
          serverTimeMs,
          reason: 'Vaqt tugagan',
        });
      }

      // S16 BUG-103: variant indeksi savol variantlari sonidan oshmasin —
      // 999 kabi 'javoblar' qabul qilinib, answer:count/auto-advance buzilardi
      const curQ = (session.questions || [])[qIndex];
      if (!curQ || optionIndex >= (curQ.options || []).length) {
        return socket.emit('answer:ack', {
          status: 'rejected_invalid', qIndex,
          serverTimeMs: 0,
          reason: 'Bunday variant mavjud emas',
        });
      }

      // 5. Idempotency check: if this key was already accepted for this player, replay ACK
      if (idempotencyKey) {
        const myAnswerSnap = await fb.get(`game_sessions/${code}/answers/${qIndex}/${playerName}`);
        const myAnswer = myAnswerSnap.val();
        if (myAnswer && myAnswer.idempotencyKey === idempotencyKey) {
          // Same key -> verify optionIndex matches (prevents inconsistent retry)
          if (myAnswer.option !== optionIndex) {
            return socket.emit('answer:ack', {
              status: 'rejected_invalid', qIndex,
              serverTimeMs: 0,
              reason: 'Bu idempotencyKey bilan boshqa variant saqlangan',
            });
          }
          // Same key + same option -> return the same ACK (safe retry on network loss)
          return socket.emit('answer:ack', {
            status: 'accepted', qIndex,
            serverTimeMs: myAnswer.server_time_ms || serverTimeMs,
            idempotencyKey,
          });
        }
      }

      // 6. Duplicate check: first answer is final (also catches diff key from same player)
      const existingSnap = await fb.get(`game_sessions/${code}/answers/${qIndex}/${playerName}`);
      if (existingSnap.exists()) {
        return socket.emit('answer:ack', {
          status: 'rejected_duplicate', qIndex,
          serverTimeMs,
          reason: 'Javob allaqachon qabul qilingan',
        });
      }

      // 7. Server-authoritative write: store the answer
      const answerPayload = {
        option: optionIndex,
        server_time_ms: serverTimeMs,  // Server time, not client timeMs
        idempotencyKey: idempotencyKey || '',
        accepted_at: Date.now(),
      };

      await fb.set(`game_sessions/${code}/answers/${qIndex}/${playerName}`, answerPayload);

      // 8. Verify write integrity: re-read and confirm no race condition
      const verifySnap = await fb.get(`game_sessions/${code}/answers/${qIndex}/${playerName}`);
      const written = verifySnap.val();
      if (written && written.server_time_ms !== answerPayload.server_time_ms) {
        console.warn(`[RACE] Answer overwrite detected: ${playerName}@q${qIndex} in ${code}`);
      }

      // 9. Send ACK to the answering player
      socket.emit('answer:ack', {
        status: 'accepted', qIndex,
        serverTimeMs,
        idempotencyKey: idempotencyKey || '',
      });

      // 10. Broadcast answer count to all players
      const ansSnap = await fb.get(`game_sessions/${code}/answers/${qIndex}`);
      const answers = ansSnap.val() || {};
      const answerCount = Object.keys(answers).length;

      const playersSnap = await fb.get(`game_sessions/${code}/players`);
      const totalPlayers = Object.keys(playersSnap.val() || {}).length;

      io.to(`game:${code}`).emit('answer:count', {
        answered: answerCount, total: totalPlayers,
      });

      // Auto-advance if all answered
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
      socket.emit('answer:ack', {
        status: 'rejected_invalid', qIndex: data?.qIndex ?? -1,
        serverTimeMs: 0,
        reason: 'Server xatoligi',
      });
    }
  }));

  // ── HOST: Force next (ownership check) ──
  socket.on('host:forceNext', wrap('host:forceNext', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      if (!code) return;
      // ABAC ownership check
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

      const timers = activeTimers.get(code);
      if (timers) {
        Object.values(timers).forEach(t => clearTimeout(t));
        activeTimers.delete(code);
      }
      await computeScoresAndShowLB(io, fb, code, Number.isInteger(data.currentIndex) ? data.currentIndex : 0);
    } catch (err) {
      log('Error force next:', err.message);
    }
  }));

  // ── HOST: End game (ownership check) ──
  socket.on('host:end', wrap('host:end', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      if (!code) return;
      // ABAC ownership check
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

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
      await endGame(io, fb, code, identity);
    } catch (err) {
      log('Error ending game:', err.message);
    }
  }));

  // ── ARENA: Watch game state ──
  socket.on('arena:watch', wrap('arena:watch', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      if (!code) return;

      // Mark socket as watcher (read-only)
      socket.data.role = 'watcher';
      
      // Don't join game:code room — watchers get sanitized events
      // Instead, join a separate watcher room
      socket.join(`watch:${code}`);
      
      // Send sanitized state (no answer key, no question details)
      const snap = await fb.get(`game_sessions/${code}/state`);
      if (snap.exists()) {
        const raw = snap.val();
        // Public watchers only get: status, q_count, player_count, time
        socket.emit('arena:stateUpdate', {
          state: {
            status: raw.status,
            q_index: raw.q_index,
            q_time: raw.q_time,
            q_started_at: raw.q_started_at,
            // EXCLUDED: q_text, q_options, q_correct, q_is_double
            // EXCLUDED: leaderboard (player names)
          },
        });
      }
      
      // Send player count
      const playersSnap = await fb.get(`game_sessions/${code}/players`);
      if (playersSnap.exists()) {
        const playerCount = Object.keys(playersSnap.val()).length;
        socket.emit('arena:playerCount', { count: playerCount });
      }
    } catch (err) {
      log('Arena watch error:', err.message);
    }
  }));

  // ── ARENA: Bot answer (simulated player, same security checks as player:answer) ──
  // SECURITY: Same invariants as player:answer — epoch, duplicate, late checks
  socket.on('arena:botAnswer', wrap('arena:botAnswer', async (data) => {
    try {
      const code = validGameCode(data.code); // S16 BUG-101
      // S16 BUG-102: playerName sanitize QILINMAGAN edi — traversal bilan
      // (playerName='../../../users/X') fb.set IXTIYORIY node'ni yozib olardi
      const playerName = validPlayerName(data.playerName);
      const { optionIndex } = data;
      const qIndex = Number.isInteger(data.qIndex) ? data.qIndex : -1;
      if (!code || qIndex < 0) return;
      if (!playerName) {
        return socket.emit('arena:botAck', { status: 'rejected_invalid', qIndex, playerName: String(data.playerName || '').slice(0, 40), reason: "Noto'g'ri bot ismi" });
      }
      // Owner-only: only the host can add bot answers
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

      // 1. Validate answer format
      if (typeof optionIndex !== 'number' || optionIndex < 0) {
        return socket.emit('arena:botAck', {
          status: 'rejected_invalid', qIndex, playerName,
          reason: 'Noto\'g\'ri variant indeksi',
        });
      }

      // 2. Epoch check: verify the question is currently active
      const stateSnap = await fb.get(`game_sessions/${code}/state`);
      if (!stateSnap.exists()) {
        return socket.emit('arena:botAck', {
          status: 'rejected_epoch', qIndex, playerName,
          reason: 'O\'yin sessiyasi topilmadi',
        });
      }
      const state = stateSnap.val();
      if (state.status !== 'question_active' || state.q_index !== qIndex) {
        return socket.emit('arena:botAck', {
          status: 'rejected_epoch', qIndex, playerName,
          reason: 'Bu savol uchun javob qabul qilinmaydi',
        });
      }

      // 3. Server-authoritative time
      const serverTimeMs = Math.max(0, Date.now() - (state.q_started_at || Date.now()));

      // 4. Late check
      const sessionSnap = await fb.get(`game_sessions/${code}`);
      if (!sessionSnap.exists()) return;
      const session = sessionSnap.val();
      const qTimeMs = (session.settings?.time_per_q || 20) * 1000;
      if (serverTimeMs > qTimeMs + 1000) {
        return socket.emit('arena:botAck', {
          status: 'rejected_late', qIndex, playerName,
          serverTimeMs,
          reason: 'Vaqt tugagan',
        });
      }

      // S16 BUG-103: variant indeksi chegarasi (player:answer bilan izchil)
      const curQ = (session.questions || [])[qIndex];
      if (!curQ || optionIndex >= (curQ.options || []).length) {
        return socket.emit('arena:botAck', {
          status: 'rejected_invalid', qIndex, playerName,
          reason: 'Bunday variant mavjud emas',
        });
      }

      // 5. Duplicate check: first answer is final
      const existingSnap = await fb.get(`game_sessions/${code}/answers/${qIndex}/${playerName}`);
      if (existingSnap.exists()) {
        return socket.emit('arena:botAck', {
          status: 'rejected_duplicate', qIndex, playerName,
          serverTimeMs,
          reason: 'Javob allaqachon qabul qilingan',
        });
      }

      // 6. Server-authoritative write
      const answerPayload = {
        option: optionIndex,
        server_time_ms: serverTimeMs,
        accepted_at: Date.now(),
      };
      await fb.set(`game_sessions/${code}/answers/${qIndex}/${playerName}`, answerPayload);

      // 7. Verify write integrity
      const verifySnap = await fb.get(`game_sessions/${code}/answers/${qIndex}/${playerName}`);
      const written = verifySnap.val();
      if (written && written.server_time_ms !== answerPayload.server_time_ms) {
        console.warn(`[RACE] Bot answer overwrite: ${playerName}@q${qIndex} in ${code}`);
      }

      // 8. Send ACK
      socket.emit('arena:botAck', {
        status: 'accepted', qIndex, playerName,
        serverTimeMs,
      });

      // Count answers and broadcast
      const ansSnap = await fb.get(`game_sessions/${code}/answers/${qIndex}`);
      const answers = ansSnap.val() || {};
      const answerCount = Object.keys(answers).length;

      const playersSnap = await fb.get(`game_sessions/${code}/players`);
      const totalPlayers = Object.keys(playersSnap.val() || {}).length;

      io.to(`game:${code}`).emit('answer:count', {
        answered: answerCount, total: totalPlayers,
      });

      // Auto-advance if all answered
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
      socket.emit('arena:botAck', {
        status: 'rejected_invalid',
        qIndex: data?.qIndex ?? -1,
        playerName: data?.playerName ?? '',
        reason: 'Server xatoligi',
      });
    }
  }));

  // ── ARENA: Leave ──
  socket.on('arena:leave', (data) => {
    const code = validGameCode(data?.code); // S16 BUG-101
    if (code) {
      socket.leave(`game:${code}`);
      socket.leave(`watch:${code}`);
    }
  });

  // ── Disconnect ──
  // SECURITY: research.md 16.2 — disconnect playerni o'chirmasin, presence false qiladi
  // Answers are NEVER deleted on disconnect — they survive network interruptions
  socket.on('disconnect', async () => {
    const code = socket.data.code;
    const role = socket.data.role;
    const playerName = socket.data.playerName;

    if (code && role === 'player') {
      try {
        // Set presence to offline (DO NOT delete player or answers!)
        await fb.set(`game_sessions/${code}/players/${playerName}/presence`, 'offline');
        await fb.set(`game_sessions/${code}/players/${playerName}/last_seen`, Date.now());

        // Notify room about presence change
        io.to(`game:${code}`).emit('player:presence', {
          playerName,
          presence: 'offline',
        });

        // Refresh player list for lobby/leaderboard (backward compatibility)
        const playersSnap = await fb.get(`game_sessions/${code}/players`);
        const players = playersSnap.val() || {};
        const playerList = Object.entries(players).map(([n, p]) => ({
          name: n, emoji: p.emoji || '\u{1F464}', presence: p.presence || 'online',
        }));
        io.to(`game:${code}`).emit('players:update', { players: playerList });

        log(`Player ${playerName} went offline in ${code}`);
      } catch (err) {
        log('Error handling player disconnect:', err.message);
      }
    }

    if (code && role === 'host') {
      // Clean up timers on host disconnect
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

// ── Helper: Read private correct answer (Prompt 05 — answer-key separated) ──
async function getPrivateCorrect(fb, code, idx) {
  // 1. Try new private path
  try {
    const snap = await fb.get(`game_sessions/${code}/private/q_${idx}_correct`);
    if (snap.exists()) return snap.val();
  } catch (_) {}
  // 2. Fallback to legacy session.questions (in-flight games from before Prompt 05)
  try {
    const sessionSnap = await fb.get(`game_sessions/${code}`);
    if (sessionSnap.exists()) {
      const q = (sessionSnap.val()?.questions || [])[idx];
      if (q && typeof q.correct === 'number') return q.correct;
    }
  } catch (_) {}
  return null;
}

// ── Helper: Show question preview (public DTO — no answer key) ──
async function showQuestionPreview(io, fb, code, idx, session) {
  const questions = session.questions || [];
  const q = questions[idx];
  if (!q) return;

  const qTime = session.settings?.time_per_q || GAME_SETTINGS.DEFAULT_TIME;

  // Store public state WITHOUT correct answer — answer key is kept server-side only
  await fb.set(`game_sessions/${code}/state`, {
    status: 'question_preview',
    q_index: idx,
    q_text: q.text || '',
    q_options: q.options || [],
    q_is_double: !!q.is_double,
    q_time: qTime,
    q_started_at: 0,
  });

  // Store the correct answer in a PRIVATE path (never sent to clients)
  await fb.set(`game_sessions/${code}/private/q_${idx}_correct`, q.correct);

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

// ── Helper: Activate question (public DTO — no answer key) ──
async function activateQuestion(io, fb, code, idx, q, qTime) {
  const now = Date.now();

  await fb.update(`game_sessions/${code}/state`, {
    status: 'question_active',
    q_started_at: now,
  });

  // SECURITY: qCorrect is NEVER sent to clients — answer key is server-side only
  io.to(`game:${code}`).emit('game:questionActive', {
    qIndex: idx, qText: q.text, qOptions: q.options,
    qIsDouble: !!q.is_double,
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

    // Read the correct answer from the PRIVATE path (not from client-visible state)
    const correctAnswer = await getPrivateCorrect(fb, code, qIdx);

    const answersSnap = await fb.get(`game_sessions/${code}/answers/${qIdx}`);
    const answers = answersSnap.val() || {};
    const playersSnap = await fb.get(`game_sessions/${code}/players`);
    const players = playersSnap.val() || {};

    const updates = [];
    const qTimeMs = (session.settings?.time_per_q || 20) * 1000;

    for (const [pname, ans] of Object.entries(answers)) {
      // Use server-calculated time (server_time_ms), not client timeMs
      const elapsed = typeof ans.server_time_ms === 'number' ? ans.server_time_ms : (ans.time_ms || 0);
      const isCorrect = ans.option === correctAnswer;

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

    // Emit answer reveal with correct answer (only once per question, after scoring)
    const totalAnswered = Object.keys(answers).length;
    const totalCorrect = Object.values(answers).filter(a => a.option === correctAnswer).length;
    io.to(`game:${code}`).emit('game:answerReveal', {
      qIndex: qIdx,
      correctOptionIndex: correctAnswer,
      correctText: (q.options || [])[correctAnswer] || '',
      stats: {
        total: Object.keys(players).length,
        answered: totalAnswered,
        correct: totalCorrect,
        incorrect: totalAnswered - totalCorrect,
      },
    });
    // Mark as revealed to prevent double-fire on forceNext/end calls
    await fb.set(`game_sessions/${code}/state/q_${qIdx}_revealed`, true);
  } catch (err) {
    console.error('Score computation error:', err.message);
  }
}

// ── Helper: End game ──
async function endGame(io, fb, code, identity) {
  // Clean up all timers for this game
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

    // Revoke host grant on game end
    if (identity && typeof identity.revokeHostGrant === 'function') {
      await identity.revokeHostGrant(code);
    }

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

    // Schedule cleanup with TTL (5 minutes)
    setTimeout(async () => {
      try {
        await fb.remove(`game_sessions/${code}/answers`);
        await fb.remove(`game_sessions/${code}`);
        log(`Session ${code} cleaned up (TTL expired)`);
      } catch (_) {}
    }, 5 * 60 * 1000);
  } catch (err) {
    console.error('End game error:', err.message);
  }
}

// ── Periodic cleanup of expired sessions ──
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
        const timers = activeTimers.get(code);
        if (timers) {
          Object.values(timers).forEach(t => clearTimeout(t));
          activeTimers.delete(code);
        }
        // Also revoke host grant during cleanup
        await fb.remove(`game_sessions/${code}/answers`);
        await fb.remove(`game_sessions/${code}`);
        await fb.remove(`game_sessions/${code}/host_grant`);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`Session cleanup: ${cleaned} expired session(s) removed`);
    }
  } catch (_) {}
}, CLEANUP_INTERVAL);

console.log('   Periodic session cleanup active (every 60s)');
