/**
 * AUTH B-17 — Onboarding state machine
 * ---------------------------------------------------------------------------
 * State: welcome → first_win → checklist → done (qat'iy monotonik — orqaga
 * qaytish mumkin emas, §15).
 *
 * Storage: `onboarding/{safeKey}` — user-scoped (IDOR'ga yopiq, §15).
 *   {
 *     step: 'welcome'|'first_win'|'checklist'|'done',
 *     checklist: object|null,      // JSONB checklist holati
 *     activated_at: number|null,   // orient/skip vaqtidagi aktivatsiya
 *     welcome_sent_at: number|null,
 *     orient: object|null,         // { subject, goal, demoScore, skipped, submittedAt }
 *     updated_at: number|null
 *   }
 */
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';
import { checkFirstWinAnswer, FIRST_WIN_COUNT } from './demo-bank.js';

// B-18 §06: 5 savollik amaliyot
export const FIRST_WIN_ITEMS = FIRST_WIN_COUNT;

export const ONBOARDING_STEPS = ['welcome', 'first_win', 'checklist', 'done'];

export const ONBOARDING_PATH = 'onboarding';

// §09: Orient'ni skip qilish aktivatsiyaga +10-15% bonus beradi (ma'lumot metrika)
export const SKIP_ACTIVATION_BONUS = 0.1;

export function stepIndex(step) {
  return ONBOARDING_STEPS.indexOf(step);
}

/** Monotoniklik: `to` faqat `from`dan keyingi step bo'lishi mumkin (§15). */
export function canAdvance(from, to) {
  const iFrom = stepIndex(from);
  const iTo = stepIndex(to);
  return iFrom >= 0 && iTo > iFrom;
}

export function normalizeState(raw) {
  const step = ONBOARDING_STEPS.includes(raw?.step) ? raw.step : 'welcome';
  return {
    step,
    checklist: raw && raw.checklist && typeof raw.checklist === 'object' ? raw.checklist : null,
    activated_at: raw?.activated_at ?? null,
    welcome_sent_at: raw?.welcome_sent_at ?? null,
    orient: raw?.orient && typeof raw.orient === 'object' ? raw.orient : null,
    firstWin: normalizeFirstWin(raw?.firstWin),
    updated_at: raw?.updated_at ?? null,
  };
}

export async function getOnboardingState(userKey) {
  const snap = await fb.get(`${ONBOARDING_PATH}/${safeKey(userKey)}`);
  return normalizeState(snap.exists() ? snap.val() : {});
}

/**
 * Birinchi marta kirishda `welcome` record'ini yaratadi (welcome_sent_at —
 * orient ekrani ko'rilganda yoziladi). Qayta kirishda mavjud holatni qaytaradi.
 */
export async function getOrCreateOnboarding(userKey) {
  const existing = await getOnboardingState(userKey);
  if (existing.step !== 'welcome' || existing.welcome_sent_at) return existing;
  const now = Date.now();
  const record = {
    step: 'welcome',
    checklist: null,
    activated_at: null,
    welcome_sent_at: now,
    orient: null,
    updated_at: now,
  };
  await fb.set(`${ONBOARDING_PATH}/${safeKey(userKey)}`, record);
  return record;
}

/**
 * §10: POST /api/onboarding/orient { subject?, goal? } → step=first_win.
 * - Idempotent: welcome'dan o'tib ketgan bo'lsa holat o'zgarmaydi (monotonic).
 * - `step` parametri qabul QILINMAYDI — client step manipulatsiya qila olmaydi (§20).
 */
export async function submitOrient({ userKey, subject = null, goal = null, demoScore = null, ip, userAgent }) {
  const state = await getOrCreateOnboarding(userKey);
  if (canAdvance('welcome', state.step)) {
    return { ok: true, state, alreadyAdvanced: true };
  }
  const now = Date.now();
  const record = {
    ...state,
    step: 'first_win',
    orient: {
      subject: subject || null,
      goal: goal || null,
      demoScore: demoScore ?? null,
      skipped: false,
      submittedAt: now,
    },
    activated_at: now,
    updated_at: now,
  };
  await fb.set(`${ONBOARDING_PATH}/${safeKey(userKey)}`, record);
  await logAuthEvent({
    action: 'onboarding:orient',
    outcome: 'success',
    method: 'POST',
    actorId: userKey,
    ipAddress: ip,
    userAgent,
    details: { step: 'first_win', subject: subject || null },
  });
  recordMetric('edikit_onboarding_orient_done_total', 1);
  return { ok: true, state: record };
}

/** §09: [Skip] — orient'ni o'tkazib yuborish; baribir first_win'ga olib boradi. */
export async function skipOrient({ userKey, ip, userAgent }) {
  const state = await getOrCreateOnboarding(userKey);
  if (canAdvance('welcome', state.step)) {
    return { ok: true, state, alreadyAdvanced: true };
  }
  const now = Date.now();
  const record = {
    ...state,
    step: 'first_win',
    orient: { skipped: true, submittedAt: now },
    activated_at: now,
    updated_at: now,
  };
  await fb.set(`${ONBOARDING_PATH}/${safeKey(userKey)}`, record);
  await logAuthEvent({
    action: 'onboarding:skip',
    outcome: 'success',
    method: 'POST',
    actorId: userKey,
    ipAddress: ip,
    userAgent,
    details: { step: 'first_win' },
  });
  recordMetric('edikit_onboarding_skip_total', 1);
  return { ok: true, state: record };
}

/**
 * §07: progress — 0..1. Keyingi bosqichlar (checklist/done) B-18+ da
 * to'ldiriladi; hozircha step asosida.
 */
export function onboardingProgress(state) {
  const idx = stepIndex(state?.step ?? 'welcome');
  if (idx < 0) return 0;
  return Math.round((idx / (ONBOARDING_STEPS.length - 1)) * 100);
}

// ─────────────────────────── B-18: Activate (first-win) ───────────────────────────

function normalizeFirstWin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    subject: raw.subject || null,
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    score: typeof raw.score === 'number' ? raw.score : null,
    total: typeof raw.total === 'number' ? raw.total : FIRST_WIN_ITEMS,
    answers: Array.isArray(raw.answers) ? raw.answers : [],
  };
}

/**
 * §06: POST /api/onboarding/first-win/start → 5 savol (fan bo'yicha).
 * - User-scoped (`onboarding/{safeKey}`); step=first_win bo'lsagina ishlaydi
 *   (welcome'dan o'tmagan yoki checklist/done bo'lsa — 409/AlreadyDone).
 * - Idempotent: davom etayotgan attempt'ni qayta start'lamaydi (replay yopiq).
 */
export async function startFirstWin({ userKey, subject, lang = 'uz', ip, userAgent }) {
  const state = await getOrCreateOnboarding(userKey);
  if (state.step !== 'first_win') {
    return { ok: false, error: 'not_in_first_win', state };
  }
  const now = Date.now();
  const existing = normalizeFirstWin(state.firstWin);
  // Davom etayotgan attempt bor — yangi start bermaymiz (idempotent, §15)
  if (existing && existing.startedAt && existing.completedAt === null) {
    return { ok: true, state: { ...state, firstWin: existing }, alreadyStarted: true };
  }
  const record = {
    ...state,
    firstWin: {
      subject: subject || state.orient?.subject || null,
      startedAt: now,
      completedAt: null,
      score: null,
      total: FIRST_WIN_ITEMS,
      answers: [],
    },
    updated_at: now,
  };
  await fb.set(`${ONBOARDING_PATH}/${safeKey(userKey)}`, record);
  await logAuthEvent({
    action: 'onboarding:first_win_start',
    outcome: 'success',
    method: 'POST',
    actorId: userKey,
    ipAddress: ip,
    userAgent,
    details: { subject: record.firstWin.subject },
  });
  recordMetric('edikit_onboarding_first_win_start_total', 1);
  return { ok: true, state: record };
}

/**
 * §08: POST /api/onboarding/first-win/answer { itemId, answer }.
 * - Server scoring + elaborative feedback (izoh) — checkFirstWinAnswer.
 * - Replay himoyasi: bir savolga ikki marta javob — 409 (error 'duplicate_answer').
 * - Faqat davom etayotgan attempt (completedAt === null) qabul qiladi.
 */
export async function submitFirstWinAnswer({ userKey, itemId, answer, lang = 'uz', ip, userAgent }) {
  const state = await getOrCreateOnboarding(userKey);
  const fw = normalizeFirstWin(state.firstWin);
  if (state.step !== 'first_win' || !fw || !fw.startedAt || fw.completedAt !== null) {
    return { ok: false, error: 'no_active_attempt', state };
  }
  const result = checkFirstWinAnswer(fw.subject, lang, itemId, answer);
  if (!result.ok) return { ok: false, error: result.error, state };
  if (fw.answers.some((a) => a.itemId === itemId)) {
    return { ok: false, error: 'duplicate_answer', state };
  }
  const now = Date.now();
  const record = {
    ...state,
    firstWin: {
      ...fw,
      answers: [
        ...fw.answers,
        {
          itemId,
          answer,
          correct: result.correct,
          correctIndex: result.correctIndex,
          explain: result.explain,
          answeredAt: now,
        },
      ],
    },
    updated_at: now,
  };
  await fb.set(`${ONBOARDING_PATH}/${safeKey(userKey)}`, record);
  return {
    ok: true,
    correct: result.correct,
    correctIndex: result.correctIndex,
    explain: result.explain,
    answered: record.firstWin.answers.length,
    total: FIRST_WIN_ITEMS,
    state: { step: record.step, firstWin: normalizeFirstWin(record.firstWin) },
  };
}

/**
 * §09/§10: POST /api/onboarding/first-win/complete → summary + ACTIVATION EVENT.
 * - Scoring: ball + izohli feedback + "X mavzuda Y% — amaliyot qiling".
 * - ACTIVATION EVENT: step=checklist; activated_at saqlanadi; metric first_win_complete.
 * - Barcha 5 savolga javob berilgan bo'lishi kerak; takroriy complete → idempotent qaytariladi.
 */
export async function completeFirstWin({ userKey, lang = 'uz', ip, userAgent }) {
  const state = await getOrCreateOnboarding(userKey);
  const fw = normalizeFirstWin(state.firstWin);
  // Takroriy complete → avvalgi natijani qaytaramiz (idempotent, §15).
  // Step allaqachon checklist bo'lsa ham (completedAt mavjud) — oldin tekshiramiz.
  if (fw && fw.startedAt && fw.completedAt !== null) {
    return { ok: true, state: { ...state, firstWin: fw }, alreadyCompleted: true };
  }
  if (state.step !== 'first_win' || !fw || !fw.startedAt) {
    return { ok: false, error: 'no_active_attempt', state };
  }
  if (fw.answers.length < FIRST_WIN_ITEMS) {
    return { ok: false, error: 'not_all_answered', answered: fw.answers.length, total: FIRST_WIN_ITEMS, state };
  }
  const now = Date.now();
  const score = fw.answers.filter((a) => a.correct).length;
  const percent = Math.round((score / FIRST_WIN_ITEMS) * 100);
  const record = {
    ...state,
    step: 'checklist',
    firstWin: { ...fw, score, completedAt: now },
    activated_at: state.activated_at || now,
    updated_at: now,
  };
  await fb.set(`${ONBOARDING_PATH}/${safeKey(userKey)}`, record);
  await logAuthEvent({
    action: 'onboarding:first_win_complete',
    outcome: 'success',
    method: 'POST',
    actorId: userKey,
    ipAddress: ip,
    userAgent,
    details: { subject: fw.subject, score, total: FIRST_WIN_ITEMS, percent },
  });
  recordMetric('edikit_onboarding_first_win_complete_total', 1);
  return {
    ok: true,
    summary: {
      subject: fw.subject,
      score,
      total: FIRST_WIN_ITEMS,
      percent,
      // §09: "X mavzuda 40% — amaliyot qiling"-uslub xulosa
      message: summarizeFirstWin(fw.subject, percent),
      answers: fw.answers.map((a) => ({
        itemId: a.itemId,
        correct: a.correct,
        yourAnswer: a.answer,
        correctIndex: a.correctIndex,
        explain: a.explain,
      })),
    },
    state: { step: record.step, firstWin: normalizeFirstWin(record.firstWin) },
  };
}

function summarizeFirstWin(subject, percent) {
  const label = typeof subject === 'string' && subject ? subject : 'mavzu';
  if (percent >= 80) return `Ajoyib! ${label} bo'yicha ${percent}% — mustahkam zamin.`;
  if (percent >= 60) return `Yaxshi! ${label} bo'yicha ${percent}% — ozgina amaliyot bilan yuqori darajaga chiqasiz.`;
  return `${label} bo'yicha ${percent}% — amaliyot qiling. Har bir savol izohi keyingi urinishda yordam beradi.`;
}

// ─────────────────────── B-19: Reinforce (checklist) ───────────────────────

/**
 * §06: Checklist 5 item (quick win birinchi). `first_win` B-18'da avtomatik
 * bajarilgan — state.firstWin.completedAt mavjud bo'lsa done hisoblanadi.
 * Qolganlari foydalanuvchi belgilaydi (profil/telegram/kalendar/streak).
 */
export const CHECKLIST_ITEMS = ['profil', 'telegram', 'first_win', 'kalendar', 'streak'];

/** §28: item qayta ochilishi mumkin — done=false yuborish mumkin (settings). */
export function checklistItemState(checklist, itemId, firstWinCompleted) {
  const items = Array.isArray(checklist?.items) ? checklist.items : [];
  if (itemId === 'first_win') return !!firstWinCompleted;
  const found = items.find((x) => x.itemId === itemId);
  return !!(found && found.done);
}

export function checklistProgress(checklist, firstWinCompleted) {
  const doneCount = CHECKLIST_ITEMS.filter((id) =>
    checklistItemState(checklist, id, firstWinCompleted)
  ).length;
  return { done: doneCount, total: CHECKLIST_ITEMS.length, percent: Math.round((doneCount / CHECKLIST_ITEMS.length) * 100) };
}

function normalizeChecklist(raw, firstWinCompleted) {
  if (!raw || typeof raw !== 'object') raw = {};
  const items = CHECKLIST_ITEMS.map((id) => ({
    itemId: id,
    done: checklistItemState(raw, id, firstWinCompleted),
  }));
  return { items, completedAt: raw.completedAt ?? null, updatedAt: raw.updatedAt ?? null };
}

/**
 * §08: POST /api/onboarding/checklist { itemId, done }.
 * - User-scoped; faqat step=checklist bo'lganda ishlaydi.
 * - first_win item ni client o'zgartira olmaydi (B-18 faktiga bog'liq).
 * - Barcha done → step=done (ACTIVATION yakuni, §07); audit + metric.
 * - Idempotent: takroriy yuborish holatni o'zgartirmaydi (DB yozuvi minimal).
 */
export async function submitChecklistItem({ userKey, itemId, done, ip, userAgent }) {
  const state = await getOrCreateOnboarding(userKey);
  if (state.step !== 'checklist' && state.step !== 'done') {
    return { ok: false, error: 'not_in_checklist', state };
  }
  if (!CHECKLIST_ITEMS.includes(itemId)) {
    return { ok: false, error: 'unknown_item', state };
  }
  if (itemId === 'first_win') {
    // B-18 faktiga bog'liq — client o'zgartira olmaydi (§16/§20)
    const fwDone = !!(state.firstWin && state.firstWin.completedAt);
    return { ok: false, error: 'first_win_locked', state, firstWinDone: fwDone };
  }
  const now = Date.now();
  const fwDone = !!(state.firstWin && state.firstWin.completedAt);
  const items = CHECKLIST_ITEMS.map((id) => {
    const wasDone = checklistItemState(state.checklist, id, fwDone);
    if (id === itemId) return { itemId: id, done: !!done, changedAt: now };
    return { itemId: id, done: wasDone };
  });
  const allDone = items.every((x) => x.done);
  const record = {
    ...state,
    checklist: {
      items,
      completedAt: allDone ? now : null,
      updatedAt: now,
    },
    step: allDone ? 'done' : 'checklist',
    updated_at: now,
  };
  await fb.set(`${ONBOARDING_PATH}/${safeKey(userKey)}`, record);
  await logAuthEvent({
    action: 'onboarding:checklist',
    outcome: 'success',
    method: 'POST',
    actorId: userKey,
    ipAddress: ip,
    userAgent,
    details: { itemId, done: !!done, step: record.step, progress: checklistProgress(record.checklist, fwDone) },
  });
  if (allDone) recordMetric('edikit_onboarding_checklist_complete_total', 1);
  return {
    ok: true,
    step: record.step,
    progress: checklistProgress(record.checklist, fwDone),
    state: { step: record.step, checklist: record.checklist },
  };
}

/** View uchun: checklist items + progress (B-19 §07 sticky progress). */
export function getChecklistView(state) {
  const fwDone = !!(state.firstWin && state.firstWin.completedAt);
  return {
    items: CHECKLIST_ITEMS.map((id) => ({
      itemId: id,
      done: checklistItemState(state.checklist, id, fwDone),
      locked: id === 'first_win',
    })),
    progress: checklistProgress(state.checklist, fwDone),
    completedAt: state.checklist?.completedAt ?? null,
  };
}
