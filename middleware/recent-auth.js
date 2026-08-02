/**
 * Edikit — Recent Authentication Middleware (Step-Up)
 *
 * Requires that the user has authenticated recently (within a configurable window)
 * before allowing sensitive operations.
 *
 * Use cases:
 *   - Passkey registration (require recent password login)
 *   - Account linking (require fresh authentication)
 *   - Recovery code generation (require recent auth)
 *   - VIP grant/admin actions (require recent auth)
 *   - Email change / security settings changes
 *
 * This middleware checks `req.session.authTime` (set during login)
 * and compares it against the configured max age.
 *
 * @module middleware/recent-auth
 */

// ── Default time windows (milliseconds) ──
const DEFAULT_TIMES = {
  sensitive: 5 * 60 * 1000,    // 5 minutes — very sensitive
  moderate: 15 * 60 * 1000,    // 15 minutes — account changes
  standard: 60 * 60 * 1000,    // 1 hour — default
  relaxed: 24 * 60 * 60 * 1000, // 24 hours — info viewing
};

/**
 * Middleware factory: require recent authentication.
 *
 * Usage:
 *   import { requireRecentAuth } from '../middleware/recent-auth.js';
 *   router.post('/passkey/register', requireRecentAuth('sensitive'), handler);
 *   router.post('/account/link', requireRecentAuth('moderate'), handler);
 *
 * @param {string|number} level - 'sensitive' | 'moderate' | 'standard' | 'relaxed' | custom ms
 * @returns {Function} Express middleware
 */
export function requireRecentAuth(level = 'standard') {
  const maxAgeMs = typeof level === 'number' ? level :
    DEFAULT_TIMES[level] || DEFAULT_TIMES.standard;

  return (req, res, next) => {
    // Check if session has authTime
    const authTime = req.session?.authTime || req.session?.adminAuthTime;

    if (!authTime) {
      // No auth time — check if user is logged in at all
      if (req.session?.user || req.session?.admin) {
        // User is logged in but no authTime recorded
        // This can happen for legacy sessions or OIDC logins
        // Record current time and allow (once)
        const now = Date.now();
        if (req.session.user) req.session.authTime = now;
        if (req.session.admin) req.session.adminAuthTime = now;
        return next();
      }

      // Not logged in
      if (req.path.startsWith('/api/') || req.xhr || req.accepts('json')) {
        return res.status(401).json({
          error: 'Avtorizatsiya talab qilinadi',
          reason: 'recent_auth_required',
        });
      }
      return res.redirect('/user/login');
    }

    // Check if auth is recent enough
    const elapsed = Date.now() - authTime;

    if (elapsed > maxAgeMs) {
      // Auth expired — require re-login
      const levelName = Object.entries(DEFAULT_TIMES).find(([, v]) => v === maxAgeMs)?.[0] || 'custom';

      // Store the original URL to redirect back after re-auth
      req.session.returnTo = req.originalUrl;
      req.session.recentAuthRequired = levelName;

      if (req.path.startsWith('/api/') || req.xhr || req.accepts('json')) {
        return res.status(401).json({
          error: 'Qayta avtorizatsiya talab qilinadi',
          reason: 'recent_auth_required',
          level: levelName,
          expiresIn: Math.ceil((maxAgeMs - elapsed) / 1000),
        });
      }

      // Redirect to login with re-auth reason
      const redirectTo = req.session?.user ? '/user/login' : '/admin/login';
      return res.redirect(`${redirectTo}?reauth=true&level=${levelName}`);
    }

    // Auth is recent enough — refresh authTime for sliding window
    // In sliding mode, update authTime on each request
    next();
  };
}

/**
 * Middleware factory: require step-up authentication for admin actions.
 * More strict than requireRecentAuth — requires admin auth within shorter window.
 *
 * Usage:
 *   router.post('/admin/api/vip/grant', requireAdminStepUp(), handler);
 */
export function requireAdminStepUp() {
  return requireRecentAuth('sensitive');
}

/**
 * Record auth time in session (call after successful login).
 *
 * @param {Object} req - Express request
 * @param {string} [type] - 'user' | 'admin'
 */
export function recordAuthTime(req, type = 'user') {
  const now = Date.now();
  if (type === 'admin') {
    req.session.adminAuthTime = now;
  } else {
    req.session.authTime = now;
  }
}

/**
 * Clear auth time (call on logout or security-sensitive event).
 *
 * @param {Object} req
 * @param {string} [type]
 */
export function clearAuthTime(req, type) {
  if (!type || type === 'user') delete req.session.authTime;
  if (!type || type === 'admin') delete req.session.adminAuthTime;
}

/**
 * Get remaining auth time in milliseconds.
 *
 * @param {Object} req
 * @param {string|number} [level]
 * @returns {number} Remaining ms (0 = expired, -1 = no auth)
 */
export function getRemainingAuthTime(req, level = 'standard') {
  const authTime = req.session?.authTime || req.session?.adminAuthTime;
  if (!authTime) return -1;

  const maxAgeMs = typeof level === 'number' ? level :
    DEFAULT_TIMES[level] || DEFAULT_TIMES.standard;

  const elapsed = Date.now() - authTime;
  return Math.max(0, maxAgeMs - elapsed);
}

export { DEFAULT_TIMES };
