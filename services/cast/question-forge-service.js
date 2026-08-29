/**
 * Deborah — Cast Student Question Forge Service (C3-13)
 * -----------------------------------------------------
 * Student savol, javob, explanation va source draftini yuboradi.
 * Teacher edit/approve qilgachgina draft live savol (Quick Prompt) yoki
 * library itemiga aylanishi mumkin.
 *
 * Key principles:
 * - Draft HECH QACHON avtomatik score/publicationga tushmaydi (item 17).
 * - Teacher approval'siz draft live savol yoki item bank itemiga aylanmaydi.
 * - Duplicate submit commandId orqali idempotent (item 5).
 * - Exact-hash duplicate existing test bank bilan tekshiriladi (item 7);
 *   semantic duplicate provider feature flag bilan optional (item 8).
 * - PII/profanity flaglari queue priority sifatida ishlatiladi (item 6).
 * - Original draft va teacher edited version auditda alohida saqlanadi (item 16).
 * - Attribution institution policy bilan boshqariladi (item 14).
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
import { flagSensitive } from './moderation-service.js';

// ── Forge types ──
export const FORGE_TYPES = {
  SINGLE_CHOICE: 'single_choice',
  TRUE_FALSE: 'true_false',
  MULTIPLE_SELECT: 'multiple_select',
  SHORT_ANSWER: 'short_answer',
};

export const FORGE_TYPE_LIST = Object.values(FORGE_TYPES);
export const FORGE_SCORED_TYPES = new Set([
  FORGE_TYPES.SINGLE_CHOICE,
  FORGE_TYPES.TRUE_FALSE,
  FORGE_TYPES.MULTIPLE_SELECT,
]);

// ── Draft status ──
export const FORGE_STATUS = {
  REVIEW_READY: 'REVIEW_READY',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

// ── Character limits (item 3: draft schema va character limits) ──
export const FORGE_CHAR_LIMITS = {
  STEM_MIN: 5,
  STEM_MAX: 500,
  OPTION_MIN: 1,
  OPTION_MAX: 120,
  OPTIONS_MIN: 2,
  OPTIONS_MAX: 8,
  EXPLANATION_MAX: 500,
  SOURCE_MAX: 200,
  SHORT_ANSWER_MAX: 280,
};

// ── Attribution policy (item 14) ──
export const FORGE_ATTRIBUTION_POLICY = {
  PRIVATE: 'private', // queue'da alias ham ko'rsatilmaydi — faqat "anonim"
  PUBLIC_ALIAS: 'public_alias', // queue'da participant alias ko'rinadi
};

// ── Store roots ──
const FORGE_ROOT = (sessionId) => `cast_private/${sessionId}/forge`;
const FORGE_BY_COMMAND = (sessionId) => `cast_private/${sessionId}/forge_by_command`;
const FORGE_META = (sessionId) => `cast_sessions/${sessionId}/forge_meta`;
const FORGE_PUBLIC_Q = (sessionId, qid) => `cast_sessions/${sessionId}/questions_public/${qid}`;
const FORGE_PRIVATE_Q = (sessionId, qid) => `cast_private/${sessionId}/questions/${qid}`;

/** Normalize option list → [{ id: 'o_1', text }] with ids. */
export function normalizeForgeOptions(options) {
  const out = [];
  const seen = new Set();
  for (const raw of (options || [])) {
    const text = String(raw?.text ?? raw ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ id: `o_${out.length + 1}`, text });
  }
  return out;
}

/**
 * Validate a forge draft (item 3).
 * @param {object} draft — { questionType, stem, options, proposedAnswer, explanation, source }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateForgeDraft(draft = {}) {
  const errors = [];

  if (!draft || typeof draft !== 'object') {
    return { valid: false, errors: ["Draft ma'lumoti talab qilinadi"] };
  }

  const type = draft.questionType;
  if (!type || !FORGE_TYPE_LIST.includes(type)) {
    errors.push(`Noma'lum savol turi: ${type}`);
  }

  const stem = String(draft.stem || '').trim();
  if (stem.length < FORGE_CHAR_LIMITS.STEM_MIN) {
    errors.push(`Savol matni kamida ${FORGE_CHAR_LIMITS.STEM_MIN} belgi bo'lishi kerak`);
  }
  if (stem.length > FORGE_CHAR_LIMITS.STEM_MAX) {
    errors.push(`Savol matni ${FORGE_CHAR_LIMITS.STEM_MAX} belgidan oshmasligi kerak`);
  }

  if (type === FORGE_TYPES.TRUE_FALSE) {
    // true_false standart variantlar — student faqat javobni tanlaydi
    if (draft.proposedAnswer !== 'o_1' && draft.proposedAnswer !== 'o_2') {
      errors.push("True/False javob tanlanishi kerak (To'g'ri yoki Noto'g'ri)");
    }
  } else if (FORGE_SCORED_TYPES.has(type)) {
    const options = normalizeForgeOptions(draft.options);
    if (options.length < FORGE_CHAR_LIMITS.OPTIONS_MIN) {
      errors.push(`Kamida ${FORGE_CHAR_LIMITS.OPTIONS_MIN} ta variant talab qilinadi`);
    }
    if (options.length > FORGE_CHAR_LIMITS.OPTIONS_MAX) {
      errors.push(`Variantlar soni ${FORGE_CHAR_LIMITS.OPTIONS_MAX} tadan oshmasligi kerak`);
    }
    for (const o of options) {
      if (o.text.length > FORGE_CHAR_LIMITS.OPTION_MAX) {
        errors.push(`Variant matni ${FORGE_CHAR_LIMITS.OPTION_MAX} belgidan oshmasligi kerak`);
      }
    }
    // Proposed answer — variant id lariga havola
    const ids = new Set(options.map((o) => o.id));
    const proposed = Array.isArray(draft.proposedAnswer) ? draft.proposedAnswer : [];
    if (proposed.length === 0) {
      errors.push("To'g'ri javob variantlari tanlanishi kerak");
    }
    for (const pid of proposed) {
      if (!ids.has(pid)) {
        errors.push(`Noto'g'ri javob variant ID: ${pid}`);
        break;
      }
    }
    if (type === FORGE_TYPES.SINGLE_CHOICE && proposed.length !== 1) {
      errors.push('Single choice savolda aynan 1 ta to\'g\'ri javob bo\'lishi kerak');
    }
  } else if (type === FORGE_TYPES.SHORT_ANSWER) {
    const proposed = String(draft.proposedAnswer || '').trim();
    if (!proposed) {
      errors.push('Namunaviy javob yozilishi kerak');
    }
    if (proposed.length > FORGE_CHAR_LIMITS.SHORT_ANSWER_MAX) {
      errors.push(`Namunaviy javob ${FORGE_CHAR_LIMITS.SHORT_ANSWER_MAX} belgidan oshmasligi kerak`);
    }
  }

  const explanation = String(draft.explanation || '').trim();
  if (explanation.length > FORGE_CHAR_LIMITS.EXPLANATION_MAX) {
    errors.push(`Izoh ${FORGE_CHAR_LIMITS.EXPLANATION_MAX} belgidan oshmasligi kerak`);
  }

  const source = String(draft.source || '').trim();
  if (source.length > FORGE_CHAR_LIMITS.SOURCE_MAX) {
    errors.push(`Manba ${FORGE_CHAR_LIMITS.SOURCE_MAX} belgidan oshmasligi kerak`);
  }

  return { valid: errors.length === 0, errors };
}

/** Normalize a draft to a clean, storeable shape (ids assigned, trimmed). */
export function normalizeForgeDraft(draft = {}) {
  const type = draft.questionType;
  let options = [];
  let proposedAnswer = draft.proposedAnswer;

  if (type === FORGE_TYPES.TRUE_FALSE) {
    options = [
      { id: 'o_1', text: "To'g'ri" },
      { id: 'o_2', text: "Noto'g'ri" },
    ];
    // keep proposedAnswer as o_1 / o_2
  } else if (FORGE_SCORED_TYPES.has(type)) {
    options = normalizeForgeOptions(draft.options);
    if (Array.isArray(proposedAnswer)) {
      proposedAnswer = proposedAnswer.filter((id) => options.some((o) => o.id === id));
    }
  } else if (type === FORGE_TYPES.SHORT_ANSWER) {
    proposedAnswer = String(draft.proposedAnswer || '').trim();
  }

  return {
    questionType: type,
    stem: String(draft.stem || '').trim(),
    options,
    proposedAnswer,
    explanation: String(draft.explanation || '').trim(),
    source: String(draft.source || '').trim(),
  };
}

/** Exact-hash of normalized stem (item 7: exact hash duplicate). */
export function hashForgeStem(stem) {
  return crypto.createHash('sha256').update(String(stem || '').toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
}

/** Light local semantic duplicate (item 8 — provider feature flag bilan optional). */
export function tokenSimilarity(a = '', b = '') {
  const tok = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\u0400-\u04ff\s]/gi, '').split(/\s+/).filter(Boolean));
  const A = tok(a);
  const B = tok(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

/** Build draft id + command index key. */
export function buildForgeDraftId() {
  return 'forge_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Submit a forge draft (items 4-8).
 * - commandId orqali idempotent (item 5)
 * - flagSensitive PII/profanity (item 6)
 * - exact-hash dup vs session'dagi boshqa draftlar + library (item 7)
 * - semantic dup — provider feature flag bo'lsa (item 8)
 * @param {object} input
 * @returns {Promise<{ draftId, status, duplicate, duplicateOf, flags, priority }>}
 */
export async function submitForgeDraft({ sessionId, participantId, alias = null, draft, commandId, semanticDuplicate = false }) {
  if (!sessionId || !participantId || !commandId) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, "Forge submit ma'lumotlari yetarli emas");
  }

  // 1. Idempotency — same commandId → existing draft
  const cmdSnap = await fb.get(`${FORGE_BY_COMMAND(sessionId)}/${commandId}`);
  if (cmdSnap.exists()) {
    const existingId = cmdSnap.val();
    const existing = await getForgeDraft(sessionId, existingId);
    if (existing) {
      return { draftId: existingId, status: existing.status, duplicate: false, replay: true, flags: existing.flags || {}, priority: existing.priority || 'LOW' };
    }
  }

  // 2. Validate schema
  const validation = validateForgeDraft(draft);
  if (!validation.valid) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, validation.errors.join('; '));
  }

  const normalized = normalizeForgeDraft(draft);
  const stemHash = hashForgeStem(normalized.stem);

  // 3. PII / profanity flags (item 6) — barcha matn maydonlari bo'yicha
  const textBlob = [normalized.stem, normalized.explanation, normalized.source, ...normalized.options.map((o) => o.text)].join(' ');
  const { flags, priority } = flagSensitive(textBlob);

  // 4. Exact-hash duplicate — session draftlariga nisbatan
  const queue = await listForgeQueue(sessionId);
  let duplicateOf = null;
  for (const rec of Object.values(queue)) {
    if (rec.stemHash === stemHash) { duplicateOf = rec.draftId; break; }
  }

  // 5. Optional semantic duplicate (provider feature flag — default OFF)
  if (!duplicateOf && semanticDuplicate) {
    for (const rec of Object.values(queue)) {
      const sim = tokenSimilarity(normalized.stem, rec.stem || '');
      if (sim >= 0.85) { duplicateOf = rec.draftId; break; }
    }
  }

  const draftId = buildForgeDraftId();
  const now = Date.now();
  const record = {
    draftId,
    sessionId,
    authorParticipantId: participantId,
    authorAlias: alias || null,
    ...normalized,
    status: FORGE_STATUS.REVIEW_READY,
    stemHash,
    flags,
    priority,
    commandId,
    duplicateOf,
    submittedAt: now,
    editedVersion: null,
    rejectReason: null,
    questionId: null,
    launchedAt: null,
    audit: [{ at: now, action: 'submit', actorId: participantId }],
  };

  await fb.set(`${FORGE_ROOT(sessionId)}/${draftId}`, record);
  await fb.set(`${FORGE_BY_COMMAND(sessionId)}/${commandId}`, draftId);

  // forge_meta counters
  const metaSnap = await fb.get(FORGE_META(sessionId));
  const meta = metaSnap.exists() ? metaSnap.val() : { total: 0, reviewReady: 0, approved: 0, rejected: 0, launched: 0 };
  meta.total = (meta.total || 0) + 1;
  meta.reviewReady = (meta.reviewReady || 0) + 1;
  await fb.set(FORGE_META(sessionId), meta);

  return { draftId, status: FORGE_STATUS.REVIEW_READY, duplicate: Boolean(duplicateOf), duplicateOf, flags, priority };
}

/** Get a single draft (private). */
export async function getForgeDraft(sessionId, draftId) {
  const snap = await fb.get(`${FORGE_ROOT(sessionId)}/${draftId}`);
  return snap.exists() ? snap.val() : null;
}

/**
 * List forge queue (director private — full records with identity).
 * Sort: newest first.
 */
export async function listForgeQueue(sessionId) {
  const snap = await fb.get(FORGE_ROOT(sessionId));
  const all = snap.exists() ? snap.val() : {};
  return Object.fromEntries(
    Object.entries(all).sort((a, b) => (b[1].submittedAt || 0) - (a[1].submittedAt || 0))
  );
}

/** Counters for director badge. */
export async function getForgeMeta(sessionId) {
  const snap = await fb.get(FORGE_META(sessionId));
  return snap.exists() ? snap.val() : { total: 0, reviewReady: 0, approved: 0, rejected: 0, launched: 0 };
}

/**
 * Apply teacher review action (items 9-10, 15-16).
 * actions: 'edit' | 'approve' | 'reject'
 * - edit: teacher edited version original'dan ALOHIDA saqlanadi (item 16)
 * - approve: session-scoped question ID yaratiladi (item 10) — lekin live
 *   emas (launch alohida command, item 11). Original+edited auditda qoladi.
 * - reject: reason saqlanadi (item 15)
 */
export async function applyForgeReview({ sessionId, draftId, action, editorId, edits = null, rejectReason = null }) {
  const record = await getForgeDraft(sessionId, draftId);
  if (!record) {
    throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Draft topilmadi');
  }
  const now = Date.now();

  if (action === 'edit') {
    if (!edits || typeof edits !== 'object') {
      throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Tahrir ma\'lumotlari kerak');
    }
    const candidate = { ...normalizeForgeDraft(edits), questionType: edits.questionType || record.questionType };
    const validation = validateForgeDraft(candidate);
    if (!validation.valid) {
      throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, validation.errors.join('; '));
    }
    // Re-flag edited text (yangi PII tekshiruvi)
    const textBlob = [candidate.stem, candidate.explanation, candidate.source, ...(candidate.options || []).map((o) => o.text)].join(' ');
    const { flags, priority } = flagSensitive(textBlob);
    record.editedVersion = {
      ...candidate,
      editedAt: now,
      editorId,
      flags,
      priority,
    };
    record.audit = [...(record.audit || []), { at: now, action: 'edit', actorId: editorId }];
    await fb.set(`${FORGE_ROOT(sessionId)}/${draftId}`, record);
    return { draftId, status: record.status, edited: true };
  }

  if (action === 'approve') {
    if (record.status === FORGE_STATUS.APPROVED) {
      return { draftId, status: record.status, questionId: record.questionId };
    }
    const finalDraft = record.editedVersion || record;
    const questionId = 'fq_' + crypto.randomBytes(6).toString('hex');
    const { public: pubQ, private: privQ } = buildForgeQuestion(finalDraft, questionId, draftId);

    // Session-scoped saqlash — public (answer key yo'q) + private (key)
    await fb.set(FORGE_PUBLIC_Q(sessionId, questionId), pubQ);
    await fb.set(FORGE_PRIVATE_Q(sessionId, questionId), privQ);

    record.status = FORGE_STATUS.APPROVED;
    record.questionId = questionId;
    record.approvedAt = now;
    record.approvedBy = editorId;
    record.audit = [...(record.audit || []), { at: now, action: 'approve', actorId: editorId, questionId }];
    await fb.set(`${FORGE_ROOT(sessionId)}/${draftId}`, record);

    const meta = await getForgeMeta(sessionId);
    meta.reviewReady = Math.max(0, (meta.reviewReady || 0) - 1);
    meta.approved = (meta.approved || 0) + 1;
    await fb.set(FORGE_META(sessionId), meta);

    return { draftId, status: FORGE_STATUS.APPROVED, questionId };
  }

  if (action === 'reject') {
    record.status = FORGE_STATUS.REJECTED;
    record.rejectReason = String(rejectReason || '').trim().slice(0, 200) || null;
    record.rejectedAt = now;
    record.rejectedBy = editorId;
    record.audit = [...(record.audit || []), { at: now, action: 'reject', actorId: editorId, reason: record.rejectReason }];
    await fb.set(`${FORGE_ROOT(sessionId)}/${draftId}`, record);

    const meta = await getForgeMeta(sessionId);
    meta.reviewReady = Math.max(0, (meta.reviewReady || 0) - 1);
    meta.rejected = (meta.rejected || 0) + 1;
    await fb.set(FORGE_META(sessionId), meta);

    return { draftId, status: FORGE_STATUS.REJECTED };
  }

  throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, `Noma'lum action: ${action}`);
}

/** Mark a draft as launched (launch now → quick prompt). */
export async function markForgeLaunched(sessionId, draftId, launchedBy) {
  const record = await getForgeDraft(sessionId, draftId);
  if (!record) {
    throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Draft topilmadi');
  }
  record.launchedAt = Date.now();
  record.launchedBy = launchedBy;
  record.audit = [...(record.audit || []), { at: Date.now(), action: 'launch', actorId: launchedBy, questionId: record.questionId }];
  await fb.set(`${FORGE_ROOT(sessionId)}/${draftId}`, record);
  const meta = await getForgeMeta(sessionId);
  meta.launched = (meta.launched || 0) + 1;
  await fb.set(FORGE_META(sessionId), meta);
  return record;
}

/**
 * Build a live-question object (Quick Prompt format) from an approved forge
 * draft. Public: answer key YO'Q. Private: correct ids/answer (item 10, 17).
 */
export function buildForgeQuestion(draft, questionId, forgeDraftId) {
  const isScored = FORGE_SCORED_TYPES.has(draft.questionType);
  const publicQ = {
    id: questionId,
    type: draft.questionType,
    text: String(draft.stem || '').trim(),
    options: (draft.options || []).map((o) => ({ id: o.id, text: o.text })),
    timer: {},
    isQuickPrompt: true,
    isForge: true,
    forgeDraftId,
    createdAt: Date.now(),
  };
  let privateQ = null;
  if (isScored) {
    privateQ = {
      id: questionId,
      type: draft.questionType,
      correctOptionIds: Array.isArray(draft.proposedAnswer) ? draft.proposedAnswer : [],
      correctAnswer: draft.questionType === FORGE_TYPES.SHORT_ANSWER ? draft.proposedAnswer : null,
      isQuickPrompt: true,
      isForge: true,
      forgeDraftId,
      explanation: String(draft.explanation || '').trim() || null,
      source: String(draft.source || '').trim() || null,
      createdAt: Date.now(),
    };
  } else if (draft.questionType === FORGE_TYPES.SHORT_ANSWER) {
    privateQ = {
      id: questionId,
      type: draft.questionType,
      correctOptionIds: [],
      correctAnswer: String(draft.proposedAnswer || ''),
      isQuickPrompt: true,
      isForge: true,
      forgeDraftId,
      explanation: String(draft.explanation || '').trim() || null,
      source: String(draft.source || '').trim() || null,
      createdAt: Date.now(),
    };
  }
  return { public: publicQ, private: privateQ };
}

/**
 * Director queue projection — attribution policy bo'yicha identity boshqariladi
 * (item 14). PRIVATE: participantId o'rniga 'anonim' — alias ham yo'q.
 * PUBLIC_ALIAS: alias ko'rsatiladi, lekin participantId hali ham yashirin emas
 * (queue director'ga private bo'lgani uchun participantId faqat server kerak).
 */
export function projectForgeQueue(queue, policy = FORGE_ATTRIBUTION_POLICY.PRIVATE) {
  return Object.fromEntries(
    Object.entries(queue).map(([id, rec]) => {
      const copy = { ...rec };
      // Attribution — raw participantId proyeksiyada HECH QACHON qolmaydi
      delete copy.authorParticipantId;
      if (policy === FORGE_ATTRIBUTION_POLICY.PUBLIC_ALIAS) {
        copy.authorLabel = rec.authorAlias || 'o\'quvchi';
        copy.authorAlias = rec.authorAlias || null;
      } else {
        copy.authorLabel = 'anonim';
        copy.authorAlias = null;
      }
      // Audit'dagi participant actorId larni ham yashiramiz
      if (Array.isArray(copy.audit)) {
        copy.audit = copy.audit.map((a) => ({
          ...a,
          actorId: String(a.actorId || '').startsWith('p_') ? 'participant' : a.actorId,
        }));
      }
      return [id, copy];
    })
  );
}

/**
 * Save approved forge draft to teacher library (item 12-13).
 * Ownership route tomonidan tekshiriladi; final draft (edited || original)
 * qayta validate qilinadi (item 13).
 * @returns {Promise<string>} libraryItemId
 */
export async function saveForgeToLibrary({ draft, teacherId }) {
  if (!teacherId) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Saqlash uchun avtorizatsiya talab qilinadi');
  }
  const normalized = normalizeForgeDraft(draft);
  const validation = validateForgeDraft(normalized);
  if (!validation.valid) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Final draft yaroqsiz: ' + validation.errors.join('; '));
  }

  const itemId = 'forge_lib_' + crypto.randomBytes(8).toString('hex');
  const item = {
    itemId,
    ...normalized,
    savedAt: Date.now(),
    savedBy: teacherId,
    source: 'forge',
    stemHash: hashForgeStem(normalized.stem),
  };
  await fb.set(`cast_library/${teacherId}/${itemId}`, item);
  return itemId;
}

/** Check approved question exists for launch (owner helper). */
export async function getForgeLiveQuestion(sessionId, questionId) {
  const snap = await fb.get(FORGE_PUBLIC_Q(sessionId, questionId));
  return snap.exists() ? snap.val() : null;
}

export default {
  FORGE_TYPES,
  FORGE_TYPE_LIST,
  FORGE_SCORED_TYPES,
  FORGE_STATUS,
  FORGE_CHAR_LIMITS,
  FORGE_ATTRIBUTION_POLICY,
  normalizeForgeOptions,
  validateForgeDraft,
  normalizeForgeDraft,
  hashForgeStem,
  tokenSimilarity,
  buildForgeDraftId,
  submitForgeDraft,
  getForgeDraft,
  listForgeQueue,
  getForgeMeta,
  applyForgeReview,
  markForgeLaunched,
  buildForgeQuestion,
  projectForgeQueue,
  saveForgeToLibrary,
  getForgeLiveQuestion,
};
