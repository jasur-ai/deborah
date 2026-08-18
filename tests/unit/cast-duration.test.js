import { describe, it, expect } from 'vitest';
import { estimateDuration } from '../../services/cast/duration-estimator.js';

const softConfig = {
  timer: { mode: 'soft', defaultSeconds: 30 },
  playback: { thinkSeconds: 5 },
  leaderboard: { frequency: 'end_only' },
  teams: { enabled: false },
};

describe('estimateDuration', () => {
  it('estimates for 20 questions soft timer', () => {
    const d = estimateDuration({ config: softConfig, questionCount: 20 });
    expect(d.minimumSeconds).toBeLessThan(d.expectedSeconds);
    expect(d.expectedSeconds).toBeLessThan(d.maximumSeconds);
    expect(d.label).toMatch(/Taxminan \d+–\d+ daqiqa/);
  });

  it('off timer produces wider range (host-controlled)', () => {
    const off = estimateDuration({
      config: { ...softConfig, timer: { mode: 'off', defaultSeconds: 30 } },
      questionCount: 10,
    });
    const soft = estimateDuration({ config: softConfig, questionCount: 10 });
    // off mode per-question max much larger
    expect(off.maximumSeconds).toBeGreaterThan(soft.maximumSeconds);
  });

  it('every_question leaderboard adds time', () => {
    const every = estimateDuration({
      config: { ...softConfig, leaderboard: { frequency: 'every_question' } },
      questionCount: 5,
    });
    const end = estimateDuration({ config: softConfig, questionCount: 5 });
    expect(every.expectedSeconds).toBeGreaterThan(end.expectedSeconds);
  });

  it('team mode adds discussion time', () => {
    const team = estimateDuration({
      config: { ...softConfig, teams: { enabled: true } },
      questionCount: 5,
    });
    const solo = estimateDuration({ config: softConfig, questionCount: 5 });
    expect(team.expectedSeconds).toBeGreaterThan(solo.expectedSeconds);
  });

  it('zero questions → small estimate, no crash', () => {
    const d = estimateDuration({ config: softConfig, questionCount: 0 });
    expect(d.minimumSeconds).toBeGreaterThanOrEqual(0);
  });
});
