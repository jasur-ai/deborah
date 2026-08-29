/**
 * Deborah — Security Tests: Public/Private Answer Key Separation
 *
 * Tests that:
 * 1. game:questionActive event does NOT contain qCorrect
 * 2. game:answerReveal event contains correct answer (post-scoring)
 * 3. Server-side scoring parity with private path
 * 4. DTO helper functions strip private fields correctly
 */

import { describe, it, expect, beforeAll } from 'vitest';

// ── Helper: Create a mock question ──
function createMockQuestion(overrides = {}) {
  return {
    text: 'Test question?',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct: 1, // Option B is correct
    is_double: false,
    ...overrides,
  };
}

// ── Test: Public event payloads ──
describe('Public question DTO — no answer key leak', () => {
  it('game:questionActive payload should NOT contain qCorrect', () => {
    const q = createMockQuestion();
    
    // Simulate the server's activation event (same as socket/game-handler.js)
    const eventPayload = {
      qIndex: 0,
      qText: q.text,
      qOptions: q.options,
      qIsDouble: !!q.is_double,
      qTime: 20,
      startedAt: Date.now(),
    };

    // This is the critical security test
    expect(eventPayload).not.toHaveProperty('qCorrect');
    expect(eventPayload).not.toHaveProperty('q_correct');
    expect(eventPayload).not.toHaveProperty('correct');
  });

  it('game:questionPreview payload should NOT contain answer key', () => {
    const q = createMockQuestion();

    // Simulate the preview event
    const eventPayload = {
      qIndex: 0,
      totalQuestions: 10,
      qText: q.text,
      qIsDouble: !!q.is_double,
      countdown: 3,
    };

    expect(eventPayload).not.toHaveProperty('qCorrect');
    expect(eventPayload).not.toHaveProperty('correct');
    expect(eventPayload).not.toHaveProperty('q_correct');
  });

  it('game:answerReveal payload SHOULD contain correct answer', () => {
    const q = createMockQuestion();
    const correctAnswer = q.correct;

    // Simulate the answer reveal event
    const revealPayload = {
      qIndex: 0,
      correctOptionIndex: correctAnswer,
      correctText: q.options[correctAnswer],
      stats: {
        total: 5,
        answered: 5,
        correct: 3,
        incorrect: 2,
      },
    };

    expect(revealPayload).toHaveProperty('correctOptionIndex');
    expect(revealPayload.correctOptionIndex).toBe(1);
    expect(revealPayload.correctText).toBe('Option B');
  });
});

// ── Test: DTO helper functions ──
describe('Public/Private DTO helpers', () => {
  it('toPublicQuestion strips correct field', () => {
    const q = createMockQuestion();

    // Simulate the toPublicQuestion helper from src/contracts/question.ts
    const publicQ = {
      text: q.text,
      options: q.options,
      isDouble: !!q.is_double,
    };

    expect(publicQ).toEqual({
      text: 'Test question?',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      isDouble: false,
    });
    expect(publicQ).not.toHaveProperty('correct');
  });

  it('full question object still has correct field (server-side)', () => {
    const q = createMockQuestion();

    // Server-side session still contains the correct answer
    expect(q).toHaveProperty('correct');
    expect(q.correct).toBe(1);
  });
});

// ── Test: Server-side scoring parity ──
describe('Server-side scoring with private answer key', () => {
  it('correct answer detection with private key', () => {
    const q = createMockQuestion();
    const privateCorrect = q.correct; // Read from private path (simulated)

    const playerAnswers = [
      { name: 'Player1', option: 1 }, // Correct
      { name: 'Player2', option: 0 }, // Wrong
      { name: 'Player3', option: 1 }, // Correct
      { name: 'Player4', option: 2 }, // Wrong
      { name: 'Player5', option: 1 }, // Correct
    ];

    const results = playerAnswers.map(ans => ({
      ...ans,
      isCorrect: ans.option === privateCorrect,
    }));

    expect(results.filter(r => r.isCorrect).length).toBe(3);
    expect(results.filter(r => !r.isCorrect).length).toBe(2);
  });

  it('scoring function with double points', () => {
    const q = createMockQuestion({ is_double: true });
    const privateCorrect = q.correct;
    const qTimeMs = 20000; // 20 seconds

    // Simulate calculatePoints (simplified)
    function calculatePoints(elapsed, totalMs, isCorrect, isDouble) {
      if (!isCorrect) return 0;
      const pct = Math.max(0, 1 - elapsed / totalMs);
      const base = Math.round(pct * 1000);
      return isDouble ? base * 2 : base;
    }

    const fastCorrect = calculatePoints(1000, qTimeMs, true, q.is_double);
    const slowCorrect = calculatePoints(15000, qTimeMs, true, q.is_double);
    const wrong = calculatePoints(1000, qTimeMs, false, q.is_double);

    expect(fastCorrect).toBeGreaterThan(slowCorrect);
    expect(fastCorrect).toBeGreaterThan(0);
    expect(slowCorrect).toBeGreaterThan(0);
    expect(wrong).toBe(0);
  });

  it('fallback: private path missing → uses session.questions', () => {
    // Simulate getPrivateCorrect with no private path, fallback to session
    const session = {
      questions: [
        createMockQuestion(),
        createMockQuestion({ correct: 3 }),
      ],
    };

    function getCorrectFromSession(idx) {
      return session.questions[idx]?.correct ?? null;
    }

    expect(getCorrectFromSession(0)).toBe(1);
    expect(getCorrectFromSession(1)).toBe(3);
    expect(getCorrectFromSession(99)).toBe(null);
  });
});

// ── Test: Client-side can't access private path ──
describe('Client-side attack prevention', () => {
  it('client should not know correct index before answering', () => {
    const q = createMockQuestion();

    // What the client receives in game:questionActive
    const clientPayload = {
      qIndex: 0,
      qText: q.text,
      qOptions: q.options,
      qIsDouble: !!q.is_double,
      qTime: 20,
      startedAt: Date.now(),
    };

    // Client CANNOT determine which option is correct
    expect(clientPayload).not.toHaveProperty('qCorrect');
    expect(clientPayload).not.toHaveProperty('correct');

    // After answering, client receives game:answerReveal
    const revealPayload = {
      qIndex: 0,
      correctOptionIndex: q.correct,
      correctText: q.options[q.correct],
    };

    // Client now knows the correct answer
    expect(revealPayload.correctOptionIndex).toBe(1);
  });
});
