#!/usr/bin/env node
/**
 * Deborah — Design Audit: DB Snapshot/Restore Helper (STEP 01 / S01.09)
 * -------------------------------------------------------------------
 * Browser/test ishga tushishidan OLDIN data/db.json ni snapshot'laydi,
 * test'lar tugagach restore qiladi — seed ma'lumotlar buzilmaydi.
 *
 * Ishga tushirish:
 *   node scripts/design-db-restore.js snapshot   → data/db.json → design-audit/db.json.snap
 *   node scripts/design-db-restore.js restore    → snapshot'dan qaytaradi
 *   node scripts/design-db-restore.js status     → holatni ko'rsatadi
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB = join(ROOT, 'data', 'db.json');
const SNAP_DIR = join(ROOT, 'design-audit');
const SNAP = join(SNAP_DIR, 'db.json.snap');

const cmd = process.argv[2] || 'status';

if (cmd === 'snapshot') {
  if (!existsSync(DB)) {
    console.error('db.json topilmadi:', DB);
    process.exit(1);
  }
  mkdirSync(SNAP_DIR, { recursive: true });
  copyFileSync(DB, SNAP);
  console.log(`✅ Snapshot olindi: ${DB} → ${SNAP} (${readFileSync(SNAP, 'utf-8').length} bayt)`);
} else if (cmd === 'restore') {
  if (!existsSync(SNAP)) {
    console.error('Snapshot topilmadi. Avval `snapshot` buyrug\'ini ishga tushiring.');
    process.exit(1);
  }
  copyFileSync(SNAP, DB);
  console.log(`✅ DB qaytarildi: ${SNAP} → ${DB}`);
} else if (cmd === 'status') {
  const snapSize = existsSync(SNAP) ? readFileSync(SNAP, 'utf-8').length : 0;
  console.log(`db.json: ${existsSync(DB) ? readFileSync(DB, 'utf-8').length + ' bayt' : 'topilmadi'}`);
  console.log(`snapshot: ${snapSize ? snapSize + ' bayt' : 'yo\'q'}`);
} else {
  console.error('Noma\'lum buyruq. snapshot | restore | status');
  process.exit(1);
}
