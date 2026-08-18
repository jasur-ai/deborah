/**
 * Edikit — Team Challenge & shared-device (C4-01) Tests
 * ------------------------------------------------------
 * coverage: team model/safe name, assignment modes (random/balanced/roster),
 * team count guard, absence/late-join recompute, talk seconds validation,
 * aggregate scoring (normalized_average answered-eligible, sum_equal_size
 * guard, individual mode), tie policy ranking, team-only leaderboard
 * projection (member IDs hidden), answer-service single_team_device
 * (responseOwnerId=team, no individual copy, duplicate team answer rejected),
 * evidenceUnit=group.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import {
  isTeamsEnabled,
  isSingleTeamDevice,
  isTalkEnabled,
  assertTalkSeconds,
  buildTeam,
  recomputeActiveMembers,
  assignTeams,
  aggregateTeamScore,
  rankTeamsWithTiePolicy,
  projectTeamForMember,
} from '../../services/cast/team-service.js';
import {
  buildTeamLeaderboard,
  teamOnlyProjection,
  rankTeams,
} from '../../services/cast/leaderboard.js';
import { submitAnswer } from '../../services/cast/answer-service.js';
import { EVIDENCE_UNIT } from '../../utils/cast-constants.js';

const SID = 'cast_team_test';
const PRIV = `cast_private/${SID}`;

// submitAnswer server-authoritative — state + private question kerak
const TEAM_STATE = {
  phase: 'QUESTION_OPEN',
  questionId: 'q_team_1',
  openedAt: Date.now() - 2000,
  closesAt: Date.now() + 60000,
  revision: 1,
};

const TEAM_PRIV_Q = {
  id: 'q_team_1',
  text: 'Jamoa savoli',
  options: [
    { id: 'o1', text: 'A' },
    { id: 'o2', text: 'B' },
    { id: 'o3', text: 'C' },
    { id: 'o4', text: 'D' },
  ],
  correctOptionIds: ['o2'],
};

const TEAM_CONFIG = {
  teams: {
    enabled: true,
    mode: 'single_team_device',
    assignment: 'random',
    count: 2,
    scoreAggregation: 'normalized_average',
    talkEnabled: true,
    talkSeconds: 60,
    reporterRotation: true,
    tiePolicy: 'first_answered',
  },
};

const TEAMS_OFF = { teams: { enabled: false } };

describe('C4-01: Team Challenge', () => {
  beforeAll(async () => {
    await fb.remove(PRIV);
    await fb.remove(`cast_sessions/${SID}`);
    // Session state + private question yozamiz (submitAnswer uchun)
    await fb.set(`cast_sessions/${SID}/state`, TEAM_STATE);
    await fb.set(`${PRIV}/questions/q_team_1`, TEAM_PRIV_Q);
    // Local-db transaction chuqur path uchun intermediate node'lar kerak
    await fb.set(`${PRIV}/answers`, {
      q_team_1: { team_1: {}, p1: {}, p2: {}, p3: {}, p9: {} },
    });
  });

  afterAll(async () => {
    await fb.remove(PRIV);
    await fb.remove(`cast_sessions/${SID}`);
  });

  describe('team model & config', () => {
    it('isTeamsEnabled / isSingleTeamDevice / isTalkEnabled', () => {
      expect(isTeamsEnabled(TEAM_CONFIG)).toBe(true);
      expect(isTeamsEnabled(TEAMS_OFF)).toBe(false);
      expect(isSingleTeamDevice(TEAM_CONFIG)).toBe(true);
      expect(isSingleTeamDevice({ teams: { enabled: true, mode: 'individual_then_aggregate' } })).toBe(false);
      expect(isTalkEnabled(TEAM_CONFIG)).toBe(true);
      expect(isTalkEnabled({ teams: { enabled: true, talkEnabled: false } })).toBe(false);
    });

    it('buildTeam sanitizes name + dedupes members', () => {
      const t = buildTeam({ teamId: 'team_1', name: '<Jamoa> 1', memberIds: ['p1', 'p2', 'p1'] });
      expect(t.name).toBe('Jamoa 1');
      expect(t.memberIds).toEqual(['p1', 'p2']);
      expect(t.name.length).toBeLessThanOrEqual(40);
    });

    it('assertTalkSeconds validates bounds', () => {
      expect(assertTalkSeconds(60)).toBe(60);
      expect(() => assertTalkSeconds(5)).toThrow();
      expect(() => assertTalkSeconds(601)).toThrow();
      expect(() => assertTalkSeconds('abc')).toThrow();
    });

    it('recomputeActiveMembers drops absent + counts online only', () => {
      const team = buildTeam({ teamId: 'team_1', memberIds: ['p1', 'p2', 'p3'] });
      const participants = {
        p1: { presence: 'online' },
        p2: { presence: 'offline' },
        p3: { presence: 'online' },
      };
      const updated = recomputeActiveMembers(team, participants);
      expect(updated.memberIds).toEqual(['p1', 'p2', 'p3']);
      expect(updated.activeMemberCount).toBe(2);
      // Missing participant removed
      const pruned = recomputeActiveMembers(team, { p1: { presence: 'online' } });
      expect(pruned.memberIds).toEqual(['p1']);
    });
  });

  describe('assignment', () => {
    const ps = [
      { participantId: 'p1', displayAlias: 'Ali' },
      { participantId: 'p2', displayAlias: 'Bek' },
      { participantId: 'p3', displayAlias: 'Sam' },
      { participantId: 'p4', displayAlias: 'Dil' },
      { participantId: 'p5', displayAlias: 'Esh' },
    ];

    it('random/balanced — every participant assigned to a team 1..count', () => {
      const { teams, assignments } = assignTeams({ participants: ps, teamsConfig: TEAM_CONFIG.teams });
      expect(Object.keys(teams)).toHaveLength(2);
      expect(Object.keys(assignments)).toHaveLength(5);
      for (const pid of Object.keys(assignments)) {
        expect(['team_1', 'team_2']).toContain(assignments[pid]);
      }
      // Balanced: ~equal sizes (5 into 2 → 3+2)
      const sizes = Object.values(teams).map((t) => t.memberIds.length).sort((a, b) => a - b);
      expect(Math.abs(sizes[0] - sizes[1])).toBeLessThanOrEqual(1);
    });

    it('roster assignment honors rosterTeamId', () => {
      const rosterPs = ps.map((p, i) => ({ ...p, rosterTeamId: i < 2 ? 'team_2' : 'team_1' }));
      const { assignments } = assignTeams({ participants: rosterPs, teamsConfig: { ...TEAM_CONFIG.teams, assignment: 'roster' } });
      expect(assignments.p1).toBe('team_2');
      expect(assignments.p2).toBe('team_2');
      expect(assignments.p3).toBe('team_1');
    });

    it('manual keeps existing teamId assignments', () => {
      const manualPs = ps.map((p, i) => ({ ...p, teamId: i % 2 === 0 ? 'team_1' : 'team_2' }));
      const { assignments } = assignTeams({ participants: manualPs, teamsConfig: { ...TEAM_CONFIG.teams, assignment: 'manual' } });
      expect(assignments.p1).toBe('team_1');
      expect(assignments.p2).toBe('team_2');
    });
  });

  describe('aggregate scoring', () => {
    const team = buildTeam({ teamId: 'team_1', memberIds: ['p1', 'p2', 'p3'] });

    it('normalized_average uses only answered eligible members (item 9)', () => {
      const scores = {
        p1: { total: 900, answeredCount: 1 },
        p2: { total: 700, answeredCount: 1 },
        p3: { total: 0, answeredCount: 0 }, // answered emas → denominator'ga kirmaydi
      };
      const r = aggregateTeamScore({ scoresByMember: scores, team, teamsConfig: TEAM_CONFIG.teams });
      expect(r.score).toBe(800); // (900+700)/2
      expect(r.answeredEligible).toBe(2);
    });

    it('normalized_average — no answers → null score', () => {
      const r = aggregateTeamScore({ scoresByMember: { p1: { total: 0 } }, team, teamsConfig: TEAM_CONFIG.teams });
      expect(r.score).toBeNull();
    });

    it('sum_equal_size returns sum', () => {
      const r = aggregateTeamScore({
        scoresByMember: { p1: { total: 900, answeredCount: 1 }, p2: { total: 700, answeredCount: 1 } },
        team,
        teamsConfig: { ...TEAM_CONFIG.teams, scoreAggregation: 'sum_equal_size' },
      });
      expect(r.score).toBe(1600);
    });

    it('individual mode → no team score', () => {
      const r = aggregateTeamScore({
        scoresByMember: { p1: { total: 900, answeredCount: 1 } },
        team,
        teamsConfig: { ...TEAM_CONFIG.teams, scoreAggregation: 'individual' },
      });
      expect(r.score).toBeNull();
    });
  });

  describe('team leaderboard & tie policy', () => {
    it('rankTeamsWithTiePolicy — first_answered orders by answeredEligible on tie', () => {
      const rows = [
        { teamId: 'team_1', name: 'Jamoa 1', score: 800, answeredEligible: 2 },
        { teamId: 'team_2', name: 'Jamoa 2', score: 800, answeredEligible: 3 },
        { teamId: 'team_3', name: 'Jamoa 3', score: 600, answeredEligible: 1 },
      ];
      const ranked = rankTeamsWithTiePolicy(rows, 'first_answered');
      expect(ranked[0].teamId).toBe('team_2');
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].teamId).toBe('team_1');
      expect(ranked[1].rank).toBe(1); // same score → same rank (tie)
      expect(ranked[2].teamId).toBe('team_3');
    });

    it('alphabetical tie policy', () => {
      const rows = [
        { teamId: 'team_b', name: 'Beta', score: 500, answeredEligible: 1 },
        { teamId: 'team_a', name: 'Alpha', score: 500, answeredEligible: 1 },
      ];
      const ranked = rankTeamsWithTiePolicy(rows, 'alphabetical');
      expect(ranked[0].teamId).toBe('team_a');
    });

    it('buildTeamLeaderboard + teamOnlyProjection hides member identity', () => {
      const teams = {
        team_1: { teamId: 'team_1', name: 'Jamoa 1', memberIds: ['p1', 'p2'] },
        team_2: { teamId: 'team_2', name: 'Jamoa 2', memberIds: ['p3', 'p4'] },
      };
      // single_team_device'da scores responseOwnerId = teamId ostida
      const scores = {
        team_1: { total: 900, answeredCount: 1 },
        team_2: { total: 1000, answeredCount: 1 },
      };
      const lb = buildTeamLeaderboard(teams, scores, TEAM_CONFIG.teams);
      expect(lb).toHaveLength(2);
      const proj = teamOnlyProjection(lb);
      expect(proj.mode).toBe('team_only');
      expect(JSON.stringify(proj)).not.toContain('p1');
      expect(JSON.stringify(proj)).not.toContain('memberIds');
      expect(proj.entries[0].teamId).toBe('team_2'); // 1000 > 900
    });

    it('buildTeamLeaderboard — individual_then_aggregate uses per-member scores', () => {
      const teams = {
        team_1: { teamId: 'team_1', name: 'Jamoa 1', memberIds: ['p1', 'p2'] },
        team_2: { teamId: 'team_2', name: 'Jamoa 2', memberIds: ['p3', 'p4'] },
      };
      const scores = {
        p1: { total: 900, answeredCount: 1 },
        p2: { total: 700, answeredCount: 1 },
        p3: { total: 1000, answeredCount: 1 },
        p4: { total: 0, answeredCount: 0 },
      };
      const cfg = { ...TEAM_CONFIG.teams, mode: 'individual_then_aggregate' };
      const lb = buildTeamLeaderboard(teams, scores, cfg);
      // team_1: (900+700)/2 = 800; team_2: 1000/1 = 1000
      expect(lb[0].teamId).toBe('team_2');
      expect(lb[0].score).toBe(1000);
      expect(lb[1].teamId).toBe('team_1');
      expect(lb[1].score).toBe(800);
    });

    it('rankTeams tie-aware', () => {
      const ranked = rankTeams([
        { teamId: 'a', score: 100 },
        { teamId: 'b', score: 100 },
        { teamId: 'c', score: 50 },
      ]);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(1);
      expect(ranked[2].rank).toBe(3);
    });
  });

  describe('answer-service — single_team_device', () => {
    it('team answer recorded with responseOwnerId=team + evidenceUnit=group (no individual copy)', async () => {
      const answer = await submitAnswer({
        sessionId: SID,
        questionId: 'q_team_1',
        participantId: 'p1',
        teamId: 'team_1',
        commandId: 'cmd_team_1',
        selectedOptionIds: ['o2'],
        config: TEAM_CONFIG,
      });
      expect(answer.status).toBe('ACCEPTED');
      expect(answer.scoreRecord.responseOwnerId).toBe('team_1');
      expect(answer.scoreRecord.evidenceUnit).toBe(EVIDENCE_UNIT.GROUP);

      // Answer record'da ham team ownership
      const rec = await fb.get(`${PRIV}/answers/q_team_1/team_1/1`);
      expect(rec.exists()).toBe(true);
      const val = rec.val();
      expect(val.responseOwnerId).toBe('team_1');
      expect(val.evidenceUnit).toBe(EVIDENCE_UNIT.GROUP);
      expect(val.participantId).toBe('p1'); // submitter saqlanadi
      // Individual copy YO'Q (item 8)
      const ind = await fb.get(`${PRIV}/answers/q_team_1/p1/1`);
      expect(ind.exists()).toBe(false);
    });

    it('duplicate team answer rejected (second member)', async () => {
      await expect(
        submitAnswer({
          sessionId: SID,
          questionId: 'q_team_1',
          participantId: 'p2',
          teamId: 'team_1',
          commandId: 'cmd_team_1_dup',
          selectedOptionIds: ['o3'],
          config: TEAM_CONFIG,
        })
      ).rejects.toThrow();
    });

    it('missing teamId in single_team_device → rejected', async () => {
      await expect(
        submitAnswer({
          sessionId: SID,
          questionId: 'q_team_1',
          participantId: 'p3',
          commandId: 'cmd_no_team',
          selectedOptionIds: ['o2'],
          config: TEAM_CONFIG,
        })
      ).rejects.toThrow();
    });

    it('individual_then_aggregate — individual answer, evidenceUnit=individual', async () => {
      const aggConfig = { ...TEAM_CONFIG, teams: { ...TEAM_CONFIG.teams, mode: 'individual_then_aggregate' } };
      const answer = await submitAnswer({
        sessionId: SID,
        questionId: 'q_team_1',
        participantId: 'p9',
        commandId: 'cmd_ind_agg',
        selectedOptionIds: ['o2'],
        config: aggConfig,
      });
      expect(answer.scoreRecord.responseOwnerId).toBe('p9');
      expect(answer.scoreRecord.evidenceUnit).toBe(EVIDENCE_UNIT.INDIVIDUAL);
      const ind = await fb.get(`${PRIV}/answers/q_team_1/p9/1`);
      expect(ind.exists()).toBe(true);
    });
  });

  describe('projectTeamForMember privacy', () => {
    it('returns own team info + reporter flag only', () => {
      const team = buildTeam({ teamId: 'team_1', memberIds: ['p1', 'p2', 'p3'] });
      team.reporterIndex = 1;
      const forP1 = projectTeamForMember(team, 'p1');
      expect(forP1.teamId).toBe('team_1');
      expect(forP1.isReporter).toBe(false);
      const forP2 = projectTeamForMember(team, 'p2');
      expect(forP2.isReporter).toBe(true);
      // Boshqa member ID'lar oshkor qilinmaydi (faqat count)
      expect(JSON.stringify(forP1)).not.toContain('p2');
      expect(JSON.stringify(forP1)).not.toContain('p3');
    });
  });
});
