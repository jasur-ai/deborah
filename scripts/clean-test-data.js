#!/usr/bin/env node
/**
 * Deborah — Test qoldiqlarini tozalash (S28.1)
 * -------------------------------------------------------------------
 * Muammo: vitest izolyatsiyasi (LOCAL_DB_FILE → temp) YO'Q davrda ishlagan
 * test run'lar real data/db.json'ga (yoki Firebase'ga) test userlari va
 * testlarini yozib ketgan. Natija: admin panelda ~20 "demo" user, 162 test,
 * katta db.json va sekin (cheksiz yuklanayotgan) panel.
 *
 * Bu skript test patternlariga mos userlarni topadi va (faqat --apply bilan)
 * o'chiradi. Default DRY-RUN — hech narsa o'chirmaydi, faqat hisobot.
 *
 *   node scripts/clean-test-data.js                 → hisobot (xavfsiz)
 *   node scripts/clean-test-data.js --apply         → backup + o'chirish
 *   node scripts/clean-test-data.js --apply --force → yaqin login qilganlarni ham
 *   node scripts/clean-test-data.js --keep=ali,vali → qo'shimcha himoya
 *
 * Test patternlari (test fayllaridagi real konventsiyalar):
 *   - username: <prefix>_<4+ raqam>  (a03f_834756, logout_823941, e2e_...)
 *   - username: <prefix>_<6 hex>     (a09cap_3fa1b2 — crypto.randomBytes)
 *   - email: @test.uz / @test.* / @example.* / mailinator / +raqam tag
 * Himoya: --keep ro'yxat + oxirgi 7 kunda login qilgan userlar default
 * o'chirmaydi (--force bilan o'chadi). Local rejimda avtomatik backup:
 * data/backups/db-before-clean-<ts>.json; o'chirilgan yozuvlar ham saqlanadi.
 */
import { fb, USE_REAL_FIREBASE } from '../firebase/admin.js';
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const keepArg = args.find((a) => a.startsWith('--keep='));
const KEEP = new Set(['__admin__', 'admin', 'sardor', 'user',
  ...(keepArg ? keepArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : [])]);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Test username konventsiyalari (yuqoridagi izoh)
const RE_NUMERIC_SUFFIX = /^[a-z0-9][a-z0-9_]{1,30}_\d{4,}$/i;
const RE_HEX_SUFFIX = /^[a-z0-9][a-z0-9_]{1,30}_[0-9a-f]{6}$/i;
const RE_TEST_EMAIL = /@(test\.[a-z]+|example\.[a-z]+|mailinator\.com)$/i;
const RE_PLUS_TAG = /\+\d+@/;

function isTestUser(key, u) {
  if (!u || typeof u !== 'object') return false;
  const uname = String(u.username || key || '').toLowerCase();
  const email = String(u.email || '').toLowerCase();
  if (RE_NUMERIC_SUFFIX.test(uname) || RE_HEX_SUFFIX.test(uname)) return true;
  if (email && (RE_TEST_EMAIL.test(email) || RE_PLUS_TAG.test(email))) return true;
  return false;
}

function countTests(u) {
  try {
    const t = u && u.tests && typeof u.tests === 'object' ? Object.keys(u.tests).length : 0;
    return t;
  } catch (_) { return 0; }
}

async function main() {
  console.log('🧹 Deborah test-qoldiq tozalash —', APPLY ? 'APPLY (o\'chirish)' : 'DRY-RUN (faqat hisobot)');
  console.log('   Backend:', USE_REAL_FIREBASE ? '🔥 FIREBASE (real DB!)' : '💾 LOCAL data/db.json');
  if (USE_REAL_FIREBASE && !APPLY) console.log('   (Firebase rejimida --apply ehtiyot bilan — backup lokal faylga)');
  console.log('');

  const snap = await fb.get('users');
  if (!snap.exists()) { console.log('users topilmadi — tozalash kerak emas'); return; }
  const users = snap.val() || {};

  const doomed = [];     // o'chiriladigan test userlar
  const recent = [];     // test-pattern lekin yaqinda login — skip
  const kept = [];
  for (const [key, u] of Object.entries(users)) {
    if (KEEP.has(key) || KEEP.has(String(u?.username || ''))) { kept.push(key); continue; }
    if (!isTestUser(key, u)) { kept.push(key); continue; }
    const last = Number(u.lastLoginAt || u.last_login_at || 0);
    if (!FORCE && last > 0 && Date.now() - last < WEEK_MS) { recent.push(key); continue; }
    doomed.push(key);
  }

  const testCount = doomed.reduce((s, k) => s + countTests(users[k]), 0)
    + recent.reduce((s, k) => s + countTests(users[k]), 0);

  console.log(`   Jami user: ${Object.keys(users).length}`);
  console.log(`   Test-pattern (o'chiriladi): ${doomed.length} — ${doomed.slice(0, 12).join(', ')}${doomed.length > 12 ? ' …' : ''}`);
  if (recent.length) console.log(`   ⏭  7 kunda login qilgan (skip, --force bilan o'chadi): ${recent.length} — ${recent.slice(0, 8).join(', ')}`);
  console.log(`   Saqlanadi: ${kept.length} (KEEP: ${[...KEEP].slice(0, 6).join(', ')}…)`);
  console.log(`   Test yozuvlari (users/*/tests): ~${testCount}`);
  console.log('');

  if (!APPLY) {
    console.log('✅ DRY-RUN — hech narsa o\'chirilmadi. O\'chirish uchun: node scripts/clean-test-data.js --apply');
    return;
  }
  if (!doomed.length) { console.log('✅ Tozalash uchun hech narsa yo\'q'); return; }

  // Backup (local rejim — butun fayl; har rejimda — o'chirilayotgan yozuvlar)
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bakDir = resolve(ROOT, 'data', 'backups');
  try { mkdirSync(bakDir, { recursive: true }); } catch (_) {}
  const removedJson = {};
  for (const k of doomed) removedJson[k] = users[k];
  try {
    writeFileSync(resolve(bakDir, `removed-users-${ts}.json`), JSON.stringify(removedJson, null, 2), 'utf-8');
    if (!USE_REAL_FIREBASE) {
      const dbFile = process.env.LOCAL_DB_FILE
        ? resolve(process.env.LOCAL_DB_FILE)
        : resolve(ROOT, 'data', 'db.json');
      if (existsSync(dbFile)) copyFileSync(dbFile, resolve(bakDir, `db-before-clean-${ts}.json`));
    }
    console.log(`💾 Backup: data/backups/removed-users-${ts}.json${USE_REAL_FIREBASE ? '' : ' + db-before-clean-' + ts + '.json'}`);
  } catch (e) {
    console.warn('⚠️ Backup yozilmadi (davom etamiz):', e.message);
  }

  let ok = 0, fail = 0;
  for (const k of doomed) {
    try { await fb.remove(`users/${k}`); ok++; process.stdout.write('.'); }
    catch (e) { fail++; console.error(`\n✗ ${k}: ${e.message}`); }
  }
  console.log('');
  console.log(`✅ O'chirildi: ${ok}${fail ? `, muvaffaqiyatsiz: ${fail}` : ''}`);
  console.log('   Panel endi tez ishlaydi (S28.1 mtime-kesh + toza DB). Serverni qayta ishga tushiring.');
}

main().catch((e) => { console.error('✗ Xato:', e.message); process.exit(1); });
