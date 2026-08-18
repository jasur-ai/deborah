/**
 * Deborah — Cast Self-Paced Race (C3-16) Tests
 * ---------------------------------------------
 * coverage: isSelfPaced, buildPersonalOrder, initCursor (idempotent, late-join
 * position), projectCursor (privacy — order/rank boshqa foydalanuvchiga
 * chiqmaydi), activateSelfPaced, pauseAll/resumeAll (expiry shift), advanceCursor
 * (finish + answeredCount), checkCursorExpiry, computeOwnRank (private), 
 * directorDistribution (faqat count'lar), fairnessHealth, finalizeRace.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  isSelfPaced,
  buildPersonalOrder,
  initCursor,
  getCursor,
  setCursor,
  listCursors,
  removeCursor,
  activateSelfPaced,
  getSpMeta,
  pauseAll,
  resumeAll,
  advanceCursor,
  checkCursorExpiry,
  computeOwnRank,
  projectCursor,
  directorDistribution,
  fairnessHealth,
  finalizeRace,
} from '../../services/cast/self-paced-service.js';

const SP_CONFIG = {
  pace: 'self_paced',
  selfPaced: {
    enabled: true,
    perQuestionSeconds: 60,
    randomizeOrder: true,
    lateJoinStart: 'first',
    lateJoinPosition: 0,
    rankVisibility: 'private',
    publicLiveRank: false,
    fairnessWindowSeconds: 30,
  },
};

const SP_CONFIG_NO_RANDOM = {
  pace: 'self_paced',
  selfPaced: { enabled: true, perQuestionSeconds: 60, randomizeOrder: false },
};

const NON_SP_CONFIG = { pace: 'instructor', selfPaced: { enabled: false } };

const SID = 'cast_sp_test';
const SP_ROOT = `cast_private/${SID}`;
const SP_META_PATH = `${SP_ROOT}/self_paced_meta`;
const QIDS = ['q1', 'q2', 'q3', 'q4', 'q5'];

describe('C3-16: Self-Paced Race', () => {
  beforeAll(async () => {
    await fb.remove(SP_ROOT);
    await fb.remove('cast_sessions/' + SID);
  });

  afterAll(async () => {
    await fb.remove(SP_ROOT);
    await fb.remove('cast_sessions/' + SID);
  });

  describe('isSelfPaced + buildPersonalOrder', () => {
    it('enabled only with pace=self_paced + selfPaced.enabled', () => {
      expect(isSelfPaced(SP_CONFIG)).toBe(true);
      expect(isSelfPaced(NON_SP_CONFIG)).toBe(false);
      expect(isSelfPaced(null)).toBe(false);
      expect(isSelfPaced({ pace: 'self_paced', selfPaced: { enabled: false } })).toBe(false);
    });

    it('deterministic personal order per (session, participant)', () => {
      const a1 = buildPersonalOrder({ questionIds: QIDS, sessionSeed: 7, participantId: 'p_a', randomize: true });
      const a2 = buildPersonalOrder({ questionIds: QIDS, sessionSeed: 7, participantId: 'p_a', randomize: true });
      const b1 = buildPersonalOrder({ questionIds: QIDS, sessionSeed: 7, participantId: 'p_b', randomize: true });
      expect(a1).toEqual(a2);
      expect(a1).not.toEqual(b1); // turli participant → turli order (statistik; deterministik)
      expect([...a1].sort()).toEqual([...QIDS].sort());
    });

    it('no randomize keeps original order', () => {
      const o = buildPersonalOrder({ questionIds: QIDS, sessionSeed: 1, participantId: 'p_x', randomize: false });
      expect(o).toEqual(QIDS);
    });
  });

  describe('initCursor', () => {
    it('rejects when self-paced off', async () => {
      await expect(initCursor({ sessionId: SID, participantId: 'p_rej', questionIds: QIDS, config: NON_SP_CONFIG })).rejects.toThrow();
    });

    it('creates cursor with personal order + position 0', async () => {
      const proj = await initCursor({ sessionId: SID, participantId: 'p1', questionIds: QIDS, config: SP_CONFIG, sessionSeed: 42, meta: { status: 'lobby' } });
      expect(proj.currentQuestionId).toBeTruthy();
      expect(proj.totalQuestions).toBe(5);
      expect(proj.position).toBe(0);
      expect(proj.status).toBe('pending');
      const raw = await getCursor(SID, 'p1');
      expect(raw.order.length).toBe(5);
      expect(raw.order[0]).toBe(proj.currentQuestionId);
    });

    it('idempotent — existing cursor unchanged', async () => {
      const raw = await getCursor(SID, 'p1');
      raw.position = 2;
      raw.status = 'active';
      await setCursor(SID, 'p1', raw);
      const proj = await initCursor({ sessionId: SID, participantId: 'p1', questionIds: QIDS, config: SP_CONFIG, sessionSeed: 42 });
      expect(proj.position).toBe(2);
      expect(proj.status).toBe('active');
    });

    it('late-join position config — in-session join starts at configured position', async () => {
      const cfg = {
        pace: 'self_paced',
        selfPaced: { enabled: true, perQuestionSeconds: 60, randomizeOrder: false, lateJoinStart: 'position', lateJoinPosition: 3 },
      };
      const proj = await initCursor({ sessionId: SID, participantId: 'p_late', questionIds: QIDS, config: cfg, sessionSeed: 1, meta: { status: 'started' } });
      expect(proj.position).toBe(3);
      expect(proj.currentQuestionId).toBe('q4');
    });

    it('late-join in lobby starts at 0', async () => {
      const proj = await initCursor({ sessionId: SID, participantId: 'p_late2', questionIds: QIDS, config: SP_CONFIG, sessionSeed: 1, meta: { status: 'lobby' } });
      expect(proj.position).toBe(0);
    });
  });

  describe('projectCursor privacy', () => {
    it('exposes own position + currentQuestionId only — no full order leak', async () => {
      const raw = { participantId: 'p_priv', order: QIDS, position: 1, status: 'active', questionOpenedAt: 100, questionExpiresAt: 200, finishedAt: null, answeredCount: 0, progress: 0 };
      const proj = projectCursor(raw);
      expect(proj.currentQuestionId).toBe('q2');
      expect(proj.order).toBeUndefined();
      expect(proj.totalQuestions).toBe(5);
      expect(proj.progress).toBeCloseTo(0.2);
      expect(Object.keys(proj)).toEqual(expect.arrayContaining(['position', 'totalQuestions', 'currentQuestionId', 'status', 'answeredCount', 'progress']));
    });
  });

  describe('activateSelfPaced', () => {
    it('activates pending cursors + sets meta', async () => {
      await initCursor({ sessionId: SID, participantId: 'p_act', questionIds: QIDS, config: SP_CONFIG, sessionSeed: 5, meta: { status: 'lobby' } });
      const res = await activateSelfPaced({ sessionId: SID, questionIds: QIDS, config: SP_CONFIG, sessionSeed: 5 });
      expect(res.count).toBeGreaterThanOrEqual(1);
      const c = await getCursor(SID, 'p_act');
      expect(c.status).toBe('active');
      expect(c.questionExpiresAt).toBeGreaterThan(c.questionOpenedAt);
      const meta = await getSpMeta(SID);
      expect(meta.paused).toBe(false);
      expect(meta.activatedAt).toBeTruthy();
    });
  });

  describe('pauseAll / resumeAll', () => {
    it('pause sets paused flag; resume shifts expiry by paused duration', async () => {
      const c0 = await getCursor(SID, 'p_act');
      const before = c0.questionExpiresAt;
      const { count } = await pauseAll(SID);
      expect(count).toBeGreaterThanOrEqual(1);
      const metaP = await getSpMeta(SID);
      expect(metaP.paused).toBe(true);
      // Expiry pause davomida muzlatilgan — hali o'zgarmagan
      const c1 = await getCursor(SID, 'p_act');
      expect(c1.questionExpiresAt).toBe(before);
      // Resume — expiry pause davriga suriladi
      await new Promise((r) => setTimeout(r, 25));
      const { count: rcount } = await resumeAll(SID, SP_CONFIG);
      expect(rcount).toBeGreaterThanOrEqual(1);
      const c2 = await getCursor(SID, 'p_act');
      expect(c2.questionExpiresAt).toBeGreaterThan(before);
      const metaR = await getSpMeta(SID);
      expect(metaR.paused).toBe(false);
    });
  });

  describe('advanceCursor', () => {
    it('advances to next question; finished at end', async () => {
      // maxsus 2-savolli cursor
      await fb.set(`cast_private/${SID}/self_paced/p_adv`, {
        participantId: 'p_adv',
        order: ['q1', 'q2'],
        position: 0,
        status: 'active',
        startedAt: Date.now(),
        questionOpenedAt: Date.now(),
        questionExpiresAt: Date.now() + 60000,
        pausedAt: null,
        totalPausedMs: 0,
        finishedAt: null,
        answeredCount: 0,
      });
      const r1 = await advanceCursor({ sessionId: SID, participantId: 'p_adv', config: SP_CONFIG });
      expect(r1.finished).toBe(false);
      expect(r1.cursor.currentQuestionId).toBe('q2');
      const r2 = await advanceCursor({ sessionId: SID, participantId: 'p_adv', config: SP_CONFIG });
      expect(r2.finished).toBe(true);
      expect(r2.cursor.status).toBe('finished');
      expect(r2.cursor.finishedAt).toBeTruthy();
    });
  });

  describe('checkCursorExpiry', () => {
    it('expired cursor auto-advances', async () => {
      await fb.set(`cast_private/${SID}/self_paced/p_exp`, {
        participantId: 'p_exp',
        order: ['q1', 'q2'],
        position: 0,
        status: 'active',
        startedAt: Date.now(),
        questionOpenedAt: Date.now(),
        questionExpiresAt: Date.now() - 1000,
        pausedAt: null,
        totalPausedMs: 0,
        finishedAt: null,
        answeredCount: 0,
      });
      const r = await checkCursorExpiry({ sessionId: SID, participantId: 'p_exp' });
      expect(r.expired).toBe(true);
      expect(r.cursor.currentQuestionId).toBe('q2');
    });

    it('not expired — unchanged', async () => {
      await fb.set(`cast_private/${SID}/self_paced/p_ok`, {
        participantId: 'p_ok',
        order: ['q1', 'q2'],
        position: 0,
        status: 'active',
        startedAt: Date.now(),
        questionOpenedAt: Date.now(),
        questionExpiresAt: Date.now() + 60000,
        pausedAt: null,
        totalPausedMs: 0,
        finishedAt: null,
        answeredCount: 0,
      });
      const r = await checkCursorExpiry({ sessionId: SID, participantId: 'p_ok' });
      expect(r.expired).toBe(false);
      expect(r.cursor.currentQuestionId).toBe('q1');
    });
  });

  describe('computeOwnRank (private)', () => {
    it('returns own rank + total without others identity', async () => {
      await fb.set(`cast_private/${SID}/self_paced/p_r1`, {
        participantId: 'p_r1', order: QIDS, position: 2, status: 'active', startedAt: Date.now() - 10000, totalPausedMs: 0, answeredCount: 3, finishedAt: null,
      });
      await fb.set(`cast_private/${SID}/self_paced/p_r2`, {
        participantId: 'p_r2', order: QIDS, position: 0, status: 'active', startedAt: Date.now() - 5000, totalPausedMs: 0, answeredCount: 1, finishedAt: null,
      });
      const r = await computeOwnRank({ sessionId: SID, participantId: 'p_r1' });
      expect(r.total).toBeGreaterThanOrEqual(2);
      expect(r.rank).toBe(1); // ko'proq javob → 1-o'rin
      expect(r.answeredCount).toBe(3);
    });
  });

  describe('directorDistribution + fairnessHealth', () => {
    it('aggregate exposes counts only (no participant ids)', async () => {
      const dist = await directorDistribution(SID);
      expect(dist.total).toBeGreaterThanOrEqual(1);
      expect(dist.histogram).toBeTruthy();
      expect(dist.finished).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(dist)).not.toMatch(/p_/); // identity yo'q
    });

    it('fairness health computes participation + spread', async () => {
      const h = await fairnessHealth({ sessionId: SID, config: SP_CONFIG });
      expect(h).toHaveProperty('participationRate');
      expect(h).toHaveProperty('spreadScore');
      expect(h.ok).toBeTypeOf('boolean');
    });
  });

  describe('finalizeRace', () => {
    it('marks all unfinished cursors finished', async () => {
      const res = await finalizeRace(SID);
      expect(res.count).toBeGreaterThanOrEqual(1);
      const cursors = await listCursors(SID);
      for (const c of Object.values(cursors)) {
        expect(c.finishedAt).toBeTruthy();
      }
    });
  });

  describe('removeCursor', () => {
    it('removes participant cursor', async () => {
      await removeCursor(SID, 'p_ok');
      const c = await getCursor(SID, 'p_ok');
      expect(c).toBeNull();
    });
  });

  describe('review fixes', () => {
    it('checkCursorExpiry does NOT advance during global pause', async () => {
      await fb.set(`${SP_ROOT}/self_paced/p_paused_exp`, {
        participantId: 'p_paused_exp',
        order: ['q1', 'q2'],
        position: 0,
        status: 'active',
        startedAt: Date.now(),
        questionOpenedAt: Date.now(),
        questionExpiresAt: Date.now() - 1000, // expired, lekin pause'da
        pausedAt: null,
        totalPausedMs: 0,
        finishedAt: null,
        answeredCount: 0,
      });
      await fb.set(SP_META_PATH, { activatedAt: Date.now(), paused: true, pausedAt: Date.now(), totalPausedMs: 0 });
      const r = await checkCursorExpiry({ sessionId: SID, participantId: 'p_paused_exp' });
      expect(r.expired).toBe(false); // pause'da o'tkazib yubormaydi
      expect(r.cursor.currentQuestionId).toBe('q1');
    });

    it('resumeAll shifts expiry by the paused duration (expiry repair)', async () => {
      // Faqat shu cursor uchun toza meta + active cursor
      await fb.set(`${SP_ROOT}/self_paced/p_repair`, {
        participantId: 'p_repair',
        order: ['q1', 'q2'],
        position: 0,
        status: 'active',
        startedAt: Date.now(),
        questionOpenedAt: Date.now(),
        questionExpiresAt: Date.now() + 30000,
        pausedAt: null,
        totalPausedMs: 0,
        finishedAt: null,
        answeredCount: 0,
      });
      await fb.set(SP_META_PATH, { activatedAt: Date.now(), paused: false, pausedAt: null, totalPausedMs: 0 });
      const before = (await getCursor(SID, 'p_repair')).questionExpiresAt;
      await pauseAll(SID);
      await new Promise((r) => setTimeout(r, 60));
      const afterPause = (await getCursor(SID, 'p_repair')).questionExpiresAt;
      expect(afterPause).toBe(before); // pause'da expiry muzlatilgan
      const r = await resumeAll(SID, SP_CONFIG);
      expect(r.count).toBeGreaterThanOrEqual(1);
      const afterResume = (await getCursor(SID, 'p_repair')).questionExpiresAt;
      expect(afterResume).toBeGreaterThan(before + 40); // pause davriga surilgan
    });

    it('preset selfPaced override on non-self-paced preset fills missing fields (strict snapshot safe)', async () => {
      const { resolvePreset } = await import('../../services/cast/presets.js');
      const r = resolvePreset('responsive_accuracy', { selfPaced: { perQuestionSeconds: 90 } });
      expect(r.config.selfPaced.enabled).toBe(false); // SECTION_FILL'dan to'ldirildi
      expect(r.config.selfPaced.perQuestionSeconds).toBe(90);
      expect(r.config.selfPaced.rankVisibility).toBe('private');
    });
  });
});
