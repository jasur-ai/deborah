/**
 * Edikit — No-device Paper-Card Scan Service (C4-03)
 * ---------------------------------------------------
 * Teacher device orqali four-orientation card scan. RAW FRAME HECh QACHON
 * serverga yuborilmaydi va storage'da qolmaydi (item 5/6, tugallanish sharti).
 * Detected cardId + orientation + confidence server'ga yuboriladi (item 7).
 *
 * - Card ID va four orientation mapping (item 2): CARD-001 + 0/90/180/270 → option.
 * - Camera permission faqat scanner action'da (client; item 3).
 * - Frame processing client-local (item 4).
 * - Unknown/duplicate card flag (item 8).
 * - Glare/occlusion confidence threshold (item 9).
 * - Not-scanned participant wrong deb BELGILANMAYDI (item 10).
 * - Manual correction lock'dan oldin + actor/time/reason audit (item 12/13).
 * - Paper mode MCQ/TF bilan cheklanadi (item 14).
 * - Report → evidenceUnit=card_response (item 15).
 */

import { CARD_ID_RE, CARD_ORIENTATION_LIST, CARD_CONFIDENCE_MIN, CARD_CONFIDENCE_WARN } from '../../utils/cast-constants.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';

export const CARD_EVIDENCE_UNIT = 'card_response';

/**
 * Validate card ID format (item 2).
 * @returns {string} normalized cardId
 */
export function normalizeCardId(raw) {
  const id = String(raw || '').trim().toUpperCase();
  if (!CARD_ID_RE.test(id)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, `Karta ID formati noto‘g‘ri: ${raw}`);
  }
  return id;
}

/**
 * Validate orientation (item 2).
 */
export function assertOrientation(orientation) {
  const o = String(orientation || '');
  if (!CARD_ORIENTATION_LIST.includes(o)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Karta yo‘nalishi noto‘g‘ri (0/90/180/270)');
  }
  return o;
}

/**
 * Confidence validation (item 9). Past confidence → glare/occlusion flag.
 * @returns {object} { confidence, flagged }
 */
export function assessConfidence(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c) || c < 0 || c > 1) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Ishonchlilik 0–1 oralig‘ida bo‘lishi kerak');
  }
  return {
    confidence: c,
    flagged: c < CARD_CONFIDENCE_MIN,
    warn: c < CARD_CONFIDENCE_WARN && c >= CARD_CONFIDENCE_MIN,
  };
}

/**
 * Four-orientation mapping: orientation → option index (item 2).
 * 0° → option 0 (A), 90° → 1 (B), 180° → 2 (C), 270° → 3 (D).
 * @param {object} privQuestion — private question { options: [{id}] }
 * @param {string} orientation
 * @returns {string} optionId
 */
export function mapOrientationToOption(privQuestion, orientation) {
  const options = privQuestion?.options || [];
  const idx = { 0: 0, 90: 1, 180: 2, 270: 3 }[String(orientation)];
  if (idx === undefined || idx >= options.length) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Bu yo‘nalish savol variantlari sonidan oshib ketdi');
  }
  return options[idx].id;
}

/**
 * Normalize answer payload from a card scan (item 7).
 * Detected card → option → server answer command.
 * @returns {{cardId, optionId, confidence, flagged}}
 */
export function normalizeCardAnswer({ cardId, orientation, confidence }) {
  const normId = normalizeCardId(cardId);
  const o = assertOrientation(orientation);
  const conf = assessConfidence(confidence);
  return { cardId: normId, orientation: o, ...conf };
}

/**
 * Idempotent scan record — first scan immutable; duplicate flag (item 8).
 * @param {object} current — existing record or null
 * @param {object} scan — { cardId, optionId, confidence, flagged, questionId, at }
 * @returns {object} { status, record }
 *   status: 'ACCEPTED' | 'DUPLICATE' | 'FLAGGED'
 */
export function mergeScanRecord(current, scan) {
  if (current) {
    // Same card → duplicate flag (item 8). First scan stays immutable.
    // Stored record'da status 'DUPLICATE' — progress/classification shuni o'qiydi.
    return {
      status: 'DUPLICATE',
      record: {
        ...current,
        status: 'DUPLICATE',
        duplicateAt: scan.at,
        duplicateCount: (current.duplicateCount || 0) + 1,
      },
    };
  }
  return { status: scan.flagged ? 'FLAGGED' : 'ACCEPTED', record: { ...scan, status: 'ACCEPTED' } };
}

/**
 * Build audit entry for manual correction (item 13).
 */
export function buildCorrectionAudit({ actorId, cardId, fromOptionId, toOptionId, reason, at = Date.now() }) {
  return {
    actorId,
    cardId,
    fromOptionId: fromOptionId || null,
    toOptionId: toOptionId || null,
    reason: String(reason || '').slice(0, 200),
    at,
  };
}

/**
 * Projection for director (item 11): scanned/expected counts.
 * Expected = registered cards (paper roster); scanned = unique accepted.
 * @param {object} participants — {pid: participant with cardId}
 * @param {object} scans — {cardId: scanRecord}
 * @returns {{ expected, scanned, flagged, unknown, duplicate }}
 */
export function projectCardProgress(participants = {}, scans = {}) {
  const expectedCards = new Set();
  const cardToPid = {};
  for (const [pid, p] of Object.entries(participants || {})) {
    if (p.cardId) {
      expectedCards.add(p.cardId);
      cardToPid[p.cardId] = pid;
    }
  }
  let scanned = 0;
  let flagged = 0;
  let duplicate = 0;
  let unknown = 0;
  for (const [cardId, rec] of Object.entries(scans || {})) {
    if (rec.status === 'DUPLICATE') { duplicate++; continue; }
    const known = expectedCards.has(cardId);
    if (!known) { unknown++; continue; }
    if (rec.status === 'FLAGGED') flagged++;
    else scanned++;
  }
  return {
    expected: expectedCards.size,
    scanned,
    flagged,
    unknown,
    duplicate,
    missing: Math.max(0, expectedCards.size - scanned - flagged),
    coverage: expectedCards.size ? Math.round((scanned / expectedCards.size) * 100) : 0,
    cardToPid,
  };
}

/**
 * Not-scanned classification (item 10): NEVER wrong.
 * @param {object} participant — { cardId, presence }
 * @param {object} scans — {cardId: record}
 * @returns {'card_scanned' | 'not_scanned' | 'no_card'}
 */
export function classifyPaperStatus({ participant = {}, scans = {} }) {
  const cardId = participant.cardId;
  if (!cardId) return 'no_card';
  const rec = scans[cardId];
  if (!rec) return 'not_scanned';
  if (rec.status === 'DUPLICATE') return 'not_scanned'; // asl javob bitta
  return 'card_scanned';
}

export default {
  CARD_EVIDENCE_UNIT,
  normalizeCardId,
  assertOrientation,
  assessConfidence,
  mapOrientationToOption,
  normalizeCardAnswer,
  mergeScanRecord,
  buildCorrectionAudit,
  projectCardProgress,
  classifyPaperStatus,
};
