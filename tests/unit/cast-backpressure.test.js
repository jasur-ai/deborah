import { describe, it, expect } from 'vitest';
import {
  EVENT_PRIORITY,
  DEFAULT_THRESHOLDS,
  classifyPriority,
  degradationLevel,
  shouldThrottleAggregate,
  shouldDrop,
  shouldQueueAdmission,
  backpressureSnapshot,
  staticLeaderboardFallback,
  degradationAuditEvent,
} from '../../services/cast/backpressure.js';

describe('C5-07: EVENT_PRIORITY enum (item 1)', () => {
  it('P0 < P1 < P2 < P3 (raqamli tartib)', () => {
    expect(EVENT_PRIORITY.P0).toBeLessThan(EVENT_PRIORITY.P1);
    expect(EVENT_PRIORITY.P1).toBeLessThan(EVENT_PRIORITY.P2);
    expect(EVENT_PRIORITY.P2).toBeLessThan(EVENT_PRIORITY.P3);
  });

  it('classifyPriority — answer/host → P0 (hech qachon drop emas)', () => {
    expect(classifyPriority('cast:answerSubmit')).toBe(EVENT_PRIORITY.P0);
    expect(classifyPriority('cast:questionClose')).toBe(EVENT_PRIORITY.P0);
    expect(classifyPriority('cast:sessionEnd')).toBe(EVENT_PRIORITY.P0);
    expect(classifyPriority('cast:misconceptionDecision')).toBe(EVENT_PRIORITY.P0);
  });

  it('classifyPriority — state/recovery → P1, analytics → P3', () => {
    expect(classifyPriority('cast:getSnapshot')).toBe(EVENT_PRIORITY.P1);
    expect(classifyPriority('cast:rejoin')).toBe(EVENT_PRIORITY.P1);
    expect(classifyPriority('cast:analyticsEvent')).toBe(EVENT_PRIORITY.P3);
    expect(classifyPriority('cast:animation')).toBe(EVENT_PRIORITY.P3);
  });

  it('classifyPriority — default → P2', () => {
    expect(classifyPriority('cast:whateverElse')).toBe(EVENT_PRIORITY.P2);
  });
});

describe('C5-07: degradationLevel (item 2/3/4/5)', () => {
  it('normal — past queue/lag', () => {
    expect(degradationLevel({ queueDepth: 10, lagMs: 50 })).toBe('normal');
  });

  it('degraded1 — T1 threshold', () => {
    expect(degradationLevel({ queueDepth: DEFAULT_THRESHOLDS.queueDepthT1 + 1, lagMs: 0 })).toBe('degraded1');
    expect(degradationLevel({ queueDepth: 0, lagMs: DEFAULT_THRESHOLDS.lagMsT1 + 10 })).toBe('degraded1');
  });

  it('degraded2 — T2 threshold', () => {
    expect(degradationLevel({ queueDepth: DEFAULT_THRESHOLDS.queueDepthT2 + 1, lagMs: 0 })).toBe('degraded2');
  });

  it('admission_queue — T3 threshold', () => {
    expect(degradationLevel({ queueDepth: DEFAULT_THRESHOLDS.queueDepthT3 + 1, lagMs: 0 })).toBe('admission_queue');
  });
});

describe('C5-07: shouldThrottleAggregate (item 3)', () => {
  it('degraded1 — P2 aggregate throttle, P0/P1 ta sir yo q', () => {
    expect(shouldThrottleAggregate('degraded1', EVENT_PRIORITY.P2)).toBe(true);
    expect(shouldThrottleAggregate('degraded1', EVENT_PRIORITY.P0)).toBe(false);
    expect(shouldThrottleAggregate('degraded1', EVENT_PRIORITY.P1)).toBe(false);
  });

  it('degraded2/admission — hammasi throttle', () => {
    expect(shouldThrottleAggregate('degraded2')).toBe(true);
    expect(shouldThrottleAggregate('admission_queue')).toBe(true);
  });
});

describe('C5-07: shouldDrop — P3 only (item 4/6)', () => {
  it('degraded2 — faqat P3 drop qilinadi, P0/P1/P2 EMAS', () => {
    expect(shouldDrop('degraded2', EVENT_PRIORITY.P3)).toBe(true);
    expect(shouldDrop('degraded2', EVENT_PRIORITY.P2)).toBe(false);
    expect(shouldDrop('degraded2', EVENT_PRIORITY.P1)).toBe(false);
    expect(shouldDrop('degraded2', EVENT_PRIORITY.P0)).toBe(false); // accepted answer drop qilinmaydi
  });

  it('normal/degraded1 — P3 ham drop qilinmaydi', () => {
    expect(shouldDrop('normal', EVENT_PRIORITY.P3)).toBe(false);
    expect(shouldDrop('degraded1', EVENT_PRIORITY.P3)).toBe(false);
  });
});

describe('C5-07: admission gate (item 5)', () => {
  it('admission_queue + katta lobby → queue', () => {
    expect(shouldQueueAdmission('admission_queue', 50)).toBe(true);
  });

  it('admission_queue + kichik lobby → o tadi', () => {
    expect(shouldQueueAdmission('admission_queue', 10)).toBe(false);
  });

  it('normal rejimda hech qachon queue qilinmaydi', () => {
    expect(shouldQueueAdmission('normal', 500)).toBe(false);
  });
});

describe('C5-07: backpressureSnapshot (item 10/11)', () => {
  it('snapshot shakli + at timestamp', () => {
    const s = backpressureSnapshot({ queueDepth: 5, lagMs: 10 });
    expect(s.level).toBe('normal');
    expect(s.droppingP3).toBe(false);
    expect(s.throttlingAggregates).toBe(false);
    expect(s.admissionQueued).toBe(false);
    expect(s.at).toBeTypeOf('number');
  });
});

describe('C5-07: staticLeaderboardFallback (item 8)', () => {
  it('live bo lmasa stale snapshot qaytaradi', () => {
    const f = staticLeaderboardFallback({ live: false, lastSnapshot: { entries: [{ rank: 1 }], hiddenCount: 2 } });
    expect(f.stale).toBe(true);
    expect(f.entries).toHaveLength(1);
  });

  it('snapshot yo q bo lsa bo sh', () => {
    const f = staticLeaderboardFallback({});
    expect(f.entries).toEqual([]);
    expect(f.stale).toBe(true);
  });
});

describe('C5-07: degradationAuditEvent (item 12)', () => {
  it('safe audit — identity/raw yo q', () => {
    const e = degradationAuditEvent({ sessionId: null, action: 'start', level: 'degraded2', metrics: { queueDepth: 450, droppedP3: 3 } });
    expect(e.type).toBe('cast:degradation:start');
    expect(e.level).toBe('degraded2');
    expect(e.safe).toBe(true);
    expect(e.droppedP3).toBe(3);
    expect(e.participantId).toBeUndefined();
    expect(e.rawText).toBeUndefined();
  });
});
