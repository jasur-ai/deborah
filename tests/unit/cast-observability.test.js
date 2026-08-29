// ── C5-08 Observability: telemetry + support bundle ──
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RingBuffer,
  sanitizeLog,
  redactFreeText,
  isSensitiveKey,
  teacherHealthStatus,
  TEACHER_HEALTH,
  parseTraceparent,
  traceFromCommand,
  newTraceContext,
  buildLogEntry,
  castTelemetrySnapshot,
  recordAckTiming,
  incCounter,
  resetCastTelemetry,
  ACK_BUCKETS,
} from '../../services/cast/telemetry.js';
import {
  classifySev,
  SEV_LEVELS,
  safeEventSummary,
  buildSupportBundle,
  assertBundleSafe,
  isBundleExpired,
  BUNDLE_TTL_MS,
} from '../../services/cast/support-bundle.js';
import { isFeatureEnabled, setCastSwitch, resetCastSwitches, allCastSwitches, NON_KILLABLE } from '../../services/cast/feature-switches.js';

describe('C5-08: RingBuffer percentiles', () => {
  it('returns null when empty', () => {
    const rb = new RingBuffer(10);
    expect(rb.p50()).toBeNull();
    expect(rb.p99()).toBeNull();
  });

  it('computes p50/p95/p99 from samples', () => {
    const rb = new RingBuffer(100);
    for (let i = 1; i <= 100; i += 1) rb.push(i);
    expect(rb.p50()).toBeGreaterThanOrEqual(49);
    expect(rb.p50()).toBeLessThanOrEqual(51);
    expect(rb.p95()).toBeGreaterThanOrEqual(94);
    expect(rb.p99()).toBeGreaterThanOrEqual(98);
  });

  it('evicts oldest when over capacity', () => {
    // Min capacity 16 (konstruktor clampi) — 20 ta push qilamiz
    const rb = new RingBuffer(16);
    for (let i = 1; i <= 20; i += 1) rb.push(i);
    expect(rb.size).toBe(16);
    expect(rb.percentile(100)).toBe(20); // eng kattasi saqlanadi
    expect(rb.values().includes(1)).toBe(false); // eng eskisi evict qilindi
  });

  it('ignores non-finite values', () => {
    const rb = new RingBuffer(10);
    rb.push(NaN);
    rb.push(Infinity);
    rb.push(42);
    expect(rb.size).toBe(1);
    expect(rb.p50()).toBe(42);
  });
});

describe('C5-08: Log sanitizer', () => {
  it('redacts answer key / raw content / tokens / PII keys', () => {
    const sanitized = sanitizeLog({
      questionId: 'q1',
      answerKey: 'A',
      correctOption: 2,
      rawResponse: 'long essay content',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      studentName: 'Ali',
      email: 'ali@x.com',
      count: 42,
      url: '/play?code=ABC',
    });
    expect(sanitized.questionId).toBe('q1');
    expect(sanitized.answerKey).toBe('[REDACTED]');
    expect(sanitized.correctOption).toBe('[REDACTED]');
    expect(sanitized.rawResponse).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.studentName).toBe('[REDACTED]');
    expect(sanitized.email).toBe('[REDACTED]');
    expect(sanitized.url).toBe('[REDACTED]');
    expect(sanitized.count).toBe(42);
  });

  it('redacts token-like long strings in values', () => {
    expect(sanitizeLog('abc123abc123abc123abc123abc123abc123abc123abc12')).toBe('[REDACTED]');
  });

  it('isSensitiveKey catches exam-security and PII patterns', () => {
    expect(isSensitiveKey('q_correct')).toBe(true);
    expect(isSensitiveKey('answer_key')).toBe(true);
    expect(isSensitiveKey('submission_text')).toBe(true);
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('full_name')).toBe(true);
    expect(isSensitiveKey('safeKey')).toBe(false);
    expect(isSensitiveKey('revision')).toBe(false);
  });

  it('redactFreeText masks free text but keeps length hint', () => {
    expect(redactFreeText('  ')).toBe('  ');
    expect(redactFreeText('hello world')).toBe('[REDACTED:11ch]');
    expect(redactFreeText(42)).toBe(42);
  });

  it('buildLogEntry produces schema-conform sanitized entry', () => {
    const entry = buildLogEntry({ msg: 'test', command: 'cast:answer', sessionId: 's1', meta: { correct: 0 } });
    expect(entry.scope).toBe('cast');
    expect(entry.v).toBe(1);
    expect(entry.traceId).toBeNull();
    expect(entry.meta.correct).toBe('[REDACTED]');
  });
});

describe('C5-08: Teacher health map', () => {
  it('maps normal → Barqaror', () => {
    expect(teacherHealthStatus({})).toBe(TEACHER_HEALTH.STABLE);
  });
  it('maps degraded2 → Kechikish yuqori', () => {
    expect(teacherHealthStatus({ backpressureLevel: 'degraded2' })).toBe(TEACHER_HEALTH.HIGH_LATENCY);
    expect(teacherHealthStatus({ backpressureLevel: 'admission_queue' })).toBe(TEACHER_HEALTH.HIGH_LATENCY);
  });
  it('maps high lag → Kechikish yuqori', () => {
    expect(teacherHealthStatus({ lagMs: 1500 })).toBe(TEACHER_HEALTH.HIGH_LATENCY);
  });
  it('maps medium lag → Tiklanmoqda', () => {
    expect(teacherHealthStatus({ lagMs: 500 })).toBe(TEACHER_HEALTH.RECOVERING);
  });
  it('recovering flag wins', () => {
    expect(teacherHealthStatus({ recovering: true, backpressureLevel: 'normal' })).toBe(TEACHER_HEALTH.RECOVERING);
  });
});

describe('C5-08: Trace / correlation ID', () => {
  it('parses valid W3C traceparent', () => {
    const t = parseTraceparent('00-0123456789abcdef0123456789abcdef-0123456789abcdef-01');
    expect(t.traceId).toBe('0123456789abcdef0123456789abcdef');
    expect(t.sampled).toBe(true);
  });
  it('rejects malformed traceparent', () => {
    expect(parseTraceparent('nope')).toBeNull();
  });
  it('extracts trace from command envelope', () => {
    const t = traceFromCommand({ traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00' });
    expect(t.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
  it('creates a fresh root context when absent', () => {
    const t = traceFromCommand({});
    expect(t.traceId).toHaveLength(32);
    expect(t.traceparent).toContain(t.traceId);
  });
  it('newTraceContext is unique per call', () => {
    expect(newTraceContext().traceId).not.toBe(newTraceContext().traceId);
  });
});

describe('C5-08: SEV classification', () => {
  it('SEV-0 for answer-key exposure', () => {
    expect(classifySev({ answerKeyExposure: true })).toBe(SEV_LEVELS.SEV0);
  });
  it('SEV-1 for full disconnect / region / cdn', () => {
    expect(classifySev({ allParticipantsDisconnected: true })).toBe(SEV_LEVELS.SEV1);
    expect(classifySev({ regionOutage: true })).toBe(SEV_LEVELS.SEV1);
  });
  it('SEV-2 for redis / db / ack spike', () => {
    expect(classifySev({ redisOutage: true })).toBe(SEV_LEVELS.SEV2);
    expect(classifySev({ dbFailure: true })).toBe(SEV_LEVELS.SEV2);
    expect(classifySev({ ackSpike: true })).toBe(SEV_LEVELS.SEV2);
  });
  it('SEV-3 default / minor', () => {
    expect(classifySev({ wrongReveal: true })).toBe(SEV_LEVELS.SEV3);
    expect(classifySev({})).toBe(SEV_LEVELS.SEV3);
  });
});

describe('C5-08: Safe event summary', () => {
  it('keeps only revision/type/at, redacts free text', () => {
    const out = safeEventSummary([
      { revision: 1, type: 'question:open', at: 1000 },
      { revision: 2, type: 'answer:submit', at: 2000, payload: { correct: 0, raw: 'secret' }, summary: 'bu javob' },
    ]);
    expect(out[0].type).toBe('question:open');
    expect(out[0].revision).toBe(1);
    // payload hech qachon chiqmaydi
    expect(out[1].payload).toBeUndefined();
    expect(out[1].summary).toContain('REDACTED');
  });
});

describe('C5-08: Support bundle safety contract', () => {
  beforeEach(() => {
    resetCastTelemetry();
  });

  it('builds a PII-safe bundle with fingerprint + expiry', async () => {
    const config = { schemaVersion: 1, preset: { id: 'base', version: 1 }, scoring: { basePoints: 1 } };
    const bundle = await buildSupportBundle({
      sessionId: 's_test',
      config,
      events: [{ revision: 1, type: 'question:open', at: Date.now() }],
      client: { browser: 'Chrome 120', device: 'desktop' },
      runtime: { latencyMs: 25, lagMs: 5, backpressureLevel: 'normal', reconnectCount: 1, failedRequestIds: ['req_1'] },
    });
    expect(bundle.version).toBe('cast_bundle_v1');
    expect(bundle.bundleId).toMatch(/^bnd_/);
    expect(bundle.config.fingerprint).toMatch(/^sha256:/);
    expect(bundle.expiresAt - bundle.createdAt).toBe(BUNDLE_TTL_MS);
    expect(bundle.client.browser).toBe('Chrome 120');
    expect(bundle.events.length).toBe(1);
    // Tugallanish sharti: raw/answer/token/roster yo'q
    expect(bundle.safetyDeclaration.containsAnswerKey).toBe(false);
    expect(bundle.safetyDeclaration.containsRoster).toBe(false);
  });

  it('assertBundleSafe passes on clean bundle', async () => {
    const bundle = await buildSupportBundle({ sessionId: 's_clean', events: [{ revision: 1, type: 'ping', at: 1 }] });
    expect(assertBundleSafe(bundle)).toBe(true);
  });

  it('assertBundleSafe throws on sensitive content', () => {
    expect(() => assertBundleSafe({ rawResponse: 'essay', token: 'abc' })).toThrow(/UNSAFE_BUNDLE/);
    expect(() => assertBundleSafe({ participant: { name: 'Ali' } })).toThrow(/UNSAFE_BUNDLE/);
    expect(() => assertBundleSafe({ answerKey: 'A' })).toThrow(/UNSAFE_BUNDLE/);
  });

  it('isBundleExpired respects TTL', async () => {
    const bundle = await buildSupportBundle({ sessionId: 's_exp' });
    expect(isBundleExpired(bundle)).toBe(false);
    expect(isBundleExpired(bundle, bundle.expiresAt + 1)).toBe(true);
    expect(isBundleExpired(null)).toBe(true);
  });
});

describe('C5-08: Feature kill switches', () => {
  beforeEach(() => {
    resetCastSwitches();
    delete process.env.CAST_FEATURE_POE;
    delete process.env.CAST_FEATURE_SUPPORTBUNDLE;
  });

  it('defaults enabled', () => {
    expect(isFeatureEnabled('poe')).toBe(true);
    expect(isFeatureEnabled('supportBundle')).toBe(true);
  });

  it('runtime override off', () => {
    setCastSwitch('poe', false);
    expect(isFeatureEnabled('poe')).toBe(false);
    setCastSwitch('poe', true);
    expect(isFeatureEnabled('poe')).toBe(true);
  });

  it('env override off', () => {
    process.env.CAST_FEATURE_POE = 'off';
    expect(isFeatureEnabled('poe')).toBe(false);
    process.env.CAST_FEATURE_POE = '1';
    expect(isFeatureEnabled('poe')).toBe(true);
  });

  it('unknown switch defaults to enabled (fail-open UX)', () => {
    expect(isFeatureEnabled('somethingElse')).toBe(true);
  });

  it('non-killable ground-truth features are listed', () => {
    expect(NON_KILLABLE).toContain('answer');
    expect(NON_KILLABLE).toContain('session');
  });

  it('allCastSwitches returns states', () => {
    const s = allCastSwitches();
    expect(s.poe).toBe(true);
    expect(typeof s.moderation).toBe('boolean');
  });
});

describe('C5-08: ACK timing metrics', () => {
  beforeEach(() => {
    resetCastTelemetry();
  });

  it('records answer ACK into answer bucket', () => {
    recordAckTiming('answer', 25);
    recordAckTiming('answer', 50);
    recordAckTiming('answer', 75);
    expect(ACK_BUCKETS.answer.size).toBe(3);
    expect(ACK_BUCKETS.answer.p50()).toBe(50);
  });

  it('snapshot exposes counters + teacher health', () => {
    incCounter('connections', 5);
    const snap = castTelemetrySnapshot({ bpLevel: 'degraded2', lagMs: 1200 });
    expect(snap.counters.connections).toBe(5);
    expect(snap.health.teacher).toBe(TEACHER_HEALTH.HIGH_LATENCY);
    expect(snap.scope).toBe('cast');
  });

  it('resetCastTelemetry clears counters and buckets', () => {
    incCounter('connections', 5);
    recordAckTiming('host', 10);
    resetCastTelemetry();
    expect(ACK_BUCKETS.host.size).toBe(0);
    expect(castTelemetrySnapshot({}).counters.connections).toBe(0);
  });
});
