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

// ── S26: Dars reja generator (o'qituvchi uchun) ──
const LANG_NAME = { uz: "o'zbek (lotin)", ru: 'rus', en: 'ingliz' };
function sanitizePlan(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const stages = Array.isArray(p.stages) ? p.stages.slice(0, 12).map((s, i) => ({
    name: String(s?.name || 'Bosqich ' + (i + 1)).slice(0, 120),
    minutes: Math.max(1, Math.min(240, Number(s?.minutes) || 5)),
    teacher: String(s?.teacher || '').slice(0, 500),
    students: String(s?.students || '').slice(0, 500),
  })) : [];
  return {
    title: String(p.title || 'Dars rejasi').slice(0, 200),
    objectives: Array.isArray(p.objectives) ? p.objectives.slice(0, 8).map((o) => String(o).slice(0, 300)) : [],
    materials: Array.isArray(p.materials) ? p.materials.slice(0, 10).map((o) => String(o).slice(0, 200)) : [],
    stages,
    homework: String(p.homework || '').slice(0, 600),
    assessment: String(p.assessment || '').slice(0, 600),
  };
}

router.post('/api/ai/lesson-plan', requireAuth, requireStudio, async (req, res) => {
  const key = req.session?.user?.safeKey || req.ip || 'anon';
  if (rateLimited(key)) return res.status(429).json({ ok: false, error: 'rate_limited', retryAfterSeconds: 60 });
  const subject = String(req.body?.subject || '').trim();
  const topic = String(req.body?.topic || '').trim();
  if (subject.length < 2 || subject.length > 120 || topic.length < 3 || topic.length > 300) {
    return res.status(400).json({ ok: false, error: 'invalid_input', message: 'Fan va mavzu to\u2018ldirilsin' });
  }
  if (!isAiEnabled()) return res.status(503).json({ ok: false, error: 'not_configured' });
  const grade = String(req.body?.grade || '').slice(0, 40);
  const duration = Math.max(20, Math.min(240, Number(req.body?.duration) || 45));
  const lang = ['uz', 'ru', 'en'].includes(req.body?.lang) ? req.body.lang : 'uz';
  const sys = 'Sen tajribali o\u2018qituvchi va metodistsan. Faqat ' + (LANG_NAME[lang]) + ' tilida javob ber.';
  const usr = `Dars rejasi tuz: fan="${subject}", mavzu="${topic}", sinf/kurs="${grade}", davomiyligi=${duration} daqiqa. Bosqichlar daqiqalari yig'indisi ${duration} ga teng bo'lsin. Javob FAQAT JSON: {"title":"...","objectives":["..."],"materials":["..."],"stages":[{"name":"...","minutes":10,"teacher":"...","students":"..."}],"homework":"...","assessment":"..."}`;
  const r = await aiGenerateText(usr, { systemInstruction: sys, maxOutputTokens: 4096 });
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error });
  const plan = sanitizePlan(extractJson(r.text));
  if (!plan.stages.length) return res.status(502).json({ ok: false, error: 'bad_format' });
  res.json({ ok: true, plan, model: r.model });
});

// ── S26: Material / maqola tavsiyalari ──
// AI faqat kalit so'zlar va tavsiflar beradi; HAR HAVOLA serverda real qidiruv
// deep-linkidan yasaladi (AI URL o'ylamaydi — soxta link yo'q).
const SEARCH_ENGINES = [
  { id: 'scholar', label: '🎓 Google Scholar', build: (q) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}` },
  { id: 'google', label: '🔎 Google', build: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: 'youtube', label: '▶️ YouTube', build: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
];

router.post('/api/ai/recommend-materials', requireAuth, requireStudio, async (req, res) => {
  const key = req.session?.user?.safeKey || req.ip || 'anon';
  if (rateLimited(key)) return res.status(429).json({ ok: false, error: 'rate_limited', retryAfterSeconds: 60 });
  const subject = String(req.body?.subject || '').trim();
  const topic = String(req.body?.topic || '').trim();
  if (subject.length < 2 || subject.length > 120 || topic.length < 3 || topic.length > 300) {
    return res.status(400).json({ ok: false, error: 'invalid_input', message: 'Fan va mavzu to\u2018ldirilsin' });
  }
  if (!isAiEnabled()) return res.status(503).json({ ok: false, error: 'not_configured' });
  const level = String(req.body?.level || '').slice(0, 40);
  const lang = ['uz', 'ru', 'en'].includes(req.body?.lang) ? req.body.lang : 'uz';
  const sys = 'Sen ta\u2018lim resurslaridan xabardor kutubxonachisan. Faqat ' + (LANG_NAME[lang]) + ' tilida javob ber.';
  const usr = `Mavzu bo'yicha o'qish/tayyorlanish uchun material tavsiyalari: fan="${subject}", mavzu="${topic}", daraja="${level}". Javob FAQAT JSON: {"keywords":["kalit so'zlar"],"items":[{"title":"material nomi (kitob/darslik/maqola/video/kurs turi bilan)","type":"maqola|darslik|video|kurs","level":"boshlang'ich|o'rta|yuqori","why":"nimaga kerak (1-2 jumla)"}],"queries":["qidiruv so'rovlari (3-5 ta)"]}`;
  const r = await aiGenerateText(usr, { systemInstruction: sys, maxOutputTokens: 3000 });
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error });
  const raw = extractJson(r.text);
  if (!raw || !Array.isArray(raw.items)) return res.status(502).json({ ok: false, error: 'bad_format' });
  const queries = (Array.isArray(raw.queries) ? raw.queries : [`${subject} ${topic}`])
    .slice(0, 6).map((q) => String(q).slice(0, 160)).filter(Boolean);
  const fallbackQ = `${subject} ${topic} ${level}`.trim();
  if (!queries.length) queries.push(fallbackQ);
  const links = queries.map((q) => ({ q, engines: SEARCH_ENGINES.map((e) => ({ id: e.id, label: e.label, url: e.build(q) })) }));
  const items = raw.items.slice(0, 10).map((it) => ({
    title: String(it?.title || '').slice(0, 300),
    type: ['maqola', 'darslik', 'video', 'kurs'].includes(it?.type) ? it.type : 'material',
    level: String(it?.level || '').slice(0, 40),
    why: String(it?.why || '').slice(0, 400),
  })).filter((it) => it.title);
  res.json({ ok: true, rec: { keywords: (raw.keywords || []).slice(0, 10).map((k) => String(k).slice(0, 60)), items, links }, model: r.model });
});

// ── S26: dars rejasi → eksport bloklari ──
function planToPdfBlocks(plan) {
  const b = [];
  b.push({ type: 'h2', text: 'Maqsadlar' });
  (plan.objectives || []).forEach((o) => b.push({ type: 'bullet', text: o }));
  b.push({ type: 'gap' });
  if ((plan.materials || []).length) {
    b.push({ type: 'h2', text: 'Kerakli jihozlar' });
    plan.materials.forEach((m) => b.push({ type: 'bullet', text: m }));
    b.push({ type: 'gap' });
  }
  b.push({ type: 'h2', text: 'Dars kechishi' });
  (plan.stages || []).forEach((s, i) => {
    b.push({ type: 'text', text: `${i + 1}. ${s.name} (${s.minutes} daqiqa)`, bold: true });
    if (s.teacher) b.push({ type: 'bullet', text: 'O\u2018qituvchi: ' + s.teacher });
    if (s.students) b.push({ type: 'bullet', text: 'O\u2018quvchi: ' + s.students });
  });
  b.push({ type: 'gap' }, { type: 'h2', text: 'Uy vazifasi' }, { type: 'text', text: plan.homework || '—' });
  b.push({ type: 'gap' }, { type: 'h2', text: 'Baholash' }, { type: 'text', text: plan.assessment || '—' });
  return b;
}
function planToDocxBlocks(plan) {
  const b = [];
  b.push({ t: 'h1', text: 'Maqsadlar' });
  (plan.objectives || []).forEach((o) => b.push({ t: 'bullet', text: o }));
  if ((plan.materials || []).length) {
    b.push({ t: 'h1', text: 'Kerakli jihozlar' });
    plan.materials.forEach((m) => b.push({ t: 'bullet', text: m }));
  }
  b.push({ t: 'h1', text: 'Dars kechishi' });
  (plan.stages || []).forEach((s, i) => {
    b.push({ t: 'h2', text: `${i + 1}. ${s.name} (${s.minutes} daqiqa)` });
    if (s.teacher) b.push({ t: 'bullet', text: 'O\u2018qituvchi: ' + s.teacher });
    if (s.students) b.push({ t: 'bullet', text: 'O\u2018quvchi: ' + s.students });
  });
  b.push({ t: 'h1', text: 'Uy vazifasi' }, { t: 'p', text: plan.homework || '—' });
  b.push({ t: 'h1', text: 'Baholash' }, { t: 'p', text: plan.assessment || '—' });
  return b;
}

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
      // Deck YOKI savollar YOKI dars rejasi → haqiqiy .pdf (Noto Sans embed)
      const deck = req.body?.deck;
      const questions = req.body?.questions;
      if (req.body?.kind === 'plan' && req.body?.plan?.stages?.length) {
        const plan = req.body.plan;
        const buf = buildPdf({ title: plan.title || name + ' — dars rejasi', subtitle: `AI Studiya · Deborah · ${plan.stages.reduce((a, s) => a + (s.minutes || 0), 0)} daqiqa`, blocks: planToPdfBlocks(plan), footerName: name });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${name}-dars-rejasi.pdf"`);
        return res.send(buf);
      }
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
      if (req.body?.kind === 'plan' && req.body?.plan?.stages?.length) {
        const plan = req.body.plan;
        const buf = buildDocx({ title: plan.title || name + ' — dars rejasi', subtitle: 'AI Studiya · Deborah', blocks: planToDocxBlocks(plan) });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${name}-dars-rejasi.docx"`);
        return res.send(buf);
      }
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
