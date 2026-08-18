/**
 * AUTH B-17 — Onboarding routes (state machine + Orient ekran)
 * ---------------------------------------------------------------------------
 * GET  /onboarding            → stepper view (step bo'yicha: welcome → Orient)
 * POST /api/onboarding/orient → { subject?, goal? } → step=first_win
 * POST /api/onboarding/skip   → Orient'ni o'tkazib yuborish → step=first_win
 * GET  /api/onboarding/demo   → demo savol (public DTO — answer key server'da)
 *
 * Security: barcha POST'lar global validateCsrf + originCheck bilan himoyalangan
 * (server.js). State user-scoped (`onboarding/{safeKey}`) — IDOR'ga yopiq.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { safeReturnUrl } from '../src/modules/auth/session-timeout.js';
import { AUTH_COPY, AUTH_LANGS, resolveAuthLang } from '../data/auth-i18n.js';
import {
  getOrCreateOnboarding,
  getOnboardingState,
  submitOrient,
  skipOrient,
  onboardingProgress,
  startFirstWin,
  submitFirstWinAnswer,
  completeFirstWin,
  submitChecklistItem,
  getChecklistView,
  CHECKLIST_ITEMS,
  DEMO_SUBJECTS,
  DEMO_SUBJECT_LABELS,
  getDemoQuestion,
  checkDemoAnswer,
  getFirstWinSet,
} from '../src/modules/onboarding/index.js';
import { logAuthEvent } from '../src/modules/auth/audit.js';

const router = Router();

// → Faqat onboarding yo'llari login talab qiladi. Router '/' da mount
// qilingani uchun shartsiz router.use(requireAuth) BARCHA so'rovlarni ushlab
// qolardi (boshqa router'larga tushmasdi) — path scope kerak.
router.use((req, res, next) => {
  const p = req.path;
  if (p === '/onboarding' || p.startsWith('/api/onboarding/')) {
    return requireAuth(req, res, next);
  }
  next();
});

async function resolveLang(req, userKey) {
  let lang = 'uz';
  try {
    const snap = await fb.get(`users/${userKey}/settings/lang`);
    if (snap.exists() && snap.val()) lang = snap.val();
  } catch (_) {}
  // URL'dagi ?lang= ustun — tildan tez o'tish uchun (AUTH i18n konventsiyasi)
  const qLang = req.query?.lang;
  if (typeof qLang === 'string' && AUTH_LANGS.includes(qLang)) lang = qLang;
  return resolveAuthLang(lang);
}

// ── GET /onboarding — stepper view; step bo'yicha kontent ──
// AUTH B-30 §07: onboarding'dan keyin qaytish manzili — allowlist (safeReturnUrl),
// open redirect YO'Q. Default `/user/panel`. Session'da saqlanadi — onboarding
// yarim qolsa ham keyingi bosqichda bir xil manzilga qaytadi.
router.get('/onboarding', async (req, res) => {
  const user = req.session.user;
  const userKey = user.safeKey;
  try {
    if (typeof req.query.returnUrl === 'string') {
      const target = safeReturnUrl(req.query.returnUrl);
      if (target) req.session.onboardingReturnUrl = target;
    }
    const state = await getOrCreateOnboarding(userKey);
    const l = await resolveLang(req, userKey);
    const copy = AUTH_COPY[l];

    // §17: onboarding_view audit (fire-and-forget, view'ni bloklamaydi)
    logAuthEvent({
      action: 'onboarding:view',
      outcome: 'success',
      method: 'GET',
      actorId: userKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
      details: { step: state.step },
    }).catch(() => {});

    res.render('user/onboarding', {
      title: copy.onboarding.title,
      lang: l,
      AUTH_LANGS,
      copy: copy.onboarding,
      csrfToken: res.locals.csrfToken || '',
      username: user.username || userKey,
      step: state.step,
      orient: state.orient,
      progress: onboardingProgress(state),
      checklist: getChecklistView(state),
      subjects: DEMO_SUBJECTS,
      subjectLabels: DEMO_SUBJECT_LABELS,
      // B-30 §07: tugagach qaytish manzili (allowlist'dan) — view'dagi tugma
      returnUrl: req.session.onboardingReturnUrl || '/user/panel',
    });
  } catch (err) {
    console.error('Onboarding page error:', err);
    res.status(500).render('error', { title: '500', message: 'Server xatosi', status: 500 });
  }
});

// ── POST /api/onboarding/orient — { subject?, goal? } → first_win (§10) ──
router.post('/api/onboarding/orient', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const { subject, goal } = req.body || {};
  // §15/§20: `step` parametri QABUL QILINMAYDI — client step o'zgartira olmaydi.
  try {
    const { state, alreadyAdvanced } = await submitOrient({
      userKey,
      subject: typeof subject === 'string' && subject ? subject.slice(0, 50) : null,
      goal: typeof goal === 'string' && goal ? goal.slice(0, 120) : null,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });
    return res.json({ ok: true, state: { step: state.step }, alreadyAdvanced });
  } catch (err) {
    console.error('Onboarding orient error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── POST /api/onboarding/skip — Orient'ni skip qilish (§09) ──
router.post('/api/onboarding/skip', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const { state, alreadyAdvanced } = await skipOrient({
      userKey,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });
    return res.json({ ok: true, state: { step: state.step }, alreadyAdvanced });
  } catch (err) {
    console.error('Onboarding skip error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── GET /api/onboarding/demo?subject=&lang= — demo savol (public DTO) ──
router.get('/api/onboarding/demo', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const l = await resolveLang(req, userKey);
  const subject = typeof req.query?.subject === 'string' ? req.query.subject : DEMO_SUBJECTS[0];
  const question = getDemoQuestion(subject, l) || getDemoQuestion(subject, 'uz');
  if (!question) return res.status(404).json({ ok: false, error: 'unknown_subject' });
  // Public DTO — `correct` YO'Q (§11)
  return res.json({ ok: true, question, subject });
});

// ── POST /api/onboarding/demo/answer — server'da tekshirish (§11) ──
router.post('/api/onboarding/demo/answer', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const { subject, questionId, answer } = req.body || {};
  const l = await resolveLang(req, userKey);
  const result = checkDemoAnswer(subject, l, questionId, answer);
  if (!result.ok) return res.status(400).json(result);
  return res.json(result);
});

// ── B-18 §06: POST /api/onboarding/first-win/start — 5 savol (public DTO) ──
router.post('/api/onboarding/first-win/start', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const l = await resolveLang(req, userKey);
  const subject = typeof req.body?.subject === 'string' && req.body.subject
    ? req.body.subject.slice(0, 50)
    : null;
  const validSubject = subject && DEMO_SUBJECTS.includes(subject) ? subject : null;
  const { ok, state, alreadyStarted, error } = await startFirstWin({
    userKey,
    subject: validSubject,
    lang: l,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  });
  if (!ok) {
    const code = error === 'not_in_first_win' ? 409 : 500;
    return res.status(code).json({ ok: false, error });
  }
  // Answer key server'da — public DTO: faqat {id,text,options}
  const fwSubject = validSubject || state.orient?.subject || DEMO_SUBJECTS[0];
  const questions = getFirstWinSet(fwSubject, l);
  return res.json({
    ok: true,
    alreadyStarted,
    subject: fwSubject,
    total: questions.length,
    answered: state.firstWin?.answers?.length || 0,
    questions,
  });
});

// ── B-18 §08: POST /api/onboarding/first-win/answer — server scoring + izoh ──
router.post('/api/onboarding/first-win/answer', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const { itemId, answer } = req.body || {};
  const l = await resolveLang(req, userKey);
  const result = await submitFirstWinAnswer({
    userKey,
    itemId: typeof itemId === 'string' ? itemId.slice(0, 80) : null,
    answer,
    lang: l,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  });
  if (!result.ok) {
    const code = result.error === 'duplicate_answer' ? 409
      : (result.error === 'no_active_attempt' ? 409
      : (result.error === 'unknown_question' || result.error === 'invalid_answer' ? 400 : 500));
    return res.status(code).json({ ok: false, error: result.error });
  }
  return res.json(result);
});

// ── B-19 §08: POST /api/onboarding/checklist — { itemId, done } ──
router.post('/api/onboarding/checklist', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const { itemId, done } = req.body || {};
  if (typeof itemId !== 'string' || !CHECKLIST_ITEMS.includes(itemId)) {
    return res.status(400).json({ ok: false, error: 'unknown_item' });
  }
  const result = await submitChecklistItem({
    userKey,
    itemId: itemId.slice(0, 30),
    done: done === true,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  });
  if (!result.ok) {
    const code = result.error === 'unknown_item' || result.error === 'first_win_locked' ? 400
      : (result.error === 'not_in_checklist' ? 409 : 500);
    return res.status(code).json(result);
  }
  return res.json(result);
});

// ── B-18 §09/§10: POST /api/onboarding/first-win/complete — ACTIVATION EVENT ──
router.post('/api/onboarding/first-win/complete', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const l = await resolveLang(req, userKey);
  const result = await completeFirstWin({
    userKey,
    lang: l,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  });
  if (!result.ok) {
    const code = result.error === 'not_all_answered' ? 400
      : (result.error === 'no_active_attempt' ? 409 : 500);
    return res.status(code).json({ ok: false, error: result.error, answered: result.answered, total: result.total });
  }
  // B-30 §07: onboarding tugadi — original returnUrl'ga (allowlist) yoki /user/panel
  const target = req.session.onboardingReturnUrl || '/user/panel';
  delete req.session.onboardingReturnUrl;
  return res.json({ ...result, returnUrl: target });
});

export default router;
