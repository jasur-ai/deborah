import { describe, it, expect, vi } from 'vitest';
import {
  payloadBytes,
  checkSocketPayload,
  answerMinimalFields,
  createCoalescer,
  distributionSnapshot,
  batchLeaderboard,
  bundleBudgetReport,
  MAX_SOCKET_PAYLOAD_BYTES,
  BUDGET_CRITICAL_BYTES,
  BUDGET_BACKGROUND_BYTES,
  DIRECTOR_COALESCE_MS,
} from '../../services/cast/payload-service.js';

describe('C5-05: payloadBytes / checkSocketPayload (item 8)', () => {
  it('JSON payload bayt hisoblanadi', () => {
    const b = payloadBytes({ a: 1, b: 'hello' });
    expect(b).toBe(Buffer.byteLength(JSON.stringify({ a: 1, b: 'hello' }), 'utf8'));
    expect(b).toBeGreaterThan(0);
  });

  it('socket payload limit — kichik ok, katta reject', () => {
    expect(checkSocketPayload({ ok: true, n: 1 }).ok).toBe(true);
    const big = { data: 'x'.repeat(MAX_SOCKET_PAYLOAD_BYTES + 100) };
    const r = checkSocketPayload(big);
    expect(r.ok).toBe(false);
    expect(r.sizeBytes).toBeGreaterThan(r.limitBytes);
  });
});

describe('C5-05: answerMinimalFields (item 9)', () => {
  it('faqat zarur scalar fieldlar — raw qo shimcha metadata chiqmaydi', () => {
    const out = answerMinimalFields({
      participantId: 'p1',
      questionId: 'q1',
      attemptNo: 1,
      correct: true,
      score: 5,
      answeredAt: 123,
      // chiqmasligi kerak:
      selectedOptionIds: ['a', 'b'],
      rawText: 'secret',
      clientMeta: { x: 1 },
    });
    expect(out.participantId).toBe('p1');
    expect(out.correct).toBe(true);
    expect(out.selectedOptionIds).toBeUndefined();
    expect(out.rawText).toBeUndefined();
    expect(out.clientMeta).toBeUndefined();
  });

  it('bo sh yozuv safe', () => {
    const out = answerMinimalFields({});
    expect(out.score).toBeNull();
    expect(out.answeredAt).toBeNull();
  });
});

describe('C5-05: createCoalescer (item 10/11)', () => {
  it('interval ichida faqat oxirgi count yuboriladi', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const c = createCoalescer(emit, DIRECTOR_COALESCE_MS);
    c.push({ answered: 1, total: 10 });
    c.push({ answered: 2, total: 10 });
    c.push({ answered: 3, total: 10 });
    await new Promise((r) => setTimeout(r, DIRECTOR_COALESCE_MS + 40));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].answered).toBe(3); // oxirgisi
    c.stop();
  });

  it('flush qolgan countni darhol yuboradi', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const c = createCoalescer(emit, 1000);
    c.push({ answered: 7, total: 10 });
    await c.flush();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].answered).toBe(7);
    c.stop();
  });

  it('stop hech narsa yubormaydi', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const c = createCoalescer(emit, 1000);
    c.push({ answered: 1, total: 2 });
    c.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(emit).not.toHaveBeenCalled();
  });

  it('flush paytida push kelsa — qolgan qiymat re-schedule bo ladi (liveness)', async () => {
    // emitFn birinchi chaqiruvda sekin (40ms) — shu paytda yangi push keladi
    let calls = 0;
    const emit = vi.fn(async () => {
      calls++;
      if (calls === 1) await new Promise((r) => setTimeout(r, 40));
    });
    const c = createCoalescer(emit, 30);
    c.push({ answered: 1, total: 5 });
    // timer 30ms da ishga tushadi, emit 40ms davom etadi → 30-70ms flush payti
    await new Promise((r) => setTimeout(r, 45)); // flush davom etmoqda
    c.push({ answered: 2, total: 5 }); // flush paytida keladi → re-schedule kerak
    await new Promise((r) => setTimeout(r, 120));
    expect(emit).toHaveBeenCalledTimes(2); // ikkinchisi re-schedule orqali ham chiqdi
    expect(emit.mock.calls[1][0].answered).toBe(2);
    c.stop();
  });
});

describe('C5-05: distributionSnapshot (item 12)', () => {
  it('evidence distribution dan snapshot oladi', () => {
    const snap = distributionSnapshot({
      questionId: 'q1',
      attemptNo: 1,
      distribution: [
        { optionId: 'o1', count: 4, percent: 40 },
        { optionId: 'o2', count: 6, percent: 60 },
      ],
    });
    expect(snap.questionId).toBe('q1');
    expect(snap.distribution).toHaveLength(2);
    expect(snap.distribution[0].count).toBe(4);
    expect(snap.snapshotAt).toBeTypeOf('number');
  });

  it('distribution yo q bo lsa null', () => {
    expect(distributionSnapshot({})).toBeNull();
    expect(distributionSnapshot({ distribution: 'nope' })).toBeNull();
  });
});

describe('C5-05: batchLeaderboard (item 13)', () => {
  it('rank + top-N + hiddenCount, batchlar soni', async () => {
    const rows = [
      { participantId: 'p1', displayAlias: 'A', score: 10 },
      { participantId: 'p2', displayAlias: 'B', score: 20 },
      { participantId: 'p3', displayAlias: 'C', score: 30 },
      { participantId: 'p4', displayAlias: 'D', score: 5 },
    ];
    const r = await batchLeaderboard(rows, { topN: 3, batchSize: 2 });
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0].displayAlias).toBe('C'); // 30 — eng yuqori
    expect(r.entries[0].rank).toBe(1);
    expect(r.hiddenCount).toBe(1);
    expect(r.batches).toBe(2);
  });

  it('tie — bir xil rank', async () => {
    const rows = [
      { participantId: 'p1', displayAlias: 'A', score: 10 },
      { participantId: 'p2', displayAlias: 'B', score: 10 },
    ];
    const r = await batchLeaderboard(rows, { topN: 5 });
    expect(r.entries[0].rank).toBe(1);
    expect(r.entries[1].rank).toBe(1); // tie
  });
});

describe('C5-05: PerfSchema (item 7 feature flag)', async () => {
  const { resolvePreset } = await import('../../services/cast/presets.js');
  const { CastConfigSnapshotSchema, CastConfigInputSchema } = await import('../../services/cast/config-schema.js');

  it('perf config snapshot da mavjud, default safeNextPrefetch=false', () => {
    const { config } = resolvePreset('responsive_accuracy', {});
    const snapshot = {
      schemaVersion: 1,
      preset: { id: 'responsive_accuracy', version: 1, customized: false },
      source: { type: 'user', key: 'test_1' },
      ...config,
    };
    const r = CastConfigSnapshotSchema.safeParse(snapshot);
    expect(r.success).toBe(true);
    const perf = r.data.perf || {};
    expect(perf.safeNextPrefetch).toBe(false); // opt-in default OFF
    expect(perf.timerUpdateMs).toBe(1000);
  });

  it('input override perf bo limi qabul qiladi', () => {
    const r = CastConfigInputSchema.safeParse({
      presetId: 'formative_check',
      overrides: { perf: { safeNextPrefetch: true, timerUpdateMs: 500 } },
    });
    expect(r.success).toBe(true);
    expect(r.data.overrides.perf.safeNextPrefetch).toBe(true);
  });

  it('resolvePreset override perf ni qo llaydi', () => {
    const { config } = resolvePreset('responsive_accuracy', { perf: { safeNextPrefetch: true, timerUpdateMs: 500 } });
    expect(config.perf.safeNextPrefetch).toBe(true);
    expect(config.perf.timerUpdateMs).toBe(500);
  });
});

describe('C5-05: bundleBudgetReport (item 1/2/3/20)', () => {
  it('budget ichida — ok', () => {
    const r = bundleBudgetReport([
      { name: 'a.js', bytes: 100 * 1024, kind: 'critical' },
      { name: 'b.js', bytes: 50 * 1024, kind: 'critical' },
      { name: 'c.css', bytes: 60 * 1024, kind: 'background' },
    ]);
    expect(r.criticalExceeded).toBe(false);
    expect(r.backgroundExceeded).toBe(false);
    expect(r.exceeded).toBe(false);
    expect(r.totalCriticalKB).toBe(150);
  });

  it('critical 250KB exceed — warn policy', () => {
    const r = bundleBudgetReport([
      { name: 'a.js', bytes: BUDGET_CRITICAL_BYTES + 1, kind: 'critical' },
    ]);
    expect(r.criticalExceeded).toBe(true);
    expect(r.policy).toBe('warn');
  });

  it('background 300KB exceed — fail policy (--ci)', () => {
    const r = bundleBudgetReport(
      [{ name: 'b.js', bytes: BUDGET_BACKGROUND_BYTES + 1, kind: 'background' }],
      { failOnExceed: true }
    );
    expect(r.backgroundExceeded).toBe(true);
    expect(r.policy).toBe('fail');
  });
});
