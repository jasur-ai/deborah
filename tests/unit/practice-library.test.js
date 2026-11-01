/**
 * Personal Mock fanlar/Subtestlar kutubxonasi — access and safe catalog metadata.
 * Live-game hosting authorization remains separate in routes/game.js.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PANEL_COPY } from '../../data/panel-i18n.js';

const mocks = vi.hoisted(() => ({ fbGet: vi.fn() }));
vi.mock('../../firebase/admin.js', () => ({ fb: { get: mocks.fbGet } }));

const {
  buildPracticeCatalog,
  loadPracticeQuestions,
  sampleMockPracticeQuestions,
  selectMockPracticeQuestionIds,
  MOCK_PRACTICE_QUESTION_LIMIT,
} = await import('../../routes/user.js');

function snapshot(value, exists = true) {
  return { exists: () => exists, val: () => value };
}

function responseStub() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

describe('personal practice catalog', () => {
  beforeEach(() => mocks.fbGet.mockReset());

  it.each(['uz', 'uz-cyrl', 'ru', 'en'])('explains the 25-question Mock session in %s', (lang) => {
    expect(PANEL_COPY[lang]['prep.mockSub']).toContain('{n}');
    expect(PANEL_COPY[lang]['prep.mockPoolCount']).toBeTruthy();
  });

  it('builds a metadata-only catalog and filters unsafe source keys', () => {
    const catalog = buildPracticeCatalog({
      algebra: {
        name: 'Algebra', count: 2,
        questions: [{ text: '2 + 2?', options: ['3', '4'], correct: 1 }],
      },
      '../private': { name: 'Should not appear', questions: [{ text: 'secret' }] },
    }, {
      pre_math: {
        title: 'Mathematics', total: 3,
        chunks: [
          { id: 'part_1', name: 'Subtest 1', count: 2, questions: [{ text: 'Q1' }, { text: 'Q2' }] },
          { id: '../bad', name: 'Unsafe chunk', count: 10, questions: [] },
        ],
      },
    });

    expect(catalog.mockFans).toEqual([{ key: 'algebra', name: 'Algebra', count: 1 }]);
    expect(catalog.preGroups).toEqual([{
      key: 'pre_math', title: 'Mathematics', count: 2,
      chunks: [{ id: 'part_1', name: 'Subtest 1', count: 2 }],
    }]);
    expect(JSON.stringify(catalog)).not.toContain('correct');
    expect(JSON.stringify(catalog)).not.toContain('2 + 2?');
    expect(JSON.stringify(catalog)).not.toContain('Should not appear');
  });

  it('samples 25 distinct questions from the full Mock bank without mutating it', () => {
    const bank = Array.from({ length: 335 }, (_, index) => ({ id: index + 1, text: `Question ${index + 1}` }));
    const original = bank.slice();
    const sample = sampleMockPracticeQuestions(bank);

    expect(MOCK_PRACTICE_QUESTION_LIMIT).toBe(25);
    expect(sample).toHaveLength(25);
    expect(new Set(sample.map((question) => question.id)).size).toBe(25);
    expect(sample.every((question) => bank.includes(question))).toBe(true);
    expect(bank).toEqual(original);
  });

  it('keeps a smaller Mock bank intact and applies a valid custom sample limit', () => {
    const smallBank = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(sampleMockPracticeQuestions(smallBank)).toEqual(smallBank);
    expect(sampleMockPracticeQuestions(Array.from({ length: 10 }, (_, id) => ({ id })), 4)).toHaveLength(4);
    expect(sampleMockPracticeQuestions(Array.from({ length: 30 }, (_, id) => ({ id })), 0)).toHaveLength(25);
  });

  it('accepts only unique IDs from the validated bank for the matching Mock session', () => {
    const bank = Array.from({ length: 40 }, (_, index) => ({
      text: `Question ${index}`,
      options: ['Wrong', 'Right'],
      correct: 1,
    }));
    const sampleIds = Array.from({ length: 25 }, (_, index) => index);

    expect(selectMockPracticeQuestionIds(bank, sampleIds)).toEqual(sampleIds);
    expect(selectMockPracticeQuestionIds(bank, [39, 2, 39])).toEqual([]);
    expect(selectMockPracticeQuestionIds(bank, [39, 99])).toEqual([]);
    expect(selectMockPracticeQuestionIds(bank, Array.from({ length: 26 }, (_, index) => index))).toEqual([]);
  });

  it.each([
    { label: 'non-VIP', isVip: false },
    { label: 'VIP', isVip: true },
  ])('allows a $label student to practise a Mock fan without checking VIP status', async ({ isVip }) => {
    mocks.fbGet.mockResolvedValue(snapshot({
      name: 'Matematika',
      questions: [{ text: '2 + 2?', options: ['3', '4'], correct: 1 }],
    }));
    const res = responseStub();
    const loaded = await loadPracticeQuestions({
      query: { source: 'mock', key: 'algebra' },
      body: {},
      session: { user: { safeKey: 'student-1', role: 'student', isVip } },
    }, res);

    expect(loaded).toEqual({
      title: 'Matematika',
      questions: [{ text: '2 + 2?', options: ['3', '4'], correct: 1 }],
    });
    expect(res.payload).toBeNull();
    expect(mocks.fbGet).toHaveBeenCalledTimes(1);
    expect(mocks.fbGet).toHaveBeenCalledWith('mock_fans/algebra');
  });

  it('allows a non-VIP student to practise a selected Subtest chunk', async () => {
    mocks.fbGet.mockResolvedValue(snapshot({
      title: 'Matematika',
      chunks: [{
        id: 'part_1', name: 'Algebra',
        questions: [{ text: 'x + 1 = 3', options: ['1', '2'], correct: 1 }],
      }],
    }));
    const res = responseStub();
    const loaded = await loadPracticeQuestions({
      query: { source: 'pre', key: 'pre_math', chunk: 'part_1' },
      body: {},
      session: { user: { safeKey: 'student-1', role: 'student', isVip: false } },
    }, res);

    expect(loaded.title).toBe('Matematika — Algebra');
    expect(loaded.questions).toHaveLength(1);
    expect(res.payload).toBeNull();
    expect(mocks.fbGet).toHaveBeenCalledTimes(1);
    expect(mocks.fbGet).toHaveBeenCalledWith('pre_groups/pre_math');
  });

  it('keeps live-game hosting behind its separate teacher/admin VIP gate', () => {
    const gameRoutes = readFileSync(new URL('../../routes/game.js', import.meta.url), 'utf8');
    expect(gameRoutes).toContain("router.get('/host', requireAuth, vipGateForMockPre");
    expect(gameRoutes).toContain('return requireVip(req, res, next);');
  });
});
