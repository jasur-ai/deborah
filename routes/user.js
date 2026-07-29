/**
 * Edikit — User Panel Routes
 * Test CRUD, search, quiz taking, mock tests, PRE tests
 */

import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { requireVip, isCurrentUserVip } from '../middleware/vip.js';
import { DB_PATHS, GAME_SETTINGS, CARTOON_CHARS } from '../utils/constants.js';
import { normalizeQuestion } from '../utils/helpers.js';

const router = Router();

// → All routes require auth
router.use(requireAuth);

// ── User Panel ──
router.get('/panel', async (req, res) => {
  const user = req.session.user;
  try {
    // 🔒 Only load Mock/PRE data for VIP users (server-side hiding)
    const isVip = await isCurrentUserVip(req);
    
    const promises = [fb.get(`users/${user.safeKey}/tests`)];
    if (isVip) {
      promises.push(fb.get(DB_PATHS.MOCK_FANS));
      promises.push(fb.get(DB_PATHS.PRE_GROUPS));
    }
    
    const [testsSnap, fansSnap, preSnap] = await Promise.all(promises);

    const tests = testsSnap.val() || {};
    const fans = isVip ? (fansSnap?.val() || {}) : {};
    const preGroups = isVip ? (preSnap?.val() || {}) : {};

    res.render('user/panel', {
      title: 'Mening Panelim',
      tests: Object.entries(tests)
        .sort((a, b) => (b[1].created_at || b[1].created || 0) - (a[1].created_at || a[1].created || 0))
        .map(([key, t]) => ({
          key,
          name: t.name || t.title || 'Testsiz',
          count: t.questions?.length || t.count || 0,
          createdAt: t.created_at || t.created || 0,
          isPublic: !!t.isPublic,
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
      isVip,
    });
    // Update session with fresh isVip value
    req.session.user.isVip = isVip;
  } catch (err) {
    console.error('User panel error:', err);
    res.render('user/panel', {
      title: 'Mening Panelim',
      tests: [], fans: [], preGroups: [],
      characters: CARTOON_CHARS,
      username: user.username,
      isVip: false,
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

    // Preserve isPublic when editing
    let isPublic = false;
    if (editKey) {
      try {
        const existing = await fb.get(`users/${user.safeKey}/tests/${editKey}`);
        if (existing.exists()) {
          isPublic = !!existing.val().isPublic;
        }
      } catch (_) {}
    }

    const testData = {
      name: name.trim(),
      questions: questions.map(q => ({
        text: q.text || '',
        options: (q.options || []).map(o => String(o || '')),
        correct: typeof q.correct === 'number' ? q.correct : 0,
      })),
      count: questions.length,
      created_at: Date.now(),
      isPublic, // Preserved from existing test, default false
    };

    await fb.set(`users/${user.safeKey}/tests/${testKey}`, testData);

    // Sync public_tests on edit (name/count may have changed)
    if (isPublic) {
      await fb.update(`public_tests/${user.safeKey}__${testKey}`, {
        name: name.trim(),
        count: questions.length,
      });
    }

    res.json({ success: true, key: testKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete Test ──
router.post('/api/tests/delete', async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const testKey = req.body.key;
    
    // Remove from public_tests if was public
    const snap = await fb.get(`users/${userKey}/tests/${testKey}`);
    if (snap.exists() && snap.val().isPublic) {
      await fb.remove(`public_tests/${userKey}__${testKey}`);
    }
    
    await fb.remove(`users/${userKey}/tests/${testKey}`);
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

// ── Toggle Test Public/Private ──
router.post('/api/tests/toggle-public', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key required' });
    
    const userKey = req.session.user.safeKey;
    const snap = await fb.get(`users/${userKey}/tests/${key}`);
    if (!snap.exists()) return res.status(404).json({ error: 'Test topilmadi' });
    
    const test = snap.val();
    const newVal = !test.isPublic;
    const globalKey = `${userKey}__${key}`;
    
    await fb.update(`users/${userKey}/tests/${key}`, { isPublic: newVal });
    
    // Sync public_tests collection
    if (newVal) {
      await fb.set(`public_tests/${globalKey}`, {
        name: test.name || 'Test',
        authorName: req.session.user.username || userKey,
        authorUid: userKey,
        testKey: key,
        count: test.questions?.length || test.count || 0,
        created: Date.now(),
      });
    } else {
      await fb.remove(`public_tests/${globalKey}`);
    }
    
    res.json({ success: true, isPublic: newVal });
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
// 🔥 Uses public_tests collection for fast search (no full user scan)
// + current user's own tests
router.get('/api/tests/search', async (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase().trim();
    if (!query) return res.json({ results: [] });

    const currentUser = req.session?.user?.safeKey || '';
    const results = [];
    const seenKeys = new Set();

    // 1️⃣ Search public_tests collection (fast, indexed)
    try {
      const pubSnap = await fb.get('public_tests');
      if (pubSnap.exists()) {
        const pubTests = pubSnap.val();
        for (const [globalKey, pub] of Object.entries(pubTests)) {
          const testName = (pub.name || '').toLowerCase();
          if (!testName.includes(query)) continue;
          
          results.push({
            userName: pub.authorName || pub.authorUid || 'Noma\'lum',
            testName: pub.name || 'Test',
            testKey: pub.testKey,
            count: pub.count || 0,
          });
          seenKeys.add(globalKey);
        }
      }
    } catch (_) {}

    // 2️⃣ Also search current user's own tests (in case not public)
    if (currentUser) {
      try {
        const mySnap = await fb.get(`users/${currentUser}/tests`);
        if (mySnap.exists()) {
          const myTests = mySnap.val();
          for (const [testKey, test] of Object.entries(myTests)) {
            const testName = (test.name || '').toLowerCase();
            if (!testName.includes(query)) continue;
            
            const globalKey = `${currentUser}__${testKey}`;
            // Skip if already in results from public_tests
            if (seenKeys.has(globalKey)) continue;
            
            results.push({
              userName: req.session.user.username || currentUser,
              testName: test.name || 'Test',
              testKey,
              count: test.questions?.length || test.count || 0,
            });
          }
        }
      } catch (_) {}
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
