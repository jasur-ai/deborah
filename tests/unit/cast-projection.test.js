import { describe, it, expect } from 'vitest';
import { participantQuestionProjection, revealProjection, directorQuestionProjection, publicStateProjection, answerCountProjection } from '../../services/cast/projections.js';
import { normalizeCastQuestion } from '../../services/cast/test-normalizer.js';
import { splitQuestion } from '../../services/cast/test-loader.js';

const raw = {
  text: '1 + 1 = ?',
  options: ['2', '3', '4', '5'],
  correct: 0,
};

describe('splitQuestion (G0-02)', () => {
  it('public question never carries correctOptionIds', () => {
    const norm = normalizeCastQuestion(raw, 0);
    const { privateQuestion, publicQuestion } = splitQuestion(norm);
    expect(publicQuestion.correctOptionIds).toBeUndefined();
    expect(publicQuestion.explanation).toBeUndefined();
    expect(privateQuestion.correctOptionIds).toEqual(['o_a']);
  });

  it('private question has answer key, public does not', () => {
    const norm = normalizeCastQuestion(raw, 0);
    const { privateQuestion, publicQuestion } = splitQuestion(norm);
    // Option ID'lar (o_a, o_b) hamma uchun ochiq — answer key faqat correctOptionIds
    expect(JSON.stringify(publicQuestion)).not.toContain('correctOptionIds');
    expect(publicQuestion.correctOptionIds).toBeUndefined();
    expect(privateQuestion.correctOptionIds.length).toBeGreaterThan(0);
  });
});

describe('participantQuestionProjection', () => {
  const norm = normalizeCastQuestion(raw, 0);
  const { publicQuestion } = splitQuestion(norm);

  it('includes safe fields + phase info', () => {
    const p = participantQuestionProjection(publicQuestion, { phase: 'QUESTION_OPEN', openedAt: 1, closesAt: 30001, revision: 42 });
    expect(p.questionId).toBe('q_01');
    expect(p.text).toBe('1 + 1 = ?');
    expect(p.options).toHaveLength(4);
    expect(p.phase).toBe('QUESTION_OPEN');
    expect(p.closesAt).toBe(30001);
    expect(p.revision).toBe(42);
  });

  it('never leaks correct answer', () => {
    const p = participantQuestionProjection(publicQuestion, { phase: 'QUESTION_OPEN' });
    expect(JSON.stringify(p)).not.toContain('correctOptionIds');
    expect(JSON.stringify(p)).not.toContain('correctAnswer');
  });
});

describe('revealProjection', () => {
  it('includes correct ids only with explanation when allowed', () => {
    const norm = normalizeCastQuestion({ ...raw, explanation: 'chunki 1+1=2' }, 0);
    const { privateQuestion } = splitQuestion(norm);
    const r = revealProjection(privateQuestion, { includeExplanation: true });
    expect(r.correctOptionIds).toEqual(['o_a']);
    expect(r.explanation).toContain('chunki');
  });

  it('omits explanation when policy disallows', () => {
    const norm = normalizeCastQuestion({ ...raw, explanation: 'secret' }, 0);
    const { privateQuestion } = splitQuestion(norm);
    const r = revealProjection(privateQuestion, { includeExplanation: false });
    expect(r.explanation).toBeUndefined();
  });
});

describe('directorQuestionProjection', () => {
  it('gives director current question without answer key', () => {
    const norm = normalizeCastQuestion(raw, 0);
    const { publicQuestion, privateQuestion } = splitQuestion(norm);
    const d = directorQuestionProjection(publicQuestion, privateQuestion);
    expect(d.questionId).toBe('q_01');
    expect(d.hasExplanation).toBe(false);
    expect(JSON.stringify(d)).not.toContain('correctOptionIds');
  });
});

describe('publicStateProjection', () => {
  it('strips internal fields', () => {
    const s = publicStateProjection({ phase: 'QUESTION_OPEN', revision: 5, questionId: 'q_01', openedAt: 1, closesAt: 2, pausedAt: null, totalPausedMs: 0, timerMode: 'soft', questionPosition: 1, totalQuestions: 10, primaryDirectorId: 'user:secret', endedAt: null });
    expect(s.primaryDirectorId).toBeUndefined();
    expect(s.phase).toBe('QUESTION_OPEN');
    expect(s.revision).toBe(5);
  });
});

describe('answerCountProjection', () => {
  it('has no identity data', () => {
    const a = answerCountProjection(3, 5);
    expect(a).toEqual({ answered: 3, total: 5 });
  });
});

describe('normalizeCastQuestion (G0-04)', () => {
  it('stable IDs assigned deterministically', () => {
    const a = normalizeCastQuestion(raw, 0);
    const b = normalizeCastQuestion(raw, 0);
    expect(a.id).toBe('q_01');
    expect(a.options[0].id).toBe('o_a');
    expect(a.options[3].id).toBe('o_d');
    expect(a).toEqual(b);
  });

  it('duplicate option text still gets separate IDs', () => {
    const q = normalizeCastQuestion({ text: 'x', options: ['same', 'same', 'same'], correct: 2 }, 0);
    const ids = q.options.map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('correct maps to correctOptionIds', () => {
    const q = normalizeCastQuestion(raw, 0);
    expect(q.correctOptionIds).toEqual(['o_a']);
  });

  it('returns null when no correct answer', () => {
    const q = normalizeCastQuestion({ text: 'x', options: ['a', 'b'], correct: -1 }, 0);
    expect(q).toBeNull();
  });

  it('handles object-option format (isCorrect flag)', () => {
    const q = normalizeCastQuestion({
      text: 'y',
      options: [{ text: 'A', isCorrect: false }, { text: 'B', isCorrect: true }],
    }, 0);
    expect(q.correctOptionIds).toEqual(['o_b']);
  });

  it('detects true/false type', () => {
    const q = normalizeCastQuestion({ text: '2+2=4', options: ['To‘g‘ri', 'Noto‘g‘ri'], correct: 0 }, 0);
    expect(q.type).toBe('true_false');
  });
});
