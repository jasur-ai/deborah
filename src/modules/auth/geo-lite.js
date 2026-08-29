/**
 * Deborah — Geo-Lite: ip → shahar + timezone (P1 lokal DB)
 * -------------------------------------------------------------------
 * AUTH A-09 §29: shahar aniqlash P1'da (lokal DB) — maxmind/paketli
 * geoip o'rniga kichik statik jadval + kelajakda to'liq DB uchun nuqta.
 * AUTH C-05 §07-§08: geo lokal (tashqi API EMAS — UZ privacy, offline);
 * timezone shahar bilan birga keladi (user Asia/Tashkent — geo hisobda).
 *
 * Xavfsizlik:
 *   - Faqat AGREGAT qaytaramiz (shahar nomi) — to'liq IP hech qachon
 *     xabar/preview'ga chiqmaydi (ip_hash ham PII hisoblanadi).
 *   - Noma'lum IP → null → xabar "shahar noma'lum" ko'rsatadi.
 *   - GeoLite2 litsenziya (CC BY-SA 4.0) — lokal CSV/JSON DB
 *     `CITY_DB_PATH` env bilan yuklanadi; bu statik jadval demo.
 *
 * Test IP'lar (RFC 5737 — hujjatlashtirish uchun):
 *   203.0.113.0/24 → Toshkent, 198.51.100.0/24 → Samarqand
 */

// ── Lokal jadval (prefix → { city, tz }) — ishlab chiqish/test uchun ──
// Real deployment: `CITY_DB_PATH` env bilan to'liq CSV/JSON DB yuklanadi.
// Timezone'lar IANA (Asia/Tashkent — UZ; xorij shaharlari o'z tz'larida).
const CITY_PREFIXES = new Map([
  // RFC 5737 test bloklari
  ['203.0.113.', { city: 'Toshkent', tz: 'Asia/Tashkent' }],
  ['198.51.100.', { city: 'Samarqand', tz: 'Asia/Tashkent' }],
  // O'zbekiston shaharlari (barchasi Asia/Tashkent)
  ['195.158.', { city: 'Toshkent', tz: 'Asia/Tashkent' }],
  ['213.230.', { city: 'Toshkent', tz: 'Asia/Tashkent' }],
  ['82.215.', { city: 'Toshkent', tz: 'Asia/Tashkent' }],
  ['91.212.', { city: 'Nukus', tz: 'Asia/Tashkent' }],
  ['194.36.', { city: 'Andijon', tz: 'Asia/Tashkent' }],
  // Xorij (C-05 timezone tekshiruvi uchun namuna)
  ['192.0.2.', { city: 'London', tz: 'Europe/London' }],
]);

/** Noma'lum IP yoki parse bo'lmasa null — "shahar noma'lum" degan ma'noda. */
export function cityFromIp(ipAddress) {
  const g = geoFromIp(ipAddress);
  return g ? g.city : null;
}

/**
 * C-05 §08: geo agregat (shahar + timezone). Client ts ishonmaydi —
 * server ts yagona manba; timezone faqat shahar konteksti uchun.
 * @returns {{ city: string, tz: string }|null}
 */
export function geoFromIp(ipAddress) {
  if (!ipAddress) return null;
  const ip = String(ipAddress).trim();
  for (const [prefix, geo] of CITY_PREFIXES.entries()) {
    if (ip.startsWith(prefix)) return { city: geo.city, tz: geo.tz };
  }
  return null;
}

/** Shahar mavjudligini tekshirish — impossible-travel qoidasi uchun. */
export function cityChanged(prevCity, currentCity) {
  if (!prevCity || !currentCity) return false; // noma'lum bo'lsa qoida ishlamaydi
  return prevCity !== currentCity;
}
