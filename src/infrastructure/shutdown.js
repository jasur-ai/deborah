/**
 * Deborah — Graceful Shutdown Handler
 *
 * Drains and closes all infrastructure services in order:
 *   1. HTTP server (stop accepting new connections)
 *   2. Socket.IO (disconnect all clients)
 *   3. Redis (quit)
 *   4. PostgreSQL (end pool)
 *   5. Any other resources
 *
 * Usage:
 *   import { setupShutdown } from './shutdown.js';
 *   setupShutdown(httpServer, io);
 */

import { closeRedis } from './redis.js';
import { closePostgres } from './postgres.js';

/**
 * Set up graceful shutdown handlers for SIGTERM and SIGINT.
 * @param {import('http').Server} httpServer
 * @param {import('socket.io').Server} [io]
 */
export function setupShutdown(httpServer, io) {
  const services = [];

  // HTTP server
  if (httpServer) {
    services.push(async () => {
      return new Promise((resolve) => {
        httpServer.close(() => resolve());
      });
    });
  }

  // Socket.IO
  if (io) {
    services.push(async () => {
      try {
        await io.close();
      } catch (_) {}
    });
  }

  // Redis
  services.push(async () => {
    try {
      await closeRedis();
    } catch (_) {}
  });

  // PostgreSQL
  services.push(async () => {
    try {
      await closePostgres();
    } catch (_) {}
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received — shutting down gracefully...`);

    for (let i = 0; i < services.length; i++) {
      try {
        await services[i]();
      } catch (err) {
        console.error(`Shutdown step ${i} failed:`, err.message);
      }
    }

    console.log('Shutdown complete.');
    process.exit(0);
  };

  // Handle signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Prevent double shutdown
  process.on('exit', () => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });
}

/**
 * Close all infrastructure services without exiting.
 * Useful for tests.
 */
export async function closeAll() {
  try { await closeRedis(); } catch (_) {}
  try { await closePostgres(); } catch (_) {}
}
