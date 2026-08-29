/**
 * Deborah — REAL AI (Gemini) klienti
 * ------------------------------------------------------------------
 * Foydalanuvchi qarori (2026-08-26): AI modullari "CI simulyatsiya"
 * emas — HAQIQIY generatsiya bo'lishi shart. Bu klient barcha AI
 * funksiyalari uchun yagona kirish nuqtasi:
 *
 *   - GEMINI_API_KEY (Render env) — yo'q bo'lsa isAiEnabled() false
 *     va chaqiruvlar { ok:false, error:'not_configured' } qaytaradi
 *     (UI'da AI tugmalari "sozlanmagan" holatda ko'rinadi).
 *   - GEMINI_MODEL (default: gemini-3.6-flash)
 *   - Timeout + 1 retry + xavfsiz JSON ajratish (```json bloklari).
 *   - Kalit hech qachon javobga/logga chiqmaydi.
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 25_000;

export function isAiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
}

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
}

/**
 * Matn generatsiyasi (real Gemini chaqiruvi).
 * @returns {Promise<{ok:true,text:string,model:string}|{ok:false,error:string,httpStatus?:number}>}
 */
export async function aiGenerateText(prompt, { systemInstruction = '', maxOutputTokens = 2048, timeoutMs = TIMEOUT_MS } = {}) {
  if (!isAiEnabled()) return { ok: false, error: 'not_configured' };
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 2) {
    return { ok: false, error: 'invalid_prompt' };
  }
  const body = {
    contents: [{ role: 'user', parts: [{ text: String(prompt).slice(0, 8000) }] }],
    generationConfig: { maxOutputTokens, temperature: 0.7 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: String(systemInstruction).slice(0, 4000) }] };
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/${DEFAULT_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || '')
          .join('')
          .trim();
        if (text) return { ok: true, text, model: DEFAULT_MODEL };
        lastErr = { error: 'empty_response', httpStatus: 200 };
      } else if (res.status === 429 || res.status >= 500) {
        // retry'ga arziydi (rate limit / vaqtinchalik xato)
        lastErr = { error: `upstream_${res.status}`, httpStatus: res.status };
        await new Promise((r) => setTimeout(r, 600 + attempt * 900));
        continue;
      } else {
        const err = await res.json().catch(() => ({}));
        // Kalit haqida detallarni tashqariga chiqarmaslik
        return { ok: false, error: err?.error?.status ? String(err.error.status).toLowerCase() : `upstream_${res.status}`, httpStatus: res.status };
      }
    } catch (e) {
      clearTimeout(timer);
      lastErr = { error: e.name === 'AbortError' ? 'timeout' : 'network' };
    }
  }
  return { ok: false, ...lastErr };
}

/** Javob matnidan birinchi JSON obyekt/array'ni xavfsiz ajratib oladi. */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.search(/[[{]/);
  if (start === -1) return null;
  const opener = raw[start];
  const closer = opener === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === opener || (opener === '[' && ch === '{') || (opener === '{' && ch === '[')) {
      if (ch === opener) depth++;
    } else if (ch === closer || ch === '}' || ch === ']') {
      if (ch === closer) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(raw.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
  }
  return null;
}

/**
 * S22: Ko'p formatli (vision/OCR) generatsiya — rasm/pdf sahifasini inlineData
 * sifatida Gemini'ga yuboradi (haqiqiy OCR, lokal tesseract kerak emas).
 * @returns {Promise<{ok:true,text:string,model:string}|{ok:false,error:string}>}
 */
export async function aiGenerateVision({ base64, mimeType = 'image/png', prompt, systemInstruction = '', maxOutputTokens = 4096, timeoutMs = TIMEOUT_MS } = {}) {
  if (!isAiEnabled()) return { ok: false, error: 'not_configured' };
  if (!base64 || typeof base64 !== 'string') return { ok: false, error: 'invalid_prompt' };
  const body = {
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: String(prompt || 'Matnni to\u2018liq ajratib ber, formatini saqlab.').slice(0, 8000) },
    ] }],
    generationConfig: { maxOutputTokens, temperature: 0.3 },
  };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: String(systemInstruction).slice(0, 4000) }] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/${DEFAULT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err?.error?.status ? String(err.error.status).toLowerCase() : `upstream_${res.status}` };
    }
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    return text ? { ok: true, text, model: DEFAULT_MODEL } : { ok: false, error: 'empty_response' };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

const LANG_NAME = { uz: "o'zbek (lotin)", ru: 'rus', en: 'ingliz' };

/**
 * Test savollari generatsiyasi — REAL AI.
 * @param {{prompt:string,count?:number,lang?:'uz'|'ru'|'en',difficulty?:string,type?:string}} input
 * @returns {Promise<{ok:true,questions:Array<{text:string,options:string[],correctIndex:number,explanation:string}>,model:string}
 *           |{ok:false,error:string}>}
 */
export async function aiGenerateQuestions({ prompt, count = 1, lang = 'uz', difficulty = 'mixed', type = 'single_choice' } = {}) {
  const n = Math.min(Math.max(Number(count) || 1, 1), 10);
  const langName = LANG_NAME[lang] || LANG_NAME.uz;
  const sys = `Sen professional test muallifisan. Faqat ${langName} tilida javob ber. Har bir savol mustaqil, aniq, bitta to'g'ri javobga ega bo'lsin.`;
  const usr = `Mavzu/so'rov: "${prompt}"

${n} ta ${type === 'true_false' ? "to'g'ri/xato" : 'variantli'} test savoli tuz (${difficulty === 'mixed' ? "oson/o'rta/qiyin aralash" : difficulty + ' darajada'}).
Javobni FAQAT quyidagi JSON formatida ber, boshqa matn YO'Q:
[{"text":"savol","options":["A","B","C","D"],"correctIndex":0,"explanation":"qisqa izoh"}]
${type === 'true_false' ? 'options ["To\u2019g\u2019ri","Xato"] bo\u2019lsin.' : "options 4 ta bo'lsin."}`;

  const res = await aiGenerateText(usr, { systemInstruction: sys, maxOutputTokens: 4096 });
  if (!res.ok) return res;
  const parsed = extractJson(res.text);
  if (!Array.isArray(parsed) || !parsed.length) return { ok: false, error: 'bad_format' };
  const questions = [];
  for (const q of parsed) {
    if (!q || typeof q.text !== 'string' || !Array.isArray(q.options) || q.options.length < 2) continue;
    const options = q.options.map((o) => String(o).slice(0, 300)).slice(0, 6);
    let ci = Number(q.correctIndex);
    if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) ci = 0;
    questions.push({
      text: String(q.text).slice(0, 800),
      options,
      correctIndex: ci,
      explanation: String(q.explanation || '').slice(0, 500),
    });
    if (questions.length >= n) break;
  }
  if (!questions.length) return { ok: false, error: 'bad_format' };
  return { ok: true, questions, model: res.model };
}


/**
 * S22: AI slayd generatsiya — {title, slides:[{title, bullets[]}]} deck.
 * @returns {Promise<{ok:true,deck:object,model:string}|{ok:false,error:string}>}
 */
export async function aiGenerateSlides({ topic, count = 6, lang = 'uz' } = {}) {
  const n = Math.min(Math.max(Number(count) || 6, 1), 15);
  const langName = LANG_NAME[lang] || LANG_NAME.uz;
  const sys = `Sen professional taqdimot muallifisan. Faqat ${langName} tilida javob ber.`;
  const usr = `Mavzu: "${String(topic).slice(0, 600)}"

${n} ta slaydli taqdimot tuz. Har slaydda sarlavha + 3-5 qisqa bullet.
Javobni FAQAT quyidagi JSON formatida ber, boshqa matn YO'Q:
{"title":"taqdimot nomi","slides":[{"title":"slayd sarlavhasi","bullets":["bullet 1","bullet 2"]}]}`;
  const res = await aiGenerateText(usr, { systemInstruction: sys, maxOutputTokens: 4096 });
  if (!res.ok) return res;
  const parsed = extractJson(res.text);
  if (!parsed || !Array.isArray(parsed.slides) || !parsed.slides.length) {
    return { ok: false, error: 'bad_format' };
  }
  const deck = {
    title: String(parsed.title || topic).slice(0, 200),
    slides: parsed.slides.slice(0, n).map((s) => ({
      title: String(s?.title || '').slice(0, 160),
      bullets: Array.isArray(s?.bullets) ? s.bullets.slice(0, 6).map((b) => String(b || '').slice(0, 240)) : [],
    })).filter((s) => s.title || s.bullets.length),
  };
  if (!deck.slides.length) return { ok: false, error: 'bad_format' };
  return { ok: true, deck, model: res.model };
}
