/**
 * Aggregate personal Mock/Subtest practice attempts for the admin catalog.
 * Only summaries are returned; user identifiers and answer data stay private.
 */
const PRACTICE_SOURCES = new Set(['mock', 'pre']);
const KEY_RE = /^[A-Za-z0-9_.-]{1,120}$/;
const CHUNK_RE = /^[A-Za-z0-9_.-]{1,64}$/;

function finiteInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function makeBucket() {
  return {
    attempts: 0,
    userKeys: new Set(),
    percentTotal: 0,
    bestPercent: 0,
    correctAnswers: 0,
    totalQuestions: 0,
    lastAt: 0,
  };
}

function addRecord(bucket, userKey, record) {
  const total = finiteInt(record.total);
  const correct = Math.min(total, finiteInt(record.correct));
  if (!total) return false;
  const storedPercent = Number(record.percent);
  const percent = Number.isFinite(storedPercent)
    ? Math.max(0, Math.min(100, Math.round(storedPercent)))
    : Math.round((correct / total) * 100);

  bucket.attempts += 1;
  bucket.userKeys.add(userKey);
  bucket.percentTotal += percent;
  bucket.bestPercent = Math.max(bucket.bestPercent, percent);
  bucket.correctAnswers += correct;
  bucket.totalQuestions += total;
  bucket.lastAt = Math.max(bucket.lastAt, finiteInt(record.at));
  return true;
}

function finalizeBucket(bucket) {
  return {
    attempts: bucket.attempts,
    participants: bucket.userKeys.size,
    averagePercent: bucket.attempts ? Math.round(bucket.percentTotal / bucket.attempts) : 0,
    bestPercent: bucket.bestPercent,
    correctAnswers: bucket.correctAnswers,
    totalQuestions: bucket.totalQuestions,
    lastAt: bucket.lastAt,
  };
}

/**
 * Aggregate the latest saved full attempts per user (retry attempts are excluded).
 * `users` is the existing users/{key} Firebase snapshot value.
 */
export function aggregatePracticeResults(users, source) {
  if (!PRACTICE_SOURCES.has(source)) return { byKey: {}, byChunk: {} };

  const byKey = new Map();
  const byChunk = new Map();
  for (const [userKey, user] of Object.entries(users || {})) {
    const history = user?.practice_history;
    if (!history || typeof history !== 'object') continue;

    for (const record of Object.values(history)) {
      if (!record || typeof record !== 'object') continue;
      if (record.practiceSource !== source || record.kind === 'retry') continue;
      const key = String(record.practiceKey || record.key || '');
      if (!KEY_RE.test(key) || key.includes('..')) continue;

      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = makeBucket();
        byKey.set(key, bucket);
      }
      if (!addRecord(bucket, userKey, record)) continue;

      if (source === 'pre') {
        const chunk = String(record.practiceChunk || '');
        if (!CHUNK_RE.test(chunk) || chunk.includes('..')) continue;
        let chunks = byChunk.get(key);
        if (!chunks) {
          chunks = new Map();
          byChunk.set(key, chunks);
        }
        let chunkBucket = chunks.get(chunk);
        if (!chunkBucket) {
          chunkBucket = makeBucket();
          chunks.set(chunk, chunkBucket);
        }
        addRecord(chunkBucket, userKey, record);
      }
    }
  }

  const finalizedByKey = Object.fromEntries(
    [...byKey.entries()].map(([key, bucket]) => [key, finalizeBucket(bucket)]),
  );
  const finalizedByChunk = Object.fromEntries(
    [...byChunk.entries()].map(([key, chunks]) => [
      key,
      Object.fromEntries([...chunks.entries()].map(([chunk, bucket]) => [chunk, finalizeBucket(bucket)])),
    ]),
  );
  return { byKey: finalizedByKey, byChunk: finalizedByChunk };
}
