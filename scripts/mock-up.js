/**
 * Edikit — Cast Test Bot (mock-up.js)
 * 
 * Socket.io-based bot simulator for real-time testing.
 * Bot answers emit arena:botAnswer events so host sees live answer counts.
 *
 * ISHLATISH:
 *   node scripts/mock-up.js <KOD> [o'yinchilar_soni] [togri_foiz] [javob_foiz]
 *   Masalan: node scripts/mock-up.js 48213 20 0.7 0.95
 */

import { io } from 'socket.io-client';
import { fb } from '../firebase/admin.js';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const code = process.argv[2];
const PLAYER_COUNT = parseInt(process.argv[3] || '20', 10);
const CORRECT_RATE = parseFloat(process.argv[4] || '0.7');
const ANSWER_RATE = parseFloat(process.argv[5] || '0.95');
const MIN_DELAY_MS = 400;
const MAX_DELAY_BUFFER_MS = 600;

if (!code) {
  console.error('❌ Foydalanish: node scripts/mock-up.js <KOD> [o\'yinchilar_soni] [togri_foiz] [javob_foiz]');
  console.error('   Masalan: node scripts/mock-up.js 48213 20 0.7 0.95');
  process.exit(1);
}

// Character image paths (matching CARTOON_CHARS in constants)
const CHAR_IMGS = [
  'characters/white-fury.png','characters/green-hulk.png','characters/blue-flash.png',
  'characters/red-phoenix.png','characters/purple-shadow.png','characters/gold-lion.png',
  'characters/silver-wolf.png','characters/cyan-dragon.png','characters/pink-rose.png',
  'characters/orange-tiger.png','characters/white-fox.png','characters/black-panther.png',
  'characters/emerald-snake.png','characters/crimson-hawk.png','characters/sapphire-owl.png',
  'characters/amber-falcon.png','characters/jade-serpent.png','characters/ruby-sparrow.png',
  'characters/cobalt-raven.png','characters/violet-phoenix.png'
];

const BOT_PREFIX = 'Bot';

function log(...args) { console.log(new Date().toLocaleTimeString('uz-UZ'), '|', ...args); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const botNames = Array.from({ length: PLAYER_COUNT }, (_, i) => `${BOT_PREFIX}${i + 1}`);

// ── 1. Botlarni Firebase'ga qo'shish ──
async function joinAll() {
  log(`🎮 Kod: ${code} — ${PLAYER_COUNT} ta bot qo'shilmoqda...`);
  const sessSnap = await fb.get(`game_sessions/${code}/state`);
  if (!sessSnap.exists()) {
    console.error('❌ Bunday kod bilan o\'yin topilmadi. Avval host-game.html\'da cast yarating.');
    process.exit(1);
  }
  const updates = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    updates.push(
      fb.set(`game_sessions/${code}/players/${botNames[i]}`, {
        emoji: CHAR_IMGS[i % CHAR_IMGS.length],
        joined_at: Date.now(),
        score: 0,
        totalTime: 0,
      })
    );
  }
  await Promise.all(updates);
  log(`✅ ${PLAYER_COUNT} ta bot lobby'ga qo'shildi. Endi host-game.html'da "O'yinni Boshlash" tugmasini bosing.`);
}

// ── 2. Socket.io orqali o'yin holatini kuzatish ──
let processedQIdx = -1;

function watchGame() {
  log('👀 O\'yin holatini kuzatish boshlandi... (Ctrl+C bilan to\'xtatish mumkin)');
  const socket = io(SERVER_URL);

  socket.on('connect', () => {
    log(`🔌 Socket ulandi: ${socket.id}`);
    socket.emit('arena:watch', { code });
  });

  socket.on('arena:stateUpdate', (data) => {
    const st = data.state;
    if (!st) return;

    if (st.status === 'question_active' && st.q_index !== processedQIdx) {
      processedQIdx = st.q_index;
      scheduleAnswers(socket, st);
    } else if (st.status === 'leaderboard') {
      log(`🏆 Shoxsupa ko'rsatilmoqda (savol ${(st.q_index ?? 0) + 1} dan keyin)`);
    } else if (st.status === 'ended') {
      const lb = st.leaderboard || [];
      log('🎉 O\'YIN TUGADI! Yakuniy natijalar:');
      lb.forEach((p, i) => log(`   ${i + 1}. ${p.emoji || ''} ${p.name} — ${p.score} ball`));
      log('✅ Test muvaffaqiyatli yakunlandi.');
      socket.close();
      process.exit(0);
    }
  });

  socket.on('connect_error', (err) => {
    log(`⚠️ Socket ulanish xatosi: ${err.message}`);
    log(`   Server: ${SERVER_URL} — ishlayotganiga ishonch hosil qiling`);
  });

  socket.on('disconnect', () => {
    log('🔌 Socket uzildi, qayta ulanmoqda...');
  });
}

// ── 3. Bot javoblarini schedule qilish ──
function scheduleAnswers(socket, st) {
  const qIndex = st.q_index;
  const qTimeMs = (st.q_time || 20) * 1000;
  const correctIdx = typeof st.q_correct === 'number' ? st.q_correct : 0;
  const numOptions = (st.q_options || []).length || 4;
  const startedAt = st.q_started_at || Date.now();
  const alreadyElapsed = Date.now() - startedAt;
  const maxDelay = Math.max(MIN_DELAY_MS, qTimeMs - MAX_DELAY_BUFFER_MS - alreadyElapsed);

  log(`📝 Savol ${qIndex + 1} faollashdi — ${PLAYER_COUNT} ta bot javob tayyorlamoqda (vaqt: ${Math.round(qTimeMs / 1000)}s)`);

  botNames.forEach((name, i) => {
    if (Math.random() > ANSWER_RATE) {
      log(`⏱️ ${name} — vaqt tugashini kutadi (javob bermaydi)`);
      return;
    }
    const isCorrect = Math.random() < CORRECT_RATE;
    let opt;
    if (isCorrect) { opt = correctIdx; }
    else { do { opt = Math.floor(Math.random() * numOptions); } while (opt === correctIdx && numOptions > 1); }

    const delay = randInt(MIN_DELAY_MS, Math.max(MIN_DELAY_MS, maxDelay));
    setTimeout(() => {
      socket.emit('arena:botAnswer', {
        code,
        qIndex,
        playerName: name,
        optionIndex: opt,
        timeMs: Math.round(delay),
      });
      const mark = opt === correctIdx ? '✅' : '❌';
      log(`${mark} ${name} -> variant ${opt} (${delay}ms)`);
    }, delay + i * 30); // Stagger starts slightly
  });
}

// ── Cleanup on exit ──
process.on('SIGINT', async () => {
  log('\n🧹 To\'xtatilmoqda... Bot o\'yinchilarni lobbydan o\'chirishni xohlaysizmi? (avtomatik o\'chirilmaydi)');
  log('   Qo\'lda tozalash uchun browser\'da Test Arena ochib "Tozalash" tugmasini bosing.');
  process.exit(0);
});

// ── Start ──
(async () => {
  await joinAll();
  watchGame();
})();
