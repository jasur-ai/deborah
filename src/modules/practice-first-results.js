/**
 * Public, immutable first-attempt results for Mock and PRE practice.
 * Only a username and score are stored here; personal history remains separate.
 */
export const PRACTICE_FIRST_SCORES_ROOT = 'practice_first_scores';

const ITEM_KEY_RE = /^[A-Za-z0-9_.-]{1,120}$/;
const CHUNK_KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const USER_KEY_RE = /^[A-Za-z0-9_-]{1,120}$/;

function validPart(value, pattern) {
  const text = String(value || '');
  return pattern.test(text) && !text.includes('..') && !text.startsWith('.') ? text : null;
}

/** Shared collection path: one first result per user for this Mock or PRE subtest. */
export function practiceFirstResultsCollectionPath(source, key, chunk = '') {
  const itemKey = validPart(key, ITEM_KEY_RE);
  if (!itemKey) throw new TypeError('invalid_practice_key');
  if (source === 'mock') return `${PRACTICE_FIRST_SCORES_ROOT}/mock/${itemKey}`;
  if (source === 'pre') {
    const chunkKey = validPart(chunk, CHUNK_KEY_RE);
    if (!chunkKey) throw new TypeError('invalid_practice_chunk');
    return `${PRACTICE_FIRST_SCORES_ROOT}/pre/${itemKey}/${chunkKey}`;
  }
  throw new TypeError('invalid_practice_source');
}

/** Exact per-user RTDB path. */
export function practiceFirstResultPath(source, key, chunk, userKey) {
  const accountKey = validPart(userKey, USER_KEY_RE);
  if (!accountKey) throw new TypeError('invalid_user_key');
  return `${practiceFirstResultsCollectionPath(source, key, chunk)}/${accountKey}`;
}

/**
 * Return the earliest retained full attempt for one catalog item.
 * The current attempt is included after it has been saved to practice_history.
 */
export function findFirstPracticeAttempt(history, source, key, chunk = '') {
  if (!['mock', 'pre'].includes(source)) return null;
  const expectedKey = String(key || '');
  const expectedChunk = source === 'pre' ? String(chunk || '') : '';
  if (!expectedKey || (source === 'pre' && !expectedChunk)) return null;

  const matches = Object.entries(history && typeof history === 'object' ? history : {})
    .filter(([, record]) => record && typeof record === 'object'
      && record.practiceSource === source
      && String(record.practiceKey || record.key || '') === expectedKey
      && (!record.kind || record.kind === 'full')
      && (source !== 'pre' || String(record.practiceChunk || '') === expectedChunk)
      && Number(record.total) > 0)
    .sort((a, b) => {
      const atDifference = (Number(a[1].at) || 0) - (Number(b[1].at) || 0);
      return atDifference || a[0].localeCompare(b[0]);
    });
  return matches.length ? matches[0][1] : null;
}

/** Privacy-minimal public record; never include email, account key, or answer data. */
export function makePublicFirstResult(record, username) {
  if (!record || typeof record !== 'object') return null;
  const total = Number(record.total);
  if (!Number.isFinite(total) || total <= 0) return null;
  const safeTotal = Math.min(100000, Math.floor(total));
  const rawCorrect = Number(record.correct);
  const correct = Number.isFinite(rawCorrect) ? Math.max(0, Math.min(safeTotal, Math.floor(rawCorrect))) : 0;
  const rawPercent = Number(record.percent);
  const percent = Number.isFinite(rawPercent)
    ? Math.max(0, Math.min(100, Math.round(rawPercent)))
    : Math.round((correct / safeTotal) * 100);
  const safeUsername = typeof username === 'string' && username.trim()
    ? username.trim().slice(0, 60)
    : 'Foydalanuvchi';
  const rawAt = Number(record.at);
  const maxDate = 8_640_000_000_000_000; // JavaScript Date's maximum timestamp
  const at = Number.isFinite(rawAt) ? Math.min(maxDate, Math.max(0, Math.floor(rawAt))) : Date.now();
  return {
    username: safeUsername,
    correct,
    total: safeTotal,
    percent,
    at,
  };
}
