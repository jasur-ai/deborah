/**
 * Edikit — Username validatsiya va normalizatsiya (AUTH B-04)
 * -----------------------------------------------------------
 * OWASP username rules:
 *   - case-insensitive ("Smith" == "smith") — DB'da canonical lowercase
 *   - uzunlik 2–50
 *   - format `^[a-zA-Z0-9_.-]+$` (login identifier — kirill/emoji/space yo'q)
 *   - NFKC Unicode normalizatsiya (full-width 'ａｄｍｉｎ' → 'admin')
 *   - rezerv so'zlar bloki (admin/root/support/system/test — squatting qarshi)
 *   - leet/confusable blok ('4dm1n'/'adm1n' → 'admin' — P1)
 *
 * DIQQAT: format regex kirill harflarini ALLAQACHON rad etadi — confusable
 * blok NFKC'dan keyin ham rezerv so'zga aylanadigan holatlar uchun
 * (full-width, leet raqamlar). safeKey() bilan mos: normalize → safeKey.
 *
 * MA'LUM KOLLIZIYA: safeKey() '.' ni '_' ga almashtiradi — 'john.doe' va
 * 'john_doe' bir xil Firebase key'ga tushadi. Bu ATUZIL MAQSADLI emas, lekin
 * maqbul: birinchisi key'ni oladi, ikkinchisi 'band' xatosini ko'radi;
 * privilege bog'liq emas; ikkala ko'rinishda ham login ishlaydi.
 */

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 50;
// Format: faqat ASCII harf/raqam, _, ., - (NFKC'dan keyingi canonical form)
export const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

/** Rezerv so'zlar — bu nomlar hech qachon ro'yxatdan o'tkazilmaydi. */
export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'support',
  'system',
  'test',
  'edikit',
]);

/** Leet o'rnini bosuvchilar — '4dm1n' → 'admin' aniqlash uchun (P1). */
const LEET_MAP = {
  // '1' → 'i' (adm1n → admin); 'l' alohida ko'rsatilmaydi — rezerv so'z
  // taqqoslash 'i' bilan ishlaydi (admin/root/support/system/test).
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i',
};

/**
 * Canonical normalizatsiya: NFKC (full-width → ASCII, compatibility) +
 * trim + lowercase. DB'da canonical shu ko'rinishda saqlanadi.
 */
export function normalizeUsername(str) {
  return String(str || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

/** Rezerv so'zmi? (normalizatsiyadan keyin — ' Admin ' ham bloklanadi). */
export function isReserved(username) {
  const n = normalizeUsername(username);
  return n.length > 0 && RESERVED_USERNAMES.has(n);
}

/** Leet/confusable o'rnini bosish: '4dm1n' → 'admin'. */
export function confusableToPlain(username) {
  const n = normalizeUsername(username);
  let out = '';
  for (const ch of n) out += LEET_MAP[ch] || ch;
  return out;
}

/**
 * Confusable rezerv so'zmi? NFKC'dan keyin ham 'admin' ga o'xshaydigan
 * variantlar: '4dm1n', 'adm1n', 'administr4tor'. Toza rezerv so'z bu
 * funksiyada false qaytaradi (isReserved qamraydi).
 */
export function isConfusableReserved(username) {
  const n = normalizeUsername(username);
  if (!n || isReserved(n)) return false;
  const plain = confusableToPlain(n);
  return plain !== n && RESERVED_USERNAMES.has(plain);
}

/**
 * To'liq username tekshiruvi (register/username yaratish uchun).
 * @returns {{ ok: true, username: string } | { ok: false, errorKey: string }}
 */
export function validateUsername(username, { checkReserved = true } = {}) {
  const n = normalizeUsername(username);
  if (n.length < USERNAME_MIN || n.length > USERNAME_MAX) {
    return { ok: false, errorKey: 'usernameChars' };
  }
  if (!USERNAME_REGEX.test(n)) {
    return { ok: false, errorKey: 'usernameChars' };
  }
  if (checkReserved && isReserved(n)) {
    return { ok: false, errorKey: 'usernameReserved' };
  }
  if (checkReserved && isConfusableReserved(n)) {
    return { ok: false, errorKey: 'usernameConfusable' };
  }
  return { ok: true, username: n };
}
