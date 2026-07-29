/**
 * Edikit — Error Handling Middleware
 */

/**
 * 404 Not Found handler
 */
export function notFound(req, res, next) {
  res.status(404).render('error', {
    title: '404 — Sahifa topilmadi',
    message: 'So\'ralgan sahifa mavjud emas',
    status: 404,
  });
}

/**
 * Global error handler
 */
export function errorHandler(err, req, res, next) {
  console.error('❌ Error:', err.message);
  console.error(err.stack);

  const status = err.status || 500;
  const message = err.expose ? err.message : 'Serverda xatolik yuz berdi';

  // API errors
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message, status });
  }

  // Page errors
  res.status(status).render('error', {
    title: `${status} — Xatolik`,
    message,
    status,
  });
}

/**
 * CSRF validation middleware (simple token-based)
 */
export function validateCsrf(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const token = req.body?._csrf || req.headers['x-csrf-token'];
    if (!token || token !== req.session?.csrfToken) {
      return res.status(403).json({ error: 'CSRF token validation failed' });
    }
  }
  next();
}
