/**
 * Edikit — Cast Personal Progress Service (C3-09)
 * -------------------------------------------------
 * Roster-linked participant uchun personal progress hisoblanadi.
 * Personal best participant-private ko'rsatiladi — public opt-in
 * bo'lmasa projector'ga chiqarilmaydi.
 *
 * Privacy:
 * - Personal best faqat o'sha participant'ga ko'rsatiladi
 * - Public personal best opt-in bo'lmasa projector'ga chiqmaydi
 * - Shared-device evidence'da individual personal best yaratilmaydi
 */

import { CAST_ERROR_CODES, CastError } from './errors.js';

// ── Personal best visibility ──
export const PERSONAL_BEST_VISIBILITY = {
  PRIVATE: 'private',       // faqat participant'ning o'ziga
  OPT_IN_PUBLIC: 'opt_in_public', // opt-in bo'lsa projector'ga
};

/**
 * Compute a comparable scoring/config fingerprint.
 * Faqat original competition score'ga ta'sir qiladigan config
 * o'zgarishlari fingerprint'ni o'zgartiradi.
 * @param {object} config — session config snapshot
 * @returns {string} stable fingerprint hash
 */
// Review fix (C5-03): fingerprint formati kengaytirildi (reveal/delivery/
// locale). Eski saqlangan progress yozuvlari yangi fingerprint bilan
// solishtirilmaydi — qabul qilingan (dev bosqichi).
export function computeComparableFingerprint(config = {}) {
  const scoring = config?.scoring || {};
  const timer = config?.timer || {};
  const playback = config?.playback || {};
  const participation = config?.participation || {};
  const localization = config?.localization || {};
  const parts = [
    scoring.mode || 'accuracy',
    scoring.version || 'score_v2',
    scoring.correctBase ?? 1000,
    scoring.speedBonusMax ?? 0,
    scoring.partialCredit ?? false,
    timer.mode || 'soft',
    timer.defaultSeconds ?? 30,
    // C5-03 (item 15): comparable content tag — reveal, delivery, locale ham
    // personal longitudinal taqqoslash uchun tekshiriladi.
    JSON.stringify(playback.advanceMode ?? 'manual'),
    JSON.stringify([...(playback.closeTrigger || [])].sort()),
    participation.delivery || 'in_room',
    localization.locale || 'uz-Latn',
  ];
  // Deterministic string (not a security hash — just comparability key)
  return parts.join('|');
}

/**
 * Check whether two sessions are comparable (same scoring fingerprint).
 * @param {string} fpA
 * @param {string} fpB
 * @returns {boolean}
 */
export function isComparableSession(fpA, fpB) {
  if (!fpA || !fpB) return false;
  return fpA === fpB;
}

/**
 * Compute personal progress for a roster-linked participant.
 * @param {object} input
 * @param {object} input.participant — { participantId, displayAlias, rosterLinked? }
 * @param {object} input.answers — { qid: answerRecord } (this participant's answers)
 * @param {string} input.fingerprint — comparable scoring fingerprint
 * @returns {object} personal progress { correct, total, accuracyPercent, masteryCount }
 */
export function computePersonalProgress({ participant, answers = {}, fingerprint }) {
  if (!participant) {
    return { available: false, reason: 'no_participant' };
  }
  // Shared-device blocker: individual personal best yaratilmaydi
  if (participant.sharedDevice === true) {
    return { available: false, reason: 'shared_device' };
  }
  // Roster-linked talab qilinadi
  if (!participant.rosterLinked && !participant.linkedUserId) {
    return { available: false, reason: 'not_roster_linked' };
  }

  let correct = 0;
  let total = 0;
  for (const a of Object.values(answers)) {
    if (!a) continue;
    total++;
    if (a.isCorrect) correct++;
  }

  return {
    available: true,
    participantId: participant.participantId,
    correct,
    total,
    accuracyPercent: total > 0 ? Math.round((correct / total) * 100) : 0,
    masteryCount: 0, // C3-08 transfer results alohida; kelajakda qo'shiladi
    fingerprint,
  };
}

/**
 * Build personal best record (participant-private).
 * @param {object} input
 * @returns {object} personal best
 */
export function buildPersonalBest({ participant, progress, visibility = PERSONAL_BEST_VISIBILITY.PRIVATE }) {
  if (!progress || !progress.available) {
    return { available: false };
  }
  return {
    available: true,
    participantId: participant?.participantId || progress.participantId,
    correct: progress.correct,
    total: progress.total,
    accuracyPercent: progress.accuracyPercent,
    visibility,
    // Public opt-in bo'lmasa projector'ga chiqmaydi
    publicVisible: visibility === PERSONAL_BEST_VISIBILITY.OPT_IN_PUBLIC,
    at: Date.now(),
  };
}

/**
 * Check whether personal best can be shown publicly.
 * @param {object} personalBest
 * @returns {boolean}
 */
export function canShowPublic(personalBest) {
  if (!personalBest || !personalBest.available) return false;
  return personalBest.publicVisible === true;
}

export default {
  PERSONAL_BEST_VISIBILITY,
  computeComparableFingerprint,
  isComparableSession,
  computePersonalProgress,
  buildPersonalBest,
  canShowPublic,
};