/**
 * Edikit — Quiz-from-Deck (unit tests, Prompt 59)
 *
 * Pure schema: concept extraction (§10), 50/30/20 blueprint, deterministic
 * question generation with per-question source citation, needs-review on
 * claim change, draft validation, status FSM, idempotency hash.
 */

import { describe, it, expect } from 'vitest';
import {
  extractQuizConcepts,
  buildQuizBlueprint,
  generateQuestionsFromDeck,
  buildSourceCitation,
  markNeedsReview,
  validateQuizDraft,
  validateQuizStatusTransition,
  buildQuizRequestHash,
  QUIZ_STATUS,
  DEFAULT_BLUEPRINT,
} from '../../src/modules/quiz-deck/index.js';

const doc = {
  title: 'Fotosintez',
  learningOutcomes: ['Fotosintez jarayonini tushuntirish'],
  slides: [
    {
      id: 's1',
      title: 'Kirish',
      speakerNotes: 'Fotosintez — yorug\'lik energiyasini kimyoviy energiyaga aylantiradi.',
      blocks: [{ type: 'text', content: { text: 'Xlorofill yashil pigment.' } }],
      citations: ['source:1'],
    },
    { id: 's2', title: 'Bosqichlar', speakerNotes: 'Yorug\'lik va qorong\'u fazalar.', blocks: [], citations: [] },
  ],
};

describe('quiz-deck — concept extraction (§10)', () => {
  it('extracts concepts with claims + citations', () => {
    const r = extractQuizConcepts({ document: doc });
    expect(r.ok).toBe(true);
    expect(r.concepts).toHaveLength(2);
    expect(r.concepts[0].claim).toContain('Fotosintez');
    expect(r.concepts[0].citations).toContain('source:1');
  });

  it('rejects document without slides', () => {
    expect(extractQuizConcepts({ document: {} }).ok).toBe(false);
  });
});

describe('quiz-deck — 50/30/20 blueprint', () => {
  it('builds default distribution for 10 questions (5/3/2)', () => {
    const r = buildQuizBlueprint({ total: 10 });
    expect(r.ok).toBe(true);
    expect(r.blueprint.easy).toBe(5);
    expect(r.blueprint.medium).toBe(3);
    expect(r.blueprint.hard).toBe(2);
    expect(r.blueprint.total).toBe(10);
  });

  it('rejects invalid total', () => {
    expect(buildQuizBlueprint({ total: 0 }).ok).toBe(false);
    expect(buildQuizBlueprint({ total: 101 }).ok).toBe(false);
  });

  it('honors custom distribution', () => {
    const r = buildQuizBlueprint({ total: 10, distribution: { easy: 0.4, medium: 0.4, hard: 0.2 } });
    expect(r.blueprint.easy).toBe(4);
    expect(r.blueprint.medium).toBe(4);
  });
});

describe('quiz-deck — question generation', () => {
  it('generates questions from concepts with citation', () => {
    const concepts = extractQuizConcepts({ document: doc }).concepts;
    const r = generateQuestionsFromDeck({ concepts, sourcePacks: [{ id: 1, title: 'Biologiya darsligi', url: 'https://x' }] });
    expect(r.ok).toBe(true);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0].slideId).toBe('s1');
    expect(r.questions[0].citation.verified).toBe(true);
    expect(r.questions[0].citation.title).toBe('Biologiya darsligi');
  });

  it('rejects no concepts', () => {
    expect(generateQuestionsFromDeck({ concepts: [] }).ok).toBe(false);
  });

  it('marks citation unverified when source pack missing (§22.11)', () => {
    const concepts = extractQuizConcepts({ document: doc }).concepts;
    const r = generateQuestionsFromDeck({ concepts, sourcePacks: [] });
    expect(r.questions[0].citation.verified).toBe(false);
    expect(r.questions[0].citation.unverified).toBe('source:1');
  });
});

describe('quiz-deck — source citation', () => {
  it('returns verified citation when pack exists in real DB', () => {
    const c = buildSourceCitation({ concept: { slideId: 's1', citations: ['source:5'] }, sourcePacks: [{ id: 5, title: 'T' }] });
    expect(c.verified).toBe(true);
    expect(c.sourcePackId).toBe(5);
  });

  it('returns null citation when concept has no citations', () => {
    const c = buildSourceCitation({ concept: { slideId: 's2', citations: [] } });
    expect(c.verified).toBe(false);
    expect(c.sourcePackId).toBeNull();
  });
});

describe('quiz-deck — needs-review on claim change (§10)', () => {
  it('flags question when claim changed', () => {
    const prev = { slides: [{ id: 's1', speakerNotes: 'Eski fikr' }] };
    const curr = { slides: [{ id: 's1', speakerNotes: 'Yangi fikr' }] };
    const r = markNeedsReview({ previousDocument: prev, currentDocument: curr, questions: [{ id: 'q_1', slideId: 's1' }] });
    expect(r.ok).toBe(true);
    expect(r.needsReview).toContain('q_1');
  });

  it('keeps question when claim unchanged', () => {
    const prev = { slides: [{ id: 's1', speakerNotes: 'X' }] };
    const curr = { slides: [{ id: 's1', speakerNotes: 'X' }] };
    const r = markNeedsReview({ previousDocument: prev, currentDocument: curr, questions: [{ id: 'q_1', slideId: 's1' }] });
    expect(r.needsReview).toEqual([]);
  });
});

describe('quiz-deck — draft validation + FSM', () => {
  it('validates draft with stem + options', () => {
    const qs = [{ stem: 'X?', options: ['A', 'B'], correctIndex: 0 }];
    expect(validateQuizDraft({ questions: qs }).ok).toBe(true);
  });

  it('rejects questions missing stem/options', () => {
    expect(validateQuizDraft({ questions: [{ stem: '' }] }).ok).toBe(false);
    expect(validateQuizDraft({ questions: [] }).ok).toBe(false);
  });

  it('enforces status FSM (§22.18 — no publish without approval)', () => {
    expect(validateQuizStatusTransition(QUIZ_STATUS.DRAFT, QUIZ_STATUS.APPROVED).ok).toBe(true);
    expect(validateQuizStatusTransition(QUIZ_STATUS.NEEDS_REVIEW, QUIZ_STATUS.APPROVED).ok).toBe(true);
    expect(validateQuizStatusTransition(QUIZ_STATUS.APPROVED, QUIZ_STATUS.PUBLISHED).ok).toBe(true);
    // DRAFT → PUBLISHED not allowed (teacher approval missing)
    const r = validateQuizStatusTransition(QUIZ_STATUS.DRAFT, QUIZ_STATUS.PUBLISHED);
    expect(r.ok).toBe(false);
  });
});

describe('quiz-deck — idempotency hash', () => {
  it('deterministic for same presentation+version', () => {
    expect(buildQuizRequestHash({ presentationId: 4, versionId: 2 })).toBe(buildQuizRequestHash({ presentationId: 4, versionId: 2 }));
    expect(buildQuizRequestHash({ presentationId: 4, versionId: 2 })).toMatch(/^qz_/);
  });
});

// DEFAULT_BLUEPRINT sanity
it('default blueprint is 50/30/20', () => {
  expect(DEFAULT_BLUEPRINT).toEqual({ easy: 0.5, medium: 0.3, hard: 0.2 });
});
