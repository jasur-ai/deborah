/**
 * Edikit — Authentication Middleware
 * Uses express-session for session management
 */

import ICONS, { icon } from '../utils/icons.js';

/**
 * Require authentication — redirects to login if not authenticated
 * For API routes (path starts with /api/), returns 401 JSON instead
 */
export function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  // API routes get JSON error, others get redirect
  if (req.path.startsWith('/api/') || req.xhr || req.accepts('json')) {
    return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi', redirect: '/user/login' });
  }
  res.redirect('/user/login');
}

/**
 * Require admin authentication
 * For API routes (path starts with /api/), returns 401 JSON instead
 */
export function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  // API routes get JSON error, others get redirect
  if (req.path.startsWith('/api/') || req.xhr || req.accepts('json')) {
    return res.status(401).json({ error: 'Admin avtorizatsiyasi talab qilinadi', redirect: '/admin/login' });
  }
  res.redirect('/admin/login');
}

/**
 * Redirect to panel if already authenticated
 */
export function redirectIfAuth(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/user/panel');
  }
  next();
}

/**
 * Redirect to admin dashboard if already authenticated
 */
export function redirectIfAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return res.redirect('/admin/dashboard');
  }
  next();
}

/**
 * Set locals for views (user info, icon helper, etc.)
 */
export function setLocals(req, res, next) {
  res.locals.user = req.session?.user || null;
  res.locals.admin = req.session?.admin || null;
  res.locals.path = req.path;
  res.locals.query = req.query || {};
  // Site URL for absolute OG image links (set via .env SITE_URL)
  res.locals.siteUrl = process.env.SITE_URL || '';
  // Icon helper for EJS templates: <%= icon('name', 20) %>
  res.locals.icon = icon;
  // Full icon registry for client-side injection (window.__ICONS)
  res.locals.icons = ICONS;
  next();
}
