/**
 * Deborah — Cast Feature Kill Switches (C5-08, item 12)
 * ----------------------------------------------------
 * Incident paytida qismni darhol o'chirish uchun switch'lar.
 *
 * Qat'iy qoida:
 *   - Switch DEFAULT'da YOQIQ (feature yoqilgan) bo'lishi mumkin, lekin
 *     OFF bo'lgan switch realtime xavfsizlikni (answer persistence,
 *     question open/close/reveal) OFF qila OLMAYDI — o'qituvchi sessiyasi
 *     buzilmasligi uchun. Faqat ops/UX qismlari switch'lanadi.
 *
 * Env orqali: CAST_FEATURE_<NAME>=off (masalan CAST_FEATURE_POE=off)
 * Runtime override: setCastSwitch(name, true|false) — ops panel/test uchun.
 */

const SWITCH_DEFAULTS = Object.freeze({
  // UX/ops feature'lar — OFF bo'lsa faqat UI yashiriladi, ground truth ta'sirlanmaydi
  poe: true,           // POE (media) flow
  forgef: true,        // question forge
  rehearsal: true,     // rehearsal mode
  choreography: true,  // session choreography
  qualityLab: true,    // quality lab
  supportBundle: true, // support bundle endpoint
  syntheticMonitor: true, // synthetic cast monitor
  moderation: true,    // moderation wall
});

const runtimeOverrides = new Map();

function envName(name) {
  return `CAST_FEATURE_${name.toUpperCase()}`;
}

/**
 * Is a feature switch enabled?
 * @param {string} name
 * @returns {boolean}
 */
export function isFeatureEnabled(name) {
  const key = String(name || '').toLowerCase();
  // Ground truth (answer/session/questionFlow) — env/override bilan OFF bo'la OLMAYDI
  if (NON_KILLABLE.includes(key)) return true;
  if (runtimeOverrides.has(key)) return runtimeOverrides.get(key);
  const env = process.env[envName(key)];
  if (env !== undefined) return !['0', 'off', 'false', 'no'].includes(String(env).toLowerCase());
  return SWITCH_DEFAULTS[key] !== false;
}

/**
 * Runtime override (ops/test). value=true → yoqish, false → o'chirish.
 */
export function setCastSwitch(name, value) {
  runtimeOverrides.set(String(name || '').toLowerCase(), !!value);
}

/** Barcha runtime override'larni tozalaydi (test/ops reset). */
export function resetCastSwitches() {
  runtimeOverrides.clear();
}

/**
 * Ops xavfsizligi: o'chirib bo'lmaydigan switch'lar (ground truth).
 * Bu ro'yxatdagi feature'lar kill switch BILAN OFF bo'la olmaydi.
 */
export const NON_KILLABLE = Object.freeze(['answer', 'questionFlow', 'session']);

/** All switch states (ops panel / dashboard uchun). */
export function allCastSwitches() {
  const out = {};
  for (const key of Object.keys(SWITCH_DEFAULTS)) {
    out[key] = isFeatureEnabled(key);
  }
  return out;
}

export default {
  isFeatureEnabled,
  setCastSwitch,
  resetCastSwitches,
  allCastSwitches,
  NON_KILLABLE,
};
