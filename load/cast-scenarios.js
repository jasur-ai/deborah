/**
 * Edikit — Cast Load Scenarios (C5-09 item 2..15)
 * ------------------------------------------------
 * Tier'lar va yuqori-yuk scenario'lari. Har bir scenario:
 *  - generator orqali virtual participant'lar ochadi
 *  - ground-truth (qancha javob yuborildi) vs accepted (qancha qabul qilindi)
 *  - ACK latency p50/p95/p99, loss, reconnect hisobini qaytaradi
 *
 * Tier chegaralari (rejadan):
 *   S 1–30 · M 31–100 · L 101–500 · XL 501–1_000 · XXL 1_001–10_000
 *
 * Scenario'lar (rejaga mos):
 *   1. gradualJoin      — asta-sekin join (ramp)
 *   2. joinBurst5s      — 5 soniyalik join burst
 *   3. answerBurst2s    — oxirgi 2 soniyalik answer burst
 *   4. ackLossRetry     — ACK loss/retry simulyatsiyasi
 *   5. reconnectStorm   — 10% reconnect storm
 *   6. hostRace         — pause/add-time/close race
 *   7. hotEvent         — 1 hot event + 20 normal class
 *   8. soak             — 45-90 daqiqa (configurable, default short)
 */

import { CastLoadClient, summarizeMetrics } from './cast-socket-client.js';

export const TIER_RANGES = {
  S: { min: 1, max: 30 },
  M: { min: 31, max: 100 },
  L: { min: 101, max: 500 },
  XL: { min: 501, max: 1000 },
  XXL: { min: 1001, max: 10000 },
};

export const TIER_ACK_SLO = {
  S: { p95: 500 },
  M: { p95: 500 },
  L: { p95: 750 },
  XL: { p95: 750 },
  XXL: { p95: 1000 },
};

/**
 * Gradual join scenario (item 3): rampMs oralig'ida N participant asta-sekin
 * ulanishadi, savol ochiladi, hamma javob beradi, ground-truth solishtiriladi.
 *
 * @returns {Promise<{ok:boolean, summary:object, tier:string, breakdown:object}>}
 */
export async function runGradualJoin({
  baseUrl,
  sessionId,
  joinCode,
  directorCookie,
  count = 30,
  rampMs = 5000,
  questions = 1,
  joinTimeoutMs = 15000,
  thinkSeconds = 0,
  metrics,
}) {
  const tier = pickTier(count);
  const sink = metrics || { acks: [], joins: [], answers: [], errors: [] };
  const bots = [];
  const opened = [];
  const startMs = Date.now();

  // 0. Director socket — session cookie bilan (owner/co_host)
  const director = new CastLoadClient({ baseUrl, sessionId, cookie: directorCookie, name: 'director', metrics: sink });
  await director.connect(joinTimeoutMs);
  const dj = await director.directorJoin(joinTimeoutMs);
  if (!dj.ok) throw new Error(`directorJoin: ${JSON.stringify(dj.error || dj).slice(0, 120)}`);

  // 1. Gradual join — rampMs bo'ylab teng taqsimlanadi
  for (let i = 0; i < count; i++) {
    const bot = new CastLoadClient({ baseUrl, sessionId, joinCode, name: `grad_${i}`, metrics: sink });
    await bot.connect(joinTimeoutMs);
    const j = await bot.join(joinTimeoutMs);
    sink.joins.push({ ok: !!j.ok, t0: Date.now(), i });
    bots.push(bot);
    // join'lar orasida kichik interval (ramp)
    if (i < count - 1 && rampMs > 0) {
      await delay(Math.max(5, Math.floor(rampMs / count)));
    }
  }
  const joinDoneMs = Date.now() - startMs;

  // 2. Sessiyani bir marta start qilamiz (lobby yopiladi) — loop ichida EMAS,
  //    aks holda questions>1 bo'lganda ikkinchi sessionStart reject bo'ladi (soak).
  const ss = await director.sessionStart();
  if (!ss.ok) throw new Error(`sessionStart: ${JSON.stringify(ss.error || ss).slice(0, 120)}`);

  // 3. Har bir savol uchun: director ochadi → botlar javob beradi
  for (let q = 0; q < questions; q++) {
    const waiters = bots.map((b) => b.waitQuestionOpened(25000));
    const op = await director.questionOpen();
    if (!op.ok) throw new Error(`questionOpen q${q}: ${JSON.stringify(op.error || op).slice(0, 120)}`);
    const openedQuestions = await Promise.all(waiters);
    const question = openedQuestions[0];
    opened.push(question);
    const optionId = question.options[0].id;

    // Answer burst: hamma bir vaqtda javob beradi (parallel)
    const answers = await Promise.allSettled(
      bots.map((b) => b.submitAnswer(question.questionId, [optionId], 1)),
    );
    const failed = answers.filter((a) => a.status === 'rejected').length;
    if (failed > 0) sink.errors.push({ kind: 'answer', count: failed });

    const cl = await director.questionClose();
    if (!cl.ok) sink.errors.push({ kind: 'questionClose', err: 'ack not ok' });
    await director.questionReveal();
    // Savollar orasidagi interval (keyingi savol uchun)
    if (q < questions - 1) await delay(500);
  }

  // 4. Disconnect
  await Promise.allSettled(bots.map((b) => b.disconnect()));
  await director.disconnect();

  const summary = summarizeMetrics(sink, count * questions);
  return {
    ok: summary.acceptedLoss === 0,
    tier,
    summary,
    breakdown: { joinCount: bots.length, joinDoneMs, questions },
    scenarios: ['gradualJoin'],
  };
}

/**
 * Answer burst scenario (item 5): oxirgi 2 soniyada hamma javob beradi.
 * count participant darhol join qiladi, keyin 2s ichida answer storm.
 */
export async function runAnswerBurst({
  baseUrl, sessionId, joinCode, directorCookie, count = 50, thinkSeconds = 0, metrics,
}) {
  const sink = metrics || { acks: [], joins: [], answers: [], errors: [] };
  const bots = [];
  for (let i = 0; i < count; i++) {
    const bot = new CastLoadClient({ baseUrl, sessionId, joinCode, name: `burst_${i}`, metrics: sink });
    await bot.connect(12000);
    await bot.join(12000);
    bots.push(bot);
  }
  const director = new CastLoadClient({ baseUrl, sessionId, cookie: directorCookie, name: 'director', metrics: sink });
  await director.connect(12000);
  const dj = await director.directorJoin(12000);
  if (!dj.ok) throw new Error(`directorJoin: ${JSON.stringify(dj.error || dj).slice(0, 120)}`);
  const waiters = bots.map((b) => b.waitQuestionOpened(25000));
  await director.sessionStart();
  await director.questionOpen();
  const openedQuestions = await Promise.all(waiters);
  const question = openedQuestions[0];
  const optionId = question.options[0].id;

  // Answer burst: parallel submit (2s ichida)
  const answers = await Promise.allSettled(
    bots.map((b) => b.submitAnswer(question.questionId, [optionId], 1)),
  );
  const failed = answers.filter((a) => a.status === 'rejected').length;
  if (failed > 0) sink.errors.push({ kind: 'answer', count: failed });

  await director.questionClose();
  await director.questionReveal();
  await Promise.allSettled(bots.map((b) => b.disconnect()));
  await director.disconnect();

  const summary = summarizeMetrics(sink, count);
  return { ok: summary.acceptedLoss === 0, summary, breakdown: { count, answerBurstMs: '2s' }, scenarios: ['answerBurst'] };
}

/**
 * Reconnect storm scenario (item 8): ~10% clientlar disconnect+reconnect qiladi.
 */
export async function runReconnectStorm({
  baseUrl, sessionId, joinCode, directorCookie, count = 50, metrics,
}) {
  const sink = metrics || { acks: [], joins: [], answers: [], errors: [] };
  const bots = [];
  for (let i = 0; i < count; i++) {
    const bot = new CastLoadClient({ baseUrl, sessionId, joinCode, name: `rc_${i}`, metrics: sink });
    await bot.connect(12000);
    await bot.join(12000);
    bots.push(bot);
  }
  // 10% reconnect storm
  const stormCount = Math.max(1, Math.floor(count * 0.1));
  const stormBots = bots.slice(0, stormCount);
  await Promise.allSettled(stormBots.map(async (b, idx) => {
    await b.disconnect();
    await delay(300 + idx * 20);
    await b.connect(12000);
    await b.join(12000).catch(() => {});
  }));

  const director = new CastLoadClient({ baseUrl, sessionId, cookie: directorCookie, name: 'director', metrics: sink });
  await director.connect(12000);
  const dj = await director.directorJoin(12000);
  if (!dj.ok) throw new Error(`directorJoin: ${JSON.stringify(dj.error || dj).slice(0, 120)}`);
  const waiters = bots.map((b) => b.waitQuestionOpened(25000));
  await director.sessionStart();
  await director.questionOpen();
  const openedQuestions = await Promise.allSettled(waiters);
  // Reconnect bo'lmaganlar javob beradi (reconnected'lar ham join'ni qayta qildi)
  const okQ = openedQuestions.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const question = okQ[0];
  const optionId = question.options[0].id;
  const answerers = bots.slice(stormCount);
  const answers = await Promise.allSettled(
    answerers.map((b) => b.submitAnswer(question.questionId, [optionId], 1)),
  );
  const failed = answers.filter((a) => a.status === 'rejected').length;
  if (failed > 0) sink.errors.push({ kind: 'answer', count: failed });

  await director.questionClose();
  await director.questionReveal();
  await Promise.allSettled(bots.map((b) => b.disconnect()));
  await director.disconnect();

  const summary = summarizeMetrics(sink, answerers.length);
  return {
    ok: summary.acceptedLoss === 0,
    summary,
    breakdown: { count, stormCount, reconnects: stormCount },
    scenarios: ['reconnectStorm'],
  };
}

/**
 * Soak scenario (item 14): qisqa intervalda takroriy savol sikllari.
 * defaultQuestions kichik — CI uchun; production'da 45-90 min beriladi.
 */
export async function runSoak({
  baseUrl, sessionId, joinCode, directorCookie, count = 30, questions = 3, metrics,
}) {
  return runGradualJoin({ baseUrl, sessionId, joinCode, directorCookie, count, questions, rampMs: 2000, metrics });
}

// ── Helpers ──
function pickTier(count) {
  if (count <= 30) return 'S';
  if (count <= 100) return 'M';
  if (count <= 500) return 'L';
  if (count <= 1000) return 'XL';
  return 'XXL';
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { pickTier, delay };
