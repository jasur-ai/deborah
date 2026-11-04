import { describe, it, expect } from 'vitest';
import {
  findFirstPracticeAttempt,
  makePublicFirstResult,
  practiceFirstResultPath,
  practiceFirstResultsCollectionPath,
} from '../../src/modules/practice-first-results.js';

describe('public first-attempt practice results', () => {
  it('uses separate Mock and PRE-subtest result namespaces and validates path parts', () => {
    expect(practiceFirstResultsCollectionPath('mock', 'math')).toBe('practice_first_scores/mock/math');
    expect(practiceFirstResultsCollectionPath('pre', 'physics', 'part-1')).toBe('practice_first_scores/pre/physics/part-1');
    expect(practiceFirstResultPath('pre', 'physics', 'part-1', 'alice')).toBe('practice_first_scores/pre/physics/part-1/alice');
    expect(() => practiceFirstResultsCollectionPath('cast', 'math')).toThrow('invalid_practice_source');
    expect(() => practiceFirstResultsCollectionPath('pre', 'physics', '../other')).toThrow('invalid_practice_chunk');
    expect(() => practiceFirstResultPath('mock', 'math', '', 'alice/other')).toThrow('invalid_user_key');
  });

  it('selects the earliest full attempt for the exact source/key/chunk and ignores retry', () => {
    const history = {
      later: { practiceSource: 'mock', practiceKey: 'math', kind: 'full', at: 300, correct: 1, total: 2 },
      retry: { practiceSource: 'mock', practiceKey: 'math', kind: 'retry', at: 50, correct: 2, total: 2 },
      partial: { practiceSource: 'mock', practiceKey: 'math', kind: 'partial', at: 70, correct: 0, total: 2 },
      first: { practiceSource: 'mock', practiceKey: 'math', kind: 'full', at: 100, correct: 2, total: 2 },
      other: { practiceSource: 'pre', practiceKey: 'math', practiceChunk: 'part-1', kind: 'full', at: 1, correct: 2, total: 2 },
      wrongChunk: { practiceSource: 'pre', practiceKey: 'physics', practiceChunk: 'part-2', kind: 'full', at: 5, correct: 1, total: 2 },
      rightChunk: { practiceSource: 'pre', practiceKey: 'physics', practiceChunk: 'part-1', kind: 'full', at: 20, correct: 2, total: 2 },
    };

    expect(findFirstPracticeAttempt(history, 'mock', 'math')).toBe(history.first);
    expect(findFirstPracticeAttempt(history, 'pre', 'physics', 'part-1')).toBe(history.rightChunk);
    expect(findFirstPracticeAttempt(history, 'pre', 'physics', 'missing')).toBeNull();
    expect(findFirstPracticeAttempt(history, 'user', 'math')).toBeNull();
  });

  it('exposes only sanitized username and score fields', () => {
    expect(makePublicFirstResult({
      correct: 3, total: 2, percent: 150, at: 11, email: 'private@example.test', userKey: 'secret', answers: [1, 2],
    }, '  learner  ')).toEqual({ username: 'learner', correct: 2, total: 2, percent: 100, at: 11 });
    expect(JSON.stringify(makePublicFirstResult({ correct: 1, total: 2, at: 22 }, 'learner')))
      .not.toContain('private@example.test');
    expect(makePublicFirstResult({ correct: 1, total: 2, at: Number.MAX_VALUE }, 'learner').at)
      .toBe(8_640_000_000_000_000);
  });
});
