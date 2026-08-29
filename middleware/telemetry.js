/**
 * Deborah — Telemetry Middleware (Prompt 69 §08-09)
 *
 * 1. HTTP trace middleware: request header'laridan traceparent o'qiladi (yoki
 *    yangi root trace yaratiladi), butun request davomida context propagation
 *    (AsyncLocalStorage), so'ng HTTP span yopiladi va http_* metriclar yoziladi.
 *    Javobga traceparent header qo'shiladi (client bilan davom ettirish uchun).
 *
 * 2. Socket span wrapper: Socket.io event handler'larini o'rab, har bir event
 *    uchun manual span yozadi. Player ism/emoji kabi PII YOZILMAYDI — faqat
 *    internal socket id + event nomi (research §38.3).
 */

import {
  traceContextFromRequest,
  withTraceContext,
  startSpan,
  endSpan,
  buildTraceparent,
  incrementCounter,
  observeHistogram,
} from '../src/telemetry/index.js';
import CONFIG from '../src/config/env.js'; // AUTH D-05 §28: tenant_id

/**
 * Express middleware: trace context + HTTP span + http metrics.
 * Mount AFTER requestIdMiddleware (req.id mavjud), BEFORE routes.
 */
export function telemetryMiddleware(req, res, next) {
  // Incoming traceparent'dan context olinadi (yoki yangi root trace).
  const ctx = traceContextFromRequest(req.headers || {});
  // W3C semantics: yangi span o'z spanId'sini generate qiladi, incoming
  // spanId esa PARENT bo'ladi (opts.parent orqali). spanId'ni to'g'ridan-
  // to'g'ri opts.spanId qilib berish YANGI spanning o'z id'si bo'lib
  // qolardi — bu W3C tracecontext'ni buzardi (ikkita span bitta ID).
  const span = startSpan('http.request', {
    kind: 'server',
    traceId: ctx.traceId,
    parent: { traceId: ctx.traceId, spanId: ctx.spanId },
    attributes: {
      'http.method': req.method,
      'http.url': (req.originalUrl || req.url || '').split('?')[0],
      'http.route': req.path,
      'http.request_id': req.id,
      // AUTH D-05 §28: tenant scope debug uchun
      'tenant_id': CONFIG.TENANT_ID || 'default',
    },
  });

  // Javob header'ida spanning O'Z traceId/spanId si qaytadi.
  res.setHeader('traceparent', buildTraceparent({ traceId: span.traceId, spanId: span.spanId, sampled: true }));

  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const status = res.statusCode;

    incrementCounter('deborah_http_requests_total', { help: 'HTTP requests' }, { value: 1, labels: { method: req.method, status: String(status) } });
    observeHistogram('deborah_http_request_duration_ms', durationMs, { help: 'HTTP request duration' });

    if (status >= 500) {
      incrementCounter('deborah_http_errors_total', { help: 'HTTP 5xx errors' }, { value: 1, labels: { method: req.method, status: String(status) } });
    }

    endSpan(span, {
      status: status >= 500 ? 'error' : status >= 400 ? 'error' : 'ok',
      statusMessage: status >= 400 ? `HTTP ${status}` : '',
      attributes: {
        'http.status_code': status,
        'http.response_time_ms': durationMs,
        'http.trace_id': span.traceId,
      },
    });
  });

  // Request-local context: http.request spanning o'z id'lari — ichki
  // chaqiruvlar (DB, outbox, provider) shu spanning child'i bo'ladi.
  return withTraceContext({ traceId: span.traceId, spanId: span.spanId, sampled: true }, () => next());
}

/**
 * Wrap a socket event listener to record a manual span.
 * PII YOZILMAYDI — faqat event nomi + socket internal id + duration.
 * @param {import('socket.io').Socket} socket
 * @param {string} event
 * @param {Function} handler
 * @returns {Function} wrapped handler
 */
export function wrapSocketEvent(socket, event, handler) {
  return (...args) => {
    const ctx = traceContextFromRequest({});
    const span = startSpan(`socket.${event}`, {
      kind: 'server',
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      attributes: {
        'socket.id': socket.id,
        'socket.event': event,
        // PII YO'Q: playerName/emoji/code yozilmaydi (research §38.3)
      },
    });
    const start = Date.now();
    const finish = (ok = true) => {
      const durationMs = Date.now() - start;
      incrementCounter('deborah_socket_events_total', { help: 'Socket events' }, { value: 1, labels: { event } });
      observeHistogram('deborah_socket_event_duration_ms', durationMs, { help: 'Socket event duration' });
      if (!ok) incrementCounter('deborah_socket_event_errors_total', { help: 'Socket event errors' }, { value: 1, labels: { event } });
      endSpan(span, {
        status: ok ? 'ok' : 'error',
        attributes: { 'socket.event_duration_ms': durationMs },
      });
    };

    try {
      const result = handler(...args);
      if (result && typeof result.then === 'function') {
        return result.then((r) => { finish(true); return r; }).catch((e) => { finish(false); throw e; });
      }
      finish(true);
      return result;
    } catch (e) {
      finish(false);
      throw e;
    }
  };
}

export default { telemetryMiddleware, wrapSocketEvent };
