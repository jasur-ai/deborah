import { describe, it, expect, vi } from 'vitest';
import {
  validateAnalyticsEvent,
  buildAnalyticsEvent,
  AnalyticsBuffer,
  safeEmit,
  summarizeProductMetrics,
  dedupeEvents,
  ANALYTICS_EVENTS,
  ANALYTICS_CATEGORIES,
  EVENT_CATEGORY_MAP,
  ANALYTICS_ALLOWED_KEYS,
  ANALYTICS_RETENTION_CLASS,
} from '../../services/cast/analytics.js';

function validEvent(overrides = {}) {
  return {
    type: ANALYTICS_EVENTS.JOINED,
    sessionId: 'cast_1',
    at: 1780000000000,
    ...overrides,
  };
}

describe('C5-04: validateAnalyticsEvent', () => {
  it('valid event — ok', () => {
    const r = validateAnalyticsEvent(validEvent({ latencyMs: 40, delivery: 'in_room' }));
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('noma lum type — reject', () => {
    const r = validateAnalyticsEvent(validEvent({ type: 'whatever_event' }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('UNKNOWN_EVENT_TYPE') || e.includes('UNKNOWN'))).toBe(true);
  });

  it('sessionId yo q — reject', () => {
    const r = validateAnalyticsEvent({ type: ANALYTICS_EVENTS.JOINED, at: 1 });
    expect(r.ok).toBe(false);
  });
});

describe('C5-04: PII fixture rejection (item 8)', () => {
  it('full name / email / phone rad etiladi', () => {
    const r = validateAnalyticsEvent(validEvent({ fullName: 'Ali Valiyev', email: 'a@b.com' }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('DISALLOWED_KEY'))).toBe(true);
  });

  it('answer key fixture rad etiladi', () => {
    const r = validateAnalyticsEvent(validEvent({ answerKey: ['a', 'b'] }));
    expect(r.ok).toBe(false);
  });

  it('raw open text / storedText rad etiladi', () => {
    const r = validateAnalyticsEvent(validEvent({ rawText: 'Formulani notogri qolladi' }));
    expect(r.ok).toBe(false);
  });

  it('token / password rad etiladi', () => {
    const r = validateAnalyticsEvent(validEvent({ token: 'abc123', password: 'x' }));
    expect(r.ok).toBe(false);
  });

  it('selectedOptionIds rad etiladi (raw academic response)', () => {
    const r = validateAnalyticsEvent(validEvent({ selectedOptionIds: ['a', 'b'] }));
    expect(r.ok).toBe(false);
    // Tugallanish sharti: raw academic response telemetry pipeline'ga kirmaydi
  });
});

describe('C5-04: buildAnalyticsEvent (item 7)', () => {
  it('pseudonymous + latency bucket, raw latency emas', () => {
    const ev = buildAnalyticsEvent({
      type: ANALYTICS_EVENTS.SUBMITTED,
      sessionId: 'cast_1',
      meta: { actorKey: 'p_abc123', latencyMs: 40 },
      network: { latencyMs: 350, sampleCount: 5 },
    });
    expect(ev.actorKey).toBe('p_abc123');
    expect(ev.bucket).toBeDefined(); // poor/good bucket
    expect(ev.latencyMs).toBe(40); // meta'dagi latency allowed
    expect(ev.retentionClass).toBe(ANALYTICS_RETENTION_CLASS);
    expect(ev.version).toBe('analytics_v1');
  });

  it('allowed bo lmagan meta keylar tushib qoladi', () => {
    const ev = buildAnalyticsEvent({
      type: ANALYTICS_EVENTS.JOINED,
      sessionId: 'cast_1',
      meta: { fullName: 'Ali', questionId: 'q1' },
    });
    expect(ev.questionId).toBe('q1');
    expect(ev.fullName).toBeUndefined();
  });
});

describe('C5-04: AnalyticsBuffer (item 13)', () => {
  it('buffer to lsa — drop + safe metric (crash emas)', () => {
    const buf = new AnalyticsBuffer({ maxSize: 2 });
    buf.push({ a: 1 });
    buf.push({ a: 2 });
    const r = buf.push({ a: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('BUFFER_FULL');
    expect(buf.stats().dropped).toBe(1);
    expect(buf.stats().accepted).toBe(2);
  });

  it('drain tozalaydi', () => {
    const buf = new AnalyticsBuffer();
    buf.push({ a: 1 });
    expect(buf.drain()).toHaveLength(1);
    expect(buf.size()).toBe(0);
  });
});

describe('C5-04: safeEmit', () => {
  it('invalid event — drop, provider chaqirilmaydi', async () => {
    const buf = new AnalyticsBuffer();
    const provider = vi.fn();
    const r = await safeEmit(buf, { type: 'bad', sessionId: 'cast_1' }, provider);
    expect(r.ok).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });

  it('provider throw — buffer/drop, live ta sir yo q (throw emas)', async () => {
    const buf = new AnalyticsBuffer();
    const provider = vi.fn().mockRejectedValue(new Error('provider down'));
    const r = await safeEmit(buf, validEvent(), provider);
    expect(r.ok).toBe(true); // buffer'ga tushdi
    expect(buf.size()).toBe(1);
  });

  it('provider mavjud — to gridan yuboradi', async () => {
    const buf = new AnalyticsBuffer();
    const provider = vi.fn().mockResolvedValue({});
    const r = await safeEmit(buf, validEvent(), provider);
    expect(r.ok).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('C5-04: summarizeProductMetrics (item 11)', () => {
  it('aggregate metrics — teacher ranking YO Q (item 12)', () => {
    const events = [
      validEvent({ type: ANALYTICS_EVENTS.VALIDATED, at: 1 }),
      validEvent({ type: ANALYTICS_EVENTS.CREATED, at: 2, setupMs: 1200 }),
      validEvent({ type: ANALYTICS_EVENTS.JOINED, at: 3, joinMs: 300 }),
      validEvent({ type: ANALYTICS_EVENTS.SUBMITTED, at: 4, ackMs: 80 }),
      validEvent({ type: ANALYTICS_EVENTS.SUBMITTED, at: 5, ackMs: 120 }),
      validEvent({ type: ANALYTICS_EVENTS.STATE_RECOVERED, at: 6 }),
      validEvent({ type: ANALYTICS_EVENTS.MISCONCEPTION, at: 7 }),
    ];
    const s = summarizeProductMetrics(events);
    expect(s.eventCount).toBe(7);
    expect(s.launchSuccessPercent).toBe(100);
    expect(s.joinLatencyAvgMs).toBe(300);
    expect(s.ackP95Ms).toBe(120); // 2 ta: 80, 120 → p95 = 120
    expect(s.recoveryCount).toBe(1);
    expect(s.teacherActionCount).toBe(1);
    expect(s.rankingMetricAvailable).toBe(false); // item 12
  });

  it('invalid eventlar dashboard hisobiga kirmaydi', () => {
    const events = [validEvent(), { type: 'bad', sessionId: 'x' }, { fullName: 'Ali' }];
    const s = summarizeProductMetrics(events);
    expect(s.eventCount).toBe(1);
  });
});

describe('C5-04: dedupeEvents', () => {
  it('eventId bo yicha dedupe', () => {
    const events = [
      { ...validEvent(), eventId: 'e1' },
      { ...validEvent(), eventId: 'e1' },
      { ...validEvent(), eventId: 'e2' },
    ];
    expect(dedupeEvents(events)).toHaveLength(2);
  });
});

describe('C5-04: taxonomy', () => {
  // Reja: setup(7) + lobby(6) + question(9) + pedagogic(9) + recovery(6) = 37 event
  it('5 category + 37 event', () => {
    expect(Object.keys(ANALYTICS_CATEGORIES)).toHaveLength(5);
    expect(Object.keys(ANALYTICS_EVENTS)).toHaveLength(37);
  });

  it('har event category ga tushadi (value-lar orqali)', () => {
    for (const value of Object.values(ANALYTICS_EVENTS)) {
      expect(EVENT_CATEGORY_MAP[value], value).toBeDefined();
    }
    // Har category'da kamida bitta event bor
    for (const cat of Object.values(ANALYTICS_CATEGORIES)) {
      expect(Object.values(EVENT_CATEGORY_MAP).includes(cat), cat).toBe(true);
    }
  });

  it('barcha 37 event value lari UNIQ (MAP overwrite yo q)', () => {
    const values = Object.values(ANALYTICS_EVENTS);
    expect(new Set(values).size).toBe(values.length);
    expect(Object.keys(EVENT_CATEGORY_MAP)).toHaveLength(values.length);
  });

  it('MAP har bir event uchun TO G RI category beradi', () => {
    expect(EVENT_CATEGORY_MAP[ANALYTICS_EVENTS.LOCKED]).toBe('lobby');
    expect(EVENT_CATEGORY_MAP[ANALYTICS_EVENTS.LOCKED_Q]).toBe('question');
  });
});

describe('C5-04: teacherActionCount NaN guard', () => {
  it('misconception event bo lmasa ham NaN bo lmaydi', () => {
    const events = [
      validEvent({ type: ANALYTICS_EVENTS.JOINED, at: 1 }),
      validEvent({ type: ANALYTICS_EVENTS.HINT, at: 2 }),
    ];
    const s = summarizeProductMetrics(events);
    expect(Number.isNaN(s.teacherActionCount)).toBe(false);
    expect(s.teacherActionCount).toBe(1);
  });

  it('umuman pedagogic event bo lmasa 0', () => {
    const s = summarizeProductMetrics([validEvent({ at: 1 })]);
    expect(Number.isNaN(s.teacherActionCount)).toBe(false);
    expect(s.teacherActionCount).toBe(0);
  });
});
