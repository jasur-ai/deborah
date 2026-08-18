/**
 * Deborah — Error Handling Middleware
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
  // S34.03: opaque reference ID — support uchun, secret detail oshkor qilmaydi
  const refId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[Error ${refId}]`, err.message);
  }
  res.status(status).render('error', {
    title: `${status} — Xatolik`,
    message,
    status,
    refId,
    // S16.08: raw stack faqat dev rejimida (render'da ishlatiladi)
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    isDev: process.env.NODE_ENV !== 'production',
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
