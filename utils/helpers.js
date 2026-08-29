/**
 * Deborah — Helper utilities
 */

import crypto from 'crypto';

/**
 * Escape HTML special characters (XSS protection)
 */
export function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize string for Firebase key usage (only a-z, 0-9, _, -)
 */
export function safeKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60);
}

/**
 * Normalize search string
 */
export function normStr(str) {
  return String(str || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Legacy SHA-256 password hashing (for migration only)
 * @deprecated Use hashPassword() with argon2 instead
 */
export function hashPass(password, salt) {
  return crypto.createHash('sha256')
    .update('qb_' + salt + '_' + password)
    .digest('hex');
}

/**
 * Hash password with argon2id (modern, memory-hard)
 * Returns the full argon2 hash string (includes salt, params, etc.)
 */
export async function hashPassword(password) {
  if (!password) throw new Error('Password is required');
  const argon2 = await import('argon2');
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,   // 19 MiB
    timeCost: 2,         // 2 iterations
    parallelism: 1,      // single thread
  });
}

/**
 * Verify password against argon2 hash
 * Returns true/false
 */
export async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  try {
    // Detect if it's an argon2 hash (starts with $argon2)
    if (hash.startsWith('$argon2')) {
      const argon2 = await import('argon2');
      return argon2.verify(hash, password);
    }
    // Not an argon2 hash — will be handled by legacy migration in auth routes
    return false;
  } catch {
    return false;
  }
}

/**
 * Login bilan BIR XIL parol tekshiruvi (argon2 + legacy sha256 + plaintext)
 * va muvaffaqiyatda argon2id'ga migratsiya qiymatini qaytaradi.
 * Secondary yo'llar (profil zaxira kodlari, reauth) login'ning
 * L1146-1156 mantig'idan farq qilmasligi kerak — aks holda eski
 * (legacy hash'li) akkauntlar to'g'ri parol bilan ham 403 oladi
 * (2026-08-27 topilma: profil backup-codes aynan shunga uchragan).
 * @returns {Promise<{ok:boolean, migrated:boolean, newHash:string|null, from:string|null}>}
 */
export async function verifyLoginPassword(password, storedHash, userKey) {
  if (!password || !storedHash) return { ok: false, migrated: false, newHash: null, from: null };
  let isMatch = false;
  let from = null;
  if (storedHash.startsWith('$argon2')) {
    isMatch = await verifyPassword(password, storedHash);
  } else if (isLegacyHash(storedHash)) {
    isMatch = hashPass(password, userKey) === storedHash;
    if (isMatch) from = 'sha256';
  } else if (storedHash === password) {
    isMatch = true;
    from = 'plaintext';
  }
  if (!isMatch) return { ok: false, migrated: false, newHash: null, from: null };
  if (from) {
    try {
      return { ok: true, migrated: true, newHash: await hashPassword(password), from };
    } catch (_) {
      return { ok: true, migrated: false, newHash: null, from };
    }
  }
  return { ok: true, migrated: false, newHash: null, from: null };
}

/**
 * Check if a stored hash uses the legacy SHA-256 algorithm
 */
export function isLegacyHash(hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash);
}

/**
 * Format milliseconds to readable time
 */
export function fmtTime(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

/**
 * Generate random game code (5 digits)
 */
export function generateGameCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

/**
 * Shuffle array with deterministic seed (optional)
 */
export function shuffleArray(arr, seed) {
  const a = [...arr];
  let s = (seed || 0) * 1103515245 + 12345;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Normalize question from any format into unified {text, options, correct, is_double}
 */
export function normalizeQuestion(q) {
  if (!q) return null;
  const rawOpts = q.options || [];
  const isObjArr = rawOpts.length > 0 && typeof rawOpts[0] === 'object';

  // S16 BUG-104: buxoro savollar endi o'tmaydi — matnsiz / <2 variant /
  // to'g'ri javobi belgilanmagan yoki chiroqdan tashqaridagi correct bilan
  // sessiya yaratilsa, o'yin jarayoni buzilardi (hech kim to'g'ri javob
  // bera olmaydi, reveal'da correctText undefined)
  const text = String(q.text || '').trim().slice(0, 2000);
  if (!text) return null;

  if (isObjArr) {
    // PRE/Mock format: options are {text, letter, isCorrect}
    const strings = rawOpts.map(o => String(o?.text || '')).slice(0, 12);
    const correctIdx = rawOpts.findIndex(o => o.isCorrect);
    if (correctIdx < 0) return null; // to'g'ri javob belgilanmagan
    if (strings.filter(Boolean).length < 2) return null;
    return {
      text,
      options: strings,
      correct: correctIdx,
      is_double: !!q.is_double
    };
  }
  // User-created format: options are strings, correct is index
  const options = rawOpts.map(o => String(o || '')).slice(0, 12);
  if (options.filter(Boolean).length < 2) return null;
  // correct — int + [0..options-1] clamp (S15 BUG-095 bilan izchil)
  const correct = Math.max(0, Math.min(
    Number.isFinite(+q?.correct) ? Math.floor(+q.correct) : 0,
    options.length - 1,
  ));
  return {
    text,
    options,
    correct,
    is_double: !!q.is_double
  };
}

/**
 * Calculate points based on answer time and game type
 */
export function calculatePoints(elapsedMs, totalTimeMs, isCorrect, isDouble, gameType) {
  if (!isCorrect) return 0;

  let pts = 100;
  if (gameType === 'score') {
    const ratio = Math.min(1, elapsedMs / totalTimeMs);
    if (ratio < 0.1) pts = 100;
    else if (ratio < 0.2) pts = 90;
    else if (ratio < 0.3) pts = 80;
    else if (ratio < 0.4) pts = 70;
    else if (ratio < 0.5) pts = 60;
    else if (ratio < 0.6) pts = 50;
    else if (ratio < 0.7) pts = 40;
    else if (ratio < 0.8) pts = 30;
    else if (ratio < 0.9) pts = 20;
    else pts = 10;
  }
  if (isDouble) pts *= 2;
  return pts;
}

/**
 * Build leaderboard from players object
 */
export function buildLeaderboard(players) {
  if (!players) return [];
  return Object.entries(players)
    .map(([name, p]) => ({
      name,
      emoji: p.emoji || '❓',
      score: p.score || 0,
      time: p.totalTime || 0
    }))
    .sort((a, b) => b.score - a.score || a.time - b.time);
}

/**
 * Character image helper for EJS
 */
export function charImg(imgPath, size = 30) {
  if (!imgPath) return '❓';
  if (imgPath.startsWith('characters/') || imgPath.startsWith('http')) {
    return `<img src="/${imgPath}" style="width:${size}px;height:${size}px;object-fit:contain;vertical-align:middle;border-radius:4px;" alt="">`;
  }
  return imgPath;
}

/**
 * Format date for display
 */
export function fmtDate(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleDateString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Create a slug from string
 */
export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}
