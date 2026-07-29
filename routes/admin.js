/**
 * Edikit — Admin Panel Routes
 * Users, Fans (Mock), PRE Tests, Results, Stats
 */

import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { requireAdmin } from '../middleware/auth.js';
import { DB_PATHS } from '../utils/constants.js';
import { safeKey } from '../utils/helpers.js';

const router = Router();

router.use(requireAdmin);

// ── Dashboard ──
router.get('/dashboard', async (req, res) => {
  try {
    const [usersSnap, gamesSnap, fansSnap] = await Promise.all([
      fb.get(DB_PATHS.USERS),
      fb.get(DB_PATHS.GAME_SESSIONS),
      fb.get(DB_PATHS.MOCK_FANS),
    ]);

    const users = usersSnap.val() || {};
    let totalTests = 0;
    Object.values(users).forEach(u => {
      totalTests += u.tests ? Object.keys(u.tests).length : 0;
    });

    const stats = {
      usersCount: Object.keys(users).length,
      gamesCount: gamesSnap.exists() ? Object.keys(gamesSnap.val() || {}).length : 0,
      testsCount: totalTests,
      fansCount: fansSnap.exists() ? Object.keys(fansSnap.val() || {}).length : 0,
    };

    res.render('admin/dashboard', {
      title: 'Admin Panel',
      stats,
      users: Object.entries(users)
        .sort((a, b) => (b[1].created_at || 0) - (a[1].created_at || 0))
        .map(([key, u]) => ({
          key,
          username: u.username || key,
          password: (u.password || '—').length === 64 ? (u.password || '—').slice(0, 12) + '…' : (u.password || '—'),
          created_at: u.created_at || 0,
          tests: u.tests ? Object.keys(u.tests).length : 0,
        })),
      fans: [],
      preGroups: [],
      results: [],
      activeTab: req.query.tab || 'danger',
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.render('admin/dashboard', {
      title: 'Admin Panel',
      stats: { usersCount: 0, gamesCount: 0, testsCount: 0, fansCount: 0 },
      users: [], fans: [], preGroups: [], results: [],
      activeTab: 'danger',
      error: err.message,
    });
  }
});

// ── API: Load fans ──
router.get('/api/fans', async (req, res) => {
  try {
    const snap = await fb.get(DB_PATHS.MOCK_FANS);
    const fans = snap.val() || {};
    const list = Object.entries(fans)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''))
      .map(([key, f]) => ({
        key, name: f.name || key,
        count: f.count || (f.questions ? f.questions.length : 0),
        createdAt: f.createdAt || 0,
      }));
    res.json({ fans: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Save fan ──
router.post('/api/fans/save', async (req, res) => {
  try {
    const { name, questions } = req.body;
    if (!name || !questions?.length) return res.status(400).json({ error: 'Invalid data' });
    const fanKey = safeKey(name) + '_' + Date.now().toString(36);
    const slim = questions.map(q => ({
      num: q.num, text: q.text, correctLetter: q.correctLetter, correctText: q.correctText,
      options: q.options.map(o => ({ text: o.text, letter: o.letter, isCorrect: o.isCorrect }))
    }));
    await fb.set(`${DB_PATHS.MOCK_FANS}/${fanKey}`, { name: name.trim(), count: slim.length, questions: slim, createdAt: Date.now() });
    res.json({ success: true, key: fanKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Delete fan ──
router.post('/api/fans/delete', async (req, res) => {
  try {
    await fb.remove(`${DB_PATHS.MOCK_FANS}/${req.body.key}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Update fan questions ──
router.post('/api/fans/update', async (req, res) => {
  try {
    const { key, questions } = req.body;
    const slim = questions.map(q => ({
      num: q.num, text: q.text, correctLetter: q.correctLetter,
      correctText: q.correctText,
      options: q.options.map(o => ({ text: o.text, letter: o.letter, isCorrect: o.isCorrect }))
    }));
    await fb.set(`${DB_PATHS.MOCK_FANS}/${key}/questions`, slim);
    await fb.set(`${DB_PATHS.MOCK_FANS}/${key}/count`, slim.length);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Load PRE groups ──
router.get('/api/pre-groups', async (req, res) => {
  try {
    const snap = await fb.get(DB_PATHS.PRE_GROUPS);
    const groups = snap.val() || {};
    const list = Object.entries(groups)
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
      .map(([key, g]) => ({
        key, title: g.title || key, chunks: g.chunks || [],
        total: g.total || 0, count: g.count || 0, createdAt: g.createdAt || 0,
      }));
    res.json({ groups: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Save PRE test (supports editKey for editing existing groups) ──
router.post('/api/pre-groups/save', async (req, res) => {
  try {
    const { title, chunks, editKey } = req.body;
    if (!title || !chunks?.length) return res.status(400).json({ error: 'Invalid data' });

    let groupKey = editKey || null;

    if (!groupKey) {
      const groupsSnap = await fb.get(DB_PATHS.PRE_GROUPS);
      const groups = groupsSnap.val() || {};
      for (const [k, g] of Object.entries(groups)) {
        if (g.title === title.trim()) { groupKey = k; break; }
      }
    }

    if (!groupKey) groupKey = safeKey(title) + '_' + Date.now().toString(36);

    const chunkList = chunks.map(c => ({
      id: c.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: c.name || `Subtest ${(c.index || 0) + 1}`,
      questions: c.questions || [],
      count: c.questions?.length || 0,
    }));

    const total = chunkList.reduce((sum, c) => sum + c.count, 0);

    await fb.set(`${DB_PATHS.PRE_GROUPS}/${groupKey}`, {
      title: title.trim(), chunks: chunkList, total, count: chunkList.length,
      createdAt: Date.now(), authorUid: DB_PATHS.PRE_AUTHOR_UID,
    });

    res.json({ success: true, key: groupKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Delete PRE group ──
router.post('/api/pre-groups/delete', async (req, res) => {
  try { await fb.remove(`${DB_PATHS.PRE_GROUPS}/${req.body.key}`); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Delete user ──
router.post('/api/users/delete', async (req, res) => {
  try { await fb.remove(`${DB_PATHS.USERS}/${req.body.key}`); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Get results ──
router.get('/api/results', async (req, res) => {
  try {
    const snap = await fb.get(DB_PATHS.RESULTS);
    const data = snap.val() || {};
    const list = Object.entries(data)
      .sort((a, b) => (b[1].date || 0) - (a[1].date || 0))
      .map(([code, r]) => ({
        code, testName: r.test_name || 'Test', host: r.host || '',
        date: r.date || 0, totalPlayers: r.totalPlayers || 0,
        leaderboard: r.leaderboard || [],
      }));
    res.json({ results: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Delete result ──
router.post('/api/results/delete', async (req, res) => {
  try { await fb.remove(`${DB_PATHS.RESULTS}/${req.body.code}`); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Get stats ──
router.get('/api/stats', async (req, res) => {
  try {
    const [usersSnap, gamesSnap, fansSnap, resultsSnap] = await Promise.all([
      fb.get(DB_PATHS.USERS), fb.get(DB_PATHS.GAME_SESSIONS),
      fb.get(DB_PATHS.MOCK_FANS), fb.get(DB_PATHS.RESULTS),
    ]);

    const users = usersSnap.val() || {};
    let totalTests = 0;
    Object.values(users).forEach(u => totalTests += u.tests ? Object.keys(u.tests).length : 0);

    const games = gamesSnap.val() || {};
    let activeGames = 0;
    Object.values(games).forEach(g => { if (g.state?.status && g.state.status !== 'ended') activeGames++; });

    const results = resultsSnap.val() || {};
    let totalPlayers = 0;
    Object.values(results).forEach(r => totalPlayers += r.totalPlayers || 0);

    const fans = fansSnap.val() || {};
    const fanStats = Object.entries(fans).map(([k, f]) => ({
      name: f.name || k, count: f.count || (f.questions?.length || 0), attempts: f.attempts || 0,
    }));

    res.json({
      userCount: Object.keys(users).length, totalTests, activeGames,
      resultsCount: Object.keys(results).length, totalPlayers,
      fansCount: Object.keys(fans).length, fanStats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
