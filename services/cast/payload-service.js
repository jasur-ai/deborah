/**
 * Deborah — Cast Payload Control Service (C5-05)
 * ----------------------------------------------
 * Performance budget va payload control:
 * - Socket max payload limit (server) uchun o'lchash helper'lari.
 * - Answer command minimal fieldlari (tugallanish sharti: har answer uchun
 *   all-participant broadcast qilinmaydi — faqat count/aggregate chiqadi).
 * - Director/Projector response count coalesce (4-10Hz / 2-4Hz).
 * - Distribution snapshot (question lockda).
 * - Leaderboard batch hisoblash.
 */

// ── Budgets (item 2/3) ──
export const BUDGET_CRITICAL_BYTES = 250 * 1024;   // initial lobby critical (250KB target)
export const BUDGET_BACKGROUND_BYTES = 300 * 1024; // background optimized (300KB target)
export const WARNING_KB = 1024;

// ── Socket limits (item 8) ──
export const MAX_SOCKET_PAYLOAD_BYTES = 64 * 1024; // 64KB server-side socket payload limit

// ── Coalesce intervals (item 10/11) ──
export const DIRECTOR_COALESCE_MS = 120; // 4-10Hz → ~8Hz (125ms)
export const PROJECTOR_COALESCE_MS = 300; // 2-4Hz → ~3Hz (333ms)

// ── Leaderboard batch (item 13) ──
export const LEADERBOARD_BATCH_SIZE = 50;

/**
 * JSON payload o'lchamini baytda hisoblaydi (utf8).
 * @param {*} payload — socket emit/ack payload
 * @returns {number} bytes
 */
export function payloadBytes(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch (_) {
    return -1; // serializable emas (circular) — o'lchab bo'lmaydi
  }
}

/**
 * Socket payload limit tekshiruvi (item 8).
 * @returns {{ limitBytes:number, ok:boolean, sizeBytes:number }}
 */
export function checkSocketPayload(payload) {
  const sizeBytes = payloadBytes(payload);
  return {
    limitBytes: MAX_SOCKET_PAYLOAD_BYTES,
    ok: sizeBytes >= 0 && sizeBytes <= MAX_SOCKET_PAYLOAD_BYTES,
    sizeBytes,
  };
}

/**
 * Answer command minimal fieldlari (item 9).
 * Raw response/qo'shimcha metadata tashqariga chiqmaydi — faqat zarur scalar'lar.
 * @param {object} a — answer record
 * @returns {object} minimal projection
 */
export function answerMinimalFields(a = {}) {
  return {
    participantId: a.participantId,
    questionId: a.questionId,
    attemptNo: a.attemptNo,
    correct: a.correct === true,
    score: typeof a.score === 'number' ? a.score : null,
    answeredAt: a.answeredAt || null,
  };
}

/**
 * Coalesce — director (4-10Hz) / projector (2-4Hz) response count.
 * Bir nechta tez kelgan count'larni bitta emitga birlashtiradi.
 *
 * @param {Function} emitFn — async (projection) => void
 * @param {number} intervalMs — DIRECTOR_COALESCE_MS / PROJECTOR_COALESCE_MS
 * @returns {{ push:(proj)=>void, flush:()=>Promise<void>, stop:()=>void, pending:()=>number }}
 */
export function createCoalescer(emitFn, intervalMs) {
  let latest = null;
  let timer = null;
  let flushing = false;

  function schedule() {
    if (timer || flushing) return;
    timer = setTimeout(async () => {
      timer = null;
      const toSend = latest;
      latest = null;
      if (toSend) {
        flushing = true;
        try {
          await emitFn(toSend);
        } finally {
          flushing = false;
          // Review fix: flush paytida yangi push kelgan bo'lsa, timer yo'q edi —
          // endi qolgan qiymatni ham re-schedule qilamiz (stall bo'lmaydi).
          if (latest) schedule();
        }
      }
    }, intervalMs);
  }

  return {
    /** Yangi count keldi — interval ichida faqat oxirgisi yuboriladi. */
    push(proj) {
      latest = proj;
      schedule();
    },
    /** Qolganlarni darhol yuborish (session end, test close). */
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      const toSend = latest;
      latest = null;
      if (toSend) {
        flushing = true;
        try { await emitFn(toSend); } finally { flushing = false; }
      }
    },
    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      latest = null;
    },
    pending() {
      return latest ? 1 : 0;
    },
  };
}

/**
 * Distribution snapshot — question lock'da aggregate distribution
 * (item 12). Snapshot bir marta hisoblanib, takroriy hisob qilinmaydi.
 * @param {object} evidence — director evidence (directorEvidenceProjection)
 * @returns {object|null} snapshot
 */
export function distributionSnapshot(evidence = {}) {
  if (!evidence.distribution || !Array.isArray(evidence.distribution)) return null;
  return {
    questionId: evidence.questionId,
    attemptNo: evidence.attemptNo,
    distribution: evidence.distribution.map((d) => ({
      optionId: d.optionId,
      count: d.count,
      percent: typeof d.percent === 'number' ? d.percent : null,
    })),
    snapshotAt: Date.now(),
  };
}

/**
 * Leaderboard batch hisoblash (item 13) — chunk'larda rank + top-N,
 * katta roster'da bitta to'liq iteratsiya emas.
 * @param {Array} rows — ranked entries
 * @param {object} opts — { batchSize, topN }
 * @returns {Promise<{entries:Array, hiddenCount:number, batches:number}>}
 */
export async function batchLeaderboard(rows = [], { batchSize = LEADERBOARD_BATCH_SIZE, topN = 5 } = {}) {
  const ranked = [...rows].sort((a, b) => b.score - a.score || String(a.participantId || '').localeCompare(String(b.participantId || '')));
  let lastScore = null;
  let lastRank = 0;
  const entries = [];
  const batches = Math.ceil(ranked.length / batchSize);
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i];
    const rank = row.score === lastScore ? lastRank : i + 1;
    lastScore = row.score;
    lastRank = rank;
    if (entries.length < topN) {
      entries.push({
        displayAlias: row.displayAlias,
        rank,
        score: typeof row.score === 'number' ? row.score : 0,
      });
    }
    // chunk chegarasida microtask — uzun roster'da event loop'ni bo'g'maydi
    if ((i + 1) % batchSize === 0) {
      await new Promise((r) => setImmediate(r));
    }
  }
  return { entries, hiddenCount: Math.max(0, ranked.length - entries.length), batches };
}

/**
 * Bundle budget hisoboti (item 1/2/3/20).
 * @param {Array<{name:string, bytes:number, kind:'critical'|'background'}>} assets
 * @returns {{ items:Array, totalCriticalBytes:number, totalBackgroundBytes:number,
 *             criticalExceeded:boolean, backgroundExceeded:boolean, policy:'warn'|'fail' }}
 */
export function bundleBudgetReport(assets = [], { failOnExceed = false } = {}) {
  const criticalBytes = assets.filter((a) => a.kind === 'critical').reduce((s, a) => s + a.bytes, 0);
  const backgroundBytes = assets.filter((a) => a.kind === 'background').reduce((s, a) => s + a.bytes, 0);
  const criticalExceeded = criticalBytes > BUDGET_CRITICAL_BYTES;
  const backgroundExceeded = backgroundBytes > BUDGET_BACKGROUND_BYTES;
  return {
    items: assets.map((a) => ({
      name: a.name,
      bytes: a.bytes,
      kb: Math.round((a.bytes / WARNING_KB) * 10) / 10,
      kind: a.kind,
    })),
    totalCriticalBytes: criticalBytes,
    totalCriticalKB: Math.round((criticalBytes / WARNING_KB) * 10) / 10,
    totalBackgroundBytes: backgroundBytes,
    totalBackgroundKB: Math.round((backgroundBytes / WARNING_KB) * 10) / 10,
    criticalBudgetKB: BUDGET_CRITICAL_BYTES / WARNING_KB,
    backgroundBudgetKB: BUDGET_BACKGROUND_BYTES / WARNING_KB,
    criticalExceeded,
    backgroundExceeded,
    exceeded: criticalExceeded || backgroundExceeded,
    policy: failOnExceed ? 'fail' : 'warn',
  };
}

export default {
  BUDGET_CRITICAL_BYTES,
  BUDGET_BACKGROUND_BYTES,
  MAX_SOCKET_PAYLOAD_BYTES,
  DIRECTOR_COALESCE_MS,
  PROJECTOR_COALESCE_MS,
  LEADERBOARD_BATCH_SIZE,
  payloadBytes,
  checkSocketPayload,
  answerMinimalFields,
  createCoalescer,
  distributionSnapshot,
  batchLeaderboard,
  bundleBudgetReport,
};
