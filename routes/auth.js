/**
 * Edikit — Authentication Routes
 * User login/register and admin login
 *
 * Security:
 *   - Admin credentials from CONFIG (Zod-validated env) — no hardcoded fallback
 *   - User passwords hashed with argon2id (memory-hard, salt included)
 *   - Legacy SHA-256 hashes auto-migrated on successful login
 *   - CSRF validation active on all POST endpoints
 *   - Rate-limited login routes (15 min window, 20 attempts)
 */

import { Router } from 'express';
import crypto from 'crypto';
import CONFIG from '../src/config/env.js';
import { fb } from '../firebase/admin.js';
import { safeKey, hashPassword, verifyPassword, isLegacyHash, hashPass } from '../utils/helpers.js';
import { redirectIfAuth, redirectIfAdmin } from '../middleware/auth.js';

const router = Router();

// ── Admin Login Page ──
router.get('/admin/login', redirectIfAdmin, (req, res) => {
  res.render('admin/login', { title: 'Admin Login', error: null });
});

// ── Admin Login Action (rate-limited, CSRF-protected, session regeneration) ──
router.post('/admin/login', redirectIfAdmin, async (req, res) => {
  const { username, password } = req.body;

  // Credentials from CONFIG (Zod-validated, no hardcoded defaults)
  if (username === CONFIG.ADMIN_USER && password === CONFIG.ADMIN_PASS) {
    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        return res.render('admin/login', {
          title: 'Admin Login',
          error: 'Session xatoligi',
        });
      }
      req.session.admin = {
        username: CONFIG.ADMIN_USER,
        loggedInAt: Date.now(),
      };
      // regenerate() yangi bo'sh sessiya yaratadi — CSRF token'ni qayta
      // o'rnatamiz, aks holda keyingi POST'lar 403 qaytaradi.
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return res.redirect('/admin/dashboard');
    });
    return;
  }

  res.render('admin/login', {
    title: 'Admin Login',
    error: 'Login yoki parol noto\'g\'ri',
  });
});

// ── Admin Logout (session destroy + regenerate) ──
router.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/admin/login');
  });
});

// ── User Login Page ──
router.get('/user/login', redirectIfAuth, (req, res) => {
  const mode = req.query.mode || 'login';
  res.render('user/login', { title: 'Kirish', mode, error: null });
});

// ── User Login Action (rate-limited, CSRF-protected) ──
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
    const userKey = safeKey(username);
    const snap = await fb.get(`users/${userKey}`);

    if (mode === 'login') {
      if (!snap.exists()) {
        return res.render('user/login', {
          title: 'Kirish',
          mode,
          error: 'Foydalanuvchi topilmadi',
        });
      }

      const userData = snap.val();
      const storedHash = userData.password || '';

      let isMatch = false;

      // 1. Try argon2 verification first
      if (storedHash.startsWith('$argon2')) {
        isMatch = await verifyPassword(password, storedHash);
      }
      // 2. Try legacy SHA-256 verification (for migration)
      else if (isLegacyHash(storedHash)) {
        const legacyHash = hashPass(password, userKey);
        isMatch = legacyHash === storedHash;
      }
      // 3. Try legacy plaintext (oldest format)
      else if (storedHash === password) {
        isMatch = true;
      }

      if (!isMatch) {
        return res.render('user/login', {
          title: 'Kirish',
          mode,
          error: 'Parol noto\'g\'ri',
        });
      }

      // ── Legacy hash migration ──
      // If password was verified with SHA-256 or plaintext, upgrade to argon2
      if (!storedHash.startsWith('$argon2')) {
        try {
          const newHash = await hashPassword(password);
          await fb.set(`users/${userKey}/password`, newHash);
        } catch (_) {
          // Non-critical: next login will migrate
        }
      }

      // Regenerate session to prevent session fixation
      req.session.regenerate(async (err) => {
        if (err) {
          return res.render('user/login', {
            title: 'Kirish',
            mode,
            error: 'Session xatoligi',
          });
        }

        // Read isVip from DB
        let isVip = false;
        try {
          const vipSnap = await fb.get(`users/${userKey}/isVip`);
          isVip = vipSnap.exists() && vipSnap.val() === true;
        } catch (_) {}

        // Role-aware session (Prompt 68) — default 'student'.
        const role = userData.role && ['student','teacher','proctor','marker','board'].includes(userData.role)
          ? userData.role
          : 'student';

        req.session.user = {
          username: userData.username || username,
          safeKey: userKey,
          isVip,
          role,
        };

        // regenerate() yangi bo'sh sessiya yaratadi — CSRF token'ni qayta
        // o'rnatamiz, aks holda keyingi POST'lar 403 qaytaradi.
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');

        // Role workspace'ga yo'naltirish (teacher uchun).
        return res.redirect(role === 'teacher' ? '/teacher' : '/user/panel');
      });
    } else {
      // ── Register ──
      if (!/^[a-zA-Z0-9_]{2,20}$/.test(username)) {
        return res.render('user/login', {
          title: 'Ro\'yxatdan o\'tish',
          mode: 'reg',
          error: 'Faqat harf, raqam va _ (2\u201320 belgi)',
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

      // Hash with argon2 (modern, memory-hard)
      const hashed = await hashPassword(password);

      await fb.set(`users/${userKey}`, {
        username: username.trim(),
        password: hashed,
        created_at: Date.now(),
        safeKey: userKey,
        isVip: false,
      });

      // Regenerate session after registration
      req.session.regenerate(async (err) => {
        if (err) {
          return res.render('user/login', {
            title: 'Ro\'yxatdan o\'tish',
            mode: 'reg',
            error: 'Session xatoligi',
          });
        }
        req.session.user = {
          username: username.trim(),
          safeKey: userKey,
          isVip: false,
          role: 'student',
        };
        // regenerate() yangi bo'sh sessiya yaratadi — CSRF token'ni qayta
        // o'rnatamiz, aks holda keyingi POST'lar 403 qaytaradi.
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        return res.redirect('/user/panel');
      });
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

// ── User Logout (session destroy + cookie clear) ──
router.get('/user/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

export default router;
