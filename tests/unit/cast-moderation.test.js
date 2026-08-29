/**
 * Deborah — Cast C3-10 Confusion Signal + Question Wall Moderation Tests
 * ----------------------------------------------------------------------
 * coverage: signal enum/cooldown/dedupe, identity-hidden aggregate,
 *           wall text validation, PII/profanity flags, moderation lifecycle,
 *           public-safe projection, host-outage freeze.
 */

import { describe, it, expect } from 'vitest';
import {
  CONFUSION_SIGNALS,
  SIGNAL_COOLDOWN_MS,
  SIGNAL_DEDUPE_WINDOW_MS,
  isValidSignal,
  isDuplicateSignal,
  aggregateSignals,
  buildAggregatePayload,
  acknowledgeSignals,
  stripIdentity,
} from '../../services/cast/confusion-service.js';
import {
  WALL_CHAR_LIMIT,
  WALL_CHAR_MIN,
  WALL_MODERATION_STATE,
  WALL_PENDING_STATES,
  WALL_ACTIONS,
  flagSensitive,
  profanityHit,
  validateWallText,
  buildWallItem,
  applyWallAction,
  projectPublicWall,
  hostOutageState,
  escapeHtml,
} from '../../services/cast/moderation-service.js';

// ── C3-10 Confusion Signal ──
describe('C3-10: Confusion Signal', () => {
  it('enum has exactly 4 signals', () => {
    expect(CONFUSION_SIGNALS).toEqual(['confused', 'too_fast', 'technical_issue', 'need_example']);
  });

  it('isValidSignal accepts only enum values', () => {
    expect(isValidSignal('confused')).toBe(true);
    expect(isValidSignal('too_fast')).toBe(true);
    expect(isValidSignal('hacked')).toBe(false);
    expect(isValidSignal(undefined)).toBe(false);
  });

  it('cooldown constants are positive', () => {
    expect(SIGNAL_COOLDOWN_MS).toBeGreaterThan(0);
    expect(SIGNAL_DEDUPE_WINDOW_MS).toBeGreaterThan(SIGNAL_COOLDOWN_MS);
  });

  it('isDuplicateSignal dedupes within window', () => {
    const now = 100000;
    expect(isDuplicateSignal(now - 5000, now, 30000)).toBe(true); // within 30s
    expect(isDuplicateSignal(now - 40000, now, 30000)).toBe(false); // expired
    expect(isDuplicateSignal(null, now, 30000)).toBe(false); // first time
  });

  it('aggregateSignals counts and dedupes same participant+signal', () => {
    const now = 100000;
    const signals = [
      { signal: 'confused', at: now - 1000, participantId: 'p1' },
      { signal: 'confused', at: now - 2000, participantId: 'p1' }, // dup — bitta sanaladi
      { signal: 'confused', at: now - 3000, participantId: 'p2' },
      { signal: 'too_fast', at: now - 4000, participantId: 'p1' },
      { signal: 'confused', at: now - 99999, participantId: 'p3' }, // eskirgan
      { signal: 'unknown', at: now - 1000, participantId: 'p4' }, // enum'da yo'q
    ];
    const res = aggregateSignals(signals, now, 30000);
    expect(res.counts.confused).toBe(2);
    expect(res.counts.too_fast).toBe(1);
    expect(res.counts.technical_issue).toBe(0);
    expect(res.counts.need_example).toBe(0);
    expect(res.total).toBe(3);
  });

  it('aggregate payload has NO identity fields', () => {
    const agg = buildAggregatePayload({ confused: 3, too_fast: 1, technical_issue: 0, need_example: 0 });
    expect(agg.total).toBe(4);
    expect(JSON.stringify(agg)).not.toContain('participant');
    expect(JSON.stringify(agg)).not.toContain('participantId');
    expect(JSON.stringify(agg)).not.toContain('displayAlias');
  });

  it('stripIdentity removes participantId', () => {
    const safe = stripIdentity([
      { signal: 'confused', at: 1, participantId: 'p1' },
      { signal: 'too_fast', at: 2, participantId: 'p2' },
    ]);
    expect(safe).toEqual([{ signal: 'confused', at: 1 }, { signal: 'too_fast', at: 2 }]);
    expect(JSON.stringify(safe)).not.toContain('participantId');
  });

  it('acknowledgeSignals marks only valid signals', () => {
    const agg = buildAggregatePayload({ confused: 2, too_fast: 0, technical_issue: 0, need_example: 0 });
    const acked = acknowledgeSignals(agg, ['confused', 'bogus']);
    expect(acked.acknowledged.confused).toBe(true);
    expect(acked.acknowledged.too_fast).toBe(false);
  });
});

// ── C3-10 Wall validation + PII flags ──
describe('C3-10: Wall validation & flags', () => {
  it('validateWallText rejects empty', () => {
    expect(validateWallText('   ').ok).toBe(false);
    expect(validateWallText('').error).toBe('EMPTY');
  });

  it('validateWallText rejects too-short', () => {
    expect(validateWallText('ab').error).toBe('TOO_SHORT');
    expect(WALL_CHAR_MIN).toBe(3);
  });

  it('validateWallText trims and caps at limit', () => {
    const res = validateWallText('  Savol bu yerda  ');
    expect(res.ok).toBe(true);
    expect(res.clean).toBe('Savol bu yerda');
    expect(WALL_CHAR_LIMIT).toBe(280);
    const long = validateWallText('x'.repeat(500));
    expect(long.clean.length).toBe(280);
  });

  it('flagSensitive detects email → HIGH', () => {
    const res = flagSensitive('Men bilan bog\'laning: ali@mail.uz');
    expect(res.flags.email).toBe(true);
    expect(res.priority).toBe('HIGH');
  });

  it('flagSensitive detects phone → HIGH', () => {
    const res = flagSensitive('Tel: +998901234567');
    expect(res.flags.phone).toBe(true);
    expect(res.priority).toBe('HIGH');
  });

  it('flagSensitive detects URL → MEDIUM', () => {
    const res = flagSensitive('Batafsil: https://example.com/docs');
    expect(res.flags.url).toBe(true);
    expect(res.priority).toBe('MEDIUM');
  });

  it('flagSensitive detects profanity → HIGH', () => {
    const res = flagSensitive('bu ahmoqona savol edi');
    expect(res.flags.profanity).toBe(true);
    expect(res.priority).toBe('HIGH');
  });

  it('flagSensitive detects 8+ digit PII → MEDIUM (phone emas)', () => {
    const res = flagSensitive('ID raqamim 12345678');
    expect(res.flags.pii).toBe(true);
    expect(res.flags.phone).toBe(false); // 8 raqam — telefon emas
    expect(res.priority).toBe('MEDIUM');
  });

  it('flagSensitive plain text → LOW, no flags', () => {
    const res = flagSensitive('3-qadam nima edi?');
    expect(res.flags.email).toBe(false);
    expect(res.flags.phone).toBe(false);
    expect(res.flags.url).toBe(false);
    expect(res.flags.profanity).toBe(false);
    expect(res.flags.pii).toBe(false);
    expect(res.priority).toBe('LOW');
  });

  // ── C4-06 extensions ──
  it('flagSensitive invisible/bidi abuse → HIGH (item 9)', () => {
    const res = flagSensitive('yaxshi\u200Bsavol');
    expect(res.flags.invisible).toBe(true);
    expect(res.priority).toBe('HIGH');
  });

  it('profanityHit locale versionlangan (item 10)', () => {
    expect(profanityHit('bu ahmoqona savol', 'uz-Latn')).toBe(true);
    expect(profanityHit('это дурак вопрос', 'ru')).toBe(true);
    expect(profanityHit('this is a nice question', 'en')).toBe(false);
  });
});

// ── C3-10 Moderation lifecycle ──
describe('C3-10: Wall moderation lifecycle', () => {
  it('buildWallItem creates RECEIVED with flags + priority', () => {
    const { item, error } = buildWallItem({
      sessionId: 's1',
      participantId: 'p1',
      text: '3-qadam tushunarli emas',
      commandId: 'c1',
    });
    expect(error).toBeNull();
    expect(item.moderationState).toBe('RECEIVED');
    expect(item.type).toBe('question_wall');
    expect(item.participantId).toBe('p1');
    expect(item.priority).toBe('LOW');
    expect(item.contentId).toMatch(/^wall_/);
  });

  it('buildWallItem rejects empty text', () => {
    const { item, error } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: ' ' });
    expect(item).toBeNull();
    expect(error).toBe('EMPTY');
  });

  // ── C4-06: HIGH priority → AUTO_FLAGGED (auto-flag final emas) ──
  it('HIGH priority (email) → AUTO_FLAGGED state', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Mening email: ali@mail.uz', commandId: 'c2' });
    expect(item.moderationState).toBe('AUTO_FLAGGED');
    expect(item.priority).toBe('HIGH');
  });

  it('buildWallItem safe-escaped storedText saqlaydi (item 8)', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: '<b>savol</b> & "matn"', commandId: 'c3' });
    expect(item.storedText).toBe('&lt;b&gt;savol&lt;/b&gt; &amp; &quot;matn&quot;');
    expect(item.text).toBe('<b>savol</b> & "matn"'); // original review uchun
  });

  it('escapeHtml barcha maxsus belgilarni oladi', () => {
    expect(escapeHtml('<a href="x">\'y\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;y&#39;&lt;/a&gt;');
  });

  it('WALL_PENDING_STATES RECEIVED+AUTO_FLAGGED+REVIEW_READY', () => {
    expect(WALL_PENDING_STATES).toEqual(['RECEIVED', 'AUTO_FLAGGED', 'REVIEW_READY']);
  });

  it('AUTO_FLAGGED → approve (review) → APPROVED; project rad etilmaydi after approve', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Mening email: ali@mail.uz', commandId: 'c4' });
    const reviewed = applyWallAction(item, 'approve', { moderatorId: 'teacher' });
    expect(reviewed.ok).toBe(true);
    expect(reviewed.next.moderationState).toBe('APPROVED');
    const projected = applyWallAction(reviewed.next, 'project');
    expect(projected.ok).toBe(true);
    expect(projected.next.moderationState).toBe('PROJECTED');
  });

  it('redact → safe-escaped storedText yangilanadi', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Savol', commandId: 'c5' });
    const red = applyWallAction(item, 'redact', { redactedText: '<b>toza</b>' });
    expect(red.next.moderationState).toBe('REDACTED');
    expect(red.next.storedText).toBe('&lt;b&gt;toza&lt;/b&gt;');
  });

  it('WALL_ACTIONS has exactly 5 actions', () => {
    expect(WALL_ACTIONS).toEqual(['approve', 'redact', 'hide', 'project', 'withdraw']);
  });

  it('RECEIVED → APPROVED (approve)', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Savol', commandId: 'c1' });
    const { ok, next } = applyWallAction(item, 'approve', { moderatorId: 'teacher' });
    expect(ok).toBe(true);
    expect(next.moderationState).toBe('APPROVED');
    expect(next.moderatedBy).toBe('teacher');
  });

  it('REDACTED requires redactedText', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Savol', commandId: 'c1' });
    const missing = applyWallAction(item, 'redact', {});
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe('REDACT_TEXT_REQUIRED');
    const ok = applyWallAction(item, 'redact', { redactedText: 'Tozalangan savol' });
    expect(ok.ok).toBe(true);
    expect(ok.next.moderationState).toBe('REDACTED');
    expect(ok.next.redactedText).toBe('Tozalangan savol');
  });

  it('hide → HIDDEN (RECEIVED → HIDDEN legal)', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Savol', commandId: 'c1' });
    const hidden = applyWallAction(item, 'hide');
    expect(hidden.ok).toBe(true);
    expect(hidden.next.moderationState).toBe('HIDDEN');
  });

  // C4-06 (item 12): project faqat APPROVED/REDACTED'dan — unmoderated proyeksiya emas
  it('RECEIVED → project ILLEGAL (unmoderated content projection yo\'q)', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Savol', commandId: 'c1' });
    const projected = applyWallAction(item, 'project');
    expect(projected.ok).toBe(false);
    expect(projected.error).toBe('ILLEGAL_TRANSITION');
  });

  it('APPROVED → project → PROJECTED (projectedAt set)', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Savol', commandId: 'c1' });
    const approved = applyWallAction(item, 'approve');
    const projected = applyWallAction(approved.next, 'project');
    expect(projected.ok).toBe(true);
    expect(projected.next.moderationState).toBe('PROJECTED');
    expect(projected.next.projectedAt).toBeTruthy();
  });

  it('withdraw → WITHDRAWN; final state cannot be re-moderated', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Savol', commandId: 'c1' });
    const w = applyWallAction(item, 'withdraw');
    expect(w.next.moderationState).toBe('WITHDRAWN');
    const again = applyWallAction(w.next, 'approve');
    expect(again.ok).toBe(false);
    expect(again.error).toBe('ALREADY_WITHDRAWN');
    const hidden = applyWallAction(item, 'hide');
    const again2 = applyWallAction(hidden.next, 'withdraw');
    expect(again2.ok).toBe(false);
    expect(again2.error).toBe('FINAL_STATE');
  });

  it('invalid action rejected', () => {
    const { item } = buildWallItem({ sessionId: 's1', participantId: 'p1', text: 'Savol', commandId: 'c1' });
    const res = applyWallAction(item, 'delete');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('INVALID_ACTION');
  });
});

// ── C3-10 Public-safe projection ──
describe('C3-10: Public-safe projection', () => {
  const mk = (over) => ({
    contentId: 'wall_x',
    type: 'question_wall',
    text: 'Raw matn',
    participantId: 'p1',
    flags: { email: false, phone: false, url: false, profanity: false, pii: false },
    priority: 'LOW',
    moderationState: 'RECEIVED',
    submittedAt: 1,
    moderatedAt: null,
    moderatedBy: null,
    redactedText: null,
    projectedAt: null,
    ...over,
  });

  it('APPROVED is public, identity stripped', () => {
    const items = projectPublicWall({ a: mk({ moderationState: 'APPROVED' }) });
    expect(items.length).toBe(1);
    expect(items[0].text).toBe('Raw matn');
    expect(items[0].participantId).toBeUndefined();
    expect(JSON.stringify(items[0])).not.toContain('participantId');
  });

  it('REDACTED exposes redactedText only', () => {
    const items = projectPublicWall({ a: mk({ moderationState: 'REDACTED', redactedText: 'Tozalangan' }) });
    expect(items[0].text).toBe('Tozalangan');
  });

  it('REDACTED without redactedText excluded', () => {
    const items = projectPublicWall({ a: mk({ moderationState: 'REDACTED', redactedText: null }) });
    expect(items.length).toBe(0);
  });

  it('RECEIVED / HIDDEN / WITHDRAWN never public', () => {
    const items = projectPublicWall({
      a: mk({ moderationState: 'RECEIVED' }),
      b: mk({ moderationState: 'HIDDEN' }),
      c: mk({ moderationState: 'WITHDRAWN' }),
    });
    expect(items.length).toBe(0);
  });

  it('PROJECTED is public', () => {
    const items = projectPublicWall({ a: mk({ moderationState: 'PROJECTED', projectedAt: 5 }) });
    expect(items[0].text).toBe('Raw matn');
    expect(items[0].projectedAt).toBe(5);
  });

  it('newest first (reverse order)', () => {
    const items = projectPublicWall({
      a: mk({ moderationState: 'APPROVED', contentId: 'wall_a', text: 'Birinchi' }),
      b: mk({ moderationState: 'APPROVED', contentId: 'wall_b', text: 'Ikkinchi' }),
    });
    expect(items[0].contentId).toBe('wall_b');
  });
});

// ── C3-10 Host outage freeze ──
describe('C3-10: Host outage freeze', () => {
  it('recent director heartbeat → online, not frozen', () => {
    const now = 100000;
    const st = hostOutageState(now - 5000, now, 60000);
    expect(st.moderatorOnline).toBe(true);
    expect(st.frozen).toBe(false);
  });

  it('stale heartbeat → frozen', () => {
    const now = 100000;
    const st = hostOutageState(now - 120000, now, 60000);
    expect(st.moderatorOnline).toBe(false);
    expect(st.frozen).toBe(true);
  });

  it('no heartbeat at all → frozen', () => {
    const st = hostOutageState(null, 100000, 60000);
    expect(st.frozen).toBe(true);
  });
});
