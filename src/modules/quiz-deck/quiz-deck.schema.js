/**
 * Edikit — Quiz-from-Deck (pure logic)
 *
 * Prompt 59 — canonical deckdan quiz yaratish (research.md §10: "Create
 * quiz from this presentation" — slide title emas, source pack va
 * quizConcepts'dan; har savolda source citation; qaysi slide/outcome'dan
 * kelgani; 50/30/20 default; teacher approval; presentationdagi claim
 * o'zgarsa related question "needs review"; §22.18 AI savol teacher
 * approval'siz bankka publish qilinmaydi). This module is PURE:
 *
 *   - extractQuizConcepts: canonical deckdan concepts/claims chiqarish.
 *   - buildQuizBlueprint: 50/30/20 easy/medium/hard distribution.
 *   - generateQuestionsFromDeck: concept → questions (stem/options/correct).
 *   - buildSourceCitation: har savolda source pack citation + slideId.
 *   - markNeedsReview: claim o'zgarsa related question'larni belgilash.
 *   - validateQuizDraft / validateQuizStatusTransition.
 *   - buildQuizRequestHash: idempotency (presentation + version).
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const QUIZ_STATUS = { DRAFT: 'draft', NEEDS_REVIEW: 'needs_review', APPROVED: 'approved', PUBLISHED: 'published' };

/** Default difficulty distribution (§10 — 50/30/20). */
export const DEFAULT_BLUEPRINT = { easy: 0.5, medium: 0.3, hard: 0.2 };

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

// ═══════════════════════════════════════════════════════════════════
// CONCEPT EXTRACTION (§10)
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract quiz concepts + claims from a canonical deck.
 * Uses learningOutcomes + slide titles + speaker notes; claims are
 * slide-level statements that questions will verify.
 */
export function extractQuizConcepts({ document = null } = {}) {
  if (!document || !Array.isArray(document.slides)) {
    return { ok: false, reason: 'no slides' };
  }
  const outcomes = Array.isArray(document.learningOutcomes) ? document.learningOutcomes : [];
  const concepts = [];
  for (const s of document.slides) {
    const title = String(s.title || '').trim();
    const notes = String(s.speakerNotes || '').trim();
    const texts = (s.blocks || [])
      .filter((b) => ['text', 'heading', 'bullets'].includes(b.type))
      .map((b) => (b.type === 'bullets' ? (b.content?.items || []).join(' ') : b.content?.text || ''))
      .filter(Boolean);
    concepts.push({
      slideId: s.id,
      slideIndex: concepts.length,
      title,
      claim: notes || texts[0] || title || `Slide ${concepts.length + 1}`,
      outcomes: outcomes,
      citations: Array.isArray(s.citations) ? s.citations : [],
    });
  }
  return { ok: true, concepts };
}

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINT (50/30/20)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a 50/30/20 quiz blueprint for a target question count.
 * @returns {{ ok: boolean, blueprint: { total, easy, medium, hard, distribution } }}
 */
export function buildQuizBlueprint({ total = 10, distribution = DEFAULT_BLUEPRINT } = {}) {
  if (!Number.isInteger(total) || total < 1 || total > 100) {
    return { ok: false, reason: 'total must be integer 1..100' };
  }
  const easy = Math.round(total * (distribution.easy ?? 0.5));
  const hard = Math.round(total * (distribution.hard ?? 0.2));
  const medium = total - easy - hard;
  return {
    ok: true,
    blueprint: {
      total,
      easy,
      medium,
      hard,
      distribution: { easy: distribution.easy ?? 0.5, medium: distribution.medium ?? 0.3, hard: distribution.hard ?? 0.2 },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// QUESTION GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate questions from deck concepts — 50/30/20, har savolda source
 * citation (slideId + citation), deterministic stems (pure template —
 * LLM variant keyingi prompt'da).
 *
 * @param {Object} opts - { concepts, blueprint, sourcePacks }
 * @returns {{ ok: boolean, questions: Array }}
 */
export function generateQuestionsFromDeck({ concepts = [], blueprint = null, sourcePacks = [] } = {}) {
  if (!Array.isArray(concepts) || concepts.length === 0) {
    return { ok: false, reason: 'no concepts to generate from' };
  }
  const bp = blueprint || buildQuizBlueprint({ total: concepts.length }).blueprint;
  const sourceMap = {};
  for (const sp of sourcePacks || []) sourceMap[sp.id] = sp;

  const questions = [];
  let easy = 0;
  let medium = 0;
  let hard = 0;

  for (let i = 0; i < concepts.length; i++) {
    const c = concepts[i];
    // Deterministic difficulty assignment by index (50/30/20)
    let difficulty;
    const ratio = i / Math.max(concepts.length, 1);
    if (ratio < bp.easy / concepts.length * concepts.length / Math.max(concepts.length, 1) && easy < bp.easy) difficulty = 'easy';
    else if (medium < bp.medium) difficulty = 'medium';
    else difficulty = 'hard';
    if (difficulty === 'easy') easy++;
    else if (difficulty === 'medium') medium++;
    else hard++;

    const claim = String(c.claim || '').slice(0, 200);
    const citation = buildSourceCitation({ concept: c, sourcePacks });

    questions.push({
      id: `q_${i + 1}`,
      slideId: c.slideId,
      slideTitle: c.title || `Slide ${i + 1}`,
      stem: `${claim}?`,
      options: ['A) To\'g\'ri', 'B) Noto\'g\'ri', 'C) Bilmayman', 'D) Qisman'],
      correctIndex: 0,
      difficulty,
      outcome: Array.isArray(c.outcomes) && c.outcomes.length ? c.outcomes[0] : null,
      citation,
    });
  }

  return { ok: true, questions, summary: { total: questions.length, easy, medium, hard } };
}

/** Build per-question source citation (real source pack check — §22.11). */
export function buildSourceCitation({ concept = {}, sourcePacks = [] } = {}) {
  const citations = Array.isArray(concept.citations) ? concept.citations : [];
  if (citations.length === 0) {
    return { slideId: concept.slideId, sourcePackId: null, title: null, url: null, verified: false };
  }
  // Real DB source pack tekshiruvi — faqat mavjud pack'lar
  const srcId = Number(String(citations[0]).replace(/\D/g, '')) || null;
  const pack = srcId ? (sourcePacks || []).find((sp) => Number(sp.id) === srcId) : null;
  if (!pack) {
    return { slideId: concept.slideId, sourcePackId: null, title: null, url: null, verified: false, unverified: String(citations[0]) };
  }
  return { slideId: concept.slideId, sourcePackId: Number(pack.id), title: pack.title, url: pack.url || null, verified: true };
}

// ═══════════════════════════════════════════════════════════════════
// NEEDS-REVIEW (§10 consistency)
// ═══════════════════════════════════════════════════════════════════

/**
 * Mark questions as needs_review when a slide claim changes.
 * @param {Object} opts - { previousDocument, currentDocument, questions }
 * @returns {{ ok: boolean, needsReview: Array<number> }}
 */
export function markNeedsReview({ previousDocument = null, currentDocument = null, questions = [] } = {}) {
  const prev = previousDocument?.slides || [];
  const curr = currentDocument?.slides || [];
  const prevClaims = {};
  for (const s of prev) prevClaims[s.id] = String(s.speakerNotes || (s.blocks?.[0]?.content?.text || '')).trim();

  const needsReview = [];
  for (const q of questions || []) {
    const slide = curr.find((s) => s.id === q.slideId);
    const prevClaim = prevClaims[q.slideId];
    const currClaim = slide ? String(slide.speakerNotes || (slide.blocks?.[0]?.content?.text || '')).trim() : '';
    if (prevClaim && currClaim && prevClaim !== currClaim) {
      needsReview.push(q.id);
    }
  }
  return { ok: true, needsReview };
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATION + FSM + HASH
// ═══════════════════════════════════════════════════════════════════

/** Validate a quiz draft before teacher approval. */
export function validateQuizDraft({ questions = [], blueprint = null } = {}) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, reason: 'no questions generated' };
  }
  if (blueprint && !Number.isInteger(blueprint.total)) {
    return { ok: false, reason: 'invalid blueprint' };
  }
  // Har savolda citation bo'lishi shart emas (verified false mumkin), lekin
  // stem/options bor bo'lishi kerak
  const invalid = questions.filter((q) => !q.stem || !Array.isArray(q.options) || q.options.length < 2);
  if (invalid.length) return { ok: false, reason: `${invalid.length} questions missing stem/options` };
  return { ok: true };
}

/** Quiz status FSM. */
export function validateQuizStatusTransition(from, to) {
  const allowed = {
    [QUIZ_STATUS.DRAFT]: [QUIZ_STATUS.NEEDS_REVIEW, QUIZ_STATUS.APPROVED],
    [QUIZ_STATUS.NEEDS_REVIEW]: [QUIZ_STATUS.DRAFT, QUIZ_STATUS.APPROVED],
    [QUIZ_STATUS.APPROVED]: [QUIZ_STATUS.PUBLISHED, QUIZ_STATUS.NEEDS_REVIEW],
    [QUIZ_STATUS.PUBLISHED]: [QUIZ_STATUS.NEEDS_REVIEW],
  };
  const targets = allowed[from] || [];
  if (!targets.includes(to)) return { ok: false, reason: `invalid quiz transition ${from} → ${to}` };
  return { ok: true };
}

/** Idempotency hash (presentation + version). */
export function buildQuizRequestHash({ presentationId = 0, versionId = 0 } = {}) {
  let h = 0x811c9dc5;
  const str = `p59q:${presentationId}:${versionId}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `qz_${h.toString(16).padStart(8, '0')}`;
}
