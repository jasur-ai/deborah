/**
 * Deborah — Cast Bot Simulator (C3-15)
 * ------------------------------------
 * Rehearsal sessionlarda production participantlarsiz botlar bilan test.
 *
 * Key principles:
 * - Bot participant IDʻlar `bot:` namespaceʻida (item 4) — real roasterdan ajratiladi.
 * - Bot javoblari NORMAL answer service orqali (submitAnswer) yuboriladi (item 5).
 * - Toʻg'ri javobni tanlash SERVER side scenario engine qiladi (item 6) —
 *   frontend hech qachon private answer keyʻni koʻrmaydi.
 * - Barcha timers cancelable — stopBots() barchasini toʻxtatadi.
 * - Faqat rehearsal (environment=simulation) sessionlarda ishlaydi.
 */

import { fb } from '../../firebase/admin.js';
import { CastError, CAST_ERROR_CODES } from './errors.js';
import { upsertParticipant, getState, getPrivateQuestion, listParticipants, markPresence, removeParticipant } from './session-store.js';
import { submitAnswer } from './answer-service.js';
import { freezeWall } from './moderation-service.js';
import { isRehearsal, REHEARSAL_ENV } from './rehearsal-service.js';

// ── Dedicated namespace (item 4) ──
export const BOT_NAMESPACE = 'bot:';

export function botId(index) {
  return `${BOT_NAMESPACE}${String(index).padStart(3, '0')}`;
}

export function isBot(participantId) {
  return typeof participantId === 'string' && participantId.startsWith(BOT_NAMESPACE);
}

// ── Scenario registry (item 3) ──
export const BOT_SCENARIOS = {
  FAST_CORRECT: 'fast_correct',       // tez + toʻg'ri
  SLOW_CORRECT: 'slow_correct',       // sekin + toʻg'ri
  WRONG_CLUSTER: 'wrong_cluster',     // notoʻg'ri klaster
  DISCONNECT: 'disconnect',           // javobdan keyin uzilish
  LATE_JOIN: 'late_join',             // sessiya oʻrtasida qoʻshilish
  NO_ANSWERS: 'no_answers',           // umuman javob yoʻq
  ALL_INSTANT: 'all_instant',         // hammasi birdan
  DUPLICATE_ANSWER: 'duplicate_answer', // takroriy submit (turli commandId)
  LOST_ACK: 'lost_ack',               // same commandId retry — idempotent
  HOST_DISCONNECT: 'host_disconnect', // direktor uzilishi (wall freeze)
};

export const BOT_SCENARIO_LIST = Object.values(BOT_SCENARIOS);

// ── Cancellable timers ──
const sessionTimers = new Map(); // sessionId → Set<timeoutId>

function schedule(sessionId, fn, delayMs) {
  if (!sessionTimers.has(sessionId)) sessionTimers.set(sessionId, new Set());
  const t = setTimeout(async () => {
    sessionTimers.get(sessionId)?.delete(t);
    try { await fn(); } catch (_) { /* bot javob xatosi — non-critical */ }
  }, delayMs);
  sessionTimers.get(sessionId).add(t);
  return t;
}

/** Stop ALL pending bot timers for a session. */
export function stopBots(sessionId) {
  const set = sessionTimers.get(sessionId);
  if (set) {
    for (const t of set) clearTimeout(t);
    set.clear();
    sessionTimers.delete(sessionId);
  }
  return true;
}

// ── Server-side answer selection (item 6) ──
function pickCorrect(priv) {
  if (priv.correctOptionIds && priv.correctOptionIds.length) return priv.correctOptionIds;
  return [];
}

function pickWrong(priv) {
  const all = (priv.options || []).map((o) => o.id);
  const correct = new Set(priv.correctOptionIds || []);
  const wrong = all.filter((id) => !correct.has(id));
  if (wrong.length === 0) return pickCorrect(priv);
  // deterministik: birinchi notoʻg'ri — "wrong cluster" kabi
  return [wrong[0]];
}

function pickRandomWrong(priv) {
  const all = (priv.options || []).map((o) => o.id);
  const correct = new Set(priv.correctOptionIds || []);
  const wrong = all.filter((id) => !correct.has(id));
  if (wrong.length === 0) return pickCorrect(priv);
  const idx = Math.floor(Math.random() * wrong.length);
  return [wrong[idx]];
}

async function answerForQuestion(sessionId, questionId, mode) {
  const priv = await getPrivateQuestion(sessionId, questionId);
  if (!priv) return { priv: null, ids: [] };
  if (mode === 'correct') return { priv, ids: pickCorrect(priv) };
  if (mode === 'wrong') return { priv, ids: pickRandomWrong(priv) };
  return { priv, ids: [] };
}

/**
 * Start a bot scenario (item 3).
 * @param {object} input — { sessionId, scenarioId, count, config }
 * @returns {Promise<{started:boolean, botIds:string[], scenarioId:string}>}
 */
export async function startScenario({ sessionId, scenarioId, count = 10, config = {} }) {
  const metaSnap = await fb.get(`cast_sessions/${sessionId}/meta`);
  const meta = metaSnap.exists() ? metaSnap.val() : null;
  if (!meta) throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Sessiya topilmadi');
  if (!isRehearsal(meta)) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Botlar faqat rehearsal (simulation) sessiyalarda ishlaydi');
  }
  if (!BOT_SCENARIO_LIST.includes(scenarioId)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, `Nomaʻlum scenario: ${scenarioId}`);
  }
  const n = Math.max(1, Math.min(Number(count) || 10, 100));
  const botIds = [];
  const now = Date.now();

  // Bots — dedicated namespace (item 4)
  for (let i = 0; i < n; i++) {
    const pid = botId(i);
    await upsertParticipant(sessionId, {
      participantId: pid,
      displayAlias: `Bot ${String(i + 1).padStart(2, '0')}`,
      avatarId: 'bot',
      presence: 'online',
      isBot: true,
      scenario: scenarioId,
      joinedAt: now,
      last_seen: now,
      late: false,
    });
    botIds.push(pid);
  }

  const state = await getState(sessionId);
  const questionId = state?.questionId;

  // Schedule scenario behavior (item 5-6)
  if (scenarioId === BOT_SCENARIOS.LATE_JOIN) {
    // 4 sekunddan keyin qoʻshiladi va javob beradi
    for (const pid of botIds) {
      schedule(sessionId, async () => {
        const st = await getState(sessionId);
        if (st?.phase === 'ENDED') return;
        await markPresence(sessionId, pid, 'online');
        await tryAnswer(sessionId, pid, st?.questionId, 'correct');
      }, 4000);
    }
  } else if (scenarioId === BOT_SCENARIOS.NO_ANSWERS) {
    // Hech narsa qilmaydi — faqat roʻyxatda turadi (coverage past boʻladi)
    for (const pid of botIds) {
      schedule(sessionId, async () => {
        await markPresence(sessionId, pid, 'online');
      }, 500);
    }
  } else if (scenarioId === BOT_SCENARIOS.ALL_INSTANT) {
    for (const pid of botIds) {
      schedule(sessionId, () => tryAnswer(sessionId, pid, questionId, 'correct'), 150);
    }
  } else if (scenarioId === BOT_SCENARIOS.DUPLICATE_ANSWER) {
    for (const pid of botIds) {
      schedule(sessionId, async () => {
        await tryAnswer(sessionId, pid, questionId, 'correct');
        // Ikkinchi submit — turli commandId (dedupe path)
        await tryAnswer(sessionId, pid, questionId, 'correct');
      }, 800);
    }
  } else if (scenarioId === BOT_SCENARIOS.LOST_ACK) {
    for (const pid of botIds) {
      // Same commandId retry — idempotent ACK
      const commandId = `bot_lostack_${pid}_${Date.now()}`;
      schedule(sessionId, async () => {
        const ok1 = await tryAnswer(sessionId, pid, questionId, 'correct', commandId);
        const ok2 = await tryAnswer(sessionId, pid, questionId, 'correct', commandId);
        return ok1 === ok2; // idempotent
      }, 700);
    }
  } else if (scenarioId === BOT_SCENARIOS.DISCONNECT) {
    for (const pid of botIds) {
      schedule(sessionId, async () => {
        await tryAnswer(sessionId, pid, questionId, 'correct');
        await markPresence(sessionId, pid, 'offline');
      }, 900);
    }
  } else if (scenarioId === BOT_SCENARIOS.SLOW_CORRECT) {
    for (const pid of botIds) {
      schedule(sessionId, () => tryAnswer(sessionId, pid, questionId, 'correct'), 12000);
    }
  } else if (scenarioId === BOT_SCENARIOS.WRONG_CLUSTER) {
    for (const pid of botIds) {
      schedule(sessionId, () => tryAnswer(sessionId, pid, questionId, 'wrong'), 1500);
    }
  } else if (scenarioId === BOT_SCENARIOS.HOST_DISCONNECT) {
    // Direktor uzilishi — wall freeze (C3-10 logika bilan)
    await fb.set(`cast_private/${sessionId}/rehearsal/host_offline`, { at: now, scenario: scenarioId });
    try { await freezeWall(sessionId); } catch (_) { /* non-critical */ }
  } else {
    // fast_correct (default)
    for (const pid of botIds) {
      schedule(sessionId, () => tryAnswer(sessionId, pid, questionId, 'correct'), 800);
    }
  }

  await fb.set(`cast_private/${sessionId}/rehearsal/last_scenario`, {
    scenarioId,
    count: n,
    startedAt: now,
    botIds,
    config: config || {},
  });

  return { started: true, botIds, scenarioId };
}

/** Bot javobini normal answer service orqali yuborish (item 5). */
async function tryAnswer(sessionId, participantId, questionId, mode, fixedCommandId = null) {
  if (!questionId) return 'NO_QUESTION';
  const state = await getState(sessionId);
  if (!state || state.phase !== 'QUESTION_OPEN' || state.questionId !== questionId) {
    return 'CLOSED';
  }
  const { priv, ids } = await answerForQuestion(sessionId, questionId, mode);
  if (!priv || ids.length === 0) return 'NO_KEY';
  const commandId = fixedCommandId || `bot_${participantId}_${questionId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const res = await submitAnswer({
      sessionId,
      questionId,
      participantId,
      commandId,
      selectedOptionIds: ids,
      config: {},
    });
    return res?.status || 'ACCEPTED';
  } catch (err) {
    return err?.code || 'ERROR';
  }
}

/** Bot roster (rehearsal private). */
export async function listBots(sessionId) {
  const participants = await listParticipants(sessionId);
  return Object.values(participants).filter((p) => isBot(p.participantId));
}

/** Remove all bots from a session (reset). */
export async function removeAllBots(sessionId) {
  stopBots(sessionId);
  const bots = await listBots(sessionId);
  for (const b of bots) {
    await removeParticipant(sessionId, b.participantId);
    await fb.remove(`cast_private/${sessionId}/answers`);
    await fb.remove(`cast_sessions/${sessionId}/scores`);
  }
  return bots.length;
}

export default {
  BOT_NAMESPACE,
  BOT_SCENARIOS,
  BOT_SCENARIO_LIST,
  botId,
  isBot,
  startScenario,
  stopBots,
  listBots,
  removeAllBots,
  REHEARSAL_ENV,
};
