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
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { isAiEnabled, aiGenerateQuestions, aiGenerateSlides, aiGenerateVision, aiGenerateText, extractJson } from '../src/modules/ai/gemini-client.js';
import { recordMetric } from '../src/telemetry/index.js';
import { buildPptx } from '../utils/minipptx.js';
import { buildDocx, deckToDocxBlocks, questionsToDocxBlocks } from '../utils/minidocx.js';
import { buildPdf, deckToPdfBlocks, questionsToPdfBlocks } from '../utils/minipdf.js';

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


// ═══════════════════════════════════════════════════════════════════
// S22 — AI Studiya (VIP userlar + o'qituvchilar uchun)
// Oddiy student: faqat Cast paytida AI (quick prompt) — studiya yopiq.
// ═══════════════════════════════════════════════════════════════════

async function isAiStudioMember(req) {
  if (!req.session?.user) return false;
  const role = req.session.user.role;
  if (role === 'teacher' || role === 'admin' || role === 'board') return true;
  try {
    const snap = await fb.get(`users/${req.session.user.safeKey}/isVip`);
    if (snap.exists() && snap.val() === true) return true;
  } catch (_) {}
  return false;
}

async function requireStudio(req, res, next) {
  if (!(await isAiStudioMember(req))) {
    return res.status(403).render('error', { title: '403', message: "AI Studiya VIP a'zolar va o'qituvchilar uchun", status: 403 });
  }
  next();
}

router.get('/user/ai-studio', requireAuth, requireStudio, (req, res) => {
  res.render('user/ai-studio', {
    title: 'AI Studiya',
    username: req.session.user.username,
    role: req.session.user.role || 'student',
    csrfToken: res.locals.csrfToken || req.session.csrfToken || '',
    aiEnabled: isAiEnabled(),
  });
});

// ── AI slayd generatsiya ──
router.post('/api/ai/generate-slides', requireAuth, requireStudio, async (req, res) => {
  const topic = String(req.body?.topic || '').trim();
  if (topic.length < 3 || topic.length > 600) {
    return res.status(400).json({ ok: false, error: 'invalid_topic' });
  }
  if (!isAiEnabled()) return res.status(503).json({ ok: false, error: 'not_configured' });
  const count = Math.min(Math.max(Number(req.body?.count) || 6, 1), 15);
  const lang = ['uz', 'ru', 'en'].includes(req.body?.lang) ? req.body.lang : 'uz';
  const result = await aiGenerateSlides({ topic, count, lang });
  if (!result.ok) {
    const status = result.error === 'not_configured' ? 503 : result.error === 'bad_format' ? 502 : 500;
    return res.status(status).json({ ok: false, error: result.error });
  }
  res.json({ ok: true, deck: result.deck, model: result.model });
});

// ── OCR: fayl (rasm/pdf) → matn → savollar yoki slaydlar ──
const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp)$/.test(file.mimetype) || file.mimetype === 'application/pdf';
    if (ok) return cb(null, true);
    cb(new Error('Faqat PNG/JPG/WEBP rasm yoki PDF (≤12MB)'));
  },
});

router.post('/api/ai/ocr-generate', requireAuth, requireStudio, ocrUpload.single('file'), async (req, res) => {
  try {
    if (!isAiEnabled()) return res.status(503).json({ ok: false, error: 'not_configured' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'file_required' });
    const mode = req.body?.mode === 'slides' ? 'slides' : 'questions';
    const extra = String(req.body?.prompt || '').slice(0, 500);
    const lang = ['uz', 'ru', 'en'].includes(req.body?.lang) ? req.body.lang : 'uz';

    // 1) Matnni ajratish: PDF → pdf-parse (text layer); rasm → Gemini vision OCR
    let text = '';
    if (req.file.mimetype === 'application/pdf') {
      // pdf-parse 2.x: PDFParse sinfi (S23 — eski .default 2.x'da YO'Q edi)
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: req.file.buffer });
      let parsed;
      try {
        parsed = await parser.getText();
      } finally {
        await parser.destroy().catch(() => {});
      }
      const parsedText = String(parsed?.text || '').trim();
      // Text layer juda kambag'al bo'lsa — birinchi sahifani rasm sifatida vision'ga
      if (parsedText.length < 40) {
        return res.status(400).json({ ok: false, error: 'pdf_no_text', message: "PDFda matn qatlami yo'q — rasmni PNG/JPG sifatida yuklang" });
      }
      text = parsedText;
    } else {
      const sharp = (await import('sharp')).default;
      const png = await sharp(req.file.buffer).rotate().resize({ width: 1600, height: 2200, fit: 'inside', withoutEnlargement: true }).png({ quality: 90 }).toBuffer();
      const v = await aiGenerateVision({
        base64: png.toString('base64'),
        mimeType: 'image/png',
        prompt: "Bu rasmdagi BARCHA matnni aniq ajratib ber (OCR). Tartibni, ro'yxatlarni va jadval strukturasini saqla. Faqat matnni qaytar.",
      });
      if (!v.ok) return res.status(v.error === 'not_configured' ? 503 : 500).json({ ok: false, error: 'ocr_' + v.error });
      text = v.text;
    }
    if (!text || text.length < 20) return res.status(400).json({ ok: false, error: 'no_text' });
    const sourceText = text.slice(0, 12000);

    // 2) Matndan savollar yoki slaydlar
    if (mode === 'slides') {
      const sys = 'Sen professional taqdimot muallifisan. Faqat ' + ({ uz: "o'zbek (lotin)", ru: 'rus', en: 'ingliz' }[lang]) + ' tilida javob ber.';
      const usr = `Quyidagi matndan 4-8 slaydli taqdimot tuz${extra ? ' (qo\u2018shimcha talab: ' + extra + ')' : ''}.\nJavob FAQAT JSON: {"title":"...","slides":[{"title":"...","bullets":["...","..."]}]}\n\nMATN:\n${sourceText}`;
      const r = await aiGenerateText(usr, { systemInstruction: sys, maxOutputTokens: 4096 });
      if (!r.ok) return res.status(502).json({ ok: false, error: r.error });
      const deck = extractJson(r.text);
      if (!deck || !Array.isArray(deck.slides)) return res.status(502).json({ ok: false, error: 'bad_format' });
      return res.json({ ok: true, mode, textPreview: sourceText.slice(0, 400), deck });
    }
    const sys = 'Sen professional test muallifisan. Faqat ' + ({ uz: "o'zbek (lotin)", ru: 'rus', en: 'ingliz' }[lang]) + ' tilida javob ber.';
    const usr = `Quyidagi matndan 5-10 ta variantli test savoli tuz${extra ? ' (qo\u2018shimcha talab: ' + extra + ')' : ''}.\nJavob FAQAT JSON array: [{"text":"savol","options":["A","B","C","D"],"correctIndex":0,"explanation":"qisqa izoh"}]\n\nMATN:\n${sourceText}`;
    const r = await aiGenerateText(usr, { systemInstruction: sys, maxOutputTokens: 4096 });
    if (!r.ok) return res.status(502).json({ ok: false, error: r.error });
    const arr = extractJson(r.text);
    if (!Array.isArray(arr)) return res.status(502).json({ ok: false, error: 'bad_format' });
    const questions = arr.slice(0, 10).map((q) => ({
      text: String(q?.text || '').slice(0, 800),
      options: Array.isArray(q?.options) ? q.options.slice(0, 6).map((o) => String(o).slice(0, 300)) : [],
      correctIndex: Number.isInteger(q?.correctIndex) ? q.correctIndex : 0,
      explanation: String(q?.explanation || '').slice(0, 500),
    })).filter((q) => q.text && q.options.length >= 2);
    return res.json({ ok: true, mode, textPreview: sourceText.slice(0, 400), questions });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Eksport: xlsx / pptx (server-side, haqiqiy fayl) ──
router.post('/api/ai/export', requireAuth, requireStudio, async (req, res) => {
  try {
    const format = ['pptx', 'pdf', 'docx'].includes(req.body?.format) ? req.body.format : 'xlsx';
    const name = String(req.body?.name || 'deborah').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'deborah';
    if (format === 'pptx') {
      const deck = req.body?.deck;
      if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
        return res.status(400).json({ ok: false, error: 'deck_required' });
      }
      const buf = buildPptx(deck);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.pptx"`);
      return res.send(buf);
    }
    if (format === 'pdf') {
      // Deck YOKI savollar → haqiqiy .pdf (Noto Sans embed: o'zbek lotin + kiril)
      const deck = req.body?.deck;
      const questions = req.body?.questions;
      if (deck && Array.isArray(deck.slides) && deck.slides.length) {
        const buf = buildPdf({ title: deck.title || name, subtitle: 'AI Studiya · Deborah', blocks: deckToPdfBlocks(deck), footerName: name });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
        return res.send(buf);
      }
      if (Array.isArray(questions) && questions.length) {
        const buf = buildPdf({ title: (deck?.title || name) + ' — savollar', subtitle: 'AI Studiya · Deborah', blocks: questionsToPdfBlocks(questions), footerName: name });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${name}-savollar.pdf"`);
        return res.send(buf);
      }
      return res.status(400).json({ ok: false, error: 'deck_or_questions_required' });
    }
    if (format === 'docx') {
      const deck = req.body?.deck;
      const questions = req.body?.questions;
      if (deck && Array.isArray(deck.slides) && deck.slides.length) {
        const buf = buildDocx({ title: deck.title || name, subtitle: 'AI Studiya · Deborah', blocks: deckToDocxBlocks(deck) });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${name}.docx"`);
        return res.send(buf);
      }
      if (Array.isArray(questions) && questions.length) {
        const buf = buildDocx({ title: name + ' — savollar', subtitle: 'AI Studiya · Deborah', blocks: questionsToDocxBlocks(questions) });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${name}-savollar.docx"`);
        return res.send(buf);
      }
      return res.status(400).json({ ok: false, error: 'deck_or_questions_required' });
    }
    const questions = req.body?.questions;
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ ok: false, error: 'questions_required' });
    }
    const XLSX = await import('xlsx');
    const rows = [['#', 'Savol', ...['A', 'B', 'C', 'D', 'E', 'F'], 'To\u2018g\u2018ri', 'Izoh']];
    questions.forEach((q, i) => {
      const opts = [0, 1, 2, 3, 4, 5].map((j) => String(q.options?.[j] || ''));
      rows.push([i + 1, String(q.text || ''), ...opts, String(q.options?.[q.correctIndex] || ''), String(q.explanation || '')]);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Savollar');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-savollar.xlsx"`);
    return res.send(buf);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});
