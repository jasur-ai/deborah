import { describe, it, expect } from 'vitest';
import {
  nextTimerAnnouncement,
  timerAnnounceTick,
  resolveA11y,
  announceLevel,
  KEYBOARD_HINTS,
  chartToTableHtml,
  ariaState,
  effectiveDeadline,
  TIMER_ANNOUNCE_THRESHOLDS,
} from '../../services/cast/a11y-service.js';

// ── C4-04 item 6/7: Timer threshold announcement (30/10/5/0) ──
describe('C4-04: Timer announcement policy', () => {
  it('30/10/5/0 thresholdlarini e\'lon qiladi, boshqa soniyalarni emas', () => {
    // 45s -> hech qanday announcement yo'q (hali 30 ga tushmagan)
    expect(nextTimerAnnouncement(45, null)).toBeNull();
    expect(nextTimerAnnouncement(31, null)).toBeNull();
    // 30 ga tushganda announce
    expect(nextTimerAnnouncement(30, null)).toEqual({ at: 30, message: '30 soniya qoldi' });
    // 29..11 orasida qayta announce qilinmaydi (last=30)
    expect(nextTimerAnnouncement(29, 30)).toBeNull();
    expect(nextTimerAnnouncement(11, 30)).toBeNull();
    // 10 ga tushganda yana
    expect(nextTimerAnnouncement(10, 30)).toEqual({ at: 10, message: '10 soniya qoldi' });
    expect(nextTimerAnnouncement(6, 10)).toBeNull();
    expect(nextTimerAnnouncement(5, 10)).toEqual({ at: 5, message: '5 soniya qoldi' });
    expect(nextTimerAnnouncement(1, 5)).toBeNull();
    expect(nextTimerAnnouncement(0, 5)).toEqual({ at: 0, message: 'Vaqt tugadi' });
  });

  it('QISQA timer (30 dan past) boshida 30 e\'lon qilinmaydi (review fix)', () => {
    // 15s/20s savolda "30 soniya qoldi" degan noto'g'ri e'lon chiqmasligi kerak
    expect(nextTimerAnnouncement(20, null)).toBeNull();
    expect(nextTimerAnnouncement(15, null)).toBeNull();
    expect(nextTimerAnnouncement(12, null)).toBeNull();
    // 10 ga tushganda to'g'ri e'lon
    expect(nextTimerAnnouncement(10, null)).toEqual({ at: 10, message: '10 soniya qoldi' });
  });

  it('timerAnnounceTick yangi last qiymatni qaytaradi', () => {
    const t = timerAnnounceTick(30, null);
    expect(t.newLast).toBe(30);
    expect(timerAnnounceTick(25, 30)).toBeNull();
    expect(timerAnnounceTick(10, 30).newLast).toBe(10);
  });

  it('thresholdlar tartibli va to\'liq', () => {
    expect(TIMER_ANNOUNCE_THRESHOLDS).toEqual([30, 10, 5, 0]);
  });
});

// ── C4-04 item 18/20: settings resolution ──
describe('C4-04: resolveA11y', () => {
  it('defaultlar configdan keladi', () => {
    const r = resolveA11y({}, {});
    expect(r.showQuestionOnDevice).toBe(true);
    expect(r.reducedMotion).toBe(true);
    expect(r.theme).toBe('focus_dark');
    expect(r.timerAnnounce).toBe(true);
  });

  it('prefs overridelari ustun keladi', () => {
    const r = resolveA11y({ highContrast: true, reducedMotion: false, fontScale: 1.25, theme: 'hc_dark' }, {});
    expect(r.highContrast).toBe(true);
    expect(r.reducedMotion).toBe(false);
    expect(r.fontScale).toBe(1.25);
    expect(r.theme).toBe('hc_dark');
  });

  it('accommodation: noTimer timer announcementni o\'chiradi', () => {
    const r = resolveA11y({}, { accessibility: { accommodation: { noTimer: true } } });
    expect(r.noTimer).toBe(true);
    expect(r.timerAnnounce).toBe(false);
  });

  it('accommodation: longTimeMs timer announcementni o\'chiradi va deadlinega qo\'shiladi', () => {
    const r = resolveA11y({}, { accessibility: { accommodation: { longTimeMs: 60000 } } });
    expect(r.longTimeMs).toBe(60000);
    expect(r.timerAnnounce).toBe(false);
    const base = 1_000_000;
    expect(effectiveDeadline(base, r)).toBe(base + 60000);
  });

  it('effectiveDeadline: noTimer → null, accommodation yo\'q → base', () => {
    const noTimer = resolveA11y({}, { accessibility: { accommodation: { noTimer: true } } });
    expect(effectiveDeadline(1000, noTimer)).toBeNull();
    expect(effectiveDeadline(1000, null)).toBe(1000);
  });
});

// ── C4-04 item 5/8/9: live region level ──
describe('C4-04: announceLevel', () => {
  it('questionClosed/error/disconnect assertive', () => {
    expect(announceLevel('questionClosed')).toBe('assertive');
    expect(announceLevel('error')).toBe('assertive');
    expect(announceLevel('disconnect')).toBe('assertive');
  });
  it('boshqalar polite', () => {
    expect(announceLevel('answerSaved')).toBe('polite');
    expect(announceLevel('timer')).toBe('polite');
    expect(announceLevel('state')).toBe('polite');
    expect(announceLevel('joinSuccess')).toBe('polite');
  });
});

// ── C4-04 item 23: keyboard hints ──
describe('C4-04: keyboard hints', () => {
  it('participant va director uchun discoverable hintlar bor', () => {
    const audiences = new Set(KEYBOARD_HINTS.map((h) => h.audience));
    expect(audiences).toContain('participant');
    expect(audiences).toContain('director');
    expect(KEYBOARD_HINTS.length).toBeGreaterThanOrEqual(8);
  });
});

// ── C4-04 item 11: chart table fallback ──
describe('C4-04: chartToTableHtml', () => {
  it('bo\'sh rows → bo\'sh string', () => {
    expect(chartToTableHtml([])).toBe('');
    expect(chartToTableHtml(null)).toBe('');
  });

  it('rows dan accessible table quradi (foiz bilan)', () => {
    const html = chartToTableHtml([
      { label: 'A', value: 3, total: 10 },
      { label: 'B', value: 7, total: 10 },
    ]);
    expect(html).toContain('<table class="cast-chart-table"');
    expect(html).toContain('<caption class="sr-only">Natijalar jadvali</caption>');
    expect(html).toContain('<th scope="col">Nom</th>');
    expect(html).toContain('<td>3</td>');
    expect(html).toContain('<td>30%</td>');
    expect(html).toContain('<td>70%</td>');
  });

  it('XSS qochadi', () => {
    const html = chartToTableHtml([{ label: '<script>alert(1)</script>', value: 1, total: 1 }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ── C4-04 item 4: ARIA state helper ──
describe('C4-04: ariaState', () => {
  it('expanded/pressed atributlarini qaytaradi', () => {
    expect(ariaState(true, undefined)).toEqual({ 'aria-expanded': 'true' });
    expect(ariaState(undefined, false)).toEqual({ 'aria-pressed': 'false' });
    expect(ariaState(true, true)).toEqual({ 'aria-expanded': 'true', 'aria-pressed': 'true' });
    expect(ariaState(undefined, undefined)).toEqual({});
  });
});
