import { describe, it, expect } from 'vitest';
import { aggregatePracticeResults } from '../../src/modules/practice-results.js';

describe('admin practice-result aggregates', () => {
  it('groups full Mock attempts without exposing user identifiers and excludes retries', () => {
    const users = {
      alice: { practice_history: {
        a: { practiceSource: 'mock', practiceKey: 'math', kind: 'full', correct: 8, total: 10, percent: 80, at: 10 },
        b: { practiceSource: 'mock', practiceKey: 'math', kind: 'full', correct: 6, total: 10, percent: 60, at: 20 },
        c: { practiceSource: 'mock', practiceKey: 'math', kind: 'retry', correct: 10, total: 10, percent: 100, at: 30 },
        d: { practiceSource: 'pre', practiceKey: 'math', kind: 'full', correct: 10, total: 10, percent: 100, at: 40 },
      } },
      bob: { practice_history: {
        e: { practiceSource: 'mock', practiceKey: 'math', kind: 'full', correct: 9, total: 10, percent: 90, at: 50 },
      } },
    };

    const aggregate = aggregatePracticeResults(users, 'mock');
    expect(aggregate.byKey.math).toEqual({
      attempts: 3,
      participants: 2,
      averagePercent: 77,
      bestPercent: 90,
      correctAnswers: 23,
      totalQuestions: 30,
      lastAt: 50,
    });
    expect(JSON.stringify(aggregate)).not.toContain('alice');
    expect(JSON.stringify(aggregate)).not.toContain('bob');
  });

  it('aggregates PRE totals and per-subtest summaries separately', () => {
    const users = {
      learner1: { practice_history: {
        a: { practiceSource: 'pre', practiceKey: 'physics', practiceChunk: 'sub-1', kind: 'full', correct: 20, total: 25, percent: 80, at: 10 },
        b: { practiceSource: 'pre', practiceKey: 'physics', practiceChunk: 'sub-2', kind: 'full', correct: 15, total: 25, percent: 60, at: 20 },
      } },
      learner2: { practice_history: {
        c: { practiceSource: 'pre', practiceKey: 'physics', practiceChunk: 'sub-1', kind: 'full', correct: 25, total: 25, percent: 100, at: 30 },
      } },
    };

    const aggregate = aggregatePracticeResults(users, 'pre');
    expect(aggregate.byKey.physics).toMatchObject({ attempts: 3, participants: 2, averagePercent: 80, bestPercent: 100 });
    expect(aggregate.byChunk.physics['sub-1']).toMatchObject({ attempts: 2, participants: 2, averagePercent: 90, bestPercent: 100 });
    expect(aggregate.byChunk.physics['sub-2']).toMatchObject({ attempts: 1, participants: 1, averagePercent: 60, bestPercent: 60 });
  });

  it('returns no cross-source aggregates for an unsupported source', () => {
    expect(aggregatePracticeResults({ alice: {} }, 'cast')).toEqual({ byKey: {}, byChunk: {} });
  });
});
