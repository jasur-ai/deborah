/**
 * Edikit — Unit Tests: Helper Utilities
 *
 * Tests for: esc, safeKey, normStr, hashPass, fmtTime, generateGameCode,
 *           shuffleArray, normalizeQuestion, calculatePoints, buildLeaderboard
 */

import { describe, it, expect } from 'vitest';
import {
  esc, safeKey, normStr, hashPass, fmtTime,
  generateGameCode, shuffleArray, normalizeQuestion,
  calculatePoints, buildLeaderboard,
} from '../../utils/helpers.js';

describe('esc() — HTML escaping', () => {
  it('should escape &, <, >, ", \'', () => {
    expect(esc('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('should return empty string for null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('should return plain text unchanged', () => {
    expect(esc('Hello World')).toBe('Hello World');
    expect(esc('123')).toBe('123');
  });
});

describe('safeKey() — Firebase key sanitization', () => {
  it('should convert to lowercase and replace special chars', () => {
    expect(safeKey('John Doe!')).toBe('john_doe_');
  });

  it('should replace consecutive underscores with one', () => {
    expect(safeKey('test___key')).toBe('test_key');
  });

  it('should limit to 60 chars', () => {
    const long = 'a'.repeat(100);
    expect(safeKey(long).length).toBeLessThanOrEqual(60);
  });
});

describe('normStr() — Search normalization', () => {
  it('should lowercase and trim', () => {
    expect(normStr('  Hello World  ')).toBe('hello world');
  });

  it('should collapse multiple spaces', () => {
    expect(normStr('a    b')).toBe('a b');
  });
});

describe('hashPass() — Password hashing', () => {
  it('should produce a 64-char hex string', () => {
    const hash = hashPass('testpass', 'testsalt');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should be deterministic', () => {
    const h1 = hashPass('same', 'salt');
    const h2 = hashPass('same', 'salt');
    expect(h1).toBe(h2);
  });

  it('should differ for different passwords', () => {
    const h1 = hashPass('pass1', 'salt');
    const h2 = hashPass('pass2', 'salt');
    expect(h1).not.toBe(h2);
  });
});

describe('fmtTime() — Time formatting', () => {
  it('should format seconds', () => {
    expect(fmtTime(5000)).toBe('5s');
    expect(fmtTime(0)).toBe('0s');
  });

  it('should format minutes and seconds', () => {
    expect(fmtTime(121000)).toBe('2m 1s');
    expect(fmtTime(60000)).toBe('1m 0s');
  });
});

describe('generateGameCode() — Game code generation', () => {
  it('should return a 5-digit string', () => {
    const code = generateGameCode();
    expect(code).toMatch(/^\d{5}$/);
  });

  it('should not start with 0', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateGameCode();
      expect(code[0]).not.toBe('0');
    }
  });
});

describe('shuffleArray() — Array shuffling', () => {
  it('should return an array of same length', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffleArray(arr, 42);
    expect(shuffled).toHaveLength(5);
  });

  it('should be deterministic with same seed', () => {
    const arr = [1, 2, 3, 4, 5];
    const s1 = shuffleArray(arr, 42);
    const s2 = shuffleArray(arr, 42);
    expect(s1).toEqual(s2);
  });

  it('should differ with different seeds', () => {
    const arr = [1, 2, 3, 4, 5];
    const s1 = shuffleArray(arr, 42);
    const s2 = shuffleArray(arr, 99);
    expect(s1).not.toEqual(s2);
  });
});

describe('normalizeQuestion() — Question normalization', () => {
  it('should handle object-type options (PRE/Mock format)', () => {
    const q = {
      text: 'Test?',
      options: [
        { text: 'A', letter: 'A', isCorrect: true },
        { text: 'B', letter: 'B', isCorrect: false },
      ],
    };
    const result = normalizeQuestion(q);
    expect(result).toEqual({
      text: 'Test?',
      options: ['A', 'B'],
      correct: 0,
      is_double: false,
    });
  });

  it('should handle array-type options (user format)', () => {
    const q = {
      text: 'What is 2+2?',
      options: ['3', '4', '5'],
      correct: 1,
    };
    const result = normalizeQuestion(q);
    expect(result.correct).toBe(1);
    expect(result.options).toEqual(['3', '4', '5']);
  });

  it('should return null for invalid input', () => {
    expect(normalizeQuestion(null)).toBeNull();
    expect(normalizeQuestion(undefined)).toBeNull();
  });
});

describe('calculatePoints() — Score calculation', () => {
  it('should return 0 for incorrect answers', () => {
    expect(calculatePoints(5000, 10000, false, false, 'score')).toBe(0);
  });

  it('should return base points for correct answers in speed mode', () => {
    const pts = calculatePoints(500, 10000, true, false, 'score');
    expect(pts).toBeGreaterThan(0);
    expect(pts).toBeLessThanOrEqual(100);
  });

  it('should double points for double-value questions', () => {
    const normal = calculatePoints(500, 10000, true, false, 'score');
    const doubled = calculatePoints(500, 10000, true, true, 'score');
    expect(doubled).toBe(normal * 2);
  });

  it('should give higher points for faster answers', () => {
    const fast = calculatePoints(500, 10000, true, false, 'score');
    const slow = calculatePoints(9500, 10000, true, false, 'score');
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('buildLeaderboard() — Leaderboard building', () => {
  it('should return empty array for null/undefined input', () => {
    expect(buildLeaderboard(null)).toEqual([]);
    expect(buildLeaderboard(undefined)).toEqual([]);
  });

  it('should sort by score descending, then time ascending', () => {
    const players = {
      alice: { score: 100, totalTime: 5000, emoji: '😊' },
      bob: { score: 200, totalTime: 3000, emoji: '😎' },
      charlie: { score: 100, totalTime: 4000, emoji: '🤓' },
    };
    const lb = buildLeaderboard(players);
    expect(lb[0].name).toBe('bob');     // highest score
    expect(lb[1].name).toBe('charlie'); // same score, lower time → before alice
    expect(lb[2].name).toBe('alice');   // same score, higher time
    expect(lb[1].score).toBe(100);
    expect(lb[1].time).toBeLessThan(lb[2].time);
  });
});
