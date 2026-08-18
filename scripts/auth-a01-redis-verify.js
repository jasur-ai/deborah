/**
 * AUTH A-01 — Real Redis TTL verification (Docker: edikit-redis)
 * -----------------------------------------------------------------
 * ioredis-mock `expiration` set() formasini qo'llamagani uchun TTL unit testda
 * o'lchanmaydi. Bu script haqiqiy Redis'ga qarshi isbotlaydi (HTTP qatlamisiz —
 * drvfs fetch quirk'laridan holi):
 *   - cookie.expires = now + 30 kun  → `edikit:sess:<sid>` TTL ≈ 2592000s
 *   - cookie.expires = now + 8 soat  → TTL ≈ 28800s
 *
 * Ishlatish:  docker exec edikit-redis redis-cli ping  (Redis tirik bo'lishi kerak)
 *   node scripts/auth-a01-redis-verify.js
 *
 * Exit: 0 = PASS, 1 = FAIL
 */
import { createSessionStore, SESSION_PREFIX, SESSION_TTL_REMEMBER_MS, SESSION_TTL_DEFAULT_MS } from '../src/modules/auth/session-store.js';

const URL = 'redis://127.0.0.1:6379';

function setSession(store, sid, expires) {
  return new Promise((resolve, reject) =>
    store.set(sid, { cookie: { expires }, user: { safeKey: 'ttl-check' } }, (err) => (err ? reject(err) : resolve()))
  );
}

async function main() {
  const { store, client, close } = await createSessionStore({ url: URL, logger: console });
  if (!client) throw new Error('Redis client olinmadi — container ishlamayaptimi?');

  try {
    // remember=on → 30 kun
    await setSession(store, 'ttl-rem', new Date(Date.now() + SESSION_TTL_REMEMBER_MS));
    const ttlRemember = await client.ttl(`${SESSION_PREFIX}ttl-rem`);
    console.log(`remember=on  → TTL ${ttlRemember}s (kutilgan 2592000)`);
    if (ttlRemember < 2592000 - 120 || ttlRemember > 2592000) {
      throw new Error(`remember TTL kutilmadi: ${ttlRemember} (30 kun = 2592000s)`);
    }

    // remember yo'q → 8 soat
    await setSession(store, 'ttl-def', new Date(Date.now() + SESSION_TTL_DEFAULT_MS));
    const ttlDefault = await client.ttl(`${SESSION_PREFIX}ttl-def`);
    console.log(`remember=off → TTL ${ttlDefault}s (kutilgan 28800)`);
    if (ttlDefault < 28800 - 120 || ttlDefault > 28800) {
      throw new Error(`default TTL kutilmadi: ${ttlDefault} (8 soat = 28800s)`);
    }

    await client.del(`${SESSION_PREFIX}ttl-rem`, `${SESSION_PREFIX}ttl-def`);
    console.log('\nPASS — Redis per-session TTL mapping ishlayapti (AUTH A-01)');
  } finally {
    await close();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
