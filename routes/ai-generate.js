/**
 * Deborah — REAL AI generatsiya API (Gemini)
 * ---------------------------------------------------------
 * Foydalanuvchi qarori (2026-08-26): AI "simulyatsiya" emas — real.
 *
 *   GET  /api/ai/status              → { enabled, model } (kalit ko'rinmaydi)
 *   POST /api/ai/generate-questions  → real savollar (auth + rate limit)
 *
 * Ishlatiladi: cast director Quick Prompt (AI ✨), panel test yaratish.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAiEnabled, aiGenerateQuestions } from '../src/modules/ai/gemini-client.js';
import { recordMetric } from '../src/telemetry/index.js';

const router = Router();

// Per-user rate limit (in-memory; sessiyasiz attacker'lar uchun IP)
const RATE_MAX = 12; // daqiqada
const RATE_DAILY = 300;
const hits = new Map(); // key -> {min, minAt, day, dayAt}
function rateLimited(key) {
  const now = Date.now();
  let e = hits.get(key);
  if (!e) { e = { min: 0, minAt: now, day: 0, dayAt: now }; hits.set(key, e); }
  if (now - e.minAt >= 60_000) { e.min = 0; e.minAt = now; }
  if (now - e.dayAt >= 86_400_000) { e.day = 0; e.dayAt = now; }
  e.min++; e.day++;
  if (hits.size > 20_000) { // xotira guard
    for (const [k, v] of hits) if (now - v.dayAt > 86_400_000) hits.delete(k);
  }
  return e.min > RATE_MAX || e.day > RATE_DAILY;
}

router.get('/api/ai/status', (req, res) => {
  res.json({ enabled: isAiEnabled(), model: isAiEnabled() ? (process.env.GEMINI_MODEL || 'gemini-3.6-flash') : null });
});

router.post('/api/ai/generate-questions', requireAuth, async (req, res) => {
  const key = req.session?.user?.safeKey || req.ip || 'anon';
  if (rateLimited(key)) {
    return res.status(429).json({ ok: false, error: 'rate_limited', retryAfterSeconds: 60 });
  }
  if (!isAiEnabled()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  const prompt = String(req.body?.prompt || '').trim();
  if (prompt.length < 3 || prompt.length > 600) {
    return res.status(400).json({ ok: false, error: 'invalid_prompt' });
  }
  const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 10);
  const lang = ['uz', 'ru', 'en'].includes(req.body?.lang) ? req.body.lang : 'uz';
  const difficulty = ['easy', 'medium', 'hard', 'mixed'].includes(req.body?.difficulty) ? req.body.difficulty : 'mixed';
  const type = req.body?.type === 'true_false' ? 'true_false' : 'single_choice';

  const started = Date.now();
  const result = await aiGenerateQuestions({ prompt, count, lang, difficulty, type });
  try {
    recordMetric('ai.generate_questions', 1, {
      type: 'counter',
      labels: { ok: result.ok ? 'true' : 'false', lang, count: String(count) },
    });
  } catch (_) { /* telemetry fail-soft */ }

  if (!result.ok) {
    const status = result.error === 'rate_limited' ? 429
      : result.error === 'not_configured' ? 503
      : result.error === 'invalid_prompt' || result.error === 'bad_format' ? 502
      : 500;
    return res.status(status).json({ ok: false, error: result.error });
  }
  return res.json({ ok: true, questions: result.questions, model: result.model, ms: Date.now() - started });
});

export default router;
