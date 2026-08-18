/**
 * Edikit — Game Routes
 * Host game page and Enter game page
 */

import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { requireVip } from '../middleware/vip.js';
import { CARTOON_CHARS, GAME_SETTINGS, DB_PATHS } from '../utils/constants.js';
import { normalizeQuestion } from '../utils/helpers.js';

const router = Router();

/**
 * Load questions from Firebase based on source type
 */
async function loadGameQuestions(source, key, chunk) {
  let questions = [];
  let testName = 'Test';

  try {
    if (source === 'user' && key) {
      const allUsersSnap = await fb.get('users');
      const users = allUsersSnap.val() || {};
      for (const [, userData] of Object.entries(users)) {
        if (userData.tests && userData.tests[key]) {
          const data = userData.tests[key];
          questions = (data.questions || []).map(normalizeQuestion).filter(Boolean);
          testName = data.name || key;
          break;
        }
      }
    } else if (source === 'mock' && key) {
      const snap = await fb.get(`${DB_PATHS.MOCK_FANS}/${key}`);
      if (snap.exists()) {
        const data = snap.val();
        const rawQs = data.questions || [];
        questions = rawQs.map(q => {
          const opts = q.options || [];
          const strings = opts.map(o => o.text || '');
          const correctIdx = opts.findIndex(o => o.isCorrect);
          return {
            text: q.text || '',
            options: strings,
            correct: correctIdx >= 0 ? correctIdx : 0,
            is_double: false
          };
        });
        testName = 'Mock: ' + (data.name || key);
      }
    } else if (source === 'pre' && key) {
      const snap = await fb.get(`${DB_PATHS.PRE_GROUPS}/${key}`);
      if (snap.exists()) {
        const data = snap.val();
        const chunks = data.chunks || [];
        const selectedChunk = chunk ? chunks.find(c => c.id === chunk) : chunks[0];
        if (selectedChunk) {
          const rawQs = selectedChunk.questions || [];
          questions = rawQs.map(q => {
            const opts = q.options || [];
            const strings = opts.map(o => o.text || '');
            const correctIdx = opts.findIndex(o => o.isCorrect);
            return {
              text: q.text || '',
              options: strings,
              correct: correctIdx >= 0 ? correctIdx : 0,
              is_double: false
            };
          });
          testName = `PRE: ${data.title} — ${selectedChunk.name}`;
        }
      }
    }
  } catch (err) {
    console.error('loadGameQuestions error:', err);
  }

  // Shuffle and limit for mock
  if (source === 'mock' && questions.length > GAME_SETTINGS.MOCK_COUNT) {
    questions = questions.sort(() => Math.random() - 0.5).slice(0, GAME_SETTINGS.MOCK_COUNT);
  }

  return { questions, testName };
}

// ── VIP gate: only allow VIP users for mock/pre sources ──
function vipGateForMockPre(req, res, next) {
  const { source } = req.query;
  if (source === 'mock' || source === 'pre') {
    return requireVip(req, res, next);
  }
  next();
}

// ── Host Game Page (with test data from query params) ──
router.get('/host', requireAuth, vipGateForMockPre, async (req, res) => {
  const { testName: tn, source, key, chunk, time, type, auto } = req.query;
  
  let questions = [];
  let testName = tn || 'Test';

  if (source && key) {
    const loaded = await loadGameQuestions(source, key, chunk);
    questions = loaded.questions;
    testName = loaded.testName;
  }

  // Cast modal settings
  const timePerQ = parseInt(time) || GAME_SETTINGS.DEFAULT_TIME;
  const gameType = type || 'score';
  const autoMode = auto !== '0'; // default true

  res.render('game/host', {
    title: 'Edikit — Host',
    characters: CARTOON_CHARS,
    timeOptions: GAME_SETTINGS.TIME_OPTIONS,
    defaultTime: GAME_SETTINGS.DEFAULT_TIME,
    existingCode: null,
    gameSess: {
      questions,
      test_name: testName,
      settings: { time_per_q: timePerQ, type: gameType, auto: autoMode, bg: 0 }
    },
  });
});

// ── Enter Game Page ──
router.get('/play', async (req, res) => {
  const code = req.query.code || '';

  // ── Cast participant boot: join code → session ID resolve ──
  if (code) {
    try {
      const { resolveSessionByCode } = await import('../services/cast/session-store.js');
      const sessionId = await resolveSessionByCode(code);
      if (sessionId) {
        const meta = await (await import('../services/cast/session-store.js')).getSessionMeta(sessionId);
        if (meta) {
          const fullConfig = await (await import('../services/cast/session-store.js')).getConfig(sessionId);
          return res.render('cast/participant', {
            title: 'Cast — Ishtirokchi',
            boot: {
              sessionId,
              role: 'participant',
              // C4-05: UI locale config'dan
              locale: fullConfig?.localization?.locale || 'uz-Latn',
              socketPath: '/socket.io',
              initialRevision: 1,
              title: meta.title || 'Cast',
              code,
              // C4-03: paper-card mode'ni client bilishi (card field ko'rsatish)
              config: {
                participation: fullConfig?.participation || {},
              },
            },
            characters: [],
          });
        }
      }
    } catch (err) {
      console.error('Cast play resolve error:', err.message);
    }
  }

  // Legacy non-Cast game enter
  res.render('game/enter', {
    title: 'Edikit — O\'yinga Kirish',
    characters: CARTOON_CHARS,
    initialCode: code,
  });
});

// ── Host Game (via direct link with existing code) ──
router.get('/host/:code', requireAuth, async (req, res) => {
  const { code } = req.params;
  try {
    const snap = await fb.get(`game_sessions/${code}`);
    if (!snap.exists()) return res.redirect('/user/panel');

    res.render('game/host', {
      title: `Edikit — ${code}`,
      characters: CARTOON_CHARS,
      timeOptions: GAME_SETTINGS.TIME_OPTIONS,
      defaultTime: GAME_SETTINGS.DEFAULT_TIME,
      existingCode: code,
      session: snap.val(),
    });
  } catch (err) {
    console.error('Host route error:', err);
    res.redirect('/user/panel');
  }
});

export default router;
