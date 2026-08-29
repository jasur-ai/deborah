/**
 * Cast C4-04 — Accessibility pure logic
 * -------------------------------------
 * Client (public/js/cast-a11y.js) shu yerdagi pure funksiyalarni ishlatadi.
 * Unit testlar shu faylni test qiladi (DOM'siz).
 */

// ── C4-04 item 6-7: Timer announcement policy (30/10/5/0) ──
export const TIMER_ANNOUNCE_THRESHOLDS = [30, 10, 5, 0];

/**
 * Har second announce qilinmasligi uchun threshold policy.
 * Threshold faqat ROPPA-ROSA kesib o'tilganda e'lon qilinadi (r === t),
 * shuning uchun qisqa timer (masalan 15s) boshida "30 soniya qoldi"
 * degan noto'g'ri e'lon chiqmaydi (C4-04 review fix #1).
 * @param {number} remainingSeconds  Qolgan soniya (0+)
 * @param {number|null} lastAnnouncedSeconds  Oxirgi announce qilingan threshold
 * @returns {{at:number, message:string}|null}  Announce kerak bo'lsa obj, aks holda null
 */
export function nextTimerAnnouncement(remainingSeconds, lastAnnouncedSeconds) {
  const r = Math.max(0, Math.round(remainingSeconds));
  for (const t of TIMER_ANNOUNCE_THRESHOLDS) {
    if (r === t && lastAnnouncedSeconds !== t) {
      return { at: t, message: t === 0 ? 'Vaqt tugadi' : `${t} soniya qoldi` };
    }
  }
  return null;
}

/**
 * Timer tick'lar orasida "announce allaqachon qilindimi" holatini saqlash uchun.
 * Agar qaytgan qiymat != null bo'lsa lastAnnouncedSeconds ni yangilash kerak.
 */
export function timerAnnounceTick(remainingSeconds, lastAnnouncedSeconds) {
  const n = nextTimerAnnouncement(remainingSeconds, lastAnnouncedSeconds);
  return n ? { ...n, newLast: n.at } : null;
}

// ── C4-04 item 18/20: Settings resolution ──
/**
 * Foydalanuvchi prefs + configdan yakuniy a11y settingsni birlashtiradi.
 * @param {object} prefs  { highContrast?, reducedMotion?, fontScale?, theme? }
 * @param {object} config Cast config (accessibility sektsiyasi)
 */
export function resolveA11y(prefs, config) {
  const a = config?.accessibility || {};
  const acc = a.accommodation || {};
  const theme = prefs?.theme || a.defaultTheme || 'focus_dark';
  return {
    highContrast: prefs?.highContrast ?? a.highContrastAvailable ?? true,
    reducedMotion: prefs?.reducedMotion ?? a.reducedMotionDefault ?? true,
    fontScale: prefs?.fontScale ?? 1,
    showQuestionOnDevice: a.showQuestionOnDevice ?? true,
    // C4-04 item 20: personal long-time / no-timer accommodation hook
    longTimeMs: acc.longTimeMs ?? 0,
    noTimer: acc.noTimer ?? false,
    timerAnnounce: !acc.noTimer && !(acc.longTimeMs > 0),
    theme,
  };
}

// ── C4-04 item 5/8/9: Live region level mapping ──
export function announceLevel(kind) {
  switch (kind) {
    case 'questionClosed':
    case 'error':
    case 'disconnect':
      return 'assertive';
    default:
      return 'polite';
  }
}

// ── C4-04 item 23: Discoverable keyboard shortcuts ──
export const KEYBOARD_HINTS = [
  { audience: 'participant', keys: '1 / A', action: 'Birinchi variantni tanlash' },
  { audience: 'participant', keys: '2 / B', action: 'Ikkinchi variantni tanlash' },
  { audience: 'participant', keys: '3 / C', action: 'Uchinchi variantni tanlash' },
  { audience: 'participant', keys: '4 / D', action: 'To‘rtinchi variantni tanlash' },
  { audience: 'participant', keys: 'Enter', action: 'Yuborish / tasdiqlash' },
  { audience: 'director', keys: '→', action: 'Keyingi savol' },
  { audience: 'director', keys: 'P', action: 'Savolni pauza qilish / davom ettirish' },
  { audience: 'director', keys: 'L', action: 'Savolni yopish (lock)' },
  { audience: 'director', keys: 'N', action: 'Natijalarni ko‘rsatish (reveal)' },
];

// ── C4-04 item 11: Chart accessible table fallback ──
/**
 * Chart (div/svg) uchun qatorli accessible table alternative yaratadi.
 * @param {Array<{label:string, value:number, total?:number}>} rows
 * @returns {string} HTML table yoki '' (bo'sh bo'lsa)
 */
export function chartToTableHtml(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const head = '<tr><th scope="col">Nom</th><th scope="col">Qiymat</th><th scope="col">Foiz</th></tr>';
  const body = rows
    .map((r) => {
      const pct = r.total > 0 ? Math.round((r.value / r.total) * 100) : 0;
      return `<tr><th scope="row">${escapeHtml(String(r.label))}</th><td>${r.value}</td><td>${pct}%</td></tr>`;
    })
    .join('');
  return `<table class="cast-chart-table"><caption class="sr-only">Natijalar jadvali</caption>${head}${body}</table>`;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── C4-04 item 4: Custom control ARIA state helpers ──
export function ariaState(expanded, pressed) {
  const out = {};
  if (expanded !== undefined) out['aria-expanded'] = String(expanded);
  if (pressed !== undefined) out['aria-pressed'] = String(pressed);
  return out;
}

// ── C4-04 item 20: Timer override ──
/**
 * Accommodation asosida ko'rsatiladigan timer ni aniqlaydi.
 * noTimer=true → null (timer yashirin), longTimeMs>0 → qo'shilgan vaqt.
 */
export function effectiveDeadline(baseClosesAt, a11y) {
  if (!a11y) return baseClosesAt;
  if (a11y.noTimer) return null;
  if (a11y.longTimeMs > 0 && baseClosesAt) return baseClosesAt + a11y.longTimeMs;
  return baseClosesAt;
}
