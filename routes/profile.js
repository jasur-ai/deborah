/**
 * Deborah — "Profilim" (hamma rollar uchun)
 * ---------------------------------------------------------
 * Talab (2026-08-27): bitta "Profilim" bo'limi HAMMA rolga
 * (student/teacher/admin/proctor/marker/board):
 *   - to'liq profil ma'lumotlari
 *   - 12 ta zaxira (backup) kod — ko'rish uchun qayta tasdiqlash
 *     (parol YOKI TOTP kod) SHART (requireRecentAuth ga teng kuch)
 *
 *   GET  /user/profile            — sahifa (requireAuth, barcha rollar)
 *   GET  /api/profile/me          — to'liq profil JSON
 *   POST /api/profile/backup-codes — zaxira kodlarni YANGILASH (rotate)
 *                                    body: { password } yoki { mfaCode }
 *
 * Xavfsizlik:
 *   - backup kodlar DB'da HASH holda saqlanadi — plaintext faqat
 *     rotate javobida BIR marta ko'rsatiladi (mfa-totp.js §09)
 *   - MFA o'chiq bo'lsa zaxira kod mavjud emas → 400 mfa_disabled
 *   - 5 ta noto'g'ri urinish / 15 daqiqa rate limit
 *   - audit: PROFILE_BACKUP_CODES_ROTATE (muvaffaqiyatli/fail)
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { verifyPassword } from '../utils/helpers.js';
import {
  hasActiveMfa,
  getMfaStatus,
  rotateBackupCodes,
  verifyMfaCode,
} from '../src/modules/auth/mfa-totp.js';
import { logAuthEvent } from '../src/modules/auth/audit.js';

const router = Router();

/** Foydalanuvchi profilini DB + sessiyadan yig'adi (parol/hash HECH QAYERDA chiqmaydi). */
async function collectProfile(sessionUser) {
  const safeKey = sessionUser.safeKey;
  const snap = await fb.get(`users/${safeKey}`).catch(() => null);
  const db = snap && snap.exists() ? snap.val() : {};
  const mfa = await getMfaStatus(safeKey).catch(() => ({ status: 'none' }));

  return {
    username: db.username || sessionUser.username || '—',
    displayName: db.display_name || sessionUser.displayName || db.username || '—',
    email: db.email || sessionUser.email || null,
    emailVerified: db.email_verified === true,
    role: db.role || sessionUser.role || 'student',
    authProvider: db.auth_provider || sessionUser.authProvider || 'password',
    avatarUrl: db.avatar_url || sessionUser.avatarUrl || null,
    isVip: db.isVip === true || sessionUser.isVip === true,
    createdAt: db.created_at || null,
    lastLoginAt: db.last_login_at || null,
    teacherRole: db.role === 'teacher' || db.role === 'teacher_pending' || db.role === 'teacher_rejected'
      ? db.role : null,
    mfa: {
      status: mfa.status || 'none', // active | pending | none
      backupCodesRemaining: typeof mfa.backupCodesRemaining === 'number' ? mfa.backupCodesRemaining : 0,
    },
    hasPassword: typeof db.password === 'string' && db.password.length > 0,
  };
}

/** Barcha rollar uchun "Profilim" sahifasi. */
router.get('/user/profile', requireAuth, async (req, res) => {
  try {
    const profile = await collectProfile(req.session.user);
    res.render('user/profile', {
      title: 'Profilim',
      user: req.session.user,
      profile,
      csrfToken: req.session.csrfToken,
    });
  } catch (err) {
    console.error('[PROFILE] render error:', err);
    res.status(500).render('error', { title: '500', message: 'Server xatosi', status: 500 });
  }
});

/** To'liq profil JSON (UI dinamik yangilash uchun). */
router.get('/api/profile/me', requireAuth, async (req, res) => {
  try {
    const profile = await collectProfile(req.session.user);
    res.json({ ok: true, profile });
  } catch (err) {
    console.error('[PROFILE] me error:', err);
    res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── Zaxira kodlar: rate limit (5 urinish / 15 daqiqa / user) ──
const bcAttempts = new Map(); // safeKey → { n, firstAt }
const BC_MAX = 5;
const BC_WINDOW_MS = 15 * 60 * 1000;
function bcLimited(safeKey) {
  const now = Date.now();
  const e = bcAttempts.get(safeKey);
  if (!e || now - e.firstAt > BC_WINDOW_MS) { bcAttempts.set(safeKey, { n: 1, firstAt: now }); return false; }
  e.n += 1;
  return e.n > BC_MAX;
}
function bcReset(safeKey) { bcAttempts.delete(safeKey); }

/**
 * POST /api/profile/backup-codes — 12 ta YANGI zaxira kod (rotate).
 * Qayta tasdiqlash: parol YOKI joriy TOTP kodi (Google-only akkauntlar uchun).
 * Eslatma: rotate avvalgi kodlarni bekor qiladi — ko'rsatilganidan keyin
 * saqlash user zimmasida (plaintext DB'da UMMUMAN saqlanmaydi).
 */
router.post('/api/profile/backup-codes', requireAuth, async (req, res) => {
  const safeKey = req.session.user.safeKey;
  try {
    if (bcLimited(safeKey)) {
      await logAuthEvent({
        action: 'profile.backup_codes_rotate', outcome: 'rate-limited',
        method: 'password_or_totp', actorId: safeKey, ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(429).json({ ok: false, error: 'rate_limited', message: 'Juda ko\u2018p urinish — 15 daqiqadan keyin qayta urinib ko\u2018ring' });
    }

    if (!(await hasActiveMfa(safeKey))) {
      return res.status(400).json({
        ok: false, error: 'mfa_disabled',
        message: 'Zaxira kodlar faqat MFA (Google Authenticator) yoqilganda mavjud. Avval Xavfsizlik profili → MFA ni yoqing.',
      });
    }

    const { password, mfaCode } = req.body || {};
    let verified = false;

    // Yo'l 1: parol bilan (parolli akkauntlar)
    if (typeof password === 'string' && password.length > 0) {
      const snap = await fb.get(`users/${safeKey}/password`).catch(() => null);
      if (snap && snap.exists()) {
        verified = await verifyPassword(password, snap.val());
      }
    }

    // Yo'l 2: joriy TOTP kodi bilan (Google-only akkauntlar ham)
    if (!verified && typeof mfaCode === 'string' && mfaCode.length >= 6) {
      const v = await verifyMfaCode(safeKey, mfaCode.trim(), req.ip).catch(() => ({ ok: false }));
      verified = v && v.ok === true;
    }

    if (!verified) {
      await logAuthEvent({
        action: 'profile.backup_codes_rotate', outcome: 'wrong-credentials',
        method: password ? 'password' : 'totp', actorId: safeKey, ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(403).json({
        ok: false, error: 'wrong_credentials',
        message: 'Tasdiqlash xato — parolingizni yoki Authenticator kodini tekshirib qayta kiriting.',
      });
    }

    bcReset(safeKey);
    // Parol/TOTP tasdiqlandi → requireRecentAuth darajasidagi ishonch
    req.session.reauthedAt = Date.now();

    const result = await rotateBackupCodes(safeKey);
    await logAuthEvent({
      action: 'profile.backup_codes_rotate', outcome: 'success',
      method: password ? 'password' : 'totp', actorId: safeKey, ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { backupCodeCount: Array.isArray(result.backupCodes) ? result.backupCodes.length : 0 },
    }).catch(() => {});

    return res.json({ ok: true, backupCodes: result.backupCodes });
  } catch (err) {
    console.error('[PROFILE] backup-codes error:', err);
    bcReset(safeKey);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

export default router;
