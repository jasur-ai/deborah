/**
 * Deborah — Telemetry Redaction (Prompt 69 §11, §15)
 *
 * Privacy-safe observability: telemetryga TUSHMAYDIGAN ma'lumotlar:
 *   - answer keys / q_correct / to'g'ri javob
 *   - raw response, health evidence, essay/submission text
 *   - tokenlar (JWT, API key, session, refresh), parollar, secretlar
 *   - student PII: ism, email, telefon, manzil
 *
 * Span attributes va metric label'lari yozilishidan OLDIN bu moduldan
 * o'tkaziladi. Bu research.md §16 security + §38.3 (Socket spanlarda student
 * PII/name emas, hashed/internal IDs) talabini bajaradi.
 *
 * PURE: regex + rekursiv object yurish.
 */

// ── Sensitive key patterns (lowercase tekshiriladi) ──
const SENSITIVE_KEY_PATTERNS = [
  // Answer key / exam security — scalar javob variantlari redactForTelemetry'da
  // alohida ishlanadi (answer: 'B' → redact; answer: {...} container saqlanadi)
  /^(q?_correct|correct_answer|answer_key|answerkey)$/,
  /correct.*(index|option|answer)|answer.*(key|correct)/,
  // Raw content that must never be exported
  /^(raw_response|raw_body|essay|submission_text|health_evidence|camera_frame|capture)$/,
  /(essay|response|evidence|submission)(_text|_body|_content)?$/,
  // Tokens / secrets
  /^(password|pass|secret|token|access_token|refresh_token|api_key|apikey|authorization|cookie|session_id|jwt|otp)$/,
  /(token|secret|apikey|api_key|password|credential|otp)/,
  // PII
  /^(email|phone|address|passport|full_name|first_name|last_name|birth_date|student_name)$/,
  /^(email|phone|address|passport|name)$/,
];

/**
 * Is a key sensitive (must be redacted from telemetry)?
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  const k = String(key || '').toLowerCase().trim();
  if (!k) return false;
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(k));
}

/**
 * Redact a single value for telemetry export.
 * Scalar qiymatlar saqlanadi; sensitive key'lar [REDACTED] bo'ladi.
 * @param {string} key
 * @param {*} value
 * @returns {*}
 */
export function redactValue(key, value) {
  if (isSensitiveKey(key)) return '[REDACTED]';
  return value;
}

/**
 * Deep-redact an object/array for telemetry export (span attributes, log ctx).
 * @param {*} obj
 * @returns {*}
 */
export function redactForTelemetry(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactForTelemetry(v));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = String(k).toLowerCase();
      // D-05: yolg'iz answer/correct — SCALAR bo'lsa redact (javob varianti),
      // container (obyekt) bo'lsa ichkariga kiriladi (answerKey redact, qolgani saqlanadi).
      if (isSensitiveKey(k)) {
        out[k] = '[REDACTED]';
      } else if ((key === 'answer' || key === 'correct' || key === 'q_correct')
          && (v === null || typeof v !== 'object')) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactForTelemetry(v);
      }
    }
    return out;
  }
  return obj;
}

/**
 * Redact a free-text string (log message, span name fragment).
 * Uzun yozma matnlar / token-like 40+ belgili hex'lar kesiladi.
 * @param {string} text
 * @returns {string}
 */
export function redactText(text) {
  if (typeof text !== 'string') return text;
  // 40+ uzunlikdagi hex/base64/JWT-like (token) fragment → [TOKEN]
  // JWT'da '.' separator ham bor — shuning uchun ._- ham kiritilgan.
  const longToken = /[A-Za-z0-9._-]{40,}/g;
  let out = text.replace(longToken, '[TOKEN]');
  // D-04: JSHSHIR — 14 xonali raqam (O'zbekiston shaxs identifikatori) → [JSHSHIR]
  out = out.replace(/\b\d{14}\b/g, '[JSHSHIR]');
  return out;
}

/**
 * Redact a string before it becomes a metric label / span attribute value.
 * @param {string} value
 * @returns {string}
 */
export function redactLabel(value) {
  if (typeof value !== 'string') return value;
  // Nomlarni hashlash mumkin emas (metric label bo'lsa) — shuning uchun
  // faqat uzun token'lar va emaily'lar kesiladi.
  return redactText(value).slice(0, 64);
}

export default { isSensitiveKey, redactValue, redactForTelemetry, redactText, redactLabel };
