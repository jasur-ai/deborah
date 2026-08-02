/**
 * Edikit — Structured Logger
 *
 * Uses Pino for structured JSON logging.
 * Provides:
 *   1. Shared logger instance
 *   2. Request ID middleware (adds req.id and request-scoped logger)
 *   3. Automatic redaction of secrets (tokens, passwords, cookies)
 *   4. Development pretty-printing via pino-pretty
 */

import pino from 'pino';
import crypto from 'crypto';

// ── Redaction paths ──
// These paths in the log object will be replaced with '[REDACTED]'
const REDACT_CONFIG = {
  paths: [
    // Auth headers
    'req.headers.authorization',
    'req.headers["authorization"]',
    'req.headers.cookie',
    'req.headers["cookie"]',
    'req.headers["set-cookie"]',
    'req.headers["x-csrf-token"]',
    // Session
    'req.session',
    'res.headers["set-cookie"]',
    // Body secrets
    'body.password',
    'body.token',
    'body.secret',
    'body.sessionToken',
    'body.refreshToken',
    'body.creditCard',
    'body.credit_card',
  ],
  censor: '[REDACTED]',
};

// ── Generate a short request ID ──
function generateReqId() {
  return crypto.randomBytes(6).toString('hex'); // 12 chars
}

// ── Create logger instance ──
let logger;

/**
 * Initialize the logger. Call once at app startup.
 * @param {{ level?: string, pretty?: boolean }} opts
 */
export function initLogger(opts = {}) {
  const level = opts.level || process.env.LOG_LEVEL || 'info';
  const pretty = opts.pretty ?? process.env.LOG_PRETTY === 'true';

  const transport = pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

  logger = pino({
    level,
    redact: REDACT_CONFIG,
    transport,
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        path: req.path,
        ip: req.ip,
        // Intentionally exclude headers (redacted above)
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
      err: pino.stdSerializers.err,
    },
  });

  logger.info(`Logger initialized (level=${level}, pretty=${pretty})`);
  return logger;
}

/**
 * Get the shared logger instance. Throws if not initialized.
 */
export function getLogger() {
  if (!logger) {
    return initLogger();
  }
  return logger;
}

/**
 * Express middleware: adds request ID and request-scoped logger.
 */
export function requestIdMiddleware(req, res, next) {
  req.id = generateReqId();
  req.log = getLogger().child({ reqId: req.id });
  next();
}

/**
 * Express middleware: logs completed requests.
 * Attach AFTER routes (before error handler).
 */
export function requestLogMiddleware() {
  const log = getLogger();
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      log.info(
        { req: { id: req.id, method: req.method, url: req.originalUrl }, res: { statusCode: res.statusCode } },
        `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
      );
    });
    next();
  };
}

export default getLogger;
