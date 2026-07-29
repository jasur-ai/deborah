/**
 * Edikit — Helper utilities
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
 * Hash password with SHA-256 (Node.js compatible)
 */
export function hashPass(password, salt) {
  return crypto.createHash('sha256')
    .update('qb_' + salt + '_' + password)
    .digest('hex');
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

  if (isObjArr) {
    // PRE/Mock format: options are {text, letter, isCorrect}
    const strings = rawOpts.map(o => o.text || '');
    const correctIdx = rawOpts.findIndex(o => o.isCorrect);
    return {
      text: q.text || '',
      options: strings,
      correct: correctIdx >= 0 ? correctIdx : -1,
      is_double: !!q.is_double
    };
  }
  // User-created format: options are strings, correct is index
  return {
    text: q.text || '',
    options: rawOpts.map(o => String(o || '')),
    correct: typeof q.correct === 'number' ? q.correct : 0,
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
