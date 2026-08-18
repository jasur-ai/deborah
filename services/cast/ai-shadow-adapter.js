/**
 * Edikit — Cast AI Co-host Shadow Adapter (C5-11)
 * -----------------------------------------------
 * Reja item 2/4: LLM adapterga faqat aggregate/de-identified input
 * beriladi (buildShadowInput natijasi) va provider timeout/cost cap
 * qo'llaniladi. Provider sozlanmagan bo'lsa — deterministic heuristic
 * fallback (rule-engine asosidagi) ishlaydi; shu tufayli shadow
 * rejim har doim ishlaydi (graceful degradation).
 *
 * SERVER-ONLY: bu fayl faqat server'da import qilinadi (socket/routes),
 * client/browser'da emas. API key env'dan — hech qachon client'ga.
 */

import { parseSuggestion, assertSuggestionAllowed, buildShadowBaseline } from './ai-shadow-service.js';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_COST_US = 500; // ~0.0005$ per run — cast shadow budget
const COST_PER_TOKEN_US = 0.6;   // rough estimate: 600 tokens ≈ 1 request

/**
 * Item 4: provider chaqiruvini timeout + cost cap bilan bajarish.
 *
 * @param {object} input
 * @param {object} input.shadowInput — buildShadowInput natijasi (de-identified)
 * @param {object} [input.opts]
 * @param {number} [input.opts.timeoutMs=5000]
 * @param {number} [input.opts.maxCostUs=500]
 * @param {Function} [input.opts.callProvider] — async (safeInput, {signal}) => raw
 *        Provider bo'lmasa default: heuristic fallback.
 * @param {AbortSignal} [input.opts.signal]
 * @returns {Promise<{ ok: boolean, suggestion?: object, raw?: unknown, provider: string, latencyMs: number, costUs: number, error?: string }>}
 */
export async function runShadowSuggestion({ shadowInput, opts = {} } = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCostUs = opts.maxCostUs ?? DEFAULT_MAX_COST_US;
  const start = Date.now();

  // Provider mavjud bo'lmasa — heuristic fallback (deterministic, cost 0).
  const provider = opts.callProvider || heuristicSuggestion;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const raw = await provider({ shadowInput, signal: ctrl.signal, maxCostUs });
    // Review fix: provider signal'ni hurmat qilmasa ham (ignored abort),
    // deadline o'tgan natija qabul qilinmaydi — hard timeout.
    if (ctrl.signal.aborted) {
      return {
        ok: false,
        provider: provider === heuristicSuggestion ? 'heuristic' : 'llm',
        latencyMs: Date.now() - start,
        costUs: 0,
        error: `timeout:${timeoutMs}ms`,
      };
    }
    const latencyMs = Date.now() - start;
    const costUs = estimateCost(raw, maxCostUs);
    const parsed = parseSuggestion(raw);
    if (!parsed.ok) {
      return {
        ok: false,
        provider: provider === heuristicSuggestion ? 'heuristic' : 'llm',
        latencyMs,
        costUs,
        error: `parse-fail:${parsed.error}`,
      };
    }
    // Ikkinchi himoya qatlami — forbidden action tekshiruvi.
    const forbidden = assertSuggestionAllowed(parsed.suggestion);
    if (forbidden) {
      return {
        ok: false,
        provider: provider === heuristicSuggestion ? 'heuristic' : 'llm',
        latencyMs,
        costUs,
        error: forbidden,
      };
    }
    return { ok: true, suggestion: parsed.suggestion, provider: provider === heuristicSuggestion ? 'heuristic' : 'llm', latencyMs, costUs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const aborted = err?.name === 'AbortError' || ctrl.signal.aborted;
    return {
      ok: false,
      provider: provider === heuristicSuggestion ? 'heuristic' : 'llm',
      latencyMs,
      costUs: 0,
      error: aborted ? `timeout:${timeoutMs}ms` : `provider-error:${String(err?.message || err).slice(0, 120)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Item 2/4 fallback: rule-engine baseline asosidagi deterministic
 * suggestion. Provider sozlanmagan muhitda ham shadow ishlaydi.
 */
export function heuristicSuggestion({ shadowInput } = {}) {
  const baseline = shadowInput?.baseline || buildShadowBaseline();
  const agg = baseline.aggregate || {};
  const confusion = baseline.confusion;

  // Confusion signal baland bo'lsa → pause/slow_down taklifi.
  if (confusion && confusion.rate >= 0.4) {
    return {
      kind: 'pace',
      message: `Ko'pchilik chalkashlik signali berdi (${Math.round(confusion.rate * 100)}%). Savolni bir marta batafsil tushuntirishni tavsiya qilamiz.`,
      action: 'pace:slow',
      confidence: 0.8,
    };
  }
  // Hinge tavsiyasi bo'lsa → unga mos soft action.
  if (baseline.hinge) {
    return {
      kind: 'intervention',
      message: `Hinge tahlili: ${String(baseline.hinge).slice(0, 160)}`,
      action: 'content:hinge_review',
      confidence: 0.6,
    };
  }
  // Past ishtirok → discuss/revote taklifi.
  // participationRate 0 = ma'lumot yo'q (baseline bo'sh) — bu "past" emas.
  if (agg.participationRate !== undefined && agg.participationRate > 0 && agg.participationRate < 0.6) {
    return {
      kind: 'climate',
      message: `Ishtirok past (${Math.round(agg.participationRate * 100)}%). Juftlikda muhokama taklif qilamiz.`,
      action: 'discuss:start',
      confidence: 0.5,
    };
  }
  return {
    kind: 'question',
    message: 'Joriy sur\'at mos ko\'rinadi. Davom etish mumkin.',
    action: null,
    confidence: 0.3,
  };
}

/**
 * Cost estimate — raw output hajmiga qarab (token ≈ 4 chars).
 */
function estimateCost(raw, maxCostUs) {
  const len = typeof raw === 'string' ? raw.length : JSON.stringify(raw || {}).length;
  const tokens = Math.ceil(len / 4);
  const costUs = Math.round(tokens * COST_PER_TOKEN_US);
  return Math.min(costUs, maxCostUs);
}

export default { runShadowSuggestion, heuristicSuggestion, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_COST_US };
