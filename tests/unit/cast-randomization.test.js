import { describe, it, expect } from 'vitest';
import { mulberry32, seededShuffle, hashToUint32, questionSeed, participantSeed, computeQuestionOrder, computeOptionOrder, SEED_VERSION } from '../../services/cast/randomization.js';

describe('seeded PRNG', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('different seeds give different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('produces values in [0,1)', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seededShuffle', () => {
  it('same seed → same order', () => {
    const arr = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(seededShuffle(arr, 123)).toEqual(seededShuffle(arr, 123));
  });

  it('is a permutation (same elements)', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    const out = seededShuffle(arr, 5);
    expect([...out].sort()).toEqual([...arr].sort());
  });

  it('does not mutate input', () => {
    const arr = ['a', 'b', 'c'];
    const before = [...arr];
    seededShuffle(arr, 9);
    expect(arr).toEqual(before);
  });

  it('different seed usually different order', () => {
    const arr = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(seededShuffle(arr, 1)).not.toEqual(seededShuffle(arr, 2));
  });
});

describe('seed derivation', () => {
  it('hashToUint32 deterministic', () => {
    expect(hashToUint32('x')).toBe(hashToUint32('x'));
  });

  it('questionSeed deterministic + versioned', () => {
    expect(questionSeed(100, 'q_01')).toBe(questionSeed(100, 'q_01'));
    expect(questionSeed(100, 'q_01')).not.toBe(questionSeed(100, 'q_02'));
  });

  it('participantSeed differs per participant', () => {
    const a = participantSeed(100, 'q_01', 'p_1');
    const b = participantSeed(100, 'q_01', 'p_2');
    expect(a).not.toBe(b);
  });

  it('seed version is in the hash input', () => {
    expect(SEED_VERSION).toBe('seed_v1');
  });
});

describe('computeQuestionOrder', () => {
  it('returns same order when shuffle disabled', () => {
    expect(computeQuestionOrder(['q_1', 'q_2', 'q_3'], 5, false)).toEqual(['q_1', 'q_2', 'q_3']);
  });

  it('deterministic with shuffle', () => {
    const ids = ['q_1', 'q_2', 'q_3', 'q_4', 'q_5'];
    expect(computeQuestionOrder(ids, 99, true)).toEqual(computeQuestionOrder(ids, 99, true));
  });

  it('single question stays in order', () => {
    expect(computeQuestionOrder(['q_1'], 99, true)).toEqual(['q_1']);
  });
});

describe('computeOptionOrder', () => {
  const options = [{ id: 'o_a' }, { id: 'o_b' }, { id: 'o_c' }, { id: 'o_d' }];

  it('no shuffle → natural order', () => {
    const out = computeOptionOrder(options, 5, false);
    expect(out.map((o) => o.displayPosition)).toEqual([0, 1, 2, 3]);
  });

  it('shuffled → deterministic + covers all ids', () => {
    const a = computeOptionOrder(options, 7, true);
    const b = computeOptionOrder(options, 7, true);
    expect(a).toEqual(b);
    expect(new Set(a.map((o) => o.id))).toEqual(new Set(options.map((o) => o.id)));
    // display positions are a permutation 0..3
    expect([...a.map((o) => o.displayPosition)].sort()).toEqual([0, 1, 2, 3]);
  });
});
