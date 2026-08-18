/**
 * Edikit — Cast Capacity & Infrastructure Cost Model (C5-10)
 * -----------------------------------------------------------
 * Har certified tier uchun compute, realtime, egress, storage,
 * observability va support costini inputlardan hisoblaydi.
 *
 * Provider-independent: narxlar kodda hardcode qilinmaydi — input object
 * orqali beriladi (item 13). Zero narxli fixture zero cost qaytaradi.
 *
 * Formula group (rejadan):
 *   compute       = nodeCount × nodeHours × nodeHourPrice
 *   realtime      = peakConnections × configuredRate
 *   network       = outboundBytes / 1GB × egressPricePerGb
 *   storage       = retainedBytes / 1GB × storagePricePerGbMonth
 *   observability = telemetryBytes / 1GB × observabilityPricePerGb
 *   support       = supportHours × supportHourlyCost
 *   total         = compute + realtime + network + storage + observability + support
 */

export const TIER_PEAK_CONNECTIONS = {
  S: 30,
  M: 100,
  L: 500,
  XL: 1000,
  XXL: 10000,
};

export const GB = 1024 ** 3;

/** Input schema (item 1) — barcha maydonlar son va default 0. */
export function normalizeCostInput(raw = {}) {
  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    tier: String(raw.tier || 'S').toUpperCase(),
    peakConnections: num(raw.peakConnections),
    durationMinutes: num(raw.durationMinutes),
    nodeCount: num(raw.nodeCount, 1),
    nodeHourPrice: num(raw.nodeHourPrice),
    egressPricePerGb: num(raw.egressPricePerGb),
    storagePricePerGbMonth: num(raw.storagePricePerGbMonth),
    observabilityPricePerGb: num(raw.observabilityPricePerGb),
    supportHours: num(raw.supportHours),
    supportHourlyCost: num(raw.supportHourlyCost),
    realtimeRate: num(raw.realtimeRate),
  };
}

/**
 * Payload/profil hisoblari (item 4/5/6/7) — load testdan olinadigan
 * o'rtacha byte'larni kirishga tayyorlaydi.
 *
 * @param {object} profile
 * @param {number} profile.avgAnswerBytes — bitta answer command payload (item 4)
 * @param {number} profile.answersPerSession — har participant boshiga o'rtacha answer
 * @param {number} profile.avgAckBytes — bitta ACK/event payload
 * @param {number} profile.eventsPerAnswer — har answer uchun event broadcast'lar soni
 * @param {number} profile.eventRecipientsFactor — har event nechta recipient (0..1)
 * @param {number} profile.storageBytesPerAnswer — answer+event log saqlash (replay/backup bilan)
 * @param {number} profile.telemetryBytesPerAnswer — metrics/log/trace ingestion
 * @param {number} profile.retentionDays — storage retention
 * @param {number} profile.nodeCount
 */
export function buildTrafficProfile(profile = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    avgAnswerBytes: num(profile.avgAnswerBytes, 256),
    answersPerSession: num(profile.answersPerSession, 20),
    avgAckBytes: num(profile.avgAckBytes, 128),
    eventsPerAnswer: num(profile.eventsPerAnswer, 2),
    eventRecipientsFactor: num(profile.eventRecipientsFactor, 0.5),
    storageBytesPerAnswer: num(profile.storageBytesPerAnswer, 512),
    telemetryBytesPerAnswer: num(profile.telemetryBytesPerAnswer, 384),
    retentionDays: num(profile.retentionDays, 90),
  };
}

/**
 * Cost hisoblash (item 9/10).
 * @param {object} input — normalizeCostInput natijasi
 * @param {object} traffic — buildTrafficProfile natijasi
 */
export function computeCost(input = {}, traffic = {}) {
  const cfg = normalizeCostInput(input);
  const prof = buildTrafficProfile(traffic);
  const peak = cfg.peakConnections || TIER_PEAK_CONNECTIONS[cfg.tier] || 30;

  // Hours
  const nodeHours = (cfg.durationMinutes / 60) * cfg.nodeCount;

  // ── Answer/event traffic (item 4/5) ──
  const totalAnswers = peak * prof.answersPerSession;
  // Egress: payload × recipient × frequency.
  // Disabled anti-pattern (item 10): "full leaderboard per-answer broadcast"
  // baseline'ga kiritilmaydi — bu yerda faqat participant + director recipient'lar
  // hisoblanadi (eventRecipientsFactor ≤ 1).
  const eventBytes = totalAnswers * prof.eventsPerAnswer * prof.avgAckBytes * prof.eventRecipientsFactor;
  const answerOutboundBytes = totalAnswers * prof.avgAnswerBytes;
  const outboundBytes = answerOutboundBytes + eventBytes;

  // ── Storage (item 6): answer + event log + replay + backup ──
  const retainedBytes = totalAnswers * prof.storageBytesPerAnswer * (prof.retentionDays / 30);

  // ── Observability (item 7): metrics/log/trace ingestion × retention ──
  const telemetryBytes = totalAnswers * prof.telemetryBytesPerAnswer * (prof.retentionDays / 30);

  const compute = nodeHours * cfg.nodeHourPrice;
  const realtime = peak * cfg.realtimeRate;
  const network = (outboundBytes / GB) * cfg.egressPricePerGb;
  const storage = (retainedBytes / GB) * cfg.storagePricePerGbMonth;
  const observability = (telemetryBytes / GB) * cfg.observabilityPricePerGb;
  const support = cfg.supportHours * cfg.supportHourlyCost;
  const total = compute + realtime + network + storage + observability + support;

  return {
    tier: cfg.tier,
    inputs: cfg,
    traffic: {
      peakConnections: peak,
      totalAnswers,
      outboundBytes,
      retainedBytes,
      telemetryBytes,
    },
    components: { compute, realtime, network, storage, observability, support },
    total,
  };
}

/**
 * Item 11: projected vs actual reconciliation.
 * Actual o'lchovlar (eventdan keyin) bilan projected (rejalangan) solishtiriladi.
 * @returns {{delta:number, deltaPct:number, verdict:'ok'|'over'|'under'}}
 */
export function reconcileCost(projectedTotal, actualTotal) {
  const delta = actualTotal - projectedTotal;
  const deltaPct = projectedTotal > 0 ? (delta / projectedTotal) * 100 : 0;
  return {
    delta,
    deltaPct,
    verdict: Math.abs(deltaPct) <= 0.0001 ? 'ok' : deltaPct > 0 ? 'over' : 'under',
  };
}

/**
 * Item 12: cost regression threshold — release report uchun.
 * @returns {boolean} — actual projected'dan threshold % dan ko'p oshganmi
 */
export function isCostRegression(projectedTotal, actualTotal, thresholdPct = 20) {
  if (projectedTotal <= 0) return actualTotal > 0;
  return (actualTotal - projectedTotal) / projectedTotal * 100 > thresholdPct;
}
