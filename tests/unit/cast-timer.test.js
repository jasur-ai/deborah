import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeClosesAt, remainingMs, isWithinBoundary, scheduleQuestionTimer, cancelSessionTimer, clearAllTimers } from '../../services/cast/timer-service.js';

// T-01 item 4: time testlarida fake clock ishlatiladi (real setTimeout emas).
// serverNow orqali o'tadigan barcha hisoblar deterministik bo'ladi.

describe('computeClosesAt', () => {
  it('off mode → null', () => {
    expect(computeClosesAt({ mode: 'off', defaultSeconds: 30, openedAt: 1000 })).toBeNull();
  });

  it('soft mode → openedAt + seconds', () => {
    expect(computeClosesAt({ mode: 'soft', defaultSeconds: 30, openedAt: 1000 })).toBe(31000);
  });

  it('strict mode → same as soft', () => {
    expect(computeClosesAt({ mode: 'strict', defaultSeconds: 20, openedAt: 5000 })).toBe(25000);
  });
});

describe('remainingMs', () => {
  it('positive remaining', () => {
    expect(remainingMs(31000, 10000)).toBe(21000);
  });

  it('clamps to zero', () => {
    expect(remainingMs(10000, 20000)).toBe(0);
  });

  it('null closesAt → null (off timer)', () => {
    expect(remainingMs(null, 1000)).toBeNull();
  });
});

describe('isWithinBoundary', () => {
  it('before close accepted', () => {
    expect(isWithinBoundary(1000, 2000)).toBe(true);
  });

  it('exact boundary accepted', () => {
    expect(isWithinBoundary(2000, 2000)).toBe(true);
  });

  it('within grace accepted', () => {
    expect(isWithinBoundary(2100, 2000, 1000)).toBe(true);
  });

  it('past grace rejected', () => {
    expect(isWithinBoundary(5000, 2000, 1000)).toBe(false);
  });

  it('null closesAt (off timer) always accepted', () => {
    expect(isWithinBoundary(999999, null)).toBe(true);
  });
});

describe('scheduleQuestionTimer (fake clock)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllTimers();
  });
  afterEach(() => {
    clearAllTimers();
    vi.useRealTimers();
  });

  it('fires callback exactly at expiry (fake timers)', () => {
    vi.setSystemTime(1000);
    let fired = null;
    scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 1, expiresAt: 5000, mode: 'soft',
      onFire: (f) => { fired = f; },
    });
    vi.advanceTimersByTime(3999);
    expect(fired).toBeNull();
    vi.advanceTimersByTime(1);
    expect(fired).toEqual({ sessionId: 's1', questionId: 'q_01', revision: 1, mode: 'soft' });
  });

  it('stale revision timer is a no-op (superseded, fake clock)', () => {
    vi.setSystemTime(1000);
    let fired = 0;
    scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 4, expiresAt: 2000, mode: 'soft',
      onFire: () => { fired++; },
    });
    // New timer replaces registry entry for the same session
    scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 5, expiresAt: 9000, mode: 'soft',
      onFire: () => { fired++; },
    });
    vi.advanceTimersByTime(10000);
    expect(fired).toBe(1); // only new revision fires
  });

  it('cancel prevents fire (fake clock)', () => {
    vi.setSystemTime(1000);
    let fired = false;
    const t = scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 1, expiresAt: 2000, mode: 'strict',
      onFire: () => { fired = true; },
    });
    t.cancel();
    vi.advanceTimersByTime(5000);
    expect(fired).toBe(false);
  });

  it('cancelSessionTimer prevents fire (fake clock)', () => {
    vi.setSystemTime(1000);
    let fired = false;
    scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 1, expiresAt: 2000, mode: 'strict',
      onFire: () => { fired = true; },
    });
    cancelSessionTimer('s1');
    vi.advanceTimersByTime(5000);
    expect(fired).toBe(false);
  });
});

describe('scheduleQuestionTimer (legacy real-timer group kept for regression)', () => {
  beforeEach(() => clearAllTimers());
  afterEach(() => clearAllTimers());

  it('fires callback when expiry reached (with fake short delay)', async () => {
    let fired = null;
    scheduleQuestionTimer({
      sessionId: 's1',
      questionId: 'q_01',
      revision: 5,
      expiresAt: Date.now() + 20,
      mode: 'soft',
      onFire: (f) => { fired = f; },
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toEqual({ sessionId: 's1', questionId: 'q_01', revision: 5, mode: 'soft' });
  });

  it('stale timer callback is no-op (superseded)', async () => {
    let fired = 0;
    const t1 = scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 4, expiresAt: Date.now() + 10, mode: 'soft',
      onFire: () => { fired++; },
    });
    // New timer for same session replaces the old registry entry
    scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 5, expiresAt: Date.now() + 50, mode: 'soft',
      onFire: () => { fired++; },
    });
    await new Promise((r) => setTimeout(r, 80));
    // old timer cancelled by new registration → only new fires
    expect(fired).toBe(1);
    t1.cancel();
  });

  it('cancel prevents fire', async () => {
    let fired = false;
    const t = scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 1, expiresAt: Date.now() + 10, mode: 'strict',
      onFire: () => { fired = true; },
    });
    t.cancel();
    await new Promise((r) => setTimeout(r, 30));
    expect(fired).toBe(false);
  });

  it('cancelSessionTimer prevents fire', async () => {
    let fired = false;
    scheduleQuestionTimer({
      sessionId: 's1', questionId: 'q_01', revision: 1, expiresAt: Date.now() + 10, mode: 'strict',
      onFire: () => { fired = true; },
    });
    cancelSessionTimer('s1');
    await new Promise((r) => setTimeout(r, 30));
    expect(fired).toBe(false);
  });
});
