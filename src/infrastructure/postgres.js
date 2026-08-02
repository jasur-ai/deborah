/**
 * Edikit — PostgreSQL Infrastructure
 *
 * Provides:
 *   1. Kysely query builder instance (typed)
 *   2. Connection pool with health check
 *   3. Migration runner (Kysely Migrator)
 *   4. Graceful shutdown
 *
 * Gracefully degrades if DATABASE_URL is not configured.
 */

import CONFIG from '../config/env.js';

let _pool = undefined;
let _kysely = null;
let _initAttempted = false;

/**
 * Get the PostgreSQL pool (singleton).
 * Returns null if DATABASE_URL is not configured or connection fails.
 */
export async function getPool() {
  if (_initAttempted) return _pool ?? null;
  _initAttempted = true;

  if (!CONFIG.DATABASE_URL) {
    _pool = undefined;
    return null;
  }

  try {
    const pgMod = await await_import_pg();
    const pg = pgMod.default || pgMod;
    _pool = new pg.Pool({
      connectionString: CONFIG.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    _pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err.message);
    });

    return _pool;
  } catch (err) {
    console.error('PostgreSQL pool creation failed:', err.message);
    _pool = undefined;
    return null;
  }
}

/**
 * Get the Kysely typed query builder instance (singleton).
 * Returns null if PostgreSQL is not configured.
 */
export async function getDb() {
  if (_kysely) return _kysely;

  const pool = await getPool();
  if (!pool) return null;

  try {
    const { Kysely, PostgresDialect } = await import('kysely');
    _kysely = new Kysely({
      dialect: new PostgresDialect({ pool }),
    });
    return _kysely;
  } catch (err) {
    console.error('Kysely initialization failed:', err.message);
    return null;
  }
}

/**
 * Check PostgreSQL health by running a simple query.
 */
export async function checkPostgresHealth() {
  const pool = await getPool();
  if (!pool) {
    return { ok: false, reason: 'postgres not configured (DATABASE_URL)' };
  }

  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { ok: true, latency: Date.now() - start };
    } finally {
      client.release();
    }
  } catch (err) {
    return { ok: false, reason: err.message, latency: Date.now() - start };
  }
}

/**
 * Run all pending migrations.
 */
export async function runMigrations() {
  const db = await getDb();
  if (!db) {
    return { error: 'PostgreSQL not configured' };
  }

  try {
    const { Migrator, FileMigrationProvider } = await import('kysely');
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(__dirname, '..', '..', 'migrations');

    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs: fs.promises,
        path,
        migrationFolder: migrationsDir,
      }),
    });

    const { error, results } = await migrator.migrateToLatest();

    if (results) {
      for (const r of results) {
        console.log(`  Migration "${r.migrationName}": ${r.status}`);
      }
    }

    if (error) {
      console.error('Migration failed:', error);
      return { error: error.message, results };
    }

    return { ok: true, results };
  } catch (err) {
    console.error('Migration runner error:', err.message);
    return { error: err.message };
  }
}

/**
 * Create a new migration file.
 */
export async function createMigration(name) {
  if (!name) throw new Error('Migration name is required');

  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(__dirname, '..', '..', 'migrations');

  const fs = await import('fs');
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = `${timestamp}_${name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}.js`;

  const template = `/**
 * Migration: ${name}
 */

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // Example: await db.schema.createTable('table').addColumn('id', 'serial', (col) => col.primaryKey()).execute();
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  // Example: await db.schema.dropTable('table').execute();
}
`;

  const filePath = path.resolve(migrationsDir, filename);
  fs.writeFileSync(filePath, template, 'utf-8');
  console.log(`Created migration: ${filename}`);
  return filename;
}

/**
 * Close all PostgreSQL connections gracefully.
 */
export async function closePostgres() {
  if (_kysely) {
    try { await _kysely.destroy(); } catch (_) {}
    _kysely = null;
  }
  if (_pool) {
    try { await _pool.end(); } catch (_) {}
    _pool = undefined;
  }
  _initAttempted = false; // allow re-init
  console.log('PostgreSQL connections closed');
}

// ── Lazy dynamic import ──
let _pgMod = null;
function await_import_pg() {
  if (!_pgMod) {
    // Use a dynamic import that returns the module synchronously once cached
    _pgMod = import('pg').then(m => m).catch(err => {
      console.error('pg module load failed:', err.message);
      return null;
    });
  }
  return _pgMod;
}
