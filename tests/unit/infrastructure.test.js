/**
 * Deborah — Infrastructure Tests
 *
 * Tests for:
 *   1. PostgreSQL pool/health check/Kysely (graceful degradation)
 *   2. Redis client/health check (graceful degradation)
 *   3. Storage abstraction (local filesystem operations)
 *   4. Shutdown handler
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// 1. PostgreSQL Infrastructure
// ═══════════════════════════════════════════════════════════════

describe('PostgreSQL infrastructure', () => {
  it('should export getPool() function', async () => {
    const mod = await import('../../src/infrastructure/postgres.js');
    expect(typeof mod.getPool).toBe('function');
  });

  it('should export getDb() function', async () => {
    const mod = await import('../../src/infrastructure/postgres.js');
    expect(typeof mod.getDb).toBe('function');
  });

  it('should export checkPostgresHealth() function', async () => {
    const mod = await import('../../src/infrastructure/postgres.js');
    expect(typeof mod.checkPostgresHealth).toBe('function');
  });

  it('should export runMigrations() function', async () => {
    const mod = await import('../../src/infrastructure/postgres.js');
    expect(typeof mod.runMigrations).toBe('function');
  });

  it('should export closePostgres() function', async () => {
    const mod = await import('../../src/infrastructure/postgres.js');
    expect(typeof mod.closePostgres).toBe('function');
  });

  it('should gracefully handle missing DATABASE_URL', async () => {
    // In test env, DATABASE_URL is not set, so getPool should return null
    const mod = await import('../../src/infrastructure/postgres.js');
    const pool = await mod.getPool();
    expect(pool).toBeNull();

    const db = await mod.getDb();
    expect(db).toBeNull();

    const health = await mod.checkPostgresHealth();
    expect(health.ok).toBe(false);
    expect(health.reason).toContain('not configured');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Redis Infrastructure
// ═══════════════════════════════════════════════════════════════

describe('Redis infrastructure', () => {
  it('should export getRedis() function', async () => {
    const mod = await import('../../src/infrastructure/redis.js');
    expect(typeof mod.getRedis).toBe('function');
  });

  it('should export checkRedisHealth() function', async () => {
    const mod = await import('../../src/infrastructure/redis.js');
    expect(typeof mod.checkRedisHealth).toBe('function');
  });

  it('should export connectRedis() function', async () => {
    const mod = await import('../../src/infrastructure/redis.js');
    expect(typeof mod.connectRedis).toBe('function');
  });

  it('should export closeRedis() function', async () => {
    const mod = await import('../../src/infrastructure/redis.js');
    expect(typeof mod.closeRedis).toBe('function');
  });

  it('should gracefully handle missing REDIS_URL', async () => {
    const mod = await import('../../src/infrastructure/redis.js');
    const client = await mod.getRedis();
    // Should be null since REDIS_URL not configured in test env
    expect(client).toBeNull();

    const health = await mod.checkRedisHealth();
    expect(health.ok).toBe(false);
    expect(health.reason).toContain('not configured');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Object Storage
// ═══════════════════════════════════════════════════════════════

describe('Object Storage (local mode)', () => {
  let storage;

  beforeAll(async () => {
    storage = (await import('../../src/infrastructure/storage.js')).default;
  });

  it('should export put/get/delete/list functions', () => {
    expect(typeof storage.put).toBe('function');
    expect(typeof storage.get).toBe('function');
    expect(typeof storage.delete).toBe('function');
    expect(typeof storage.list).toBe('function');
  });

  it('should report type as local by default', () => {
    const info = storage.getInfo();
    expect(info.type).toBe('local');
  });

  it('should put and get a file', async () => {
    const key = `test/test-${Date.now()}.txt`;
    const content = Buffer.from('Hello Deborah!');

    const putResult = await storage.put(key, content, 'text/plain');
    expect(putResult.key).toBe(key);
    expect(putResult.size).toBe(content.length);

    const getResult = await storage.get(key);
    expect(getResult).not.toBeNull();
    expect(getResult.key).toBe(key);
    expect(getResult.data.toString()).toBe('Hello Deborah!');

    // Cleanup
    await storage.delete(key);
  });

  it('should return null for non-existent file', async () => {
    const result = await storage.get('test/nonexistent-file-12345');
    expect(result).toBeNull();
  });

  it('should list files with prefix', async () => {
    const prefix = `test-list-${Date.now()}`;

    // Create some test files
    await storage.put(`${prefix}/a.txt`, Buffer.from('A'));
    await storage.put(`${prefix}/b.txt`, Buffer.from('B'));

    const files = await storage.list(prefix);
    expect(files.length).toBe(2);

    // Cleanup
    await storage.delete(`${prefix}/a.txt`);
    await storage.delete(`${prefix}/b.txt`);
  });

  it('should return empty array for non-existent prefix', async () => {
    const files = await storage.list('nonexistent-prefix-xyz');
    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Shutdown Handler
// ═══════════════════════════════════════════════════════════════

describe('Shutdown handler', () => {
  it('should export setupShutdown() and closeAll() functions', async () => {
    const mod = await import('../../src/infrastructure/shutdown.js');
    expect(typeof mod.setupShutdown).toBe('function');
    expect(typeof mod.closeAll).toBe('function');
  });

  it('setupShutdown should not throw with null args', async () => {
    const mod = await import('../../src/infrastructure/shutdown.js');
    expect(() => mod.setupShutdown(null, null)).not.toThrow();
  });

  it('closeAll should resolve without throwing', async () => {
    const mod = await import('../../src/infrastructure/shutdown.js');
    await expect(mod.closeAll()).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Env Schema — Infrastructure vars
// ═══════════════════════════════════════════════════════════════

describe('Env schema — infrastructure vars', () => {
  it('should have DATABASE_URL as optional', async () => {
    const CONFIG = (await import('../../src/config/env.js')).default;
    // Should be undefined since not set in test env
    expect(CONFIG.DATABASE_URL).toBeUndefined();
  });

  it('should have REDIS_URL as optional', async () => {
    const CONFIG = (await import('../../src/config/env.js')).default;
    expect(CONFIG.REDIS_URL).toBeUndefined();
  });

  it('should default STORAGE_TYPE to local', async () => {
    const CONFIG = (await import('../../src/config/env.js')).default;
    expect(CONFIG.STORAGE_TYPE).toBe('local');
  });
});
