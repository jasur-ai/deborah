import { processEmailQueue } from './queue.js';

function configuredProvider(env) {
  const provider = String(env.EMAIL_PROVIDER_PRIMARY || env.EMAIL_PROVIDER || 'mock').toLowerCase();
  const configured = provider === 'smtp'
    ? Boolean(env.SMTP_HOST)
    : provider === 'postmark'
      ? Boolean(env.POSTMARK_SERVER_TOKEN || env.EMAIL_API_KEY)
      : false;
  return { provider, configured };
}

/**
 * Start the DB-backed email queue worker for the long-lived web process.
 * Tests can inject a queue processor; importing server.js alone never starts it.
 */
export function startEmailQueueWorker({
  intervalMs = 5_000,
  processQueue = processEmailQueue,
  logger = console,
  env = process.env,
} = {}) {
  const { provider, configured } = configuredProvider(env);
  if (!configured) {
    logger.warn?.(
      { event: 'email.queue.worker.disabled', provider },
      'Email queue worker is disabled because no real provider is configured.',
    );
    return {
      started: false,
      firstRun: Promise.resolve(null),
      runOnce: async () => null,
      stop() {},
    };
  }

  let stopped = false;
  let running = false;
  const runOnce = async () => {
    if (stopped || running) return null;
    running = true;
    try {
      const result = await processQueue();
      if (result && (result.sent || result.retried || result.deadletter || result.failed)) {
        logger.info?.(
          { event: 'email.queue.worker.tick', provider, ...result },
          'Email queue processed.',
        );
      }
      return result;
    } catch (err) {
      logger.warn?.(
        { event: 'email.queue.worker.error', provider, error: String(err?.message || err) },
        'Email queue worker tick failed.',
      );
      return null;
    } finally {
      running = false;
    }
  };

  const pollMs = Math.max(1_000, Number(intervalMs) || 5_000);
  const timer = setInterval(() => { void runOnce(); }, pollMs);
  timer.unref?.();
  logger.info?.(
    { event: 'email.queue.worker.started', provider, intervalMs: pollMs },
    'Email queue worker started.',
  );
  const firstRun = runOnce();

  return {
    started: true,
    firstRun,
    runOnce,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
