/**
 * Edikit — User Panel Routes
 * Test CRUD, search, quiz taking, mock tests, PRE tests
 */

import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { DB_PATHS, GAME_SETTINGS, CARTOON_CHARS } from '../utils/constants.js';
import { normalizeQuestion } from '../utils/helpers.js';

const router = Router();

// → All routes require auth
router.use(requireAuth);

// ── User Panel ──
router.get('/panel', async (req, res) => {
  const user = req.session.user;
  try {
    const [testsSnap, fansSnap, preSnap] = await Promise.all([
      fb.get(`users/${user.safeKey}/tests`),
      fb.get(DB_PATHS.MOCK_FANS),
      fb.get(DB_PATHS.PRE_GROUPS),
    ]);

    const tests = testsSnap.val() || {};
    const fans = fansSnap.val() || {};
    const preGroups = preSnap.val() || {};

    res.render('user/panel', {
      title: 'Mening Panelim',
      tests: Object.entries(tests)
        .sort((a, b) => (b[1].created_at || b[1].created || 0) - (a[1].created_at || a[1].created || 0))
        .map(([key, t]) => ({
          key,
          name: t.name || t.title || 'Testsiz',
          count: t.questions?.length || t.count || 0,
          createdAt: t.created_at || t.created || 0,
        })),
      fans: Object.entries(fans)
        .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''))
        .map(([key, f]) => ({
          key,
          name: f.name || key,
          count: f.count || (f.questions?.length || 0),
          createdAt: f.createdAt || 0,
        })),
      preGroups: Object.entries(preGroups)
        .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
        .map(([key, g]) => ({
          key,
          title: g.title || key,
          chunks: g.chunks || [],
          count: g.count || 0,
          total: g.total || 0,
        })),
      characters: CARTOON_CHARS,
      username: user.username,
    });
  } catch (err) {
    console.error('User panel error:', err);
    res.render('user/panel', {
      title: 'Mening Panelim',
      tests: [], fans: [], preGroups: [],
      characters: CARTOON_CHARS,
      username: user.username,
      error: err.message,
    });
  }
});

// ── Create Test Page ──
router.get('/create-test', async (req, res) => {
  const editKey = req.query.edit || null;
  let testData = null;

  if (editKey) {
    try {
      const snap = await fb.get(`users/${req.session.user.safeKey}/tests/${editKey}`);
      if (snap.exists()) testData = snap.val();
    } catch (_) {}
  }

  res.render('user/create-test', {
    title: editKey ? 'Testni tahrirlash' : 'Yangi test yaratish',
    editKey,
    testData,
    isEdit: !!editKey,
  });
});

// ── Save Test ──
router.post('/api/tests/save', async (req, res) => {
  try {
    const { name, questions, editKey } = req.body;
    const user = req.session.user;
    if (!name || !questions?.length) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    const testKey = editKey || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const testData = {
      name: name.trim(),
      questions: questions.map(q => ({
        text: q.text || '',
        options: (q.options || []).map(o => String(o || '')),
        correct: typeof q.correct === 'number' ? q.correct : 0,
      })),
      count: questions.length,
      created_at: Date.now(),
      isPublic: false, // 🔒 Private by default
    };

    await fb.set(`users/${user.safeKey}/tests/${testKey}`, testData);
    res.json({ success: true, key: testKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete Test ──
router.post('/api/tests/delete', async (req, res) => {
  try {
    await fb.remove(`users/${req.session.user.safeKey}/tests/${req.body.key}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Rename Test ──
router.post('/api/tests/rename', async (req, res) => {
  try {
    const { key, name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    await fb.update(`users/${req.session.user.safeKey}/tests/${key}`, { name: name.trim() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Take Quiz / Arena (split-screen view) ──
router.get('/test-arena', (req, res) => {
  const { source, key } = req.query;
  res.render('user/test-arena', {
    title: 'Edikit — Test Arena',
    characters: CARTOON_CHARS,
    initialCode: '',
    autoLoad: false,
    source: source || '',
    testKey: key || '',
  });
});

// ── Search tests ──
// 🔒 Privacy: only returns tests explicitly marked isPublic=true
// or tests belonging to the current user
router.get('/api/tests/search', async (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase().trim();
    if (!query) return res.json({ results: [] });

    const snap = await fb.get('users');
    const users = snap.val() || {};
    const results = [];
    const currentUser = req.session?.user?.safeKey || '';

    for (const [userId, userData] of Object.entries(users)) {
      if (!userData.tests) continue;
      for (const [testKey, test] of Object.entries(userData.tests)) {
        const testName = (test.name || '').toLowerCase();
        if (!testName.includes(query)) continue;

        // 🔒 Only show public tests or the current user's own tests
        const isOwn = userId === currentUser;
        if (!isOwn && !test.isPublic) continue;

        results.push({
          userName: userData.username || userId,
          testName: test.name || 'Test',
          testKey,
          count: test.questions?.length || test.count || 0,
        });
      }
    }

    res.json({ results: results.slice(0, 30) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeMockQuestions(questions) {
  return (questions || []).map(q => {
    const opts = q.options || [];
    const strings = opts.map(o => o.text || '');
    const correctIdx = opts.findIndex(o => o.isCorrect);
    return {
      text: q.text || '',
      options: strings,
      correct: correctIdx >= 0 ? correctIdx : 0,
      is_double: false,
    };
  }).filter(Boolean);
}

export default router;
