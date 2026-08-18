/**
 * Deborah — Cast Deterministic Randomization
 * -----------------------------------------
 * Server-side seeded PRNG (mulberry32) + seeded shuffle.
 * Question va option order stable seed + stable IDs bilan qayta tiklanadi.
 * Array index scoringda ishlatilmaydi — har doim optionId.
 */

import crypto from 'crypto';

export const SEED_VERSION = 'seed_v1';

/** Hash: sha256 → uint32 */
export function hashToUint32(input) {
  const h = crypto.createHash('sha256').update(input).digest();
  return h.readUInt32BE(0);
}

/** mulberry32 PRNG — deterministik */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic shuffle — same seed → same order.
 */
export function seededShuffle(arr, seed) {
  const rand = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** questionSeed = hash(seedVersion, sessionSeed, questionId) */
export function questionSeed(sessionSeed, questionId) {
  return hashToUint32(`${SEED_VERSION}:${sessionSeed}:${questionId}`);
}

/** participantSeed = hash(seedVersion, sessionSeed, questionId, participantId) */
export function participantSeed(sessionSeed, questionId, participantId) {
  return hashToUint32(`${SEED_VERSION}:${sessionSeed}:${questionId}:${participantId}`);
}

/**
 * Question order: shuffled questionIds for the session.
 * @param {string[]} questionIds
 * @param {number} sessionSeed
 * @param {boolean} shuffleQuestions
 */
export function computeQuestionOrder(questionIds, sessionSeed, shuffleQuestions = true) {
  if (!shuffleQuestions || questionIds.length <= 1) return [...questionIds];
  return seededShuffle(questionIds, hashToUint32(`${SEED_VERSION}:order:${sessionSeed}`));
}

/**
 * Participant option order (displayPosition map).
 * @param {Array<{id:string}>} options
 * @param {number} seed
 * @param {boolean} shuffleAnswers
 * @returns {Array<{id:string, displayPosition:number}>}
 */
export function computeOptionOrder(options, seed, shuffleAnswers = true) {
  if (!shuffleAnswers || options.length <= 1) {
    return options.map((o, i) => ({ id: o.id, displayPosition: i }));
  }
  const shuffled = seededShuffle(options.map((o, i) => ({ id: o.id, idx: i })), seed);
  return shuffled.map((item, pos) => ({ id: item.id, displayPosition: pos }));
}
