import { afterEach, describe, expect, it, vi } from 'vitest';
import { startEmailQueueWorker } from '../../src/modules/email/worker.js';

describe('production email queue worker', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not poll while the provider is still mock/unconfigured', () => {
    const processQueue = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const worker = startEmailQueueWorker({
      env: { EMAIL_PROVIDER: 'mock' },
      processQueue,
      logger,
    });

    expect(worker.started).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(processQueue).not.toHaveBeenCalled();
    worker.stop();
  });

  it('drains immediately and polls when SMTP is configured', async () => {
    const processQueue = vi.fn().mockResolvedValue({ sent: 1, retried: 0, deadletter: 0 });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const worker = startEmailQueueWorker({
      env: { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test' },
      intervalMs: 60_000,
      processQueue,
      logger,
    });

    try {
      expect(worker.started).toBe(true);
      await worker.firstRun;
      expect(processQueue).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledTimes(2);
      expect(logger.info.mock.calls[0][0]).toMatchObject({ event: 'email.queue.worker.started' });
    } finally {
      worker.stop();
    }

    expect(await worker.runOnce()).toBeNull();
    expect(processQueue).toHaveBeenCalledOnce();
  });
});
