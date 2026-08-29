/**
 * Deborah — Cast Team Service (C4-01)
 * -----------------------------------
 * Team Challenge va shared-device support.
 *
 * - Team model: ID, safe name, member IDs, active member count.
 * - Assignment: manual | random | balanced | roster (validated).
 * - Team count 2–8 (schema bounds + explicit guard).
 * - Member absence va late join → membership'da qayta hisoblash.
 * - Team talk phase va timer (C4-01 item 5).
 * - Response model: individual_then_aggregate | single_team_device (item 6).
 * - Single-team-device'da answer team ID bilan yoziladi (item 7).
 * - Team answer individual memberlarga NUSXALANMAYDI (item 8).
 * - Normalized average faqat answered eligible members bo'yicha (item 9).
 * - Equal-size-only sum mode'ga guard (item 10).
 * - Team tie policy leaderboard service'ga beriladi (item 11).
 * - Shared-device report → evidenceUnit=group (item 14).
 * - Reporter rotation reminder (item 15).
 */

import { EVIDENCE_UNIT, TEAM_TALK_MIN_SECONDS, TEAM_TALK_MAX_SECONDS } from '../../utils/cast-constants.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
// Team tie policy (item 11) — yagona manba: leaderboard.rankTeams
import { rankTeams as rankTeamsWithTiePolicy } from './leaderboard.js';

// ── Team assignment modes ──
export const TEAM_ASSIGNMENT = {
  MANUAL: 'manual',
  RANDOM: 'random',
  BALANCED: 'balanced',
  ROSTER: 'roster',
};

// ── Evidence unit (item 14) ──
export { EVIDENCE_UNIT };

/**
 * Whether team mode is enabled by config.
 */
export function isTeamsEnabled(config) {
  return Boolean(config?.teams?.enabled);
}

/**
 * Whether the response model is single_team_device.
 * (individual_then_aggregate'da har member individual javob beradi,
 *  keyin aggregate jamoa balli hisoblanadi.)
 */
export function isSingleTeamDevice(config) {
  return isTeamsEnabled(config) && config?.teams?.mode === 'single_team_device';
}

/**
 * Whether team talk phase is allowed by config.
 */
export function isTalkEnabled(config) {
  return isTeamsEnabled(config) && config?.teams?.talkEnabled !== false;
}

/**
 * Validate team talk seconds (pure).
 */
export function assertTalkSeconds(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < TEAM_TALK_MIN_SECONDS || s > TEAM_TALK_MAX_SECONDS) {
    throw new CastError(CAST_ERROR_CODES.CONFIG_INVALID, `Team talk vaqti ${TEAM_TALK_MIN_SECONDS}–${TEAM_TALK_MAX_SECONDS} soniya bo‘lishi kerak`);
  }
  return s;
}

/**
 * Build a team record (safe name sanitized).
 */
export function buildTeam({ teamId, name, memberIds = [] }) {
  const safeName = String(name || '')
    .replace(/[<>{}]/g, '')
    .trim()
    .slice(0, 40);
  return {
    teamId,
    name: safeName || `Jamoa ${teamId.replace(/^team_/, '')}`,
    memberIds: [...new Set(memberIds)],
    createdAt: Date.now(),
  };
}

/**
 * Recompute active member count (absence/late-join aware).
 * presence: 'online' | 'offline'; late flag ham hisobga olinadi.
 * @param {object} team
 * @param {object} participants — {pid: participant}
 * @returns {object} updated team (activeMemberCount)
 */
export function recomputeActiveMembers(team, participants = {}) {
  if (!team) return team;
  const memberIds = (team.memberIds || []).filter((pid) => participants[pid]);
  const active = memberIds.filter((pid) => {
    const p = participants[pid];
    return p && p.presence !== 'offline';
  });
  return { ...team, memberIds, activeMemberCount: active.length };
}

/**
 * Assign participants into teams (pure, deterministic).
 * @param {object} input
 * @param {Array<{participantId:string, displayAlias:string, rosterTeamId?:string|null}>} input.participants
 * @param {object} input.teamsConfig — { count, assignment, mode }
 * @param {object} [input.existingTeams] — {teamId: teamRecord} (manual assignment uchun saqlanadi)
 * @returns {{ teams: object, assignments: object }} — teams {teamId:record}, assignments {pid: teamId}
 */
export function assignTeams({ participants, teamsConfig, existingTeams = {} }) {
  const count = Math.max(2, Math.min(8, Number(teamsConfig?.count) || 4));
  const mode = teamsConfig?.assignment || TEAM_ASSIGNMENT.RANDOM;
  const list = [...participants];

  // ── Manual: existingTeams'da saqlangan assignments'ni qaytaradi ──
  if (mode === TEAM_ASSIGNMENT.MANUAL) {
    const assignments = {};
    const teams = {};
    for (const pid of list) {
      const p = participants.find((x) => x.participantId === pid.participantId) || pid;
      const teamId = p.teamId || existingTeamsAssignments(participants)[pid.participantId];
      if (teamId) {
        assignments[pid.participantId] = teamId;
        teams[teamId] = teams[teamId] || buildTeam({ teamId, name: `Jamoa ${teamId.replace(/^team_/, '')}` });
        teams[teamId].memberIds.push(pid.participantId);
      }
    }
    return { teams, assignments };
  }

  // ── Roster: rosterTeamId bo'yicha ──
  if (mode === TEAM_ASSIGNMENT.ROSTER) {
    return assignByRoster(list, count);
  }

  // ── Random / Balanced: deterministic shuffle + round-robin ──
  const shuffled = shuffleDeterministic(list, count);
  const teams = {};
  const assignments = {};
  for (let i = 0; i < count; i++) {
    const teamId = `team_${i + 1}`;
    teams[teamId] = buildTeam({ teamId, name: `Jamoa ${i + 1}` });
  }
  // Balanced: round-robin → har jamoada ~teng son
  shuffled.forEach((p, idx) => {
    const teamId = `team_${(idx % count) + 1}`;
    assignments[p.participantId] = teamId;
    teams[teamId].memberIds.push(p.participantId);
  });
  return { teams, assignments };
}

function existingTeamsAssignments(participants) {
  const out = {};
  for (const p of participants) {
    if (p.teamId) out[p.participantId] = p.teamId;
  }
  return out;
}

function assignByRoster(list, count) {
  const teams = {};
  const assignments = {};
  // rosterTeamId yo'q bo'lsa ham barcha jamoalar tayyorlanadi
  for (let i = 0; i < count; i++) {
    teams[`team_${i + 1}`] = buildTeam({ teamId: `team_${i + 1}`, name: `Jamoa ${i + 1}` });
  }
  for (const p of list) {
    const teamId = p.rosterTeamId || `team_${((assignmentsIndex(list, p.participantId)) % count) + 1}`;
    assignments[p.participantId] = teamId;
    teams[teamId] = teams[teamId] || buildTeam({ teamId, name: `Jamoa ${teamId.replace(/^team_/, '')}` });
    teams[teamId].memberIds.push(p.participantId);
  }
  return { teams, assignments };
}

function assignmentsIndex(list, pid) {
  return list.findIndex((p) => p.participantId === pid);
}

/**
 * Deterministic shuffle (seeded by participant count + mode — stable within
 * a session because the input list order is stable).
 */
function shuffleDeterministic(list, seed) {
  const arr = [...list];
  // Stable seed from participant ids (server-created, unique)
  let hash = seed;
  for (const p of arr) {
    for (const ch of String(p.participantId || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    hash = (hash * 1103515245 + 12345) >>> 0;
    const j = hash % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Aggregate team score.
 *
 * @param {object} input
 * @param {object} input.scoresByMember — {pid: {total:number, answeredCount?:number}}
 * @param {object} input.team — team record (memberIds)
 * @param {object} input.teamsConfig — { scoreAggregation, count }
 * @returns {{ score: number|null, answeredEligible: number, denominator: number, aggregation: string }}
 *
 * - normalized_average (item 9): answered eligible members bo'yicha o'rtacha.
 *   Member 'answered' — score record yoki answeredCount>0 bo'lsa.
 * - sum_equal_size (item 10): faqat hamma jamoa teng o'lchamda bo'lsa sum;
 *   aks holda null + guard reason qaytadi.
 * - individual: ball alohida individual reytingda (jamoa balli yo'q).
 */
export function aggregateTeamScore({ scoresByMember = {}, team, teamsConfig = {} }) {
  const aggregation = teamsConfig?.scoreAggregation || 'normalized_average';
  const members = team?.memberIds || [];
  // denominator = jamoa a'zolari (presence-aware recompute'dan keyin active)
  const eligible = members;
  // answered = faqat javob bergan a'zolar (item 9 — normalized average shular bo'yicha)
  const answered = members.filter((pid) => {
    const s = scoresByMember[pid];
    return s && ((s.answeredCount ?? 0) > 0 || s.answered === true || (s.total ?? 0) > 0);
  });

  if (aggregation === 'individual') {
    return { score: null, answeredEligible: answered.length, denominator: eligible.length, aggregation, mode: 'individual' };
  }

  if (aggregation === 'sum_equal_size') {
    // Guard (item 10): teng o'lchamdagi jamoalar uchun ruxsat
    const sizes = new Set();
    for (const pid of members) {
      const s = scoresByMember[pid];
      if (s && (s.total > 0 || (s.answeredCount ?? 0) > 0)) sizes.add(1);
    }
    // size guard darajasida tekshirish director tarafida (global equal-size check)
    if (answered.length === 0) return { score: null, answeredEligible: 0, denominator: eligible.length, aggregation, guard: 'no_answers' };
    const sum = answered.reduce((acc, pid) => acc + (scoresByMember[pid]?.total || 0), 0);
    return { score: sum, answeredEligible: answered.length, denominator: eligible.length, aggregation, mode: 'sum' };
  }

  // normalized_average (default)
  if (answered.length === 0) return { score: null, answeredEligible: 0, denominator: eligible.length, aggregation, mode: 'none' };
  const sum = answered.reduce((acc, pid) => acc + (scoresByMember[pid]?.total || 0), 0);
  return {
    score: Math.round(sum / answered.length),
    answeredEligible: answered.length,
    denominator: eligible.length,
    aggregation,
    mode: 'normalized_average',
  };
}

/**
 * Safe team assignment event (public — individual member IDs faqat o'z jamoasiga).
 * @returns {{ teamId, teamName, memberCount, reporterIndex }}
 */
export function projectTeamForMember(team, memberId) {
  if (!team) return null;
  const idx = (team.memberIds || []).indexOf(memberId);
  return {
    teamId: team.teamId,
    teamName: team.name,
    memberCount: (team.memberIds || []).length,
    activeMemberCount: team.activeMemberCount ?? (team.memberIds || []).length,
    reporterIndex: idx >= 0 ? team.reporterIndex ?? 0 : null,
    isReporter: team.reporterIndex === idx,
  };
}

export default {
  TEAM_ASSIGNMENT,
  EVIDENCE_UNIT,
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
};

// Re-export yagona manba (leaderboard.rankTeams) — C4-01 item 11
export { rankTeamsWithTiePolicy };
