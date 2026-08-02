/**
 * Edikit — Worker Entrypoint (TypeScript Boundary)
 *
 * This is the canonical entrypoint for background workers.
 * Worker processes should import from here rather than from
 * legacy JS modules directly.
 *
 * Usage:
 *   npx tsx src/app/worker.ts
 *
 * Legacy JS adapter: use src/app/adapter.js for accessing
 * existing routes, middleware, and services.
 *
 * Migration path:
 *   1. Create worker logic in src/modules/<feature>/
 *   2. Use adapter.getDb() for data access
 *   3. Use adapter.getConfig() for configuration
 *   4. Register worker in src/app/worker.ts
 */

export interface WorkerManifest {
  name: string;
  description: string;
  cron?: string;
}

const REGISTERED_WORKERS: WorkerManifest[] = [
  {
    name: 'session-cleanup',
    description: 'Clean up expired game sessions',
    cron: '*/5 * * * *',
  },
];

/**
 * Get the list of registered workers.
 */
export function getWorkers(): WorkerManifest[] {
  return [...REGISTERED_WORKERS];
}

// ── CLI entrypoint ──
const isMainModule = process.argv[1]?.endsWith('worker.ts') ?? false;

if (isMainModule) {
  console.log('Edikit Worker — Registered workers:');
  REGISTERED_WORKERS.forEach((w) => {
    console.log(`  - ${w.name}: ${w.description}${w.cron ? ` (cron: ${w.cron})` : ''}`);
  });
  console.log('\nNo workers are running. Use the adapter to import legacy services.');
}
