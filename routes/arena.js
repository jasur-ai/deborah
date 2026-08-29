/**
 * Deborah — Arena Routes (Public)
 * Split-screen test arena: host + phone + bot simulation
 */

import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { CARTOON_CHARS } from '../utils/constants.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// ── Main Arena Page ──
router.get('/', (req, res) => {
  const code = req.query.code || '';
  const auto = req.query.auto === '1';
  res.render('user/test-arena', {
    title: 'Deborah — Test Arena',
    characters: CARTOON_CHARS,
    initialCode: code,
    autoLoad: auto,
  });
});

// ── API: Check if session exists (public — anyone can check) ──
router.get('/api/check-session', async (req, res) => {
  try {
    // S16 BUG-100: kod whitelist'siz fb path'ga tushardi — '?code=../users'
    // bilan IXTIYORIY fb node mavjudligini tekshirish orakli (public endpoint!)
    const code = req.query.code;
    if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return res.json({ exists: false });
    const snap = await fb.get(`game_sessions/${code}`);
    res.json({ exists: snap.exists() });
  } catch (err) {
    res.json({ exists: false, error: err.message });
  }
});

// ── API: Add bots to session (admin only — modifies game state) ──
router.post('/api/add-bots', requireAdmin, async (req, res) => {
  try {
    const { count, prefix } = req.body;
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return res.status(400).json({ error: 'Invalid params' }); // S16 BUG-100
    if (!count) return res.status(400).json({ error: 'Invalid params' });

    const stSnap = await fb.get(`game_sessions/${code}/state`);
    if (!stSnap.exists()) return res.status(404).json({ error: 'Sessiya topilmadi' });

    const botCount = Math.min(50, Math.max(1, parseInt(count, 10) || 15));
    const botPrefix = prefix || 'Bot';
    const updates = [];

    for (let i = 1; i <= botCount; i++) {
      const charIdx = (i - 1) % CARTOON_CHARS.length;
      updates.push(
        fb.set(`game_sessions/${code}/players/${botPrefix}${i}`, {
          emoji: CARTOON_CHARS[charIdx].image,
          joined_at: Date.now(),
          score: 0,
          totalTime: 0,
        })
      );
    }

    await Promise.all(updates);
    res.json({ success: true, count: botCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Cleanup bots from session (admin only) ──
router.post('/api/cleanup-bots', requireAdmin, async (req, res) => {
  try {
    const { prefix } = req.body;
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return res.status(400).json({ error: 'Invalid params' }); // S16 BUG-100

    const botPrefix = prefix || 'Bot';
    const removes = [];

    for (let i = 1; i <= 50; i++) {
      removes.push(fb.remove(`game_sessions/${code}/players/${botPrefix}${i}`));
    }

    await Promise.all(removes);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
