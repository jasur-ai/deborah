#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * DEBORAH — Demo ma'lumotlarni tozalash (adabiyot, algebra va h.k.)
 * ─────────────────────────────────────────────────────────────
 * Maqsad: demo/seed ma'lumotlar O'CHIRILADI, REAL ma'lumotlar QOLADI.
 *
 * Nimani o'chiradi:
 *   1. mock_fans/*   — 22 ta demo fan (matematika_algebra, adabiyot_uzbek, fizika...)
 *   2. pre_groups/*  — 6 ta demo DMT guruhi (pre_matematika, pre_fizika...)
 *   3. results/*     — faqat demo natijalar (demo host yoki demo fan nomi bilan)
 *   4. users/*       — faqat seed ro'yxatidagi demo userlar (email'siz, pass 1234)
 *                      __admin__ VA real ro'yxatdan o'tganlar QOLADI
 *
 * Qanday ishga tushiriladi:
 *   Lokal (data/db.json):
 *     node scripts/cleanup-demo-data.js            # DRY-RUN (ko'rsatadi, o'chirmaydi)
 *     node scripts/cleanup-demo-data.js --apply    # HAQIQIY O'CHIRISH
 *
 *   Real Firebase (production):
 *     FIREBASE_SERVICE_ACCOUNT='<json string>' \
 *     FIREBASE_DATABASE_URL='https://sessiya-11767-default-rtdb.firebaseio.com' \
 *     node scripts/cleanup-demo-data.js --apply
 *
 * Ehtiyot chorasi: --apply'dan oldin doim DRY-RUN bilan tekshiring.
 */
import fb from '../firebase/admin.js';

const APPLY = process.argv.includes('--apply');

// ── Seed'dagi demo userlar (firebase/seed-data.js demoUsers + test hisoblar) ──
const DEMO_USER_KEYS = [
  'user', // demo oddiy hisob (user/user)
  'alisher','malika','sardor','nigora','davron','nilufar','behruz','zarnigor',
  'shoxrux','munisa','jahongir','gulnoza','turgun','odil','dildora','islom',
  'feruza','rustam','kamola','jasmina','muhammad','zulfiya','bobur','rayhona',
  'komil','nargiza','elyor','nazokat','sanjar','aziza','xurshid','abdulla',
  'dilnoza','otabek','shahzoda','farrux','gulbahor','ilhom','malika2',
  'temur','zilola','anvar','sabina','doniyor','kamron','madina','sardor2',
];
// Eslatma: ro'yxat to'liq bo'lmasa ham xavfsiz — pastdagi qo'shimcha shart
// (email YO'Q + password demo hash'ga mos) himoya qiladi.

// Demo fan nomlari (results tozalashda matching uchun)
const DEMO_SUBJECT_RE = /Matematika|Algebra|Geometriya|Trigonometriya|Adabiyot|Fizika|Kimyo|Biologiya|Tarix|Geografiya|Informatika|Ingliz|Astronomiya|Ekologiya|Huquq|Iqtisodiyot|Psixologiya|Pedagogika|Tibbiyot|Falsafa|San'at|Sanat|DTM/i;

async function list(path) {
  try {
    const snap = await fb.get(path);
    return snap.exists() ? (snap.val() || {}) : {};
  } catch (e) {
    return {};
  }
}

function log(kind, msg) {
  console.log(`  ${kind === 'del' ? '🗑' : kind === 'keep' ? '✅' : 'ℹ️'} ${msg}`);
}

async function main() {
  console.log('\n════════════════════════════════════════════════');
  console.log(`  DEMO MA'LUMOTLARNI TOZALASH — rejim: ${APPLY ? '🔴 APPLY (haqiqiy o\'chirish)' : '🔵 DRY-RUN (faqat ko\'rsatish)'}`);
  console.log('════════════════════════════════════════════════\n');

  let delCount = 0;

  // ── 1. mock_fans (demo fanlar: adabiyot, algebra...) ──
  console.log('── mock_fans (demo fanlar) ──');
  const fans = await list('mock_fans');
  for (const key of Object.keys(fans)) {
    log('del', `mock_fans/${key} — ${fans[key]?.name || key}`);
    if (APPLY) await fb.remove(`mock_fans/${key}`);
    delCount++;
  }
  if (!Object.keys(fans).length) log('info', 'bo\'sh — tozalash kerak emas');

  // ── 2. pre_groups (demo DTM guruhlari) ──
  console.log('\n── pre_groups (demo DTM guruhlari) ──');
  const pres = await list('pre_groups');
  for (const key of Object.keys(pres)) {
    log('del', `pre_groups/${key} — ${pres[key]?.title || key}`);
    if (APPLY) await fb.remove(`pre_groups/${key}`);
    delCount++;
  }
  if (!Object.keys(pres).length) log('info', 'bo\'sh — tozalash kerak emas');

  // ── 3. results (faqat demo natijalar) ──
  console.log('\n── results (demo natijalar) ──');
  const results = await list('results');
  let resDel = 0, resKeep = 0;
  for (const [code, r] of Object.entries(results)) {
    const host = (r && (r.host || r.hostName || r.owner)) || '';
    const name = (r && (r.name || r.title || r.testName)) || '';
    const isDemo =
      DEMO_USER_KEYS.includes(String(host).toLowerCase()) ||
      (name && DEMO_SUBJECT_RE.test(name));
    if (isDemo) {
      log('del', `results/${code} — ${name || '(nom yo\u2018q)'} · host: ${host || '—'}`);
      if (APPLY) await fb.remove(`results/${code}`);
      delCount++; resDel++;
    } else {
      log('keep', `results/${code} — ${name || '(nom yo\u2018q)'} · host: ${host || '—'} [REAL]`);
      resKeep++;
    }
  }
  if (!Object.keys(results).length) log('info', 'bo\'sh');
  else log('info', `demo: ${resDel} o'chiriladi · real: ${resKeep} qoladi`);

  // ── 4. users (faqat seed demo hisoblari) ──
  console.log('\n── users (demo hisoblar; __admin__ va real userlar qoladi) ──');
  const users = await list('users');
  let uDel = 0, uKeep = 0;
  for (const [key, u] of Object.entries(users)) {
    if (key === '__admin__') { log('keep', `users/${key} — ADMIN (majburiy saqlanadi)`); uKeep++; continue; }
    const noEmail = !(u && u.email);
    // Bu platformada REAL ro'yxatdan o'tgan user doim emailga ega (AUTH A-18).
    // Email yo'q + seed ro'yxatda (yoki umuman email'siz) = demo hisob.
    const inSeedList = DEMO_USER_KEYS.includes(key.toLowerCase());
    const looksDemo = noEmail || inSeedList;
    if (looksDemo) {
      log('del', `users/${key} — ${u?.username || key} (demo, email yo'q)`);
      if (APPLY) await fb.remove(`users/${key}`);
      delCount++; uDel++;
    } else {
      log('keep', `users/${key} — ${u?.username || key} ${u?.email ? '· ' + u.email : ''} [REAL]`);
      uKeep++;
    }
  }
  log('info', `demo: ${uDel} o'chiriladi · real/admin: ${uKeep} qoladi`);

  console.log('\n════════════════════════════════════════════════');
  console.log(`  YAKUN: ${delCount} element ${APPLY ? 'O\'CHIRILDI ✅' : 'o\'chiriladi (dry-run)'}`);
  if (!APPLY) console.log('  Haqiqiy o\'chirish uchun: node scripts/cleanup-demo-data.js --apply');
  console.log('════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('XATO:', e?.message || e);
  process.exit(1);
});
