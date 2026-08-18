/**
 * Deborah — Pedagogically Safe Power-ups (C3-17) Tests
 * -----------------------------------------------------
 * coverage: isPowerUpsEnabled, allowedTypes, isTypeAllowed (registry — random
 * elimination/sabotage EXCLUDED), initInventory, activatePowerUp (idempotent,
 * allowed-types check, inventory decrement, effect build — extra_time personal
 * timer policy), grantPowerUp, projectInventory (privacy), director summary,
 * scoring engagement breakdown (raw correctness unchanged).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  isPowerUpsEnabled,
  allowedTypes,
  isTypeAllowed,
  initInventory,
  getInventory,
  activatePowerUp,
  grantPowerUp,
  projectInventory,
  directorPowerupSummary,
} from '../../services/cast/powerup-service.js';
import { calculateQuestionScore } from '../../services/cast/scoring.js';
import { POWERUP_TYPES, POWERUP_TYPE_LIST } from '../../utils/cast-constants.js';

const SID = 'cast_pu_test';
const PU_ROOT = `cast_private/${SID}`;

const PU_CONFIG = {
  powerUps: {
    enabled: true,
    allowedTypes: ['hint', 'extra_time', 'team_consult'],
    startingInventory: { hint: 2, extra_time: 1, team_consult: 1 },
    extraTimeSeconds: 15,
    teamConsistent: true,
  },
};

const PU_CONFIG_NO_PERSONAL = {
  powerUps: {
    enabled: true,
    allowedTypes: ['extra_time'],
    startingInventory: { extra_time: 1 },
    extraTimeSeconds: 15,
    teamConsistent: true,
  },
};

const DISABLED_CONFIG = { powerUps: { enabled: false, allowedTypes: [] } };

describe('C3-17: Pedagogically Safe Power-ups', () => {
  beforeAll(async () => {
    await fb.remove(PU_ROOT);
  });

  afterAll(async () => {
    await fb.remove(PU_ROOT);
  });

  describe('registry safety', () => {
    it('exactly 4 allowed types — no random elimination / sabotage', () => {
      expect(POWERUP_TYPE_LIST).toEqual(['hint', 'extra_time', 'team_consult', 'private_redemption']);
      expect(POWERUP_TYPE_LIST).not.toContain('eliminate');
      expect(POWERUP_TYPE_LIST).not.toContain('sabotage');
      expect(POWERUP_TYPE_LIST).not.toContain('random_elimination');
      expect(POWERUP_TYPE_LIST).not.toContain('opponent_sabotage');
    });

    it('enabled only when enabled + allowedTypes non-empty', () => {
      expect(isPowerUpsEnabled(PU_CONFIG)).toBe(true);
      expect(isPowerUpsEnabled(DISABLED_CONFIG)).toBe(false);
      expect(isPowerUpsEnabled({ powerUps: { enabled: true, allowedTypes: [] } })).toBe(false);
      expect(isPowerUpsEnabled(null)).toBe(false);
    });

    it('isTypeAllowed filters against registry + config', () => {
      expect(isTypeAllowed(PU_CONFIG, 'hint')).toBe(true);
      expect(isTypeAllowed(PU_CONFIG, 'private_redemption')).toBe(false); // config ruxsat bermagan
      expect(isTypeAllowed(PU_CONFIG, 'sabotage')).toBe(false); // registry'da yo'q
    });
  });

  describe('initInventory', () => {
    it('creates inventory from startingInventory', async () => {
      const proj = await initInventory({ sessionId: SID, participantId: 'p1', config: PU_CONFIG });
      expect(proj.enabled).toBe(true);
      expect(proj.counts.hint).toBe(2);
      expect(proj.counts.extra_time).toBe(1);
      expect(proj.allowed).toEqual(['hint', 'extra_time', 'team_consult']);
    });

    it('idempotent — existing inventory unchanged', async () => {
      const inv = await getInventory(SID, 'p1');
      inv.hint = 5;
      await fb.set(`${PU_ROOT}/powerups/p1`, inv);
      const proj = await initInventory({ sessionId: SID, participantId: 'p1', config: PU_CONFIG });
      expect(proj.counts.hint).toBe(5);
    });

    it('default inventory when startingInventory empty', async () => {
      const proj = await initInventory({
        sessionId: SID,
        participantId: 'p_def',
        config: { powerUps: { enabled: true, allowedTypes: ['hint'], startingInventory: {}, extraTimeSeconds: 15 } },
      });
      expect(proj.counts.hint).toBe(1); // POWERUP_DEFAULT_INVENTORY.hint
    });
  });

  describe('activatePowerUp', () => {
    it('rejects when disabled', async () => {
      await expect(
        activatePowerUp({ sessionId: SID, participantId: 'p1', type: 'hint', config: DISABLED_CONFIG })
      ).rejects.toThrow();
    });

    it('rejects unknown type and disallowed type', async () => {
      await expect(
        activatePowerUp({ sessionId: SID, participantId: 'p1', type: 'sabotage', config: PU_CONFIG })
      ).rejects.toThrow();
      await expect(
        activatePowerUp({ sessionId: SID, participantId: 'p1', type: 'private_redemption', config: PU_CONFIG })
      ).rejects.toThrow(); // allowedTypes'da yo'q
    });

    it('activates hint — decrements inventory + logs used', async () => {
      const res = await activatePowerUp({ sessionId: SID, participantId: 'p1', type: 'hint', config: PU_CONFIG, questionId: 'q1' });
      expect(res.activated).toBe(true);
      expect(res.inventory.counts.hint).toBe(4); // 5 - 1 (idempotent test'dan 5 bo'ldi)
      expect(res.effect.kind).toBe('hint_shown');
      // Used log yozilgan
      const used = await fb.get(`${PU_ROOT}/powerups_used/p1`);
      expect(used.val()['hint:q1']).toBeTruthy();
    });

    it('idempotent — same (type, question) replays, no double decrement', async () => {
      const before = (await getInventory(SID, 'p1')).hint;
      const res = await activatePowerUp({ sessionId: SID, participantId: 'p1', type: 'hint', config: PU_CONFIG, questionId: 'q1' });
      expect(res.activated).toBe(false);
      expect(res.replay).toBe(true);
      const after = (await getInventory(SID, 'p1')).hint;
      expect(after).toBe(before); // ikkinchi marta kamaymaydi
    });

    it('rejects when inventory exhausted', async () => {
      // p1'ning extra_time 1 ta — ishlatamiz, keyin qayta → yo'q
      await activatePowerUp({ sessionId: SID, participantId: 'p1', type: 'extra_time', config: PU_CONFIG, questionId: 'q2' });
      await expect(
        activatePowerUp({ sessionId: SID, participantId: 'p1', type: 'extra_time', config: PU_CONFIG, questionId: 'q3' })
      ).rejects.toThrow();
    });

    it('extra_time effect: no personal timer → not silently applied (item 7)', async () => {
      await initInventory({ sessionId: SID, participantId: 'p_npt', config: PU_CONFIG_NO_PERSONAL });
      const res = await activatePowerUp({ sessionId: SID, participantId: 'p_npt', type: 'extra_time', config: PU_CONFIG_NO_PERSONAL, questionId: 'q1' });
      expect(res.activated).toBe(true);
      expect(res.effect.kind).toBe('no_personal_timer');
      expect(res.effect.applied).toBe(false); // global timerga silent apply YO'Q
      expect(res.effect.seconds).toBe(0);
    });

    it('extra_time with personal timer (self-paced) applies seconds', async () => {
      const cfgWithPersonal = {
        powerUps: { enabled: true, allowedTypes: ['extra_time'], startingInventory: { extra_time: 1 }, extraTimeSeconds: 20, teamConsistent: true },
        selfPaced: { enabled: true, perQuestionSeconds: 60 },
      };
      await initInventory({ sessionId: SID, participantId: 'p_personal', config: cfgWithPersonal });
      const res = await activatePowerUp({ sessionId: SID, participantId: 'p_personal', type: 'extra_time', config: cfgWithPersonal, questionId: 'q1' });
      expect(res.effect.kind).toBe('extra_time');
      expect(res.effect.seconds).toBe(20);
      expect(res.effect.applied).toBe(true);
    });

    it('team_consult marks consistency (item 11)', async () => {
      await initInventory({ sessionId: SID, participantId: 'p_team', config: PU_CONFIG });
      const res = await activatePowerUp({ sessionId: SID, participantId: 'p_team', type: 'team_consult', config: PU_CONFIG, questionId: 'q1', teamMemberId: 'p2' });
      expect(res.effect.kind).toBe('team_consult');
      expect(res.effect.consistent).toBe(true);
    });
  });

  describe('grantPowerUp', () => {
    it('adds count to inventory (fresh participant)', async () => {
      await initInventory({ sessionId: SID, participantId: 'p_g', config: { powerUps: { enabled: true, allowedTypes: ['hint'], startingInventory: {}, extraTimeSeconds: 15 } } });
      const res = await grantPowerUp({ sessionId: SID, participantId: 'p_g', type: 'hint', config: PU_CONFIG, count: 2 });
      // default hint=1 (POWERUP_DEFAULT_INVENTORY) + grant 2 = 3
      expect(res.inventory.counts.hint).toBe(3);
    });
  });

  describe('projectInventory privacy', () => {
    it('exposes only own counts + allowed — no other participants', async () => {
      const proj = projectInventory({ hint: 1, extra_time: 0, team_consult: 0, private_redemption: 0 }, PU_CONFIG);
      expect(proj.counts.hint).toBe(1);
      expect(proj).not.toHaveProperty('participantId');
      expect(Object.keys(proj.counts)).toEqual(POWERUP_TYPE_LIST);
    });
  });

  describe('director summary', () => {
    it('aggregate counts only — no identity', async () => {
      const s = await directorPowerupSummary(SID);
      expect(s.total).toBeGreaterThanOrEqual(1);
      expect(s.usedCount).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(s)).not.toMatch(/p_/);
    });
  });

  describe('scoring engagement breakdown (item 9, 10)', () => {
    it('raw correctness unchanged — engagement multiplier separate', () => {
      const correct = calculateQuestionScore({
        mode: 'accuracy', isCorrect: true, elapsedMs: 500, limitMs: 30000,
        config: { correctBase: 1000, speedBonusMax: 0, multiplier: 1 },
        engagementMultiplier: 1,
      });
      const doubled = calculateQuestionScore({
        mode: 'accuracy', isCorrect: true, elapsedMs: 500, limitMs: 30000,
        config: { correctBase: 1000, speedBonusMax: 0, multiplier: 1 },
        engagementMultiplier: 2,
      });
      expect(correct.breakdown.isCorrect).toBe(true);
      expect(doubled.breakdown.isCorrect).toBe(true); // correctness o'zgarmaydi
      expect(doubled.breakdown.engagementMultiplier).toBe(2);
      expect(doubled.breakdown.preEngagement).toBe(correct.score);
      expect(doubled.score).toBe(correct.score * 2);
      expect(correct.breakdown.base).toBe(1000);
    });
  });
});
