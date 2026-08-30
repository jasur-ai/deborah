#!/usr/bin/env node
/**
 * Deborah — PostgreSQL migratsiya runner (S30)
 * -------------------------------------------------------------------
 * AI-modullar (academic, accessibility, ai-*, api-contracts, ...) PostgreSQL
 * saqlash qatlamini ishlatadi (kysely + migrations/). DATABASE_URL sozlanmagan
 * bo'lsa iloka graceful ishlaydi (fb/local-db), lekin shu modullar faqat
 * default-o'qish/xato rejimida qoladi ("PostgreSQL required").
 *
 * Sozlash (bitta qadam):
 *   1) .env:  DATABASE_URL=postgres://user:pass@host:5432/deborah
 *      (free tier: Neon / Supabase; lokal: sudo apt install postgresql)
 *   2) npm run db:migrate
 *
 * S30: kysely 0.29 Migrator o'rniga oddiy ketma-ket runner — har migratsiya
 * alohida auto-commit (DO $$ / CREATE ROLE kabi DDL tranzaksiya muammolari
 * yo'q), xato bo'lsa ANIQ fayl nomi bilan to'xtaydi. Holat `kysely_migration`
 * jadvalida (nomi Migrator bilan mos — ikkalasi aralash ishlaydi).
 *
 * Usage:
 *   node scripts/db-migrate.js            → pending migratsiyalar
 *   node scripts/db-migrate.js --status   → ulanish holati
 *   node scripts/db-migrate.js --down <nom> → bitta migratsiya down (rollback)
 */
import { getDb, checkPostgresHealth } from '../src/infrastructure/postgres.js';
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');
const args = process.argv.slice(2);

async function listMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.js')).sort();
  return files;
}

async function ensureTable(db) {
  await db.schema
    .createTable('kysely_migration')
    .addColumn('name', 'varchar(255)', (col) => col.notNull().primaryKey())
    .addColumn('timestamp', 'bigint', (col) => col.notNull())
    .ifNotExists()
    .execute();
}

async function main() {
  if (args.includes('--status')) {
    const h = await checkPostgresHealth();
    console.log(h.ok
      ? `✅ PostgreSQL ulangan (latency ${h.latency}ms)`
      : `⛔ PostgreSQL yo'q: ${h.reason}`);
    process.exit(h.ok ? 0 : 1);
  }

  const health = await checkPostgresHealth();
  if (!health.ok) {
    console.log('⛔ PostgreSQL sozlanmagan yoki ulanmadi:', health.reason);
    console.log('');
    console.log("   .env ga quyidagini qo'shing (free tier: Neon/Supabase, yoki lokal Postgres):");
    console.log('   DATABASE_URL=postgres://user:parol@127.0.0.1:5432/deborah');
    console.log('');
    console.log('   Keyin: npm run db:migrate');
    console.log("   (DATABASE_URL siz ilova ishlayveradi — AI-modul sahifalari cheklangan bo'ladi)");
    process.exit(1);
  }

  const db = await getDb();
  if (!db) {
    console.log('⛔ Kysely init xatosi — DATABASE_URL ni tekshiring.');
    process.exit(1);
  }

  const downIdx = args.indexOf('--down');
  if (downIdx !== -1 && args[downIdx + 1]) {
    const name = args[downIdx + 1];
    const mod = await import(pathToFileURL(resolve(MIGRATIONS_DIR, name)).href);
    if (typeof mod.down !== 'function') {
      console.error(`✗ ${name}: down() yo'q — rollback qo'llanmagan`);
      process.exit(1);
    }
    await mod.down(db);
    await db.deleteFrom('kysely_migration').where('name', '=', name).execute();
    console.log(`⬇️  ${name} down bajarildi`);
    process.exit(0);
  }

  await ensureTable(db);
  const done = new Set(
    (await db.selectFrom('kysely_migration').select('name').execute())
      .map((r) => r.name),
  );
  const files = await listMigrations();
  let ran = 0, failed = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const mod = await import(pathToFileURL(resolve(MIGRATIONS_DIR, f)).href);
    try {
      await mod.up(db);
      await db
        .insertInto('kysely_migration')
        .values({ name: f, timestamp: Date.now() })
        .execute();
      ran++;
      console.log(`  ✅ ${f}`);
    } catch (err) {
      failed++;
      const msg = String(err?.message || err).slice(0, 300);
      console.error(`  ❌ ${f}: ${msg}`);
      if (err?.cause?.message) console.error(`     sabab: ${String(err.cause.message).slice(0, 300)}`);
      break; // keyingisi bu jadvalarga bog'liq bo'lishi mumkin — to'xtaymiz
    }
  }
  if (ran && !failed) console.log(`✅ ${ran} migratsiya yakunlandi.`);
  else if (!ran && !failed) console.log('✅ Pending migratsiya yo\'q — DB yangi.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
