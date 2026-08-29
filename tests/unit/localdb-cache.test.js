/**
 * S28.1 — local-db mtime/size kesh regress testlari.
 *
 * Muammo: get()/set()/update()/remove() har op'da butun db.json faylni
 * qayta o'qib JSON.parse qilardi → bulg'angan/katta DB'da admin panel
 * cheksiz "yuklanmoqda" bo'lib qolardi. Fix: readDB() mtime+size keshi.
 *
 * Semantik saqlanishi SHART: tashqi process faylga yozsa — keyingi get
 * YANGI ma'lumotni ko'radi (statSync har readDB'da tekshiriladi).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = 'localdb_cache_probe';

// fb (firebase/admin) orqali ishlaymiz — real ilova shunday ishlatadi;
// import init'ni ham ishga tushiradi (temp DB fayli yaratiladi).
async function getFb() {
  const { fb } = await import('../../firebase/admin.js');
  return fb;
}

async function writeExternally(obj) {
  // Testning o'zi "tashqi process" rolini o'ynaydi: to'g'ridan-to'g'ri faylga
  // yozadi (local-db o'z keshidan bilmaydi — mtime tekshiruvi orqali ko'rishi kerak).
  const file = process.env.LOCAL_DB_FILE;
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
  data.users = data.users || {};
  data.users[KEY] = { role: 'student', email: `old_${Date.now()}@test.uz`, ...data.users[KEY], ...obj };
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

describe('S28.1 local-db mtime-kesh', () => {
  it('tashqi fayl yozuvidan keyin get YANGI qiymatni ko\'radi (kesh semantigi buzilmadi)', async () => {
    const fb = await getFb();
    const marker = `fresh_${Date.now()}@test.uz`;
    await writeExternally({ email: marker, role: 'student' });
    // mtime/size o'zgardi → readDB faylni qayta o'qishi kerak
    const snap = await fb.get(`users/${KEY}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().email).toBe(marker);
  });

  it('set() → get() o\'z yozuvini ko\'radi (writeDB kesh sinxronizatsiyasi)', async () => {
    const fb = await getFb();
    const marker = `own_${Date.now()}@test.uz`;
    await fb.set(`users/${KEY}/email`, marker);
    const snap = await fb.get(`users/${KEY}`);
    expect(snap.val().email).toBe(marker);
  });

  it('perf: 30 ta kichik get 1MB foniida tez (har op full-file re-read emas)', async () => {
    const fb = await getFb();
    // ~1MB yuk — users ostiga (o'z kalitlarimiz, oxirida tozalanadi)
    const big = {};
    for (let i = 0; i < 4000; i++) big[`perf_${i}`] = { email: `p${i}@test.uz`, role: 'student', pad: 'x'.repeat(40) };
    await fb.set(`users/${KEY}_bulk`, big);
    try {
      const t0 = Date.now();
      for (let i = 0; i < 30; i++) {
        const s = await fb.get(`users/${KEY}`);
        if (!s.exists()) throw new Error('kesh qiymat yo\'qoldi');
      }
      const dt = Date.now() - t0;
      // Pre-fix: 30 × (~1MB readFileSync + JSON.parse) ≈ 300ms+.
      // Post-fix: statSync + navigate ≈ bir necha ms. Chegaralar yumshoq.
      expect(dt).toBeLessThan(150);
    } finally {
      await fb.remove(`users/${KEY}_bulk`);
      await fb.remove(`users/${KEY}`);
    }
  });
});
