/**
 * Edikit — Authentication Routes
 * User login/register and admin login
 */

import { Router } from 'express';
import crypto from 'crypto';
import { fb } from '../firebase/admin.js';
import { safeKey } from '../utils/helpers.js';
import { ADMIN_USER, ADMIN_PASS } from '../utils/constants.js';
import { requireAuth, redirectIfAuth, redirectIfAdmin } from '../middleware/auth.js';

const router = Router();

// ── Admin Login Page ──
router.get('/admin/login', redirectIfAdmin, (req, res) => {
  res.render('admin/login', { title: 'Admin Login', error: null });
});

// ── Admin Login Action (rate-limited) ──
router.post('/admin/login', redirectIfAdmin, async (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.admin = {
      username: ADMIN_USER,
      loggedInAt: Date.now(),
    };
    return res.redirect('/admin/dashboard');
  }

  res.render('admin/login', {
    title: 'Admin Login',
    error: 'Login yoki parol noto\'g\'ri',
  });
});

// ── Admin Logout ──
router.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// ── User Login Page ──
router.get('/user/login', redirectIfAuth, (req, res) => {
  const mode = req.query.mode || 'login';
  res.render('user/login', { title: 'Kirish', mode, error: null });
});

// ── User Login Action (rate-limited) ──
router.post('/user/login', redirectIfAuth, async (req, res) => {
  const { username, password } = req.body;
  const mode = req.body.mode || 'login';

  if (!username || !password) {
    return res.render('user/login', {
      title: 'Kirish',
      mode,
      error: 'Ism va parolni kiriting',
    });
  }

  try {
    const snap = await fb.get(`users/${safeKey(username)}`);

    if (mode === 'login') {
      if (!snap.exists()) {
        return res.render('user/login', {
          title: 'Kirish',
          mode,
          error: 'Foydalanuvchi topilmadi',
        });
      }

      const userData = snap.val();
      const hashed = crypto.createHash('sha256')
        .update('qb_' + safeKey(username) + '_' + password)
        .digest('hex');

      if (userData.password === hashed) {
        // OK
      } else if (userData.password === password) {
        // Legacy plaintext password - upgrade to hash
        try {
          await fb.set(`users/${safeKey(username)}/password`, hashed);
        } catch (_) {}
      } else {
        return res.render('user/login', {
          title: 'Kirish',
          mode,
          error: 'Parol noto\'g\'ri',
        });
      }

      req.session.user = {
        username: userData.username || username,
        safeKey: safeKey(username),
      };

      return res.redirect('/user/panel');
    } else {
      // Register
      if (!/^[a-zA-Z0-9_]{2,20}$/.test(username)) {
        return res.render('user/login', {
          title: 'Ro\'yxatdan o\'tish',
          mode: 'reg',
          error: 'Faqat harf, raqam va _ (2–20 belgi)',
        });
      }

      if (password.length < 4) {
        return res.render('user/login', {
          title: 'Ro\'yxatdan o\'tish',
          mode: 'reg',
          error: 'Parol kamida 4 ta belgi',
        });
      }

      if (snap.exists()) {
        return res.render('user/login', {
          title: 'Ro\'yxatdan o\'tish',
          mode: 'reg',
          error: 'Bu nom band',
        });
      }

      const hashed = crypto.createHash('sha256')
        .update('qb_' + safeKey(username) + '_' + password)
        .digest('hex');

      await fb.set(`users/${safeKey(username)}`, {
        username: username.trim(),
        password: hashed,
        created_at: Date.now(),
        safeKey: safeKey(username),
      });

      req.session.user = {
        username: username.trim(),
        safeKey: safeKey(username),
      };

      return res.redirect('/user/panel');
    }
  } catch (err) {
    console.error('Auth error:', err);
    return res.render('user/login', {
      title: 'Xatolik',
      mode,
      error: 'Server xatoligi: ' + err.message,
    });
  }
});

// ── User Logout ──
router.get('/user/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

export default router;
