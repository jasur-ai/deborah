/**
 * Edikit — Origin/Referer Allowlist Middleware
 *
 * Protects against CSRF attacks by verifying that POST/PUT/PATCH/DELETE
 * requests come from an allowed origin.
 *
 * The allowlist is configured via ALLOWED_ORIGINS env var (comma-separated).
 * Falls back to checking Host header vs Origin/Referer.
 *
 * Usage:
 *   import { originCheck } from './middleware/origin-check.js';
 *   app.use(originCheck);
 */

import CONFIG from '../src/config/env.js';

// ── Parse allowed origins from config or env ──
const ALLOWED_ORIGINS = (() => {
  const raw = process.env.ALLOWED_ORIGINS || '';
  if (raw) {
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  // Default: allow localhost and the configured host
  const origins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    `http://${CONFIG.HOST}:${CONFIG.PORT}`,
  ];
  if (CONFIG.SITE_URL) {
    origins.push(CONFIG.SITE_URL.toLowerCase().replace(/\/$/, ''));
  }
  return origins;
})();

/**
 * Normalize a URL to just origin (proto + host + port, no path).
 */
function extractOrigin(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Check if an origin is in the allowlist.
 */
function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => {
    if (allowed === '*') return true;
    return origin === allowed || origin.startsWith(allowed + '/') || origin === allowed.replace(/\/$/, '');
  });
}

/**
 * Express middleware: check Origin/Referer header on state-changing requests.
 * Skips GET/HEAD/OPTIONS, socket.io, and static files.
 */
export function originCheck(req, res, next) {
  // Only check state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip socket.io, static paths and signed provider webhooks
  // (Prompt 58 §11 — Manus HMAC-signed webhook; server-to-server,
  // Origin header bo'lmasligi yoki foreign bo'lishi mumkin)
  const path = req.path || '';
  if (path.startsWith('/socket.io/') || path.startsWith('/css/') ||
      path.startsWith('/js/') || path.startsWith('/images/') ||
      path.startsWith('/characters/') || path.startsWith('/api/webhooks/')) {
    return next();
  }

  // Try Origin header first, then Referer
  const origin = extractOrigin(req.headers.origin) || extractOrigin(req.headers.referer);

  // If no origin/referer header (e.g., direct curl/postman), skip check
  // Allow requests from same origin (Host header matches)
  if (!origin) {
    // Check if it's a same-origin request by comparing to Host
    const host = req.headers.host;
    if (host) {
      const proto = req.protocol || 'http';
      const sameOrigin = `${proto}://${host}`.toLowerCase();
      if (isOriginAllowed(sameOrigin)) {
        return next();
      }
    }
    // If no host either, allow (legacy clients)
    return next();
  }

  if (!isOriginAllowed(origin)) {
    const log = req.log || console;
    log.warn({
      event: 'security:origin_blocked',
      method: req.method,
      path: req.path,
      origin,
      ip: req.ip,
    }, `Origin blocked: ${origin} → ${req.method} ${req.path}`);

    return res.status(403).json({
      error: 'Origin not allowed',
      code: 'ORIGIN_BLOCKED',
    });
  }

  next();
}
