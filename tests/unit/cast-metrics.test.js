import { describe, it, expect } from 'vitest';
import {
  buildMetric,
  withEvidenceGuard,
  guardedMetric,
  wilsonInterval,
  suppressTinySubgroup,
  summarizeMissingStatuses,
  itemDiscrimination,
  roundPercent,
  SMALL_SAMPLE_THRESHOLD,
  TINY_SUBGROUP_THRESHOLD,
  METRIC_STATUS,
} from '../../services/cast/metrics-service.js';
import {
  checkCompatibility,
  sideBySide,
  equatingStatus,
  longitudinalComparable,
  comparableFieldPaths,
} from '../../services/cast/comparison-service.js';
import { computeComparableFingerprint } from '../../services/cast/personal-progress-service.js';

const baseConfig = {
  timer: { mode: 'soft', defaultSeconds: 30 },
  scoring: { mode: 'accuracy', version: 'score_v2', correctBase: 1000, speedBonusMax: 0, scorePolicy: 'first_only' },
  playback: { advanceMode: 'manual', closeTrigger: ['host_or_soft_timeout'] },
  localization: { locale: 'uz-Latn', rtl: false },
  participation: { delivery: 'in_room' },
};

describe('C5-03: buildMetric', () => {
  it('numerator + denominator + integer percent (item 1, 2)', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 19, denominator: 24 });
    expect(m.numerator).toBe(19);
    expect(m.denominator).toBe(24);
    expect(m.percent).toBe(79); // 79.16 → 79
    expect(m.status).toBe(METRIC_STATUS.VALID_DESCRIPTIVE);
  });

  it('denominator 0 — percent null', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 0, denominator: 0 });
    expect(m.percent).toBeNull();
  });

  it('one_decimal policy', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 1, denominator: 3, rounding: 'one_decimal' });
    expect(m.percent).toBe(33.3);
  });

  it('roundPercent integer vs one_decimal', () => {
    expect(roundPercent(79.16)).toBe(79);
    expect(roundPercent(79.16, 'one_decimal')).toBe(79.2);
    expect(roundPercent(null)).toBeNull();
  });
});

describe('C5-03: withEvidenceGuard', () => {
  it('small sample → INSUFFICIENT_EVIDENCE, qiymat yo q', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 3, denominator: 4 });
    const g = withEvidenceGuard(m);
    expect(g.status).toBe(METRIC_STATUS.INSUFFICIENT_EVIDENCE);
    expect(g.percent).toBeNull();
    expect(SMALL_SAMPLE_THRESHOLD).toBe(6);
  });

  it('yetarli sample → VALID', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 7, denominator: 10 });
    expect(withEvidenceGuard(m).status).toBe(METRIC_STATUS.VALID_DESCRIPTIVE);
  });
});

describe('C5-03: guardedMetric (order-independent)', () => {
  it('denominator 0 -> INSUFFICIENT_EVIDENCE (TINY emas)', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 0, denominator: 0 });
    const g = guardedMetric(m);
    expect(g.status).toBe(METRIC_STATUS.INSUFFICIENT_EVIDENCE);
  });

  it('denominator 2 -> TINY_SUBGROUP', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 2, denominator: 2 });
    expect(guardedMetric(m).status).toBe(METRIC_STATUS.TINY_SUBGROUP);
  });

  it('denominator 8 -> VALID (evidence guard o tdi, tiny o tdi)', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 8, denominator: 8 });
    expect(guardedMetric(m).status).toBe(METRIC_STATUS.VALID_DESCRIPTIVE);
  });
});

describe('C5-03: wilsonInterval', () => {
  it('interval beradi (item 6)', () => {
    const i = wilsonInterval(19, 24);
    expect(i.low).toBeLessThan(i.high);
    expect(i.low).toBeGreaterThanOrEqual(0);
    expect(i.high).toBeLessThanOrEqual(100);
  });

  it('denominator 0 — null', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe('C5-03: suppressTinySubgroup', () => {
  it('tiny subgroup → TINY_SUBGROUP (item 16)', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 2, denominator: 2 });
    const s = suppressTinySubgroup(m);
    expect(s.status).toBe(METRIC_STATUS.TINY_SUBGROUP);
    expect(s.percent).toBeNull();
    expect(TINY_SUBGROUP_THRESHOLD).toBe(3);
  });

  it('katta subgroup → normal', () => {
    const m = buildMetric({ metric: 'accuracy', numerator: 8, denominator: 10 });
    expect(suppressTinySubgroup(m).status).toBe(METRIC_STATUS.VALID_DESCRIPTIVE);
  });

  it('null denominator (guard dan keyin) ham TINY deb hisoblanadi — order-independent', () => {
    const m = withEvidenceGuard(buildMetric({ metric: 'accuracy', numerator: 2, denominator: 2 }));
    const s = suppressTinySubgroup(m);
    expect(s.status).toBe(METRIC_STATUS.TINY_SUBGROUP);
  });
});

describe('C5-03: summarizeMissingStatuses', () => {
  it('har bir missing status alohida (item 3)', () => {
    const participants = {
      p1: { presence: 'online', delivery: 'in_room' }, // accepted
      p2: { presence: 'online', delivery: 'in_room' }, // no response
      p3: { late: true, presence: 'offline' }, // late join
      p4: { presence: 'offline' }, // disconnected
      p5: { delivery: 'remote', networkBucket: 'poor' }, // technical failure
      p6: { abstained: true }, // abstain
    };
    const answersByQuestion = { q1: { p1: { isCorrect: true, selectedOptionIds: ['a'] } } };
    const r = summarizeMissingStatuses({ participants, answersByQuestion });
    expect(r.counts.no_response).toBe(1);
    expect(r.counts.late_join).toBe(1);
    expect(r.counts.disconnected).toBe(1);
    expect(r.counts.technical_failure).toBe(1);
    expect(r.counts.abstain).toBe(1);
  });
});

describe('C5-03: itemDiscrimination', () => {
  it('small sample → INSUFFICIENT_EVIDENCE (item 4)', () => {
    const rows = [{ participantId: 'p1', score: 10, correct: true }];
    const d = itemDiscrimination({ rows });
    expect(d.status).toBe(METRIC_STATUS.INSUFFICIENT_EVIDENCE);
  });

  it('yetarli sample — index hisoblanadi', () => {
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const high = i < 6;
      rows.push({ participantId: `p${i}`, score: high ? 100 : 20, correct: high });
    }
    const d = itemDiscrimination({ rows });
    expect(d.status).toBe(METRIC_STATUS.VALID_DESCRIPTIVE);
    expect(d.index).toBeGreaterThan(0);
  });
});

describe('C5-03: checkCompatibility', () => {
  it('bir xil config — compatible, SIDE_BY_SIDE', () => {
    const c = checkCompatibility({ config: baseConfig }, { config: { ...baseConfig } });
    expect(c.compatible).toBe(true);
    expect(c.allowedViews).toContain('SIDE_BY_SIDE');
  });

  it('scoring.mode farqi — incompatible, direct delta blok (item 11)', () => {
    const b = { ...baseConfig, scoring: { ...baseConfig.scoring, mode: 'speed' } };
    const c = checkCompatibility({ config: baseConfig }, { config: b });
    expect(c.compatible).toBe(false);
    expect(c.differences).toContain('scoring.mode');
    expect(c.allowedViews).toEqual(['SEPARATE_REPORTS']);
  });

  it('timer farqi — incompatible', () => {
    const b = { ...baseConfig, timer: { ...baseConfig.timer, defaultSeconds: 60 } };
    const c = checkCompatibility({ config: baseConfig }, { config: b });
    expect(c.differences).toContain('timer.defaultSeconds');
  });

  it('delivery farqi — incompatible', () => {
    const b = { ...baseConfig, participation: { delivery: 'remote' } };
    const c = checkCompatibility({ config: baseConfig }, { config: b });
    expect(c.differences).toContain('participation.delivery');
  });

  it('locale farqi — incompatible', () => {
    const b = { ...baseConfig, localization: { locale: 'ru-Cyrl', rtl: false } };
    const c = checkCompatibility({ config: baseConfig }, { config: b });
    expect(c.differences).toContain('localization.locale');
  });
});

describe('C5-03: sideBySide', () => {
  it('faqat aggregate rows (item 12)', () => {
    const s = sideBySide(
      { accuracy: { percent: 79 }, accepted: 24, technicalFailures: 1 },
      { accuracy: { percent: 85 }, accepted: 20, technicalFailures: 0 }
    );
    expect(s.type).toBe('side_by_side');
    expect(s.rows).toHaveLength(3);
    expect(JSON.stringify(s)).not.toContain('participantId');
  });
});

describe('C5-03: equatingStatus', () => {
  it('different test form — equating off (item 13)', () => {
    const e = equatingStatus({ testVersionA: 'v1', testVersionB: 'v2' });
    expect(e.equating).toBe(false);
    expect(e.reason).toBe('DIFFERENT_TEST_FORM');
  });

  it('bir xil form — hali ham feature flag off', () => {
    const e = equatingStatus({ testVersionA: 'v1', testVersionB: 'v1' });
    expect(e.equating).toBe(false);
    expect(e.reason).toBe('FEATURE_FLAG_OFF');
  });
});

describe('C5-03: longitudinalComparable (item 15)', () => {
  it('bir xil fingerprint + coverage — comparable', () => {
    const fp = 'accuracy|score_v2|1000|0|false|soft|30|"manual"|["host_or_soft_timeout"]|in_room|uz-Latn';
    const r = longitudinalComparable({ fpA: fp, fpB: fp, coverageA: 0.8, coverageB: 0.9 });
    expect(r.comparable).toBe(true);
  });

  it('low coverage — not comparable', () => {
    const fp = 'x';
    const r = longitudinalComparable({ fpA: fp, fpB: fp, coverageA: 0.1, coverageB: 0.9 });
    expect(r.comparable).toBe(false);
    expect(r.reason).toBe('LOW_COVERAGE');
  });
});

describe('C5-03: computeComparableFingerprint (extended)', () => {
  it('delivery/locale/reveal o zgarishi fingerprint ni o zgartiradi', () => {
    const a = computeComparableFingerprint(baseConfig);
    const b = computeComparableFingerprint({ ...baseConfig, participation: { delivery: 'remote' } });
    expect(a).not.toBe(b);
  });
});

describe('C5-03: comparableFieldPaths', () => {
  it('test version, timer, scoring, reveal, locale, delivery', () => {
    const paths = comparableFieldPaths(baseConfig);
    expect(paths).toContain('timer.defaultSeconds');
    expect(paths).toContain('scoring.mode');
    expect(paths).toContain('playback.advanceMode');
    expect(paths).toContain('localization.locale');
    expect(paths).toContain('participation.delivery');
  });
});
