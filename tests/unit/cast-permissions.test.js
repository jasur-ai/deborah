import { describe, it, expect } from 'vitest';
import { can, assertCan, ACTIONS, CAST_ROLES } from '../../services/cast/permissions.js';

// T-01 item 6: har role × har action kombinatsiyasi eksplitsit test qilinadi.
// MATRIX ichki (export qilinmaydi) — shuning uchun quyida xatti-harakat (behavior)
// asosida to'liq kombinatsiyalarni sinaymiz.

// Expected matrix (behavioral, permissions.js MATRIX bilan sinxron saqlanadi):
const EXPECTED_MATRIX = {
  [CAST_ROLES.OWNER]: Object.values(ACTIONS),
  [CAST_ROLES.CO_HOST]: [
    ACTIONS.SESSION_START,
    ACTIONS.QUESTION_OPEN,
    ACTIONS.QUESTION_PAUSE,
    ACTIONS.QUESTION_RESUME,
    ACTIONS.QUESTION_CLOSE,
    ACTIONS.QUESTION_REVEAL,
    ACTIONS.QUESTION_NEXT,
    ACTIONS.ADD_TIME,
    ACTIONS.LEADERBOARD_SHOW,
    ACTIONS.LOCK_LOBBY,
    ACTIONS.REMOVE_PARTICIPANT,
    ACTIONS.ANSWER_SUBMIT,
    ACTIONS.MODERATE,
    ACTIONS.SESSION_END,
    ACTIONS.ANALYZE,
    ACTIONS.DISCUSS_START,
    ACTIONS.REVOTE_OPEN,
  ],
  [CAST_ROLES.MODERATOR]: [
    ACTIONS.MODERATE,
    ACTIONS.REMOVE_PARTICIPANT,
    ACTIONS.ANSWER_SUBMIT,
    ACTIONS.ANALYZE,
  ],
  [CAST_ROLES.PROJECTOR_ONLY]: [ACTIONS.PROJECTOR_VIEW],
  [CAST_ROLES.ANALYST_READONLY]: [ACTIONS.ANALYZE, ACTIONS.PROJECTOR_VIEW],
  participant: [ACTIONS.ANSWER_SUBMIT, ACTIONS.JOIN],
};

describe('T-01 matrix self-validation', () => {
  it('EXPECTED_MATRIX faqat haqiqiy ACTIONS qiymatlarini ishlatadi', () => {
    const realActions = Object.values(ACTIONS);
    for (const [role, list] of Object.entries(EXPECTED_MATRIX)) {
      for (const a of list) {
        expect(realActions, `role=${role} action=${a}`).toContain(a);
      }
    }
  });

  it('EXPECTED_MATRIX har haqiqiy rolni qamrab oladi (owner/co-host/moderator/projector/analyst/participant)', () => {
    expect(Object.keys(EXPECTED_MATRIX).sort()).toEqual(
      [CAST_ROLES.OWNER, CAST_ROLES.CO_HOST, CAST_ROLES.MODERATOR, CAST_ROLES.PROJECTOR_ONLY, CAST_ROLES.ANALYST_READONLY, 'participant'].sort(),
    );
  });
});

describe('T-01 Role × Action full matrix (it.each)', () => {
  const roles = Object.keys(EXPECTED_MATRIX);
  const actions = Object.values(ACTIONS);

  it.each(roles.flatMap((role) => actions.map((action) => [role, action])))(
    'role=%s action=%s → %s',
    (role, action) => {
      const expected = EXPECTED_MATRIX[role].includes(action);
      expect(can(role, action).allowed).toBe(expected);
    },
  );
});

describe('T-01 assertCan matches can for every combination', () => {
  const roles = Object.keys(EXPECTED_MATRIX);
  const actions = Object.values(ACTIONS);

  it.each(roles.flatMap((role) => actions.map((action) => [role, action])))(
    'assertCan role=%s action=%s',
    (role, action) => {
      const expected = EXPECTED_MATRIX[role].includes(action);
      if (expected) {
        expect(assertCan(role, action)).toBe(true);
      } else {
        expect(() => assertCan(role, action)).toThrow();
      }
    },
  );
});

describe('Role matrix', () => {
  it('owner can do everything', () => {
    for (const action of Object.values(ACTIONS)) {
      expect(can(CAST_ROLES.OWNER, action).allowed).toBe(true);
    }
  });

  it('co-host can control questions but not everything bypass', () => {
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.QUESTION_OPEN).allowed).toBe(true);
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.QUESTION_REVEAL).allowed).toBe(true);
    expect(can(CAST_ROLES.CO_HOST, ACTIONS.SESSION_END).allowed).toBe(true);
  });

  it('moderator cannot control question progression', () => {
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.MODERATE).allowed).toBe(true);
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.QUESTION_OPEN).allowed).toBe(false);
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.QUESTION_REVEAL).allowed).toBe(false);
    expect(can(CAST_ROLES.MODERATOR, ACTIONS.SESSION_END).allowed).toBe(false);
  });

  it('projector_only is read-only', () => {
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.PROJECTOR_VIEW).allowed).toBe(true);
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.QUESTION_OPEN).allowed).toBe(false);
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.ANSWER_SUBMIT).allowed).toBe(false);
    expect(can(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.MODERATE).allowed).toBe(false);
  });

  it('analyst is read-only aggregate', () => {
    expect(can(CAST_ROLES.ANALYST_READONLY, ACTIONS.ANALYZE).allowed).toBe(true);
    expect(can(CAST_ROLES.ANALYST_READONLY, ACTIONS.QUESTION_NEXT).allowed).toBe(false);
  });

  it('unknown role denied', () => {
    expect(can('superuser', ACTIONS.QUESTION_OPEN).allowed).toBe(false);
  });

  it('participant can answer and join', () => {
    expect(can('participant', ACTIONS.ANSWER_SUBMIT).allowed).toBe(true);
    expect(can('participant', ACTIONS.JOIN).allowed).toBe(true);
    expect(can('participant', ACTIONS.QUESTION_OPEN).allowed).toBe(false);
  });
});

describe('assertCan', () => {
  it('throws on denial with reason', () => {
    expect(() => assertCan(CAST_ROLES.PROJECTOR_ONLY, ACTIONS.MODERATE)).toThrow();
  });

  it('passes allowed', () => {
    expect(assertCan(CAST_ROLES.OWNER, ACTIONS.SESSION_END)).toBe(true);
  });
});
