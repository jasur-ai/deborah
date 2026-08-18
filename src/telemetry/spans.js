/**
 * AUTH D-05 — Auth span helpers.
 *
 * - authSpanMiddleware: route'ga biriktiriladi (auth.login/register/mfa/reset),
 *   span'ni handler davomida faollashtiradi (AsyncLocalStorage context),
 *   finish'da status/outcome/user_id (hash)/tenant_id yozadi.
 * - userIdHash: raw userKey emas — hash (PII minimal, D-05 §09).
 * - PII yo'q: parol/token/OTP hech qachon attribute bo'lmaydi (redact).
 */

import crypto from 'crypto';
import { startSpan, endSpan } from './tracer.js';
import { runWithTrace } from './context.js';
import { redactForTelemetry } from './redaction.js';
import CONFIG from '../config/env.js';

/** Raw userKey'dan 16-hex hash — trace attribute'larida PII yo'q. */
export function userIdHash(userKey) {
  if (!userKey) return null;
  return crypto.createHash('sha256').update(String(userKey)).digest('hex').slice(0, 16);
}

/**
 * Route handler'ni auth span ichida ishga tushiradi.
 * @param {string | ((req) => string)} nameOrFn - span nomi (auth.login va h.k.)
 * @param {(req) => object} [attrsFn] - qo'shimcha redacted attribute'lar
 * @returns {Function} express middleware
 */
export function authSpanMiddleware(nameOrFn, attrsFn = null) {
  return (req, res, next) => {
    const name = typeof nameOrFn === 'function' ? nameOrFn(req) : nameOrFn;
    const span = startSpan(name, {
      kind: 'server',
      attributes: {
        'auth.method': req.method,
        'http.route': req.path,
        'tenant_id': CONFIG.TENANT_ID || 'default',
        ...(attrsFn ? redactForTelemetry(attrsFn(req) || {}) : {}),
      },
    });
    const start = Date.now();
    res.on('finish', () => {
      const status = res.statusCode;
      const userId = req.user?.userKey || req.user?.id || req.session?.userKey || null;
      // Handler `res.locals.authOutcome` o'rnatgan bo'lsa — u haqiqiy natija
      // (server-render 200-xato loginlarda statusCode yetarli emas).
      const outcome = res.locals?.authOutcome || (status >= 400 ? 'error' : 'success');
      endSpan(span, {
        status: outcome === 'success' ? 'ok' : 'error',
        attributes: {
          'http.status_code': status,
          'auth.outcome': outcome,
          'auth.duration_ms': Date.now() - start,
          'tenant_id': CONFIG.TENANT_ID || 'default',
          ...(userId ? { 'user_id': userIdHash(userId) } : {}),
        },
      });
    });
    // Handler davomida span context faol — ichki chaqiruvlar (DB, provider)
    // shu spanning child'i bo'ladi (W3C tracecontext).
    return runWithTrace({ traceId: span.traceId, spanId: span.spanId, sampled: true }, () => next());
  };
}

export default { userIdHash, authSpanMiddleware };
