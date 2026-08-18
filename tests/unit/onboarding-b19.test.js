/**
 * AUTH B-19 — Onboarding: Reinforce (checklist) + welcome sequence
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - CHECKLIST_ITEMS: 5 item (§06), first_win avtomatik done
 *  - submitChecklistItem: done toggle, idempotent, first_win_locked, unknown_item
 *  - All done → step=done (§07); qayta ochish (done=false, §28)
 *  - checklistProgress / getChecklistView
 *  - runWelcomeSequence: Day 0/1/3/7 schedule, idempotent (day flag), cap, PII minimal
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import {
  getOrCreateOnboarding,
  submitOrient,
  startFirstWin,
  completeFirstWin,
  submitChecklistItem,
  checklistProgress,
  getChecklistView,
  CHECKLIST_ITEMS,
} from '../../src/modules/onboarding/index.js';
import { getFirstWinSet } from '../../src/modules/onboarding/index.js';
import { runWelcomeSequence, WELCOME_DAYS } from '../../src/modules/onboarding/welcome.js';

const USER = 'b19-unit-user';

describe('AUTH B-19 — checklist', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('CHECKLIST_ITEMS: §06 5 item — quick win (profil) birinchi; first_win avtomatik', async () => {
    expect(CHECKLIST_ITEMS).toEqual(['profil', 'telegram', 'first_win', 'kalendar', 'streak']);
  });

  it('submitChecklistItem: welcome holatida not_in_checklist', async () => {
    await getOrCreateOnboarding(USER);
    const res = await submitChecklistItem({ userKey: USER, itemId: 'profil', done: true });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_in_checklist');
  });

  it('checklist boshlash: orient + first-win complete → step=checklist', async () => {
    await submitOrient({ userKey: USER, subject: 'matematika', ip: '10.0.0.1' });
    await startFirstWin({ userKey: USER, lang: 'uz' });
    const set = getFirstWinSet('matematika', 'uz');
    for (const q of set) {
      await (await import('../../src/modules/onboarding/index.js')).submitFirstWinAnswer({
        userKey: USER, itemId: q.id, answer: 0, lang: 'uz',
      });
    }
    const done = await completeFirstWin({ userKey: USER, lang: 'uz' });
    expect(done.ok).toBe(true);
    expect(done.state.step).toBe('checklist');
  });

  it('first_win item avtomatik done + locked (client o\'zgartira olmaydi)', async () => {
    const view = getChecklistView({ firstWin: { completedAt: Date.now() }, checklist: null });
    const fw = view.items.find((x) => x.itemId === 'first_win');
    expect(fw.done).toBe(true);
    expect(fw.locked).toBe(true);

    const res = await submitChecklistItem({ userKey: USER, itemId: 'first_win', done: false });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('first_win_locked');
  });

  it('profil done → progress 2/5 (first_win + profil); idempotent', async () => {
    const r1 = await submitChecklistItem({ userKey: USER, itemId: 'profil', done: true });
    expect(r1.ok).toBe(true);
    expect(r1.step).toBe('checklist');
    expect(r1.progress.done).toBe(2);
    expect(r1.progress.total).toBe(5);
    // Takroriy — o'zgarmaydi
    const r2 = await submitChecklistItem({ userKey: USER, itemId: 'profil', done: true });
    expect(r2.progress.done).toBe(2);
    // §28: qayta ochish (done=false)
    const r3 = await submitChecklistItem({ userKey: USER, itemId: 'profil', done: false });
    expect(r3.progress.done).toBe(1);
  });

  it('unknown_item → error', async () => {
    const res = await submitChecklistItem({ userKey: USER, itemId: 'nope', done: true });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unknown_item');
  });

  it('hammasi done → step=done (§07)', async () => {
    await submitChecklistItem({ userKey: USER, itemId: 'profil', done: true });
    const r = await submitChecklistItem({ userKey: USER, itemId: 'telegram', done: true });
    expect(r.step).toBe('checklist'); // 3/5
    const r2 = await submitChecklistItem({ userKey: USER, itemId: 'kalendar', done: true });
    const r3 = await submitChecklistItem({ userKey: USER, itemId: 'streak', done: true });
    expect(r3.ok).toBe(true);
    expect(r3.step).toBe('done');
    expect(r3.progress.percent).toBe(100);
    // DB'da saqlangan
    const snap = await fb.get(`onboarding/${safeKey(USER)}`);
    expect(snap.val().step).toBe('done');
    expect(snap.val().checklist.completedAt).toBeTruthy();
  });

  it('checklistProgress / getChecklistView: 5/5 → 100%', () => {
    const all = CHECKLIST_ITEMS.map((id) => ({ itemId: id, done: true }));
    // firstWin item har doim fwDone faktiga bog'liq — done=false bo'lsa 4/5
    const p = checklistProgress({ items: all }, true);
    expect(p.done).toBe(5);
    expect(p.percent).toBe(100);
    const view = getChecklistView({ firstWin: { completedAt: Date.now() }, checklist: { items: all } });
    expect(view.items.length).toBe(5);
    expect(view.items.every((x) => x.done)).toBe(true);
  });
});

describe('AUTH B-19 — welcome sequence', () => {
  beforeAll(async () => {
    await snapshotDb();
    // Day-0 user: activated_at 2 kun oldin → w0 + w1 o'tishi kerak
    await fb.set('users/b19-w', { username: 'b19w', email: 'b19w@test.uz', settings: { lang: 'uz' } });
    await fb.set(`onboarding/${safeKey('b19-w')}`, {
      step: 'checklist',
      activated_at: Date.now() - 2 * 86400000,
      updated_at: Date.now(),
      orient: { subject: 'matematika', skipped: false, submittedAt: Date.now() - 2 * 86400000 },
      firstWin: { subject: 'matematika', completedAt: Date.now() - 1 * 86400000, score: 3, total: 5 },
    });
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('WELCOME_DAYS: 0/1/3/7 (4 ta)', () => {
    expect(WELCOME_DAYS.map((d) => d.day)).toEqual([0, 1, 3, 7]);
  });

  it('runWelcomeSequence: Day 0 → sent; day flag yoziladi (takroriy emas)', async () => {
    const sent = [];
    const r = await runWelcomeSequence({
      deps: { sendEmail: async (msg) => { sent.push(msg.tag); return { ok: true }; } },
    });
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(r.skipped).toBeGreaterThanOrEqual(0);
    // day flag yozilgan — keyingi run hech narsa yubormaydi (shu day uchun)
    const snap = await fb.get(`onboarding/${safeKey('b19-w')}/welcomeSent`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().w0).toBeTruthy();
    const r2 = await runWelcomeSequence({
      deps: { sendEmail: async () => { throw new Error('duplicate!'); } },
    });
    expect(r2.sent).toBe(0);
  });

  it('Day 1 ham yuboriladi (ageDays=2 >= 1), Day 3/7 emas', async () => {
    const sent = [];
    const r = await runWelcomeSequence({
      deps: { sendEmail: async (msg) => { sent.push(msg.tag); return { ok: true }; } },
    });
    expect(sent).toContain('welcome-w1');
    expect(sent).not.toContain('welcome-w3');
    expect(sent).not.toContain('welcome-w7');
  });

  it('Orient qilmagan user → skip (spam yo\'q, §16)', async () => {
    await fb.set('users/b19-no', { username: 'b19no', email: 'b19no@test.uz' });
    await fb.set(`onboarding/${safeKey('b19-no')}`, { step: 'welcome', welcome_sent_at: Date.now() });
    const r = await runWelcomeSequence({
      deps: { sendEmail: async () => { throw new Error('should not send'); } },
    });
    // hech narsa yuborilmaydi (welcome'da, orient yo'q)
    expect(r.sent).toBe(0);
  });
});
